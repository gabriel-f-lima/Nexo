import { addDaysToKey, daysBetween, formatShortDate } from './dates';
import { formatMoney, type Currency } from './finance';
import { currentStreak, type HabitLike } from './streaks';

/* Objetivos: juntam uma meta financeira, um compromisso na agenda e hábitos de apoio (ex.: "Viagem em julho").
   O progresso combina quanto já foi guardado com a constância nos hábitos, e diz o próximo passo. */

export interface ObjectiveLike {
  id: string;
  title: string;
  targetDate: string;
  goalId: string | null;
  eventId: string | null;
  habitIds: string[];
  startedOn: string;
  completedAt: string | null;
}

export interface GoalLike {
  id: string;
  name: string;
  currency: Currency;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
}

export interface EventLike {
  id: string;
  title: string;
  start: string;
}

export interface ObjectiveMoney {
  goalName: string;
  currency: Currency;
  savedCents: number;
  targetCents: number;
  remainingCents: number;
  ratio: number;
  /** Quanto já deveria estar guardado hoje, num ritmo constante desde o início. */
  expectedCents: number;
  /** Valor por semana para chegar lá no prazo (arredondado para cima, em unidades inteiras). */
  perWeekCents: number;
  onTrack: boolean;
}

export interface ObjectiveHabit {
  id: string;
  name: string;
  doneToday: boolean;
  doneLast7: number;
  streak: number;
}

export type ObjectiveStatus = 'done' | 'on_track' | 'behind' | 'overdue';

export interface ObjectiveProgress {
  daysLeft: number;
  totalDays: number;
  elapsedRatio: number;
  money: ObjectiveMoney | null;
  habits: ObjectiveHabit[];
  /** Constância nos hábitos de apoio (0 a 1) desde o início, até 28 dias para trás. */
  habitRatio: number | null;
  event: EventLike | null;
  /** 0 a 1: 60% dinheiro e 40% hábitos quando há os dois. */
  overall: number;
  status: ObjectiveStatus;
  nextSteps: string[];
}

const HABIT_WINDOW_DAYS = 28;

export const objectiveProgress = (
  objective: ObjectiveLike,
  data: { goals: GoalLike[]; events: EventLike[]; habits: HabitLike[] },
  today: string,
): ObjectiveProgress => {
  const totalDays = Math.max(1, daysBetween(objective.startedOn, objective.targetDate));
  const daysLeft = daysBetween(today, objective.targetDate);
  const elapsedRatio = Math.min(1, Math.max(0, daysBetween(objective.startedOn, today) / totalDays));

  const goal = objective.goalId ? data.goals.find((g) => g.id === objective.goalId) ?? null : null;
  let money: ObjectiveMoney | null = null;
  if (goal) {
    const remainingCents = Math.max(0, goal.targetCents - goal.savedCents);
    const weeksLeft = Math.max(1, Math.ceil(Math.max(0, daysLeft) / 7));
    const expectedCents = Math.round(goal.targetCents * elapsedRatio);
    money = {
      goalName: goal.name,
      currency: goal.currency,
      savedCents: goal.savedCents,
      targetCents: goal.targetCents,
      remainingCents,
      ratio: Math.min(1, goal.savedCents / goal.targetCents),
      expectedCents,
      perWeekCents: remainingCents ? Math.ceil(remainingCents / weeksLeft / 100) * 100 : 0,
      onTrack: remainingCents === 0 || goal.savedCents >= expectedCents * 0.9,
    };
  }

  const habits: ObjectiveHabit[] = objective.habitIds
    .map((id) => data.habits.find((h) => h.id === id))
    .filter((h): h is HabitLike => !!h)
    .map((h) => {
      const last7 = Array.from({ length: 7 }, (_, i) => addDaysToKey(today, -i));
      return {
        id: h.id,
        name: h.name,
        doneToday: h.doneDates.includes(today),
        doneLast7: last7.filter((d) => h.doneDates.includes(d)).length,
        streak: currentStreak(h.doneDates, today),
      };
    });

  let habitRatio: number | null = null;
  if (habits.length) {
    const windowDays = Math.max(1, Math.min(HABIT_WINDOW_DAYS, daysBetween(objective.startedOn, today) + 1));
    const days = Array.from({ length: windowDays }, (_, i) => addDaysToKey(today, -i));
    const source = objective.habitIds.map((id) => data.habits.find((h) => h.id === id)).filter((h): h is HabitLike => !!h);
    const done = source.reduce((sum, h) => sum + days.filter((d) => h.doneDates.includes(d)).length, 0);
    habitRatio = done / (windowDays * source.length);
  }

  const event = objective.eventId ? data.events.find((e) => e.id === objective.eventId) ?? null : null;

  const overall = money && habitRatio !== null
    ? money.ratio * 0.6 + habitRatio * 0.4
    : money ? money.ratio : habitRatio ?? elapsedRatio;

  let status: ObjectiveStatus;
  if (objective.completedAt) status = 'done';
  else if (daysLeft < 0) status = 'overdue';
  else if ((money && !money.onTrack) || (habitRatio !== null && habitRatio < 0.5 && daysBetween(objective.startedOn, today) >= 3)) status = 'behind';
  else status = 'on_track';

  const nextSteps: string[] = [];
  if (status !== 'done') {
    if (money && money.remainingCents > 0) {
      nextSteps.push(daysLeft > 7
        ? `Guarde ${formatMoney(money.perWeekCents, money.currency)} por semana até ${formatShortDate(objective.targetDate, today)}.`
        : `Faltam ${formatMoney(money.remainingCents, money.currency)} para ${money.goalName}.`);
    }
    const pending = habits.find((h) => !h.doneToday);
    if (pending) nextSteps.push(`Marque “${pending.name}” hoje para manter o ritmo.`);
    if (!nextSteps.length) nextSteps.push(daysLeft >= 0 ? 'Tudo no ritmo. Continue assim!' : 'O prazo passou. Marque como concluído ou escolha uma nova data.');
  }

  return { daysLeft, totalDays, elapsedRatio, money, habits, habitRatio, event, overall, status, nextSteps };
};

export const OBJECTIVE_STATUS_LABEL: Record<ObjectiveStatus, string> = {
  done: 'Concluído',
  on_track: 'No ritmo',
  behind: 'Precisa de atenção',
  overdue: 'Prazo passou',
};
