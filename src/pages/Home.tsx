import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, CalendarClock, Check, CheckCheck, ChevronRight, Circle, CreditCard, Flame, Leaf, ListChecks, Lock, NotebookPen,
  ReceiptText, Sparkles, Target, Wallet,
} from 'lucide-react';
import { Header } from '../components/ui';
import QuickEntry from '../components/planning/QuickEntry';
import { InsightList, ProgressRing } from '../components/planning/ui';
import { useDataStore } from '../store/data';
import { useAuthStore } from '../store/auth';
import { useFinanceStore } from '../store/finance';
import { useProgressStore } from '../store/progress';
import { formatLongDate, formatShortDate, formatTime, relativeDay, toISODate } from '../lib/dates';
import { formatMoney } from '../lib/finance';
import { displayName } from '../lib/user';
import { useTier } from '../lib/useTier';
import { LIMITS } from '../lib/billing';
import { availableBalance } from '../lib/ledger';
import { billsToWatch } from '../lib/bills';
import { cardInvoices } from '../lib/cards';
import { currentStreak, streakGoalProgress } from '../lib/streaks';
import { objectiveProgress, OBJECTIVE_STATUS_LABEL } from '../lib/objectives';
import { buildCoach, buildWeekly, primaryCurrency, useSnapshot } from '../lib/derived';
import '../styles/planning.css';

const dueKey = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toISODate(date);
};

interface MoneyDue {
  key: string;
  title: string;
  detail: string;
  cents: number;
  currency: ReturnType<typeof primaryCurrency>;
  overdue: boolean;
  to: string;
}

