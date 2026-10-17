import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarCheck, Ellipsis, Flame, Leaf, Plus, Sparkles } from 'lucide-react';
import { Header, Modal } from '../components/ui';
import { useDataStore, type Habit } from '../store/data';
import { useAuthStore } from '../store/auth';
import { confirmAction } from '../lib/confirm';
import { addDays, formatLongDate, parseDateKey, toISODate, weekStart } from '../lib/dates';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Dias seguidos a partir de hoje (ou de ontem, se hoje ainda não foi marcado). */
const streakFor = (doneDates: string[], today: string): number => {
  const done = new Set(doneDates);
  let cursor = parseDateKey(today);
  if (!done.has(today)) cursor = addDays(cursor, -1);
  let count = 0;
  while (done.has(toISODate(cursor))) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
};

/** Rotina de hábitos com semana, progresso do dia e sequência de cada hábito. */
export default function Rotina() {
  const habits = useDataStore((s) => s.habits);
  const addHabit = useDataStore((s) => s.addHabit);
  const removeHabit = useDataStore((s) => s.removeHabit);
  const toggleHabitForDate = useDataStore((s) => s.toggleHabitForDate);
  const requireAuth = useAuthStore((s) => s.requireAuth);

  const today = toISODate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [habitName, setHabitName] = useState('');
  const [formError, setFormError] = useState('');

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const completed = habits.filter((h) => h.doneDates.includes(selectedDate)).length;
  const nextWeekBlocked = toISODate(addDays(week, 7)) > today;

  const save = (event: FormEvent) => {
    event.preventDefault();
    const clean = habitName.trim();
    if (!clean) { setFormError('Escreva o nome do hábito.'); return; }
    requireAuth(() => {
      addHabit(clean);
      setFormOpen(false);
      setHabitName('');
      setFormError('');
    });
  };

  const remove = async (habit: Habit) => {
    const ok = await confirmAction({
      title: 'Remover hábito',
      message: `Quer remover “${habit.name}” e o respectivo histórico?`,
      confirmText: 'Remover',
      danger: true,
    });
    if (ok) requireAuth(() => removeHabit(habit.id));
  };

  return (
    <div className="screen">
      <Header title="Rotina" subtitle="Pequenos passos, todos os dias" />

      <div className="screen-stack">
        <motion.div className="hero-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="row between">
            <div style={{ display: 'grid', gap: 4 }}>
              <span className="text-2" style={{ fontSize: 13 }}>Progresso do dia</span>
              <div className="stat-line">
                {completed}
                <small>/ {habits.length} hábitos</small>
              </div>
            </div>
            <div className="icon-btn"><Sparkles size={21} /></div>
          </div>
          <div className="track" style={{ marginTop: 14 }}>
            <motion.div
              className="fill"
              initial={{ width: 0 }}
              animate={{ width: `${habits.length ? (completed / habits.length) * 100 : 0}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <p className="text-2" style={{ fontSize: 12, marginTop: 12 }}>
            {selectedDate === today ? 'O que já conseguiu fazer hoje?' : `Resumo de ${formatLongDate(parseDateKey(selectedDate))}`}
          </p>
        </motion.div>

        <div className="row between">
          <span className="section-title">Esta semana</span>
          <div className="row gap-sm">
            <motion.button type="button" className="icon-btn plain sm" whileTap={{ scale: 0.9 }} onClick={() => setWeek((w) => addDays(w, -7))} aria-label="Semana anterior">
              <ChevronLeft size={17} />
            </motion.button>
            <motion.button
              type="button"
              className="icon-btn sm"
              whileTap={{ scale: 0.9 }}
              onClick={() => { setWeek(weekStart(new Date())); setSelectedDate(today); }}
              aria-label="Semana atual"
            >
              <CalendarCheck size={16} />
            </motion.button>
            <motion.button
              type="button"
              className="icon-btn plain sm"
              whileTap={{ scale: 0.9 }}
              onClick={() => setWeek((w) => addDays(w, 7))}
              disabled={nextWeekBlocked}
              aria-label="Semana seguinte"
              style={nextWeekBlocked ? { opacity: 0.4 } : undefined}
            >
              <ChevronRight size={17} />
            </motion.button>
          </div>
        </div>

        <div className="week">
          {weekDays.map((date) => {
            const key = toISODate(date);
            const selected = key === selectedDate;
            const count = habits.filter((h) => h.doneDates.includes(key)).length;
            return (
              <button
                key={key}
                type="button"
                className={`week-day${selected ? ' sel' : ''}`}
                onClick={() => setSelectedDate(key)}
                aria-pressed={selected}
                aria-label={`${DAY_NAMES[date.getDay()]} ${date.getDate()}`}
              >
                {selected ? <motion.div className="week-bg" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} /> : null}
                <span className="wd">{DAY_NAMES[date.getDay()]}</span>
                <span className="wn">{date.getDate()}</span>
                <span className={`dot-s${count > 0 ? ' on' : ''}`} />
              </button>
            );
          })}
        </div>

        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div style={{ display: 'grid', gap: 3 }}>
            <span className="section-title">Os seus hábitos</span>
            <span className="section-hint">Toque num hábito para marcar ou desmarcar</span>
          </div>
          <motion.button
            type="button"
            className="icon-btn"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => { setHabitName(''); setFormError(''); setFormOpen(true); }}
            aria-label="Adicionar hábito"
            style={{ background: 'var(--accent)', color: 'var(--bg)', border: 0 }}
          >
            <Plus size={20} />
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {habits.length ? habits.map((habit, index) => {
            const done = habit.doneDates.includes(selectedDate);
            const streak = streakFor(habit.doneDates, today);
            return (
              <motion.div
                key={habit.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ delay: index * 0.03, type: 'spring', stiffness: 380, damping: 32 }}
                className={`habit-row${done ? ' done' : ''}`}
                style={{ padding: 0, gap: 0, overflow: 'hidden' }}
              >
                <motion.button
                  type="button"
                  className="grow"
                  whileTap={{ scale: 0.99 }}
                  onClick={() => requireAuth(() => toggleHabitForDate(habit.id, selectedDate))}
                  aria-pressed={done}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px', textAlign: 'left', minWidth: 0 }}
                >
                  <motion.span key={done ? 'on' : 'off'} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                    {done ? <CalendarCheck size={24} color="var(--accent)" /> : <span style={{ display: 'block', width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--muted)' }} />}
                  </motion.span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: done ? 'var(--text-2)' : 'var(--text)' }}>{habit.name}</span>
                    <span className="streak">
                      <Flame size={13} color={streak ? 'var(--warn)' : 'var(--muted)'} />
                      {streak} {streak === 1 ? 'dia seguido' : 'dias seguidos'}
                    </span>
                  </span>
                </motion.button>
                <motion.button
                  type="button"
                  className="icon-btn ghost sm"
                  style={{ marginRight: 10 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => { void remove(habit); }}
                  aria-label={`Remover hábito ${habit.name}`}
                >
                  <Ellipsis size={19} />
                </motion.button>
              </motion.div>
            );
          }) : (
            <motion.div key="empty" className="empty-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Leaf size={26} color="var(--muted)" />
              <strong>Comece com um hábito simples</strong>
              <span>Crie uma rotina que faça sentido para você e acompanhe a consistência ao longo da semana.</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Novo hábito">
        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <p className="text-2" style={{ fontSize: 13, lineHeight: 1.5 }}>Escolha algo pequeno que consiga repetir com regularidade.</p>
          <input className="input" value={habitName} onChange={(e) => setHabitName(e.target.value)} placeholder="Ex.: Beber água, ler 10 páginas" maxLength={60} autoFocus />
          {formError ? <p className="error">{formError}</p> : null}
          <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Salvar hábito</motion.button>
        </form>
      </Modal>
    </div>
  );
}
