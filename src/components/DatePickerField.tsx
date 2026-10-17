import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS, parseDateKey, toISODate } from '../lib/dates';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const formatBR = (key: string): string => {
  const d = parseDateKey(key);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/** Campo de data com o calendário do Nuvora. Dias antes de `min` ficam desabilitados. */
export default function DatePickerField({
  value,
  onChange,
  min,
  label,
  placeholder = 'Escolha uma data',
  clearable = false,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  label: string;
  placeholder?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => {
    const base = value ? parseDateKey(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const today = toISODate();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const base = value ? parseDateKey(value) : new Date();
      setView(new Date(base.getFullYear(), base.getMonth(), 1));
    }
    setOpen((o) => !o);
  };

  const cells = useMemo(() => {
    const year = view.getFullYear();
    const month = view.getMonth();
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const list: Array<number | null> = Array(first).fill(null);
    for (let d = 1; d <= days; d++) list.push(d);
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [view]);

  const isDisabled = (key: string) => !!min && key < min;
  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  return (
    <div className="dp" ref={rootRef}>
      <button
        type="button"
        className="input dp-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={value ? '' : 'dp-placeholder'}>{value ? formatBR(value) : placeholder}</span>
        <CalendarDays size={18} />
      </button>

      {open ? (
        <motion.div
          className="cal dp-pop"
          role="dialog"
          aria-label={label}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="cal-head">
            <button
              type="button"
              className="icon-btn plain sm"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              aria-label="Mês anterior"
            >
              <ChevronLeft size={17} />
            </button>
            <div className="cal-title">{MONTHS[view.getMonth()]} {view.getFullYear()}</div>
            <button
              type="button"
              className="icon-btn plain sm"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              aria-label="Mês seguinte"
            >
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="cal-grid">
            {WEEKDAYS.map((d, i) => <div key={i} className="cal-wd">{d}</div>)}
            {cells.map((day, index) => {
              if (!day) return <div key={`blank-${index}`} />;
              const key = toISODate(new Date(view.getFullYear(), view.getMonth(), day));
              const selected = key === value;
              const isToday = key === today;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isDisabled(key)}
                  className={`cal-day${selected ? ' sel' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => pick(key)}
                  aria-label={`${day} de ${MONTHS[view.getMonth()]} de ${view.getFullYear()}`}
                  aria-pressed={selected}
                >
                  <span className="num">{day}</span>
                  <span className="pin" />
                </button>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: clearable ? 'space-between' : 'flex-end', marginTop: 8 }}>
            {clearable ? (
              <button type="button" className="link-btn" onClick={() => { onChange(''); setOpen(false); }}>Limpar</button>
            ) : null}
            <button
              type="button"
              className="link-btn"
              disabled={isDisabled(today)}
              onClick={() => pick(today)}
            >
              Hoje
            </button>
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
