import { addMonthsToMonth, monthOfKey } from './dates';
import { billDueDate, type BillLike } from './bills';
import { monthWithinBudgets, type BudgetLike, type LedgerTransaction } from './ledger';
import { currentStreak, longestPerfectRun, longestStreak, type HabitLike, type StreakGoalLike } from './streaks';

/* Conquistas: regras claras, pontos e nível. Uma conquista desbloqueada fica registrada na conta,
   mesmo que depois o dado que a liberou mude (ex.: um hábito apagado). */

export interface AchievementContext {
  today: string;
  habits: HabitLike[];
  tasks: Array<{ done: boolean }>;
  events: Array<{ start: string }>;
  transactions: Array<LedgerTransaction & { billId: string | null; billPeriod: string | null }>;
  goals: Array<{ targetCents: number; savedCents: number }>;
  budgets: BudgetLike[];
  bills: BillLike[];
  objectives: Array<{ goalId: string | null; eventId: string | null; habitIds: string[] }>;
  streakGoals: StreakGoalLike[];
  healthScore: number | null;
}

export type AchievementGroup = 'rotina' | 'agenda' | 'financas' | 'metas';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  group: AchievementGroup;
  points: number;
  /** Progresso atual e alvo, para mostrar quanto falta. */
  progress: (ctx: AchievementContext) => [number, number];
}

const bestHabitStreak = (ctx: AchievementContext) =>
  Math.max(0, ...ctx.habits.map((h) => Math.max(longestStreak(h.doneDates), currentStreak(h.doneDates, ctx.today))));

const billsPaidOnTime = (ctx: AchievementContext): number =>
  ctx.transactions.filter((t) => {
    if (!t.billId || !t.billPeriod) return false;
    const bill = ctx.bills.find((b) => b.id === t.billId);
    const due = bill ? billDueDate(bill, t.billPeriod) : null;
    return !!due && t.occurredOn <= due;
  }).length;

