import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Lock, Plus, Tags, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Header } from '../components/ui';
import TransactionForm from '../components/TransactionForm';
import CategoryManager from '../components/CategoryManager';
import GoalsSection from '../components/GoalsSection';
import Paywall from '../components/Paywall';
import Plans from '../components/Plans';
import { LIMITS, type Limits } from '../lib/billing';
import { useTier } from '../lib/useTier';
import { BalanceLine, BarsChart, DonutChart, type BarDatum, type LinePoint, type SliceDatum } from '../components/charts';
import { useFinanceStore, type Transaction } from '../store/finance';
import { canEditFinanceDay } from '../lib/rules';
import { notify } from '../lib/toast';
import { useAuthStore } from '../store/auth';
import { MONTHS, formatLongDate, parseDateKey } from '../lib/dates';
import { CURRENCIES, formatMoney, monthKeyOf, totalsByCurrency, type Currency } from '../lib/finance';
import { PERIODS, inBucket, periodRange, shiftReference, type Period } from '../lib/period';
import { downloadCsv, downloadXlsx, toExportRows } from '../lib/export';

const NO_CATEGORY_COLOR = '#A1ADA6';

/** Financeiro: lançamentos, gráficos por período, metas e exportação. */
function FinancasContent({ limits }: { limits: Limits }) {
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const goals = useFinanceStore((s) => s.goals);
  const loaded = useFinanceStore((s) => s.loaded);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const user = useAuthStore((s) => s.user);

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [paywall, setPaywall] = useState<string | null>(null);

  const [period, setPeriod] = useState<Period>('month');
  const [ref, setRef] = useState(() => new Date());
  const [currency, setCurrency] = useState<Currency>('BRL');

  const key = monthKeyOf(month);
  const monthItems = useMemo(() => transactions.filter((t) => t.occurredOn.startsWith(key)), [transactions, key]);
  const totals = useMemo(() => totalsByCurrency(monthItems), [monthItems]);
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    monthItems.forEach((t) => {
      const list = map.get(t.occurredOn) ?? [];
      list.push(t);
      map.set(t.occurredOn, list);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthItems]);

  /* Gráficos: período e moeda escolhidos */
  const range = useMemo(() => periodRange(period, ref), [period, ref]);
  const periodItems = useMemo(
    () => transactions.filter((t) => t.occurredOn >= range.start && t.occurredOn <= range.end && t.currency === currency),
    [transactions, range, currency],
  );
  const periodTotals = useMemo(() => totalsByCurrency(periodItems)[0], [periodItems]);

  const barData: BarDatum[] = useMemo(() => range.buckets.map((b) => {
    const inside = periodItems.filter((t) => inBucket(t.occurredOn, b));
    return {
      label: b.label,
      income: inside.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0),
      expense: inside.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0),
    };
  }), [range, periodItems]);

  const balancePoints: LinePoint[] = useMemo(() => {
    let running = 0;
    return range.buckets.map((b) => {
      const inside = periodItems.filter((t) => inBucket(t.occurredOn, b));
      running += inside.reduce((s, t) => s + (t.type === 'income' ? t.amountCents : -t.amountCents), 0);
      return { label: b.label, value: running / 100 };
    });
  }, [range, periodItems]);

  const slices: SliceDatum[] = useMemo(() => {
    const expenses = periodItems.filter((t) => t.type === 'expense');
    const byCategory = new Map<string, number>();
    expenses.forEach((t) => {
      const k = t.categoryId ?? '__none__';
      byCategory.set(k, (byCategory.get(k) ?? 0) + t.amountCents);
    });
    return Array.from(byCategory.entries())
      .map(([id, value]) => {
        const category = categories.find((c) => c.id === id);
        return {
          name: category?.name ?? 'Sem categoria',
          color: category?.color ?? NO_CATEGORY_COLOR,
          value: value / 100,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [periodItems, categories]);

  const exportName = `nuvora-financeiro-${range.start}-a-${range.end}`;
  const exportAll = () => transactions.filter((t) => t.occurredOn >= range.start && t.occurredOn <= range.end);

  const doCsv = () => {
    if (!limits.csvExport) { setPaywall('A exportação faz parte dos planos pagos.'); return; }
    const rows = toExportRows(exportAll(), categories);
    if (!rows.length) return;
    downloadCsv(rows, `${exportName}.csv`);
  };
  const doXlsx = () => {
    if (!limits.xlsxExport) { setPaywall('A exportação em planilha Excel faz parte do plano Pro.'); return; }
    const rows = toExportRows(exportAll(), categories);
    if (!rows.length) return;
    downloadXlsx(rows, goals, `${exportName}.xlsx`);
  };

  const openNew = () => requireAuth(() => {
    if (limits.monthlyEntries !== null && monthItems.length >= limits.monthlyEntries) {
      setPaywall(`Seu plano permite até ${limits.monthlyEntries} lançamentos por mês. Assine o Pro para lançamentos ilimitados.`);
      return;
    }
    setEditing(null);
    setFormOpen(true);
  });
  const openEdit = (t: Transaction) => {
    if (!canEditFinanceDay(t.occurredOn)) { notify('Lançamentos de dias anteriores a ontem ficam só para consulta.', 'info'); return; }
    setEditing(t); setFormOpen(true);
  };
  const categoryName = (id: string | null) => categories.find((c) => c.id === id);

  return (
    <div className="screen">
      <Header title="Financeiro" subtitle="Receitas, despesas, metas e gráficos" />

      <div className="screen-stack">
        {/* Mês atual: lista e totais */}
        <div className="cal" style={{ padding: 12 }}>
          <div className="row between">
            <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior">
              <ChevronLeft size={17} />
            </motion.button>
            <span className="cal-title">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
            <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Próximo mês">
              <ChevronRight size={17} />
            </motion.button>
          </div>
        </div>

        {totals.length ? totals.map((total) => (
          <motion.div key={total.currency} className="card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <span className="eyebrow">{total.currency}</span>
              <span className="text-2" style={{ fontSize: 12 }}>Saldo do mês</span>
            </div>
            <div className="stat-line" style={{ color: total.balance < 0 ? 'var(--danger)' : 'var(--text)' }}>
              {formatMoney(total.balance, total.currency)}
            </div>
            <div className="row gap-md" style={{ marginTop: 14 }}>
              <div className="grow">
                <div className="row gap-sm text-2" style={{ fontSize: 12 }}><TrendingUp size={14} color="var(--accent)" /> Receitas</div>
                <div style={{ color: 'var(--accent)', fontWeight: 700, marginTop: 2 }}>{formatMoney(total.income, total.currency)}</div>
              </div>
              <div className="grow">
                <div className="row gap-sm text-2" style={{ fontSize: 12 }}><TrendingDown size={14} color="var(--danger)" /> Despesas</div>
                <div style={{ color: 'var(--danger)', fontWeight: 700, marginTop: 2 }}>{formatMoney(total.expense, total.currency)}</div>
              </div>
            </div>
          </motion.div>
        )) : (
          <div className="empty-card">
            <Wallet size={24} color="var(--muted)" />
            <strong>Nenhum lançamento em {MONTHS[month.getMonth()]}</strong>
            <span>Registre receitas e despesas para ver o resumo do mês.</span>
          </div>
        )}

        <div className="row gap-sm">
          <motion.button type="button" className="btn btn-primary grow" whileTap={{ scale: 0.98 }} onClick={openNew}>
            <Plus size={18} /> Novo lançamento
          </motion.button>
          <motion.button type="button" className="btn btn-ghost" whileTap={{ scale: 0.98 }} onClick={() => requireAuth(() => setCategoriesOpen(true))}>
            <Tags size={17} /> Categorias
          </motion.button>
        </div>

        {user && !loaded ? <p className="muted center" style={{ fontSize: 13 }}>Carregando lançamentos…</p> : null}

        {groups.map(([day, items]) => (
          <div key={day} style={{ display: 'grid', gap: 8 }}>
            <div className="section-hint" style={{ textTransform: 'capitalize', marginTop: 6 }}>{formatLongDate(parseDateKey(day))}</div>
            {items.map((t) => {
              const category = categoryName(t.categoryId);
              const income = t.type === 'income';
              return (
                <motion.button key={t.id} type="button" className="task-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.98 }} onClick={() => openEdit(t)}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: category?.color ?? NO_CATEGORY_COLOR, flexShrink: 0 }} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.description || category?.name || 'Sem descrição'}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{category?.name ?? 'Sem categoria'}</span>
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: income ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap' }}>
                    {income ? '+' : '−'} {formatMoney(t.amountCents, t.currency)}
                  </span>
                </motion.button>
              );
            })}
          </div>
        ))}

        {/* Gráficos */}
        <div className="section-head" style={{ marginTop: 10 }}>
          <div>
            <div className="section-title">Gráficos</div>
            <div className="section-hint">Totais separados por moeda</div>
          </div>
        </div>

        <div className="row gap-sm" style={{ overflowX: 'auto', paddingBottom: 2 }}>
          {PERIODS.map((p) => (
            <button key={p.value} type="button" className="chip" aria-pressed={period === p.value} onClick={() => (limits.periods.includes(p.value) ? setPeriod(p.value) : setPaywall(`A análise por ${p.label.toLowerCase()} está disponível no plano Pro.`))}
              style={period === p.value ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
              {p.label}{limits.periods.includes(p.value) ? null : <Lock size={12} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
            </button>
          ))}
        </div>

        <div className="row between" style={{ gap: 8 }}>
          <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setRef(shiftReference(period, ref, -1))} aria-label="Período anterior">
            <ChevronLeft size={17} />
          </motion.button>
          <span className="text-2 center" style={{ fontSize: 13, textTransform: 'capitalize', flex: 1 }}>{range.label}</span>
          <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setRef(shiftReference(period, ref, 1))} aria-label="Próximo período">
            <ChevronRight size={17} />
          </motion.button>
        </div>

        <div className="row gap-sm">
          {CURRENCIES.map((c) => (
            <button key={c} type="button" className="grow" aria-pressed={currency === c} onClick={() => setCurrency(c)}
              style={{ minHeight: 38, borderRadius: 11, fontWeight: 700, fontSize: 13,
                background: currency === c ? 'var(--accent-soft)' : 'var(--bg)',
                border: `1px solid ${currency === c ? 'var(--accent)' : 'var(--border)'}`,
                color: currency === c ? 'var(--accent)' : 'var(--text-2)' }}>
              {c}
            </button>
          ))}
        </div>

        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="row between">
            <span className="text-2" style={{ fontSize: 13 }}>Receitas x despesas</span>
            <span className="text-2" style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--accent)' }}>■</span> receita <span style={{ color: 'var(--danger)', marginLeft: 6 }}>■</span> despesa
            </span>
          </div>
          {periodItems.length ? <BarsChart data={barData} /> : <p className="muted center" style={{ fontSize: 13, padding: '24px 0' }}>Sem lançamentos em {currency} neste período.</p>}
          {periodTotals ? (
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span>Saldo: <strong style={{ color: periodTotals.balance < 0 ? 'var(--danger)' : 'var(--accent)' }}>{formatMoney(periodTotals.balance, currency)}</strong></span>
              <span className="text-2">Despesas: {formatMoney(periodTotals.expense, currency)}</span>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <span className="text-2" style={{ fontSize: 13 }}>Saldo acumulado</span>
          {periodItems.length ? <BalanceLine points={balancePoints} /> : null}
        </div>

        <div className="card" style={{ display: 'grid', gap: 14 }}>
          <span className="text-2" style={{ fontSize: 13 }}>Gastos por categoria</span>
          {slices.length ? (
            <>
              <DonutChart slices={slices} centerLabel="Despesas" centerValue={formatMoney(periodTotals?.expense ?? 0, currency)} />
              <div style={{ display: 'grid', gap: 8 }}>
                {slices.map((s) => {
                  const pct = periodTotals?.expense ? Math.round((s.value * 100) / (periodTotals.expense / 100)) : 0;
                  return (
                    <div key={s.name} className="row gap-sm" style={{ fontSize: 13 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                      <span className="grow">{s.name}</span>
                      <span className="text-2">{pct}%</span>
                      <strong>{formatMoney(Math.round(s.value * 100), currency)}</strong>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted center" style={{ fontSize: 13, padding: '16px 0' }}>Sem despesas em {currency} neste período.</p>
          )}
        </div>

        <div className="row gap-sm">
          <motion.button type="button" className="btn btn-ghost grow" whileTap={{ scale: 0.98 }} onClick={doCsv} disabled={!exportAll().length}>
            <Download size={17} /> CSV
          </motion.button>
          <motion.button type="button" className="btn btn-ghost grow" whileTap={{ scale: 0.98 }} onClick={doXlsx} disabled={!exportAll().length}>
            <FileSpreadsheet size={17} /> Planilha
          </motion.button>
        </div>
        <p className="muted center" style={{ fontSize: 12 }}>Exporta todos os lançamentos do período selecionado, em todas as moedas.</p>

        <GoalsSection />
      </div>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      <CategoryManager open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <Paywall open={paywall !== null} onClose={() => setPaywall(null)} title="Recurso dos planos" message={paywall ?? ''} />
    </div>
  );
}

/** Gestão financeira: liberada nos planos pagos, com os limites de cada nível. */
export default function Financas() {
  const userId = useAuthStore((s) => s.user?.id);
  const tier = useTier(userId);
  if (tier === 'loading') return <div className="card text-2" style={{ fontSize: 13 }}>Carregando…</div>;
  if (!LIMITS[tier].finance) return <FinanceLocked />;
  return <FinancasContent limits={LIMITS[tier]} />;
}

function FinanceLocked() {
  return (
    <div className="screen">
      <Header title="Controle financeiro" subtitle="Disponível nos planos pagos" />
      <div className="screen-stack">
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div className="row gap-sm"><Lock size={16} color="var(--accent)" /><strong>Gestão financeira</strong></div>
          <p className="text-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Lançamentos, gráficos, metas e exportação. No Básico você registra até {LIMITS.basico.monthlyEntries} lançamentos por mês; no Pro, sem limite.
          </p>
        </div>
        <Plans />
      </div>
    </div>
  );
}
