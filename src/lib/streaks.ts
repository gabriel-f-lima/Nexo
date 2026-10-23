import { addDaysToKey, daysBetween } from './dates';

/* Sequências de hábitos: dias seguidos de cada hábito e do conjunto. */

export interface HabitLike {
  id: string;
  name: string;
  doneDates: string[];
}

/** Dias seguidos até hoje (ou até ontem, se hoje ainda não foi marcado: a sequência ainda pode continuar). */
export const currentStreak = (doneDates: string[], today: string): number => {
  const done = new Set(doneDates);
  let cursor = done.has(today) ? today : addDaysToKey(today, -1);
  let count = 0;
  while (done.has(cursor)) {
    count += 1;
    cursor = addDaysToKey(cursor, -1);
  }
  return count;
};

/** Maior sequência já feita. */
export const longestStreak = (doneDates: string[]): number => {
  const days = Array.from(new Set(doneDates)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i += 1) {
    run = i > 0 && daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
};

/** Dias seguidos em que pelo menos um hábito foi feito. */
export const activeDaysStreak = (habits: HabitLike[], today: string): number =>
  currentStreak(habits.flatMap((h) => h.doneDates), today);

/** Quantos hábitos foram feitos em cada dia. */
const countsByDay = (habits: HabitLike[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const habit of habits) {
    for (const day of new Set(habit.doneDates)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
};

/** Dias em [start, end] em que todos os hábitos atuais foram feitos. */
export const perfectDaysBetween = (habits: HabitLike[], start: string, end: string): string[] => {
  if (!habits.length) return [];
  const counts = countsByDay(habits);
  const result: string[] = [];
  for (let day = start; day <= end; day = addDaysToKey(day, 1)) {
    if ((counts.get(day) ?? 0) >= habits.length) result.push(day);
  }
  return result;
};

/** Maior sequência de dias perfeitos (todos os hábitos feitos). */
export const longestPerfectRun = (habits: HabitLike[]): number => {
  if (!habits.length) return 0;
  const counts = countsByDay(habits);
  const perfect = Array.from(counts.entries()).filter(([, n]) => n >= habits.length).map(([day]) => day);
  return longestStreak(perfect);
};

export interface StreakGoalLike {
  habitId: string;
  targetDays: number;
  startedOn: string;
  achievedOn: string | null;
}

export interface StreakGoalProgress {
  current: number;
  target: number;
  ratio: number;
  achieved: boolean;
  /** Faltam quantos dias seguidos. */
  remaining: number;
  /** Hoje ainda não foi marcado e a sequência depende disso. */
  atRisk: boolean;
}

export const streakGoalProgress = (goal: StreakGoalLike, habit: HabitLike | undefined, today: string): StreakGoalProgress => {
  const current = habit ? currentStreak(habit.doneDates, today) : 0;
  const achieved = goal.achievedOn !== null || current >= goal.targetDays;
  return {
    current,
    target: goal.targetDays,
    ratio: achieved ? 1 : Math.min(1, current / goal.targetDays),
    achieved,
    remaining: Math.max(0, goal.targetDays - current),
    atRisk: !achieved && current > 0 && !!habit && !habit.doneDates.includes(today),
  };
};

/** Sugestões de meta de sequência. */
export const STREAK_TARGETS = [7, 14, 21, 30, 60, 100] as const;