const closedMonthWithinBudgets = (ctx: AchievementContext): boolean => {
  const last = addMonthsToMonth(monthOfKey(ctx.today), -1);
  const hadSpending = ctx.transactions.some((t) => t.type === 'expense' && monthOfKey(t.occurredOn) === last);
  return hadSpending && monthWithinBudgets(ctx.budgets, ctx.transactions, last);
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_habit', title: 'Primeiro passo', description: 'Marque um hábito como feito pela primeira vez.', group: 'rotina', points: 10,
    progress: (c) => [c.habits.some((h) => h.doneDates.length > 0) ? 1 : 0, 1] },
  { id: 'streak_3', title: 'Pegando ritmo', description: 'Faça o mesmo hábito 3 dias seguidos.', group: 'rotina', points: 15,
    progress: (c) => [Math.min(3, bestHabitStreak(c)), 3] },
  { id: 'streak_7', title: 'Uma semana inteira', description: 'Faça o mesmo hábito 7 dias seguidos.', group: 'rotina', points: 30,
    progress: (c) => [Math.min(7, bestHabitStreak(c)), 7] },
  { id: 'streak_30', title: 'Hábito formado', description: 'Faça o mesmo hábito 30 dias seguidos.', group: 'rotina', points: 80,
    progress: (c) => [Math.min(30, bestHabitStreak(c)), 30] },
  { id: 'streak_100', title: 'Imparável', description: 'Faça o mesmo hábito 100 dias seguidos.', group: 'rotina', points: 200,
    progress: (c) => [Math.min(100, bestHabitStreak(c)), 100] },
  { id: 'perfect_day', title: 'Dia perfeito', description: 'Conclua todos os seus hábitos (pelo menos 2) no mesmo dia.', group: 'rotina', points: 15,
    progress: (c) => [c.habits.length >= 2 && longestPerfectRun(c.habits) >= 1 ? 1 : 0, 1] },
  { id: 'perfect_week', title: 'Semana perfeita', description: 'Conclua todos os hábitos (pelo menos 2) por 7 dias seguidos.', group: 'rotina', points: 60,
    progress: (c) => [c.habits.length >= 2 ? Math.min(7, longestPerfectRun(c.habits)) : 0, 7] },
  { id: 'tasks_10', title: 'Mão na massa', description: 'Tenha 10 tarefas concluídas.', group: 'agenda', points: 20,
    progress: (c) => [Math.min(10, c.tasks.filter((t) => t.done).length), 10] },
  { id: 'planner', title: 'Agenda organizada', description: 'Cadastre 10 compromissos.', group: 'agenda', points: 20,
    progress: (c) => [Math.min(10, c.events.length), 10] },
  { id: 'first_entry', title: 'Primeiro lançamento', description: 'Registre sua primeira receita ou despesa.', group: 'financas', points: 10,
    progress: (c) => [c.transactions.length ? 1 : 0, 1] },
  { id: 'entries_100', title: 'Tudo anotado', description: 'Registre 100 lançamentos.', group: 'financas', points: 50,
    progress: (c) => [Math.min(100, c.transactions.length), 100] },
  { id: 'budget_set', title: 'Com limite definido', description: 'Defina um orçamento para uma categoria.', group: 'financas', points: 15,
    progress: (c) => [c.budgets.length ? 1 : 0, 1] },
  { id: 'budget_month', title: 'Dentro do orçamento', description: 'Feche um mês com todos os orçamentos respeitados.', group: 'financas', points: 60,
    progress: (c) => [closedMonthWithinBudgets(c) ? 1 : 0, 1] },
  { id: 'bills_on_time', title: 'Contas em dia', description: 'Pague 3 contas até o vencimento.', group: 'financas', points: 30,
    progress: (c) => [Math.min(3, billsPaidOnTime(c)), 3] },
  { id: 'health_80', title: 'Saúde de ferro', description: 'Alcance 80 pontos de saúde financeira.', group: 'financas', points: 80,
    progress: (c) => [Math.min(80, c.healthScore ?? 0), 80] },
  { id: 'first_goal', title: 'Sonho com data', description: 'Crie uma meta financeira.', group: 'metas', points: 10,
    progress: (c) => [c.goals.length ? 1 : 0, 1] },
  { id: 'goal_done', title: 'Meta batida', description: 'Conclua uma meta financeira.', group: 'metas', points: 80,
    progress: (c) => [c.goals.some((g) => g.savedCents >= g.targetCents) ? 1 : 0, 1] },
  { id: 'objective_linked', title: 'Tudo conectado', description: 'Crie um objetivo que junta meta financeira, compromisso e hábito.', group: 'metas', points: 40,
    progress: (c) => [c.objectives.some((o) => o.goalId && o.eventId && o.habitIds.length) ? 1 : 0, 1] },
  { id: 'streak_goal', title: 'Desafio aceito', description: 'Defina uma meta de sequência para um hábito.', group: 'metas', points: 10,
    progress: (c) => [c.streakGoals.length ? 1 : 0, 1] },
  { id: 'streak_goal_done', title: 'Desafio cumprido', description: 'Cumpra uma meta de sequência.', group: 'metas', points: 60,
    progress: (c) => {
      const done = c.streakGoals.some((g) => {
        if (g.achievedOn) return true;
        const habit = c.habits.find((h) => h.id === g.habitId);
        return !!habit && currentStreak(habit.doneDates, c.today) >= g.targetDays;
      });
      return [done ? 1 : 0, 1];
    } },
];

export const ACHIEVEMENT_GROUPS: Record<AchievementGroup, string> = {
  rotina: 'Rotina',
  agenda: 'Agenda e tarefas',
  financas: 'Finanças',
  metas: 'Metas',
};

/** Conquistas cujo critério está cumprido agora. */
export const earnedNow = (ctx: AchievementContext): string[] =>
  ACHIEVEMENTS.filter((a) => {
    const [current, target] = a.progress(ctx);
    return current >= target;
  }).map((a) => a.id);

/* Nível: soma dos pontos das conquistas. */

const LEVELS = [
  { min: 0, name: 'Iniciante' },
  { min: 40, name: 'Aprendiz' },
  { min: 100, name: 'Constante' },
  { min: 180, name: 'Focado' },
  { min: 280, name: 'Disciplinado' },
  { min: 400, name: 'Estrategista' },
  { min: 540, name: 'Mestre da rotina' },
  { min: 700, name: 'Referência' },
  { min: 880, name: 'Lenda' },
];

export interface LevelInfo {
  level: number;
  name: string;
  points: number;
  /** Pontos do nível atual e do próximo (null no último). */
  floor: number;
  next: number | null;
  ratio: number;
}

export const levelFor = (points: number): LevelInfo => {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) if (points >= LEVELS[i].min) index = i;
  const floor = LEVELS[index].min;
  const next = LEVELS[index + 1]?.min ?? null;
  return {
    level: index + 1,
    name: LEVELS[index].name,
    points,
    floor,
    next,
    ratio: next === null ? 1 : (points - floor) / (next - floor),
  };
};

export const pointsOf = (unlockedIds: Iterable<string>): number => {
  const ids = new Set(unlockedIds);
  return ACHIEVEMENTS.filter((a) => ids.has(a.id)).reduce((sum, a) => sum + a.points, 0);
};
