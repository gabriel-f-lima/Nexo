import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { DEFAULT_CATEGORIES, type Currency, type TransactionType } from '../lib/finance';
import { selectAll, writeOp } from './data';

export interface Category { id: string; name: string; color: string; kind: TransactionType }
export interface Transaction {
  id: string;
  type: TransactionType;
  amountCents: number;
  currency: Currency;
  categoryId: string | null;
  occurredOn: string; // AAAA-MM-DD
  description: string;
}
export interface TransactionInput {
  type: TransactionType;
  amountCents: number;
  currency: Currency;
  categoryId: string | null;
  occurredOn: string;
  description: string;
}
export interface Goal {
  id: string;
  name: string;
  currency: Currency;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
}

interface FinanceState {
  userId: string | null;
  loaded: boolean;
  categories: Category[];
  transactions: Transaction[];
  goals: Goal[];

  load: (userId: string) => Promise<void>;
  reset: () => void;
  addTransaction: (input: TransactionInput) => void;
  updateTransaction: (id: string, input: TransactionInput) => void;
  removeTransaction: (id: string) => void;
  addCategory: (name: string, color: string, kind: TransactionType) => void;
  removeCategory: (id: string) => void;
  addGoal: (name: string, currency: Currency, targetCents: number, deadline: string | null) => void;
  addGoalSaving: (id: string, cents: number) => void;
  removeGoal: (id: string) => void;
}

const MAX_CATEGORIES = 40;
const MAX_GOALS = 30;

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const mapCategory = (row: Record<string, unknown>): Category => ({
  id: String(row.id),
  name: String(row.name),
  color: String(row.color),
  kind: row.kind === 'income' ? 'income' : 'expense',
});

const mapTransaction = (row: Record<string, unknown>): Transaction => ({
  id: String(row.id),
  type: row.type === 'income' ? 'income' : 'expense',
  amountCents: Number(row.amount_cents),
  currency: (row.currency as Currency) ?? 'BRL',
  categoryId: row.category_id ? String(row.category_id) : null,
  occurredOn: String(row.occurred_on),
  description: String(row.description ?? ''),
});

const mapGoal = (row: Record<string, unknown>): Goal => ({
  id: String(row.id),
  name: String(row.name),
  currency: (row.currency as Currency) ?? 'BRL',
  targetCents: Number(row.target_cents),
  savedCents: Number(row.saved_cents ?? 0),
  deadline: row.deadline ? String(row.deadline) : null,
});

const transactionRow = (input: TransactionInput, id: string, userId: string) => ({
  user_id: userId,
  id,
  type: input.type,
  amount_cents: input.amountCents,
  currency: input.currency,
  category_id: input.categoryId,
  occurred_on: input.occurredOn,
  description: input.description.trim().slice(0, 120),
  updated_at: new Date().toISOString(),
});

const sortTransactions = (list: Transaction[]): Transaction[] =>
  [...list].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

