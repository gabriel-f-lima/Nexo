import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calendar as CalendarIcon } from 'lucide-react';
import { Header, Modal } from '../components/ui';
import Paywall from '../components/Paywall';
import { currentTier, LIMITS } from '../lib/billing';
import { useDataStore } from '../store/data';
import { useAuthStore } from '../store/auth';
import { confirmAction } from '../lib/confirm';
import { notify } from '../lib/toast';
import { isPastDay } from '../lib/rules';
import { MONTHS, formatLongDate, formatTime, parseDateKey, toISODate } from '../lib/dates';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Agenda mensal com a lista de compromissos do dia escolhido. */
export default function Agenda() {
  const events = useDataStore((s) => s.events);
  const addEvent = useDataStore((s) => s.addEvent);
  const removeEvent = useDataStore((s) => s.removeEvent);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const userId = useAuthStore((s) => s.user?.id);
  const [paywall, setPaywall] = useState<string | null>(null);

  const today = toISODate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState('');

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();

  const cells = useMemo(() => {
    const offset = new Date(year, month, 1).getDay();
    const count = new Date(year, month + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)] as Array<number | null>;
  }, [year, month]);

  const eventDates = useMemo(() => new Set(events.map((e) => toISODate(new Date(e.start)))), [events]);
  const selectedEvents = useMemo(
    () => events
      .filter((e) => toISODate(new Date(e.start)) === selectedDate)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    [events, selectedDate],
  );

  const shiftMonth = (amount: number) => {
    const next = new Date(year, month + amount, 1);
    const day = parseDateKey(selectedDate).getDate();
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    setVisibleMonth(next);
    setSelectedDate(toISODate(new Date(next.getFullYear(), next.getMonth(), Math.min(day, lastDay))));
  };

  const openForm = () => {
    if (isPastDay(selectedDate)) { notify('Dia passado: você pode apenas consultar os compromissos.', 'info'); return; }
    setTitle('');
    setTime('09:00');
    setLocation('');
    setFormError('');
    setFormOpen(true);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) { setFormError('Dê um nome ao compromisso.'); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setFormError('Indique a hora no formato HH:MM.'); return; }
    const start = new Date(`${selectedDate}T${time}:00`);
    requireAuth(() => {
      if (!userId) return;
      currentTier(userId)
        .then((tier) => {
          const max = LIMITS[tier].eventsPerDay;
          const sameDay = events.filter((e) => toISODate(new Date(e.start)) === selectedDate).length;
          setFormOpen(false);
          if (max === null || sameDay < max) {
            addEvent(clean, start.toISOString(), location);
            return;
          }
          setPaywall(tier === 'free'
            ? `No plano gratuito você tem até ${max} compromissos por dia. Assine para ter mais.`
            : `Você já tem ${max} compromissos neste dia, o limite do seu plano. Assine o Pro para compromissos ilimitados.`);
        })
        .catch(() => setPaywall('Não foi possível verificar seu plano agora. Tente novamente.'));
    });
  };

  const remove = async (id: string, name: string) => {
    if (isPastDay(selectedDate)) { notify('Dia passado: os compromissos não podem ser removidos.', 'info'); return; }
    const ok = await confirmAction({
      title: 'Remover compromisso',
      message: `Quer remover “${name}” da agenda?`,
      confirmText: 'Remover',
      danger: true,
    });
    if (ok) requireAuth(() => removeEvent(id));
  };

  return (
    <div className="screen">
      <Header title="Agenda" subtitle="Planeje seus dias" />

      <div className="screen-stack">
        <div className="cal">
          <div className="cal-head">
            <span className="cal-title">{MONTHS[month]} {year}</span>
            <div className="row gap-sm">
              <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
                <ChevronLeft size={17} />
              </motion.button>
              <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => shiftMonth(1)} aria-label="Mês seguinte">
                <ChevronRight size={17} />
              </motion.button>
            </div>
          </div>

          <div className="cal-grid">
            {WEEKDAYS.map((d) => <div key={d} className="cal-wd">{d}</div>)}
            {cells.map((day, index) => {
              if (!day) return <div key={`blank-${index}`} />;
              const key = toISODate(new Date(year, month, day));
              const selected = key === selectedDate;
              const isToday = key === today;
              return (
                <button
                  key={key}
                  type="button"
                  className={`cal-day${selected ? ' sel' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => setSelectedDate(key)}
                  aria-label={`${day} de ${MONTHS[month]} de ${year}`}
                  aria-pressed={selected}
                >
                  {selected ? <motion.div className="cal-selected" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} /> : null}
                  <span className="num">{day}</span>
                  <span className={`pin${eventDates.has(key) ? ' on' : ''}`} />
                </button>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="link-btn" onClick={() => { setSelectedDate(today); setVisibleMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); }}>
              Ir para hoje
            </button>
          </div>
        </div>

        <div className="row between" style={{ alignItems: 'center' }}>
          <div style={{ display: 'grid', gap: 3 }}>
            <span className="section-title">Compromissos</span>
            <span className="text-2" style={{ fontSize: 13, textTransform: 'capitalize' }}>{formatLongDate(parseDateKey(selectedDate))}</span>
          </div>
          <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.05 }} onClick={openForm} aria-label="Adicionar compromisso" style={{ background: 'var(--accent)', color: 'var(--bg)', border: 0 }}>
            <Plus size={20} />
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {selectedEvents.length ? selectedEvents.map((event) => (
            <motion.div
              key={event.id}
              className="event-row"
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              <div className="event-accent" />
              <div className="event-info">
                <span className="event-time">{formatTime(event.start)}</span>
                <span className="event-title">{event.title}</span>
                {event.location ? <span className="event-loc">{event.location}</span> : null}
              </div>
              <motion.button
                type="button"
                className="icon-btn ghost sm"
                style={{ marginRight: 10 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => { void remove(event.id, event.title); }}
                aria-label={`Remover ${event.title}`}
              >
                <Trash2 size={17} />
              </motion.button>
            </motion.div>
          )) : (
            <motion.div key="empty" className="empty-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <CalendarIcon size={24} color="var(--muted)" />
              <strong>Dia livre</strong>
              <span>Não tem compromissos nesta data. Adicione um para organizar o seu dia.</span>
              <button type="button" className="link-btn" onClick={openForm}>Adicionar compromisso</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Novo compromisso">
        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <p style={{ color: 'var(--accent)', fontSize: 13, textTransform: 'capitalize' }}>{formatLongDate(parseDateKey(selectedDate))}</p>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" maxLength={80} autoFocus />
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Hora" />
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Local (opcional)" maxLength={80} />
          {formError ? <p className="error">{formError}</p> : null}
          <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Guardar compromisso</motion.button>
        </form>
      </Modal>
      <Paywall open={paywall !== null} onClose={() => setPaywall(null)} title="Limite de compromissos" message={paywall ?? ''} />
    </div>
  );
}
