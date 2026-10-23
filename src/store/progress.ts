import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { toISODate } from '../lib/dates';
import { selectAll, writeOp } from './data';

/* Objetivos (dinheiro + agenda + rotina), metas de sequência e conquistas desbloqueadas. Livres em todos os planos. */

export interface Objective {
  id: string;
  title: string;
  targetDate: string;
  goalId: string | null;
  eventId: string | null;
  habitIds: string[];
  startedOn: string;
  completedAt: string | null;
}
export type ObjectiveInput = Pick<Objective, 'title' | 'targetDate' | 'goalId' | 'eventId' | 'habitIds'>;

export interface StreakGoal {
  habitId: string;
  targetDays: number;
  startedOn: string;
  achievedOn: string | null;
}

interface ProgressState {
  userId: string | null;
  loaded: boolean;
  /** false quando o banco ainda não tem a migration de planejamento. */
  ready: boolean;
  objectives: Objective[];
  streakGoals: StreakGoal[];
  /** Conquistas desbloqueadas: id → data. */
  achievements: Record<string, string>;

  load: (userId: string) => Promise<void>;
  reset: () => void;
  addObjective: (input: ObjectiveInput) => string | null;
  updateObjective: (id: string, input: ObjectiveInput) => void;
  setObjectiveDone: (id: string, done: boolean) => void;
  removeObjective: (id: string) => void;
  setStreakGoal: (habitId: string, targetDays: number | null) => void;
  markStreakGoalAchieved: (habitId: string, date: string) => void;
  /** Registra conquistas novas; devolve as que ainda não estavam desbloqueadas. */
  unlockAchievements: (ids: string[]) => string[];
}

export const MAX_OBJECTIVES = 30;
export const MAX_OBJECTIVE_HABITS = 5;

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const missingSchema = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code ?? '';
  return code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205';
};

const mapObjective = (row: Record<string, unknown>): Objective => ({
  id: String(row.id),
  title: String(row.title),
  targetDate: String(row.target_date),
  goalId: row.goal_id ? String(row.goal_id) : null,
  eventId: row.event_id ? String(row.event_id) : null,
  habitIds: Array.isArray(row.habit_ids) ? row.habit_ids.map(String) : [],
  startedOn: String(row.started_on),
  completedAt: row.completed_at ? String(row.completed_at) : null,
});

const objectiveRow = (o: Objective, userId: string) => ({
  user_id: userId, id: o.id, title: o.title, target_date: o.targetDate, goal_id: o.goalId, event_id: o.eventId,
  habit_ids: o.habitIds, started_on: o.startedOn, completed_at: o.completedAt, updated_at: new Date().toISOString(),
});

const streakRow = (g: StreakGoal, userId: string) => ({
  user_id: userId, habit_id: g.habitId, target_days: g.targetDays, started_on: g.startedOn, achieved_on: g.achievedOn,
  updated_at: new Date().toISOString(),
});

const cleanInput = (input: ObjectiveInput): ObjectiveInput => ({
  title: input.title.trim().slice(0, 60),
  targetDate: input.targetDate,
  goalId: input.goalId || null,
  eventId: input.eventId || null,
  habitIds: Array.from(new Set(input.habitIds)).slice(0, MAX_OBJECTIVE_HABITS),
});