export const useFinanceStore = create<FinanceState>()((set, get) => {
  /** Grava uma linha na nuvem para o usuário dono da store. */
  const save = (table: string, row: Record<string, unknown>) => {
    if (!get().userId) return;
    void writeOp(`salvar ${table}`, () => supabase.from(table).upsert(row, { onConflict: 'user_id,id' }));
  };

  return {
    userId: null,
    loaded: false,
    categories: [],
    transactions: [],
    goals: [],

    load: async (userId) => {
      set({ userId, loaded: false });
      try {
        const [categoryRows, transactionRows, goalRows, state] = await Promise.all([
          selectAll('nexo_categories', 'id,name,color,kind', userId),
          selectAll('nexo_transactions', 'id,type,amount_cents,currency,category_id,occurred_on,description', userId),
          selectAll('nexo_goals', 'id,name,currency,target_cents,saved_cents,deadline', userId),
          supabase.from('nexo_user_state').select('finance_seeded').eq('user_id', userId).maybeSingle(),
        ]);
        if (state.error) throw state.error;
        if (get().userId !== userId) return;

        let categories = categoryRows.map(mapCategory);
        const seeded = Boolean((state.data as { finance_seeded?: boolean } | null)?.finance_seeded);

        // Primeiro acesso ao financeiro: cria as categorias sugeridas, uma única vez.
        if (categories.length === 0 && !seeded) {
          const { error } = await supabase.from('nexo_categories').upsert(
            DEFAULT_CATEGORIES.map((c) => ({ user_id: userId, id: c.id, name: c.name, color: c.color, kind: c.kind })),
            { onConflict: 'user_id,id' },
          );
          if (error) throw error;
          await supabase.from('nexo_user_state').update({ finance_seeded: true }).eq('user_id', userId);
          categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
        }

        if (get().userId !== userId) return;
        set({
          categories,
          transactions: sortTransactions(transactionRows.map(mapTransaction)),
          goals: goalRows.map(mapGoal),
          loaded: true,
        });
      } catch (error) {
        if (get().userId !== userId) return;
        set({ loaded: true });
        if (import.meta.env.DEV) console.warn('[nuvora] financeiro', error);
      }
    },

    reset: () => set({ userId: null, loaded: false, categories: [], transactions: [], goals: [] }),

    addTransaction: (input) => {
      const userId = get().userId;
      if (!userId) return;
      const transaction: Transaction = {
        id: createId(),
        type: input.type,
        amountCents: input.amountCents,
        currency: input.currency,
        categoryId: input.categoryId,
        occurredOn: input.occurredOn,
        description: input.description.trim().slice(0, 120),
      };
      set((s) => ({ transactions: sortTransactions([...s.transactions, transaction]) }));
      save('nexo_transactions', transactionRow(input, transaction.id, userId));
    },

    updateTransaction: (id, input) => {
      const userId = get().userId;
      if (!userId) return;
      set((s) => ({
        transactions: sortTransactions(s.transactions.map((t) => (t.id === id
          ? { ...t, ...input, description: input.description.trim().slice(0, 120) }
          : t))),
      }));
      save('nexo_transactions', transactionRow(input, id, userId));
    },

    removeTransaction: (id) => {
      const userId = get().userId;
      if (!userId) return;
      set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) }));
      void writeOp('apagar lançamento', () =>
        supabase.from('nexo_transactions').delete().eq('user_id', userId).eq('id', id));
    },

    addCategory: (name, color, kind) => {
      const userId = get().userId;
      const clean = name.trim().slice(0, 40);
      if (!userId || !clean || get().categories.length >= MAX_CATEGORIES) return;
      const category: Category = { id: createId(), name: clean, color, kind };
      set((s) => ({ categories: [...s.categories, category] }));
      save('nexo_categories', { user_id: userId, id: category.id, name: clean, color, kind, updated_at: new Date().toISOString() });
    },

    removeCategory: (id) => {
      const userId = get().userId;
      if (!userId) return;
      // O banco define category_id como nulo nos lançamentos afetados (on delete set null).
      set((s) => ({
        categories: s.categories.filter((c) => c.id !== id),
        transactions: s.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)),
      }));
      void writeOp('apagar categoria', () =>
        supabase.from('nexo_categories').delete().eq('user_id', userId).eq('id', id));
    },

    addGoal: (name, currency, targetCents, deadline) => {
      const userId = get().userId;
      const clean = name.trim().slice(0, 60);
      if (!userId || !clean || targetCents <= 0 || get().goals.length >= MAX_GOALS) return;
      const goal: Goal = { id: createId(), name: clean, currency, targetCents, savedCents: 0, deadline };
      set((s) => ({ goals: [...s.goals, goal] }));
      save('nexo_goals', {
        user_id: userId, id: goal.id, name: clean, currency, target_cents: targetCents,
        saved_cents: 0, deadline, updated_at: new Date().toISOString(),
      });
    },

    addGoalSaving: (id, cents) => {
      const userId = get().userId;
      if (!userId || cents <= 0) return;
      let changed: Goal | undefined;
      set((s) => ({
        goals: s.goals.map((g) => {
          if (g.id !== id) return g;
          changed = { ...g, savedCents: g.savedCents + cents };
          return changed;
        }),
      }));
      const goal = get().goals.find((g) => g.id === id);
      if (goal) {
        save('nexo_goals', {
          user_id: userId, id: goal.id, name: goal.name, currency: goal.currency, target_cents: goal.targetCents,
          saved_cents: goal.savedCents, deadline: goal.deadline, updated_at: new Date().toISOString(),
        });
      }
      void changed;
    },

    removeGoal: (id) => {
      const userId = get().userId;
      if (!userId) return;
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
      void writeOp('apagar meta', () =>
        supabase.from('nexo_goals').delete().eq('user_id', userId).eq('id', id));
    },
  };
});