/** Meu dia: compromissos, hábitos pendentes, contas que vencem, saldo disponível e o que o coach recomenda, numa tela só. */
export default function Home() {
  const navigate = useNavigate();
  const tasks = useDataStore((s) => s.tasks);
  const events = useDataStore((s) => s.events);
  const habits = useDataStore((s) => s.habits);
  const toggleTask = useDataStore((s) => s.toggleTask);
  const toggleHabitForDate = useDataStore((s) => s.toggleHabitForDate);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const user = useAuthStore((s) => s.user);
  const tier = useTier(user?.id);
  const financeAccess = tier !== 'loading' && LIMITS[tier].finance;
  const finance = useFinanceStore();
  const objectives = useProgressStore((s) => s.objectives);
  const streakGoals = useProgressStore((s) => s.streakGoals);
  const snapshot = useSnapshot(financeAccess);
  const [weeklyOpen, setWeeklyOpen] = useState(() => new Date().getDay() === 1);

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
      return !Number.isNaN(start.getTime()) && toISODate(start) === today && start.getTime() >= now - 30 * 60_000;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const pendingHabits = habits.filter((h) => !h.doneDates.includes(today));

  const doneTasks = todayTasks.filter((t) => t.done).length;
  const doneHabits = habits.length - pendingHabits.length;
  const totalGoals = todayTasks.length + habits.length;
  const completed = doneTasks + doneHabits;
  const progress = totalGoals ? completed / totalGoals : 0;
  const allComplete = totalGoals > 0 && completed === totalGoals;
  const firstName = displayName(user).split(' ')[0];

  const currency = primaryCurrency(finance);
  const balance = useMemo(() => availableBalance(
    finance.transactions, finance.cardPayments, (id) => finance.cards.find((c) => c.id === id)?.currency, currency, today,
  ), [finance.transactions, finance.cardPayments, finance.cards, currency, today]);

  // Contas e faturas vencidas ou que vencem nos próximos 3 dias.
  const moneyDue: MoneyDue[] = useMemo(() => {
    if (!financeAccess) return [];
    const list: MoneyDue[] = billsToWatch(finance.bills, finance.transactions, today, 3).map((o) => ({
      key: `bill:${o.bill.id}:${o.period}`,
      title: o.bill.name,
      detail: o.status === 'overdue' ? `Venceu ${relativeDay(o.dueDate, today)}` : `Vence ${relativeDay(o.dueDate, today)}`,
      cents: o.bill.amountCents,
      currency: o.bill.currency,
      overdue: o.status === 'overdue',
      to: '/app/financas?aba=contas',
    }));
    for (const card of finance.cards.filter((c) => !c.archived)) {
      for (const inv of cardInvoices(card, finance.transactions, finance.cardPayments, today)) {
        const soon = inv.status === 'closed' && inv.due <= toISODate(new Date(now + 3 * 86_400_000));
        if ((inv.status === 'overdue' || soon) && inv.remainingCents > 0) {
          list.push({
            key: `invoice:${card.id}:${inv.month}`,
            title: `Fatura ${card.name}`,
            detail: inv.status === 'overdue' ? `Venceu ${relativeDay(inv.due, today)}` : `Vence ${relativeDay(inv.due, today)}`,
            cents: inv.remainingCents,
            currency: card.currency,
            overdue: inv.status === 'overdue',
            to: '/app/financas?aba=cartoes',
          });
        }
      }
    }
    return list.sort((a, b) => Number(b.overdue) - Number(a.overdue));
  }, [financeAccess, finance.bills, finance.transactions, finance.cards, finance.cardPayments, today, now]);
  const dueTodayCount = moneyDue.filter((m) => m.overdue || m.detail.endsWith('hoje')).length;

  const insights = useMemo(() => buildCoach(snapshot), [snapshot]);
  const weekly = useMemo(() => buildWeekly(snapshot), [snapshot]);
  const activeObjectives = useMemo(() => objectives
    .filter((o) => !o.completedAt)
    .map((o) => ({ objective: o, progress: objectiveProgress(o, { goals: finance.goals, events, habits }, today) }))
    .sort((a, b) => a.objective.targetDate.localeCompare(b.objective.targetDate))
    .slice(0, 2), [objectives, finance.goals, events, habits, today]);

  return (
    <div className="screen">
      <Header
        title={user ? `Olá, ${firstName}` : 'Meu dia'}
        subtitle={formatLongDate()}
      />

      <div className="screen-stack">
        <motion.section className="hero-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="row gap-md">
            <ProgressRing value={progress} size={70} label={`${Math.round(progress * 100)}%`} />
            <div className="grow" style={{ display: 'grid', gap: 4 }}>
              <span className="eyebrow">Seu dia em foco</span>
              <div className="stat-line">{completed}<small>/ {totalGoals} concluídos</small></div>
              <span className="text-2" style={{ fontSize: 12.5 }}>
                {totalGoals === 0
                  ? 'Adicione uma tarefa ou um hábito para começar.'
                  : allComplete
                    ? 'Tudo em dia. Você concluiu o que planejou para hoje.'
                    : `${todayTasks.length - doneTasks} ${todayTasks.length - doneTasks === 1 ? 'tarefa' : 'tarefas'} e ${pendingHabits.length} ${pendingHabits.length === 1 ? 'hábito' : 'hábitos'} para concluir`}
              </span>
            </div>
          </div>
        </motion.section>

        <div className="tiles">
          {financeAccess ? (
            <button type="button" className="tile" onClick={() => navigate('/app/financas')}>
              <span className="tile-icon"><Wallet size={16} /></span>
              <span className="tile-value" style={{ color: balance < 0 ? 'var(--danger)' : undefined }}>{formatMoney(balance, currency)}</span>
              <span className="tile-label">Saldo disponível</span>
            </button>
          ) : (
            <button type="button" className="tile" onClick={() => navigate('/app/financas')}>
              <span className="tile-icon"><Lock size={16} /></span>
              <span className="tile-value" style={{ fontSize: 15 }}>Financeiro</span>
              <span className="tile-label">Saldo, contas e cartões nos planos pagos</span>
            </button>
          )}
          <button type="button" className="tile" onClick={() => navigate('/app/financas?aba=contas')} disabled={!financeAccess}>
            <span className={`tile-icon ${dueTodayCount ? 'danger' : 'warn'}`}><ReceiptText size={16} /></span>
            <span className="tile-value">{financeAccess ? dueTodayCount : '—'}</span>
            <span className="tile-label">{dueTodayCount === 1 ? 'Conta para pagar hoje' : 'Contas para pagar hoje'}</span>
          </button>
          <button type="button" className="tile" onClick={() => navigate('/app/agenda')}>
            <span className="tile-icon blue"><CalendarClock size={16} /></span>
            <span className="tile-value">{todayEvents.length}</span>
            <span className="tile-label">{todayEvents.length === 1 ? 'Compromisso hoje' : 'Compromissos hoje'}</span>
          </button>
          <button type="button" className="tile" onClick={() => navigate('/app/rotina')}>
            <span className="tile-icon"><Leaf size={16} /></span>
            <span className="tile-value">{pendingHabits.length}</span>
            <span className="tile-label">{pendingHabits.length === 1 ? 'Hábito pendente' : 'Hábitos pendentes'}</span>
          </button>
        </div>

        <QuickEntry compact />

        <AnimatePresence>
          {allComplete ? (
            <motion.div key="celebrate" className="celebrate" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              <div className="celebrate-icon"><CheckCheck size={22} /></div>
              <div>
                <h3>Dia concluído!</h3>
                <p>Você cuidou das tarefas e da rotina de hoje. Parabéns!</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {insights.length ? (
          <>
            <div className="section-head">
              <div>
                <div className="section-title">Coach</div>
                <div className="section-hint">O que merece atenção agora</div>
              </div>
              <Sparkles size={18} color="var(--accent)" />
            </div>
            <InsightList insights={insights} limit={3} />
          </>
        ) : null}

        <div className="section-head">
          <div>
            <div className="section-title">Agenda de hoje</div>
            <div className="section-hint">Próximos compromissos</div>
          </div>
          <span className="count">{todayEvents.length}</span>
        </div>
        {todayEvents.length ? todayEvents.map((event, index) => (
          <motion.div key={event.id} className="event-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
            <div className="event-accent" />
            <div className="event-info">
              <span className="event-time">{formatTime(event.start)}{Date.parse(event.start) < now ? ' · agora' : ''}</span>
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

        {financeAccess && moneyDue.length ? (
          <>
            <div className="section-head">
              <div>
                <div className="section-title">Contas e faturas</div>
                <div className="section-hint">Vencidas e as que vencem nos próximos 3 dias</div>
              </div>
              <span className="count">{moneyDue.length}</span>
            </div>
            {moneyDue.map((item) => (
              <button key={item.key} type="button" className={`invoice-row${item.overdue ? ' overdue' : ''}`} onClick={() => navigate(item.to)}>
                <span className={`tile-icon ${item.overdue ? 'danger' : 'warn'}`} style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', background: item.overdue ? 'var(--danger-soft)' : 'rgba(246,167,93,0.13)', color: item.overdue ? 'var(--danger)' : 'var(--warn)' }}>
                  {item.key.startsWith('invoice') ? <CreditCard size={15} /> : <ReceiptText size={15} />}
                </span>
                <span className="grow"><span className="when">{item.title}</span><span className="sub" style={{ display: 'block' }}>{item.detail}</span></span>
                <span className="amount">{formatMoney(item.cents, item.currency)}</span>
                <ChevronRight size={16} className="muted" />
              </button>
            ))}
          </>
        ) : null}

        <div className="section-head">
          <div>
            <div className="section-title">Hábitos de hoje</div>
            <div className="section-hint">Toque para concluir ou desfazer</div>
          </div>
          <span className="count">{doneHabits}/{habits.length}</span>
        </div>
        {habits.length ? habits.map((habit, index) => {
          const done = habit.doneDates.includes(today);
          const streak = currentStreak(habit.doneDates, today);
          const goal = streakGoals.find((g) => g.habitId === habit.id);
          const goalProgress = goal ? streakGoalProgress(goal, habit, today) : null;
          return (
            <motion.button key={habit.id} type="button" className={`habit-row${done ? ' done' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }} whileTap={{ scale: 0.98 }} onClick={() => requireAuth(() => toggleHabitForDate(habit.id, today))} aria-pressed={done}>
              {done ? <Check size={22} color="var(--accent)" /> : <Circle size={22} color="var(--muted)" />}
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="habit-name" style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{habit.name}</span>
                <span className="streak">
                  <Flame size={13} color={streak ? 'var(--warn)' : 'var(--muted)'} /> {streak} {streak === 1 ? 'dia seguido' : 'dias seguidos'}
                  {goalProgress && !goalProgress.achieved ? ` · meta ${goalProgress.target}` : ''}
                </span>
              </span>
              {done ? <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700 }}>Feito</span> : null}
            </motion.button>
          );
        }) : (
          <div className="empty-card">
            <Leaf size={20} color="var(--accent)" />
            <span>Você ainda não tem hábitos na rotina. Adicione em Rotina.</span>
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
          <motion.button key={task.id} type="button" className={`task-row${task.done ? ' done' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }} whileTap={{ scale: 0.98 }} onClick={() => requireAuth(() => toggleTask(task.id))}>
            {task.done ? <Check size={22} color="var(--accent)" /> : <Circle size={22} color="var(--text-2)" />}
            <span className="task-title grow" style={{ fontSize: 15 }}>{task.title}</span>
          </motion.button>
        )) : (
          <div className="empty-card">
            <ListChecks size={20} color="var(--accent)" />
            <span>Sua lista está vazia. Peça ao assistente para adicionar uma tarefa.</span>
          </div>
        )}

        {activeObjectives.length ? (
          <>
            <div className="section-head">
              <div>
                <div className="section-title">Objetivos</div>
                <div className="section-hint">Dinheiro, agenda e rotina juntos</div>
              </div>
              <button type="button" className="link-btn" onClick={() => navigate('/app/metas')}>Ver todos</button>
            </div>
            {activeObjectives.map(({ objective, progress: p }) => (
              <button key={objective.id} type="button" className="streak-goal" style={{ width: '100%', textAlign: 'left' }} onClick={() => navigate('/app/metas')}>
                <ProgressRing value={p.overall} size={52} stroke={6} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{objective.title}</strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {OBJECTIVE_STATUS_LABEL[p.status]} · {p.daysLeft >= 0 ? `${p.daysLeft} dias até ${formatShortDate(objective.targetDate, today)}` : 'prazo passou'}
                  </span>
                  {p.nextSteps[0] ? <span className="text-2" style={{ display: 'block', fontSize: 12.5, marginTop: 2 }}>{p.nextSteps[0]}</span> : null}
                </span>
                <Target size={18} color="var(--accent)" />
              </button>
            ))}
          </>
        ) : null}

        {weekly.lines.length > 1 ? (
          <div className="card weekly">
            <button type="button" className="row between" style={{ width: '100%' }} onClick={() => setWeeklyOpen((v) => !v)} aria-expanded={weeklyOpen}>
              <span className="row gap-sm"><NotebookPen size={17} color="var(--accent)" /><strong>Resumo da semana</strong></span>
              <span className="muted" style={{ fontSize: 12 }}>{formatShortDate(weekly.start, today)} a {formatShortDate(weekly.end, today)}</span>
            </button>
            <AnimatePresence initial={false}>
              {weeklyOpen ? (
                <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                  {weekly.lines.map((line) => <li key={line}><Check size={14} />{line}</li>)}
                </motion.ul>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </div>
    </div>
  );
}
