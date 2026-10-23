import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Lock } from 'lucide-react';
import { BalanceLine, BarsChart, DonutChart, type BarDatum, type LinePoint, type SliceDatum } from '../charts';
import { useFinanceStore } from '../../store/finance';
import { type Limits } from '../../lib/billing';
import { CURRENCIES, formatMoney, totalsByCurrency, type Currency } from '../../lib/finance';
import { PERIODS, inBucket, periodRange, shiftReference, type Period } from '../../lib/period';
import { downloadCsv, downloadXlsx, toExportRows } from '../../lib/export';
import { notify } from '../../lib/toast';

const NO_CATEGORY_COLOR = '#A1ADA6';

/** Gráficos por período e moeda, e exportação dos lançamentos do período. */
export default function ChartsTab({ limits, onPaywall }: { limits: Limits; onPaywall: (message: string) => void }) {
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const goals = useFinanceStore((s) => s.goals);
  const cards = useFinanceStore((s) => s.cards);
  const [period, setPeriod] = useState<Period>('month');
  const [ref, setRef] = useState(() => new Date());
  const [currency, setCurrency] = useState<Currency>('BRL');

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
    const byCategory = new Map<string, number>();
    periodItems.filter((t) => t.type === 'expense').forEach((t) => {
      const k = t.categoryId ?? '__none__';
      byCategory.set(k, (byCategory.get(k) ?? 0) + t.amountCents);
    });
    return Array.from(byCategory.entries())
      .map(([id, value]) => {
        const category = categories.find((c) => c.id === id);
        return { name: category?.name ?? 'Sem categoria', color: category?.color ?? NO_CATEGORY_COLOR, value: value / 100 };
      })
      .sort((a, b) => b.value - a.value);
  }, [periodItems, categories]);

  const exportName = `nexo-financeiro-${range.start}-a-${range.end}`;
  const exportItems = useMemo(() => transactions.filter((t) => t.occurredOn >= range.start && t.occurredOn <= range.end), [transactions, range]);

  const doCsv = () => {
    if (!limits.csvExport) { onPaywall('A exportação faz parte dos planos pagos.'); return; }
    const rows = toExportRows(exportItems, categories, cards);
    if (rows.length) downloadCsv(rows, `${exportName}.csv`);
  };
  const doXlsx = () => {
    if (!limits.xlsxExport) { onPaywall('A exportação em planilha Excel faz parte do plano Pro.'); return; }
    const rows = toExportRows(exportItems, categories, cards);
    if (!rows.length) return;
    downloadXlsx(rows, goals, `${exportName}.xlsx`).catch(() => notify('Não foi possível gerar a planilha. Tente novamente.', 'error'));
  };

  return (
    <div className="stack">
      <div className="row gap-sm" style={{ overflowX: 'auto', paddingBottom: 2 }}>
        {PERIODS.map((p) => (
          <button key={p.value} type="button" className="chip" aria-pressed={period === p.value}
            onClick={() => (limits.periods.includes(p.value) ? setPeriod(p.value) : onPaywall(`A análise por ${p.label.toLowerCase()} está disponível no plano Pro.`))}
            style={period === p.value ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
            {p.label}{limits.periods.includes(p.value) ? null : <Lock size={12} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
          </button>
        ))}
      </div>

      <div className="row between" style={{ gap: 8 }}>
        <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setRef(shiftReference(period, ref, -1))} aria-label="Período anterior">
          <ChevronLeft size={17} />
        </motion.button>
        <span className="text-2 center" style={{ fontSize: 13, flex: 1 }}>{range.label.charAt(0).toUpperCase() + range.label.slice(1)}</span>
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
            <span>Resultado: <strong style={{ color: periodTotals.balance < 0 ? 'var(--danger)' : 'var(--accent)' }}>{formatMoney(periodTotals.balance, currency)}</strong></span>
            <span className="text-2">Despesas: {formatMoney(periodTotals.expense, currency)}</span>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <span className="text-2" style={{ fontSize: 13 }}>Resultado acumulado no período</span>
        {periodItems.length ? <BalanceLine points={balancePoints} /> : <p className="muted center" style={{ fontSize: 13, padding: '16px 0' }}>Sem lançamentos para mostrar.</p>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <span className="text-2" style={{ fontSize: 13 }}>Gastos por categoria (inclui compras no cartão)</span>
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
        <motion.button type="button" className="btn btn-ghost grow" whileTap={{ scale: 0.98 }} onClick={doCsv} disabled={!exportItems.length}>
          <Download size={17} /> CSV
        </motion.button>
        <motion.button type="button" className="btn btn-ghost grow" whileTap={{ scale: 0.98 }} onClick={doXlsx} disabled={!exportItems.length}>
          <FileSpreadsheet size={17} /> Planilha
        </motion.button>
      </div>
      <p className="muted center" style={{ fontSize: 12 }}>Exporta todos os lançamentos do período selecionado, em todas as moedas.</p>
    </div>
  );
}