export const useProgressStore = create<ProgressState>()((set, get) => {
  const save = (table: string, row: Record<string, unknown>, conflict = 'user_id,id') => {
    const userId = get().userId;
    if (!userId || !get().ready) return;
    void writeOp(`salvar ${table}`, () => supabase.from(table).upsert(row, { onConflict: conflict }));
  };

  return {
    userId: null,
    loaded: false,
    ready: false,
    objectives: [],
    streakGoals: [],
    achievements: {},

    load: async (userId) => {
      set({ userId, loaded: false });
      try {
        const [objectiveRows, streakRows, achievementRows] = await Promise.all([
          selectAll('nexo_objectives', 'id,title,target_date,goal_id,event_id,habit_ids,started_on,completed_at', userId),
          selectAll('nexo_streak_goals', 'habit_id,target_days,started_on,achieved_on', userId),
          selectAll('nexo_achievements', 'id,unlocked_at', userId),
        ]);
        if (get().userId !== userId) return;
        set({
          ready: true,
          loaded: true,
          objectives: objectiveRows.map(mapObjective),
          streakGoals: streakRows.map((row) => ({
            habitId: String(row.habit_id),
            targetDays: Number(row.target_days),
            startedOn: String(row.started_on),
            achievedOn: row.achieved_on ? String(row.achieved_on) : null,
          })),
          achievements: Object.fromEntries(achievementRows.map((row) => [String(row.id), String(row.unlocked_at)])),
        });
      } catch (error) {
        if (get().userId !== userId) return;
        set({ loaded: true, ready: !missingSchema(error) });
        if (import.meta.env.DEV) console.warn('[nexo] metas e conquistas', error);
      }
    },

    reset: () => set({ userId: null, loaded: false, ready: false, objectives: [], streakGoals: [], achievements: {} }),

    addObjective: (input) => {
      const userId = get().userId;
      const clean = cleanInput(input);
      if (!userId || !get().ready || !clean.title || get().objectives.length >= MAX_OBJECTIVES) return null;
      const objective: Objective = { ...clean, id: createId(), startedOn: toISODate(), completedAt: null };
      set((s) => ({ objectives: [...s.objectives, objective] }));
      save('nexo_objectives', objectiveRow(objective, userId));
      return objective.id;
    },

    updateObjective: (id, input) => {
      const userId = get().userId;
      const current = get().objectives.find((o) => o.id === id);
      const clean = cleanInput(input);
      if (!userId || !current || !clean.title) return;
      const objective: Objective = { ...current, ...clean };
      set((s) => ({ objectives: s.objectives.map((o) => (o.id === id ? objective : o)) }));
      save('nexo_objectives', objectiveRow(objective, userId));
    },

    setObjectiveDone: (id, done) => {
      const userId = get().userId;
      const current = get().objectives.find((o) => o.id === id);
      if (!userId || !current) return;
      const objective: Objective = { ...current, completedAt: done ? new Date().toISOString() : null };
      set((s) => ({ objectives: s.objectives.map((o) => (o.id === id ? objective : o)) }));
      save('nexo_objectives', objectiveRow(objective, userId));
    },

    removeObjective: (id) => {
      const userId = get().userId;
      if (!userId) return;
      set((s) => ({ objectives: s.objectives.filter((o) => o.id !== id) }));
      void writeOp('apagar objetivo', () => supabase.from('nexo_objectives').delete().eq('user_id', userId).eq('id', id));
    },

    setStreakGoal: (habitId, targetDays) => {
      const userId = get().userId;
      if (!userId || !get().ready) return;
      if (targetDays === null) {
        set((s) => ({ streakGoals: s.streakGoals.filter((g) => g.habitId !== habitId) }));
        void writeOp('apagar meta de sequência', () =>
          supabase.from('nexo_streak_goals').delete().eq('user_id', userId).eq('habit_id', habitId));
        return;
      }
      const goal: StreakGoal = { habitId, targetDays: Math.min(365, Math.max(2, Math.round(targetDays))), startedOn: toISODate(), achievedOn: null };
      set((s) => ({ streakGoals: [...s.streakGoals.filter((g) => g.habitId !== habitId), goal] }));
      save('nexo_streak_goals', streakRow(goal, userId), 'user_id,habit_id');
    },

    markStreakGoalAchieved: (habitId, date) => {
      const userId = get().userId;
      const current = get().streakGoals.find((g) => g.habitId === habitId);
      if (!userId || !current || current.achievedOn) return;
      const goal = { ...current, achievedOn: date };
      set((s) => ({ streakGoals: s.streakGoals.map((g) => (g.habitId === habitId ? goal : g)) }));
      save('nexo_streak_goals', streakRow(goal, userId), 'user_id,habit_id');
    },

    unlockAchievements: (ids) => {
      const userId = get().userId;
      if (!userId || !get().ready || !get().loaded) return [];
      const fresh = ids.filter((id) => !get().achievements[id]);
      if (!fresh.length) return [];
      const now = new Date().toISOString();
      set((s) => ({ achievements: { ...s.achievements, ...Object.fromEntries(fresh.map((id) => [id, now])) } }));
      void writeOp('registrar conquista', () => supabase.from('nexo_achievements').upsert(
        fresh.map((id) => ({ user_id: userId, id, unlocked_at: now })),
        { onConflict: 'user_id,id', ignoreDuplicates: true },
      ));
      return fresh;
    },
  };
});
