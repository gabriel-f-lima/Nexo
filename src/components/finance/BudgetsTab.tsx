import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Gauge, Pencil, Plus } from 'lucide-react';
import { Modal } from '../ui';
import { SetupNote } from '../planning/ui';
import SelectField from '../SelectField';
import NoticeBox from '../NoticeBox';
import { useAuthStore } from '../../store/auth';
import { useFinanceStore, type Budget, type Category } from '../../store/finance';
import { budgetStatus } from '../../lib/ledger';
import { CURRENCIES, centsToInput, formatMoney, parseAmountToCents, type Currency } from '../../lib/finance';
import { addMonthsToMonth, daysInMonth, formatMonthName, monthOfKey, toISODate } from '../../lib/dates';

/** Orçamento mensal por categoria, com o ritmo de gasto e a projeção para o fim do mês. */
export default function BudgetsTab() {
  const budgets = useFinanceStore((s) => s.budgets);
  const categories = useFinanceStore((s) => s.categories);
  const transactions = useFinanceStore((s) => s.transactions);
  const planningReady = useFinanceStore((s) => s.planningReady);
  const loaded = useFinanceStore((s) => s.loaded);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [editing, setEditing] = useState<{ category: Category | null; budget: Budget | null } | null>(null);
  const today = toISODate();
  const month = monthOfKey(today);
  const [year, monthNumber] = month.split('-').map(Number);
  const daysLeft = daysInMonth(year, monthNumber - 1) - Number(today.slice(8, 10));

  const rows = useMemo(() => budgets
    .map((budget) => ({ budget, category: categories.find((c) => c.id === budget.categoryId), status: budgetStatus(budget, transactions, today) }))
    .filter((r) => r.category)
    .sort((a, b) => b.status.ratio - a.status.ratio), [budgets, categories, transactions, today]);
  const free = categories.filter((c) => c.kind === 'expense' && !budgets.some((b) => b.categoryId === c.id));

  if (loaded && !planningReady) return <SetupNote>Os orçamentos estão sendo ativados na sua conta. Tente de novo mais tarde.</SetupNote>;

  return (
    <div className="stack">
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="section-title">Orçamentos de {formatMonthName(month)}</div>
          <div className="section-hint">{daysLeft === 0 ? 'Último dia do mês' : `Faltam ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} para o mês acabar`}</div>
        </div>
        {free.length ? (
          <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} onClick={() => requireAuth(() => setEditing({ category: null, budget: null }))} aria-label="Novo orçamento" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 0 }}>
            <Plus size={20} />
          </motion.button>
        ) : null}
      </div>

      {rows.length ? rows.map(({ budget, category, status }) => {
        const money = (c: number) => formatMoney(c, budget.currency);
        const committed = status.spentCents + status.scheduledCents;
        const left = budget.amountCents - committed;
        const text = status.state === 'exceeded'
          ? `Passou ${money(-left)} do limite.`
          : status.exceedDay
            ? `No ritmo atual, estoura no dia ${status.exceedDay}.`
            : status.state === 'warning'
              ? `Restam ${money(left)}. Vá com calma.`
              : `Restam ${money(left)}${daysLeft > 0 ? `, cerca de ${money(Math.floor(left / Math.max(1, daysLeft)))} por dia` : ''}.`;
        return (
          <motion.button key={budget.categoryId} type="button" className="budget-row" style={{ textAlign: 'left', width: '100%' }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} onClick={() => setEditing({ category: category ?? null, budget })}>
            <div className="budget-head">
              <span className="budget-dot" style={{ background: category?.color }} />
              <strong className="grow">{category?.name}</strong>
              <span style={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{money(committed)} <span className="muted" style={{ fontWeight: 500 }}>/ {money(budget.amountCents)}</span></span>
            </div>
            <div className={`budget-track ${status.state}`}><div style={{ width: `${Math.min(100, Math.round(status.ratio * 100))}%` }} /></div>
            <div className="budget-foot">
              <span style={{ color: status.state === 'ok' ? 'var(--text-2)' : status.state === 'warning' ? 'var(--warn)' : 'var(--danger)' }}>{text}</span>
              <Pencil size={13} className="muted" />
            </div>
            {status.scheduledCents ? <span className="muted" style={{ fontSize: 11.5 }}>Inclui {money(status.scheduledCents)} já lançados para os próximos dias.</span> : null}
          </motion.button>
        );
      }) : (
        <div className="empty-card">
          <Gauge size={24} color="var(--muted)" />
          <strong>Nenhum orçamento definido</strong>
          <span>Escolha um limite por mês para as categorias em que mais gasta. O coach avisa quando o ritmo indicar que vai passar.</span>
          {free.length ? <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => setEditing({ category: null, budget: null }))}><Plus size={15} /> Definir orçamento</button> : null}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.budget ? `Orçamento de ${editing.category?.name ?? ''}` : 'Novo orçamento'}>
        {editing ? <BudgetFormBody category={editing.category} budget={editing.budget} free={free} onDone={() => setEditing(null)} /> : null}
      </Modal>
    </div>
  );
}

function BudgetFormBody({ category, budget, free, onDone }: { category: Category | null; budget: Budget | null; free: Category[]; onDone: () => void }) {
  const setBudget = useFinanceStore((s) => s.setBudget);
  const transactions = useFinanceStore((s) => s.transactions);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [categoryId, setCategoryId] = useState(category?.id ?? free[0]?.id ?? '');
  const [amount, setAmount] = useState(budget ? centsToInput(budget.amountCents) : '');
  const [currency, setCurrency] = useState<Currency>(budget?.currency ?? 'BRL');
  const [error, setError] = useState('');

  // Média dos últimos 3 meses fechados, como ponto de partida.
  const average = useMemo(() => {
    if (!categoryId) return null;
    const month = monthOfKey(toISODate());
    const months = [1, 2, 3].map((i) => addMonthsToMonth(month, -i));
    const total = transactions
      .filter((t) => t.type === 'expense' && t.categoryId === categoryId && t.currency === currency && months.includes(monthOfKey(t.occurredOn)))
      .reduce((sum, t) => sum + t.amountCents, 0);
    return total ? Math.round(total / 3) : null;
  }, [categoryId, currency, transactions]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!categoryId) { setError('Escolha a categoria.'); return; }
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe o limite do mês, como 600,00.'); return; }
    requireAuth(() => { setBudget(categoryId, currency, cents); onDone(); });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      {!budget ? (
        <SelectField label="Categoria" value={categoryId} onChange={setCategoryId} options={free.map((c) => ({ value: c.id, label: c.name }))} />
      ) : null}
      <div className="row gap-sm">
        <input className="input grow" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Limite por mês" inputMode="decimal" aria-label="Limite por mês" autoFocus />
        <SelectField label="Moeda" width={118} value={currency} onChange={(next) => setCurrency(next as Currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      {average ? (
        <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => setAmount(centsToInput(average))}>
          Usar a média dos últimos 3 meses: {formatMoney(average, currency)}
        </button>
      ) : null}
      <NoticeBox>Vale para todo mês. Compras no cartão contam no mês de cada parcela.</NoticeBox>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Salvar orçamento</motion.button>
      {budget ? (
        <button type="button" className="btn btn-danger btn-block" onClick={() => requireAuth(() => { setBudget(budget.categoryId, budget.currency, null); onDone(); })}>Remover orçamento</button>
      ) : null}
    </form>
  );
}
