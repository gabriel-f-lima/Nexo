import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CircleCheck, Lightbulb, Wrench } from 'lucide-react';
import type { Insight } from '../../lib/coach';

/** Anel de progresso (0 a 1) com o texto no centro. */
export function ProgressRing({ value, size = 64, stroke = 7, label, color = 'var(--accent)' }: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  color?: string;
}) {
  const reduce = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${Math.round(clamped * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--active)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={reduce ? false : { strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: circumference * (1 - clamped) }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="ring-label">
        {label ?? `${Math.round(clamped * 100)}%`}
      </text>
    </svg>
  );
}

export interface TabItem<T extends string> { value: T; label: string; icon?: ReactNode; alert?: boolean }

/** Abas com o indicador deslizando entre elas. */
export function Tabs<T extends string>({ items, value, onChange, label }: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className="tab"
            onClick={() => onChange(item.value)}
          >
            {selected ? <motion.span layoutId={`tab-bg-${label}`} className="tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} /> : null}
            {item.icon}
            {item.label}
            {item.alert && !selected ? <span className="tab-dot" aria-label="Pede atenção" /> : null}
          </button>
        );
      })}
    </div>
  );
}

const TONE_ICON = { alert: AlertTriangle, tip: Lightbulb, good: CircleCheck };

/** Avisos do coach, com o atalho para resolver. */
export function InsightList({ insights, limit, empty }: { insights: Insight[]; limit?: number; empty?: ReactNode }) {
  const navigate = useNavigate();
  const visible = limit ? insights.slice(0, limit) : insights;
  if (!visible.length) return empty ? <>{empty}</> : null;
  return (
    <div className="insights">
      {visible.map((insight, index) => {
        const Icon = TONE_ICON[insight.tone];
        return (
          <motion.div
            key={insight.id}
            className={`insight ${insight.tone}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
          >
            <span className="insight-icon"><Icon size={17} /></span>
            <div className="grow">
              <div className="insight-title">{insight.title}</div>
              <div className="insight-text">{insight.text}</div>
              {insight.action ? (
                <button type="button" className="link-btn" onClick={() => navigate(insight.action!.to)}>{insight.action.label}</button>
              ) : null}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Aviso quando o banco ainda não recebeu a migration de planejamento. */
export function SetupNote({ children }: { children?: ReactNode }) {
  return (
    <div className="setup-note" role="status">
      <Wrench size={16} />
      <p>{children ?? 'Este recurso ainda está sendo ativado na sua conta. Tente de novo mais tarde.'}</p>
    </div>
  );
}

/** Bolinhas dos últimos 7 dias (do mais antigo ao de hoje). */
export function WeekDots({ days }: { days: boolean[] }) {
  return (
    <span className="week-dots" aria-label={`${days.filter(Boolean).length} de ${days.length} dias`}>
      {days.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
    </span>
  );
}
