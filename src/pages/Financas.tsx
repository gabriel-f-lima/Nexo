import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, ChevronLeft, ChevronRight, CreditCard, Gauge, Lock, Plus, ReceiptText, Scale, Tags, Target, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { Header, Modal } from '../components/ui';
import TransactionForm from '../components/TransactionForm';
import CategoryManager from '../components/CategoryManager';
import Paywall from '../components/Paywall';
import Plans from '../components/Plans';
import NoticeBox from '../components/NoticeBox';
import SelectField from '../components/SelectField';
import QuickEntry from '../components/planning/QuickEntry';
import { InsightList, Tabs, type TabItem } from '../components/planning/ui';
import CardsTab from '../components/finance/CardsTab';
import BillsTab from '../components/finance/BillsTab';
import BudgetsTab from '../components/finance/BudgetsTab';
import ChartsTab from '../components/finance/ChartsTab';
import { LIMITS, type Limits } from '../lib/billing';
import { useTier } from '../lib/useTier';
import { useFinanceStore, type Transaction } from '../store/finance';
import { canEditFinanceDay } from '../lib/rules';
import { notify } from '../lib/toast';
import { useAuthStore } from '../store/auth';
import { addMonthsToMonth, formatLongDate, formatMonthName, formatMonthTitle, monthOfKey, parseDateKey, toISODate } from '../lib/dates';
import { centsToInput, formatMoney, parseAmountToCents, totalsByCurrency, type Currency } from '../lib/finance';
import { availableBalance } from '../lib/ledger';
import { cardInvoices } from '../lib/cards';
import { billsToWatch } from '../lib/bills';
import { buildCoach, usedCurrencies, useSnapshot } from '../lib/derived';
import { monthlyEntriesMessage } from '../lib/limits';
import '../styles/planning.css';

const NO_CATEGORY_COLOR = '#A1ADA6';
type Tab = 'resumo' | 'cartoes' | 'contas' | 'orcamentos' | 'graficos';
const TAB_VALUES: Tab[] = ['resumo', 'cartoes', 'contas', 'orcamentos', 'graficos'];

/** Financeiro: saldo, lançamentos, cartões e faturas, contas, orçamentos e gráficos. */
function FinancasContent({ limits, tier }: { limits: Limits; tier: 'basico' | 'pro' }) {
  const [params, setParams] = useSearchParams();
  const tab = (TAB_VALUES as string[]).includes(params.get('aba') ?? '') ? params.get('aba') as Tab : 'resumo';
  const setTab = (next: Tab) => setParams(next === 'resumo' ? {} : { aba: next }, { replace: true });
  const [paywall, setPaywall] = useState<string | null>(null);
  const snapshot = useSnapshot(true);
  const insights = useMemo(() => buildCoach(snapshot), [snapshot]);
  const alerts = (prefix: RegExp) => insights.some((i) => i.tone === 'alert' && prefix.test(i.id));

  const items: TabItem<Tab>[] = [
    { value: 'resumo', label: 'Resumo', icon: <Wallet size={15} /> },
    { value: 'cartoes', label: 'Cartões', icon: <CreditCard size={15} />, alert: alerts(/^(invoice|card)-/) },
    { value: 'contas', label: 'Contas', icon: <ReceiptText size={15} />, alert: alerts(/^bill-/) },
    { value: 'orcamentos', label: 'Orçamentos', icon: <Gauge size={15} />, alert: alerts(/^budget-/) },
    { value: 'graficos', label: 'Gráficos', icon: <BarChart3 size={15} /> },
  ];

  return (
    <div className="screen">
      <Header title="Financeiro" subtitle="Saldo, cartões, contas, orçamentos e gráficos" />
      <div className="screen-stack">
        <Tabs items={items} value={tab} onChange={setTab} label="Seções do financeiro" />
        <motion.div key={tab} className="stack tab-panel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {tab === 'resumo' ? <OverviewTab tier={tier} insights={insights.filter((i) => !/^(streak|goal-done)/.test(i.id))} onPaywall={setPaywall} /> : null}
          {tab === 'cartoes' ? <CardsTab /> : null}
          {tab === 'contas' ? <BillsTab /> : null}
          {tab === 'orcamentos' ? <BudgetsTab /> : null}
          {tab === 'graficos' ? <ChartsTab limits={limits} onPaywall={setPaywall} /> : null}
        </motion.div>
      </div>
      <Paywall open={paywall !== null} onClose={() => setPaywall(null)} title="Recurso dos planos" message={paywall ?? ''} />
    </div>
  );
}

