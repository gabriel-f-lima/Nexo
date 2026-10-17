import { motion, AnimatePresence } from 'framer-motion';
import { Check, CheckCheck, Circle, Leaf, Calendar, ListChecks } from 'lucide-react';
import { Header } from '../components/ui';
import { useDataStore } from '../store/data';
import { useAuthStore } from '../store/auth';
import { formatLongDate, formatTime, toISODate } from '../lib/dates';
import { displayName } from '../lib/user';

const dueKey = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toISODate(date);
};

/** Visão geral do dia: progresso, compromissos, tarefas e metas da rotina. */
export default function Home() {
  const tasks = useDataStore((s) => s.tasks);
  const events = useDataStore((s) => s.events);
  const habits = useDataStore((s) => s.habits);
  const toggleTask = useDataStore((s) => s.toggleTask);
  const toggleHabitForDate = useDataStore((s) => s.toggleHabitForDate);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const user = useAuthStore((s) => s.user);

  const today = toISODate();
  const now = Date.now();

  const todayTasks = tasks.filter((task) => {
    if (!task.dueDate) return true;
    const due = dueKey(task.dueDate);
    return due === today || (due !== '' && due < today && !task.done);
  });
  const todayEvents = events
    .filter((event) => {
      const start = new Date(event.start);
      return !Number.isNaN(start.getTime()) && toISODate(start) === today && start.getTime() >= now;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const doneTasks = todayTasks.filter((t) => t.done).length;
  const doneHabits = habits.filter((h) => h.doneDates.includes(today)).length;
  const totalGoals = todayTasks.length + habits.length;
  const completed = doneTasks + doneHabits;
  const progress = totalGoals ? Math.round((completed / totalGoals) * 100) : 0;
  const allComplete = totalGoals > 0 && completed === totalGoals;
  const pending = totalGoals - completed;
  const firstName = displayName(user).split(' ')[0];

  return (
    <div className="screen">
      <Header
        title={user ? `Olá, ${firstName}` : 'Olá!'}
        subtitle={`${formatLongDate()} · ${pending} ${pending === 1 ? 'item pendente' : 'itens pendentes'}`}
      />

      <div className="screen-stack">
        <motion.section
          className="hero-card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="row between" style={{ gap: 12 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <span className="eyebrow">Seu dia em foco</span>
              <div className="stat-line">
                {completed}
                <small>/ {totalGoals} concluídos</small>
              </div>
            </div>
            <motion.div key={progress} className="badge-pct" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
              {progress}%
            </motion.div>
          </div>
          <div className="track" style={{ marginTop: 14 }}>
            <motion.div
              className="fill"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <p className="text-2" style={{ fontSize: 12, marginTop: 12 }}>
            {totalGoals === 0
              ? 'Adicione uma tarefa ou um hábito para começar.'
              : allComplete
                ? 'Tudo em dia. Você concluiu suas metas de hoje.'
                : `${todayTasks.length - doneTasks} tarefas e ${habits.length - doneHabits} hábitos para concluir`}
          </p>
        </motion.section>

        <AnimatePresence>
          {allComplete ? (
            <motion.div
              key="celebrate"
              className="celebrate"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            >
              <div className="celebrate-icon"><CheckCheck size={22} /></div>
              <div>
                <h3>Dia concluído!</h3>
                <p>Você cuidou das tarefas e da rotina de hoje. Parabéns!</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="section-head">
          <div>
            <div className="section-title">Próximos compromissos</div>
            <div className="section-hint">Ainda hoje</div>
          </div>
          <span className="count">{todayEvents.length}</span>
        </div>
        {todayEvents.length ? todayEvents.map((event, index) => (
          <motion.div
            key={event.id}
            className="event-row"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
          >
            <div className="event-accent" />
            <div className="event-info">
              <span className="event-time">{formatTime(event.start)}</span>
              <span className="event-title">{event.title}</span>
              {event.location ? <span className="event-loc">{event.location}</span> : null}
            </div>
          </motion.div>
        )) : (
          <div className="empty-card">
            <Calendar size={20} color="var(--blue)" />
            <span>Nenhum compromisso restante para hoje.</span>
          </div>
        )}

        <div className="section-head">
          <div>
            <div className="section-title">Tarefas de hoje</div>
            <div className="section-hint">Tarefas vencidas também aparecem aqui</div>
          </div>
          <span className="count">{doneTasks}/{todayTasks.length}</span>
        </div>
        {todayTasks.length ? todayTasks.map((task, index) => (
          <motion.button
            key={task.id}
            type="button"
            className={`task-row${task.done ? ' done' : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => requireAuth(() => toggleTask(task.id))}
          >
            {task.done ? <Check size={22} color="var(--accent)" /> : <Circle size={22} color="var(--text-2)" />}
            <span className="task-title grow" style={{ fontSize: 16 }}>{task.title}</span>
          </motion.button>
        )) : (
          <div className="empty-card">
            <ListChecks size={20} color="var(--accent)" />
            <span>Sua lista está vazia. Peça ao assistente para adicionar uma tarefa.</span>
          </div>
        )}

        <div className="section-head">
          <div>
            <div className="section-title">Metas da rotina</div>
            <div className="section-hint">Toque em uma meta para concluir ou desfazer</div>
          </div>
          <span className="count">{doneHabits}/{habits.length}</span>
        </div>
        {habits.length ? habits.map((habit, index) => {
          const done = habit.doneDates.includes(today);
          return (
            <motion.button
              key={habit.id}
              type="button"
              className={`habit-row${done ? ' done' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => requireAuth(() => toggleHabitForDate(habit.id, today))}
              aria-pressed={done}
            >
              {done ? <Check size={22} color="var(--accent)" /> : <Circle size={22} color="var(--muted)" />}
              <span className="habit-name grow" style={{ fontSize: 14, fontWeight: 600 }}>{habit.name}</span>
              {done ? <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700 }}>Feita</span> : null}
            </motion.button>
          );
        }) : (
          <div className="empty-card">
            <Leaf size={20} color="var(--accent)" />
            <span>Você ainda não tem metas na rotina. Adicione hábitos na opção Rotina.</span>
          </div>
        )}
      </div>
    </div>
  );
}
