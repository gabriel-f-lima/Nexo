import { motion } from 'framer-motion';

/* Gráficos em SVG puro: escalam com a tela (viewBox) e não adicionam bibliotecas. */

export interface BarDatum { label: string; income: number; expense: number }

/** Receitas (verde) x despesas (vermelho) por período. */
export function BarsChart({ data }: { data: BarDatum[] }) {
  const W = 320;
  const H = 180;
  const PAD_B = 22;
  const top = 10;
  const plotH = H - PAD_B - top;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const slot = (W - 8) / Math.max(1, data.length);
  const barW = Math.min(12, slot * 0.36);
  const showEvery = data.length > 12 ? 5 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Receitas e despesas por período" style={{ display: 'block' }}>
      <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--border)" />
      {data.map((d, i) => {
        const x = 4 + i * slot + slot / 2;
        const hi = (d.income / max) * plotH;
        const he = (d.expense / max) * plotH;
        return (
          <g key={`${d.label}-${i}`}>
            {d.income > 0 ? (
              <motion.rect
                x={x - barW - 1} y={H - PAD_B - hi} width={barW} height={hi} rx={3}
                fill="var(--accent)"
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                transition={{ duration: 0.5, delay: i * 0.02 }}
                style={{ transformOrigin: 'bottom', transformBox: 'fill-box' }}
              />
            ) : null}
            {d.expense > 0 ? (
              <motion.rect
                x={x + 1} y={H - PAD_B - he} width={barW} height={he} rx={3}
                fill="var(--danger)"
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                transition={{ duration: 0.5, delay: i * 0.02 + 0.05 }}
                style={{ transformOrigin: 'bottom', transformBox: 'fill-box' }}
              />
            ) : null}
            {i % showEvery === 0 ? (
              <text x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">{d.label}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export interface SliceDatum { name: string; color: string; value: number }

/** Rosca com a participação de cada categoria no total. */
export function DonutChart({ slices, centerLabel, centerValue }: { slices: SliceDatum[]; centerLabel: string; centerValue: string }) {
  const SIZE = 200;
  const R = 74;
  const STROKE = 24;
  const C = 2 * Math.PI * R;
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  let offset = 0;

  return (
    <div style={{ position: 'relative', width: 200, maxWidth: '100%', margin: '0 auto' }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" role="img" aria-label="Gastos por categoria">
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--active)" strokeWidth={STROKE} />
        {slices.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.name}
              cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth={STROKE}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <div>
          <div className="text-2" style={{ fontSize: 11 }}>{centerLabel}</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{centerValue}</div>
        </div>
      </div>
    </div>
  );
}

export interface LinePoint { label: string; value: number }

/** Saldo acumulado ao longo do período. */
export function BalanceLine({ points }: { points: LinePoint[] }) {
  const W = 320;
  const H = 160;
  const PAD_B = 22;
  const top = 12;
  const values = points.map((p) => p.value);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const range = hi - lo || 1;
  const plotH = H - PAD_B - top;
  const step = points.length > 1 ? (W - 16) / (points.length - 1) : 0;
  const yOf = (v: number) => top + (1 - (v - lo) / range) * plotH;
  const xOf = (i: number) => 8 + i * step;
  const zeroY = yOf(0);
  const coords = points.map((p, i) => ({ x: xOf(i), y: yOf(p.value) }));
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const area = coords.length ? `${line} L ${coords[coords.length - 1].x} ${zeroY} L ${coords[0].x} ${zeroY} Z` : '';
  const showEvery = points.length > 12 ? 5 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Saldo acumulado" style={{ display: 'block' }}>
      <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeDasharray="4 4" />
      {coords.length > 1 ? (
        <>
          <path d={area} fill="var(--accent-soft)" />
          <motion.path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
        </>
      ) : null}
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={points.length > 20 ? 1.5 : 3} fill="var(--accent)" />
      ))}
      {points.map((p, i) => (i % showEvery === 0 ? (
        <text key={`${p.label}-${i}`} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">{p.label}</text>
      ) : null))}
    </svg>
  );
}