function OverviewTab({ tier, insights, onPaywall }: {
  tier: 'basico' | 'pro';
  insights: ReturnType<typeof buildCoach>;
  onPaywall: (message: string) => void;
}) {
  const navigate = useNavigate();
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const cards = useFinanceStore((s) => s.cards);
  const cardPayments = useFinanceStore((s) => s.cardPayments);
  const bills = useFinanceStore((s) => s.bills);
  const goals = useFinanceStore((s) => s.goals);
  const loaded = useFinanceStore((s) => s.loaded);
  const finance = useFinanceStore();
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const user = useAuthStore((s) => s.user);
  const today = toISODate();

  const [month, setMonth] = useState(monthOfKey(today));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<Currency | null>(null);

  const monthItems = useMemo(() => transactions.filter((t) => monthOfKey(t.occurredOn) === month), [transactions, month]);
  const monthTotals = useMemo(() => totalsByCurrency(monthItems), [monthItems]);
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    monthItems.forEach((t) => {
      const list = map.get(t.occurredOn) ?? [];
      list.push(t);
      map.set(t.occurredOn, list);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthItems]);

  const currencies = usedCurrencies(finance);
  const cardCurrency = (id: string) => cards.find((c) => c.id === id)?.currency;
  const balances = (currencies.length ? currencies : (['BRL'] as Currency[])).map((currency) => {
    const balance = availableBalance(transactions, cardPayments, cardCurrency, currency, today);
    const invoicesDue = cards.filter((c) => c.currency === currency && !c.archived)
      .flatMap((c) => cardInvoices(c, transactions, cardPayments, today))
      .filter((i) => i.status === 'closed' || i.status === 'overdue')
      .reduce((s, i) => s + i.remainingCents, 0);
    const billsDue = billsToWatch(bills.filter((b) => b.currency === currency), transactions, today, 31)
      .filter((o) => monthOfKey(o.dueDate) <= monthOfKey(today))
      .reduce((s, o) => s + o.bill.amountCents, 0);
    const totals = totalsByCurrency(transactions.filter((t) => monthOfKey(t.occurredOn) === monthOfKey(today) && t.currency === currency))[0];
    return { currency, balance, invoicesDue, billsDue, income: totals?.income ?? 0, expense: totals?.expense ?? 0 };
  });

  const openNew = () => requireAuth(() => {
    const limit = monthlyEntriesMessage(tier, transactions.filter((t) => monthOfKey(t.occurredOn) === monthOfKey(today)).length);
    if (limit) { onPaywall(limit); return; }
    setEditing(null);
    setFormOpen(true);
  });
  const openEdit = (t: Transaction) => {
    if (!canEditFinanceDay(t.occurredOn)) { notify('Lançamentos de dias anteriores a ontem ficam só para consulta.', 'info'); return; }
    setEditing(t); setFormOpen(true);
  };

  return (
    <>
      {balances.map((b) => (
        <motion.section key={b.currency} className="hero-card money-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="row between">
            <span className="label"><Wallet size={15} /> Saldo disponível hoje · {b.currency}</span>
            <button type="button" className="link-btn" style={{ fontSize: 12.5, padding: 0 }} onClick={() => requireAuth(() => setAdjusting(b.currency))}><Scale size={13} style={{ verticalAlign: -2 }} /> Ajustar</button>
          </div>
          <div className={`value${b.balance < 0 ? ' negative' : ''}`}>{formatMoney(b.balance, b.currency)}</div>
          <div className="money-split">
            <div><div className="k"><TrendingUp size={12} color="var(--accent)" /> Receitas do mês</div><div className="v" style={{ color: 'var(--accent)' }}>{formatMoney(b.income, b.currency)}</div></div>
            <div><div className="k"><TrendingDown size={12} color="var(--danger)" /> Gastos do mês</div><div className="v">{formatMoney(b.expense, b.currency)}</div></div>
            {b.invoicesDue ? <div><div className="k"><CreditCard size={12} /> Faturas a pagar</div><div className="v" style={{ color: 'var(--warn)' }}>{formatMoney(b.invoicesDue, b.currency)}</div></div> : null}
            {b.billsDue ? <div><div className="k"><ReceiptText size={12} /> Contas a pagar</div><div className="v" style={{ color: 'var(--warn)' }}>{formatMoney(b.billsDue, b.currency)}</div></div> : null}
          </div>
        </motion.section>
      ))}

      <QuickEntry />

      <InsightList insights={insights} limit={3} />

      <div className="row gap-sm">
        <motion.button type="button" className="btn btn-primary grow" whileTap={{ scale: 0.98 }} onClick={openNew}><Plus size={18} /> Novo lançamento</motion.button>
        <motion.button type="button" className="btn btn-ghost" whileTap={{ scale: 0.98 }} onClick={() => requireAuth(() => setCategoriesOpen(true))}><Tags size={17} /> Categorias</motion.button>
      </div>

      <div className="cal" style={{ padding: 12 }}>
        <div className="row between">
          <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setMonth(addMonthsToMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={17} /></motion.button>
          <span className="cal-title" style={{ textTransform: 'none' }}>{formatMonthTitle(month)}</span>
          <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setMonth(addMonthsToMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={17} /></motion.button>
        </div>
        {monthTotals.length ? (
          <div className="row gap-sm" style={{ marginTop: 10, flexWrap: 'wrap', justifyContent: 'center', fontSize: 12.5 }}>
            {monthTotals.map((t) => (
              <span key={t.currency} className="text-2">
                {t.currency}: <span style={{ color: 'var(--accent)' }}>+{formatMoney(t.income, t.currency)}</span> · <span style={{ color: 'var(--danger)' }}>−{formatMoney(t.expense, t.currency)}</span> · resultado <strong style={{ color: t.balance < 0 ? 'var(--danger)' : 'var(--text)' }}>{formatMoney(t.balance, t.currency)}</strong>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {user && !loaded ? <p className="muted center" style={{ fontSize: 13 }}>Carregando lançamentos…</p> : null}

      {groups.length ? groups.map(([day, list]) => (
        <div key={day} className="stack" style={{ gap: 8 }}>
          <div className="section-hint" style={{ marginTop: 6 }}>{formatLongDate(parseDateKey(day))}{day > today ? ' · agendado' : ''}</div>
          {list.map((t) => {
            const category = categories.find((c) => c.id === t.categoryId);
            const card = t.cardId ? cards.find((c) => c.id === t.cardId) : undefined;
            const income = t.type === 'income';
            return (
              <motion.button key={t.id} type="button" className="task-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.98 }} onClick={() => openEdit(t)}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: category?.color ?? NO_CATEGORY_COLOR, flexShrink: 0 }} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.description || category?.name || 'Sem descrição'}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {category?.name ?? 'Sem categoria'}
                    <span className="tx-tags">
                      {card ? <span className="tx-tag"><CreditCard size={10} /> {card.name}{t.installmentTotal ? ` ${t.installmentNumber}/${t.installmentTotal}` : ''}</span> : null}
                      {t.billId || t.billPeriod ? <span className="tx-tag bill"><ReceiptText size={10} /> conta</span> : null}
                    </span>
                  </span>
                </span>
                <span style={{ fontWeight: 700, fontSize: 14, color: income ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap' }}>
                  {income ? '+' : '−'} {formatMoney(t.amountCents, t.currency)}
                </span>
              </motion.button>
            );
          })}
        </div>
      )) : (
        <div className="empty-card">
          <Wallet size={24} color="var(--muted)" />
          <strong>Nenhum lançamento em {formatMonthName(month)}</strong>
          <span>Use o registro rápido acima ou o botão Novo lançamento.</span>
        </div>
      )}

      <button type="button" className="tile" onClick={() => navigate('/app/metas')}>
        <span className="row gap-sm"><span className="tile-icon"><Target size={16} /></span><strong className="grow">Metas financeiras</strong><ChevronRight size={16} className="muted" /></span>
        <span className="tile-label">
          {goals.length
            ? `${goals.length} ${goals.length === 1 ? 'meta' : 'metas'} · agora em Metas, junto com objetivos e metas de sequência.`
            : 'Crie metas para juntar dinheiro e ligue cada uma à agenda e à rotina em Metas.'}
        </span>
      </button>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      <CategoryManager open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <Modal open={adjusting !== null} onClose={() => setAdjusting(null)} title="Ajustar saldo">
        {adjusting ? <AdjustBalance currency={adjusting} current={balances.find((b) => b.currency === adjusting)?.balance ?? 0} onDone={() => setAdjusting(null)} onPaywall={onPaywall} tier={tier} /> : null}
      </Modal>
    </>
  );
}

/** Iguala o saldo do Nexo ao do banco com um lançamento de ajuste (receita ou despesa pela diferença). */
function AdjustBalance({ currency, current, onDone, onPaywall, tier }: {
  currency: Currency; current: number; onDone: () => void; onPaywall: (message: string) => void; tier: 'basico' | 'pro';
}) {
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const transactions = useFinanceStore((s) => s.transactions);
  const [value, setValue] = useState(centsToInput(Math.abs(current)));
  const [negative, setNegative] = useState(current < 0);
  const [error, setError] = useState('');

  const save = (event: FormEvent) => {
    event.preventDefault();
    const raw = value.trim() === '0' || value.trim() === '0,00' ? 0 : parseAmountToCents(value);
    if (raw === null) { setError('Informe o saldo do seu banco, como 1.250,00.'); return; }
    const target = negative ? -raw : raw;
    const diff = target - current;
    if (diff === 0) { onDone(); return; }
    const today = toISODate();
    const limit = monthlyEntriesMessage(tier, transactions.filter((t) => monthOfKey(t.occurredOn) === monthOfKey(today)).length);
    if (limit) { onPaywall(limit); return; }
    addTransaction({
      type: diff > 0 ? 'income' : 'expense', amountCents: Math.abs(diff), currency, categoryId: null,
      occurredOn: today, description: 'Ajuste de saldo',
    });
    notify(`Saldo ajustado para ${formatMoney(target, currency)}.`, 'success');
    onDone();
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <p className="text-2" style={{ fontSize: 13.5 }}>Quanto você tem hoje na conta (em {currency})? O Nexo registra a diferença como “Ajuste de saldo”.</p>
      <div className="row gap-sm">
        <SelectField label="Sinal" width={110} value={negative ? '-' : '+'} onChange={(next) => setNegative(next === '-')} options={[{ value: '+', label: 'Positivo' }, { value: '-', label: 'Negativo' }]} />
        <input className="input grow" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label="Saldo atual" autoFocus />
      </div>
      <NoticeBox>Hoje o Nexo calcula {formatMoney(current, currency)}: receitas, menos despesas à vista e faturas pagas, até hoje.</NoticeBox>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Ajustar saldo</motion.button>
    </form>
  );
}

/** Gestão financeira: liberada nos planos pagos, com os limites de cada nível. */
export default function Financas() {
  const userId = useAuthStore((s) => s.user?.id);
  const tier = useTier(userId);
  if (tier === 'loading') {
    return (
      <div className="screen">
        <Header title="Financeiro" subtitle="Carregando seu plano…" />
        <div className="loading-inline" role="status" aria-label="Carregando"><div className="spinner" /></div>
      </div>
    );
  }
  if (tier === 'free' || !LIMITS[tier].finance) return <FinanceLocked />;
  return <FinancasContent limits={LIMITS[tier]} tier={tier} />;
}

function FinanceLocked() {
  return (
    <div className="screen">
      <Header title="Financeiro" subtitle="Disponível nos planos pagos" />
      <div className="screen-stack">
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div className="row gap-sm"><Lock size={16} color="var(--accent)" /><strong>Gestão financeira completa</strong></div>
          <p className="text-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Saldo disponível, cartões de crédito com fechamento e vencimento de fatura, contas a pagar com aviso, orçamentos por categoria,
            gráficos e exportação. No Básico você registra até {LIMITS.basico.monthlyEntries} lançamentos por mês; no Pro, sem limite.
          </p>
        </div>
        <Plans />
      </div>
    </div>
  );
}

