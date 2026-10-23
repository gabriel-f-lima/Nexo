import { useMemo } from 'react';
import { useDataStore } from '../store/data';
import { useFinanceStore } from '../store/finance';
import { useProgressStore } from '../store/progress';
import { toISODate } from './dates';
import { CURRENCIES, type Currency } from './finance';
import { mainCurrency } from './ledger';
import { coachInsights, type Insight } from './coach';
import { financialHealth, type FinancialHealth } from './health';
import { weeklySummary, type WeeklySummary } from './weekly';
import type { AchievementContext } from './achievements';

/* Números derivados dos dados da conta, montados num lugar só: telas e avisos mostram sempre o mesmo. */

type DataState = ReturnType<typeof useDataStore.getState>;
type FinanceState = ReturnType<typeof useFinanceStore.getState>;
type ProgressState = ReturnType<typeof useProgressStore.getState>;

export interface Snapshot {
  today: string;
  data: DataState;
  finance: FinanceState;
  progress: ProgressState;
  /** Plano com acesso ao financeiro. */
  financeAccess: boolean;
}

const categoryNameOf = (finance: FinanceState) => (id: string | null): string =>
  (id ? finance.categories.find((c) => c.id === id)?.name : null) ?? 'Sem categoria';

/** Moedas em uso (lançamentos, cartões e contas), na ordem padrão. */
export const usedCurrencies = (finance: FinanceState): Currency[] => {
  const used = new Set<Currency>([
    ...finance.transactions.map((t) => t.currency),
    ...finance.cards.filter((c) => !c.archived).map((c) => c.currency),
    ...finance.bills.filter((b) => b.active).map((b) => b.currency),
  ]);
  return CURRENCIES.filter((c) => used.has(c));
};

export const primaryCurrency = (finance: FinanceState): Currency => mainCurrency(finance.transactions);

export const buildCoach = ({ today, data, finance, progress, financeAccess }: Snapshot): Insight[] => coachInsights({
  today,
  currencies: usedCurrencies(finance),
  transactions: finance.transactions,
  categoryName: categoryNameOf(finance),
  budgets: finance.budgets,
  goals: finance.goals,
  bills: finance.bills,
  cards: finance.cards,
  cardPayments: finance.cardPayments,
  habits: data.habits,
  streakGoals: progress.streakGoals.filter((g) => data.habits.some((h) => h.id === g.habitId)),
  finance: financeAccess,
});

export const buildHealth = ({ today, finance, financeAccess }: Snapshot, currency: Currency = primaryCurrency(finance)): FinancialHealth | null => {
  if (!financeAccess) return null;
  const names = categoryNameOf(finance);
  return financialHealth({
    today,
    currency,
    transactions: finance.transactions,
    budgets: finance.budgets,
    bills: finance.bills,
    cards: finance.cards,
    cardPayments: finance.cardPayments,
    categoryName: (id) => names(id),
  });
};

export const buildWeekly = ({ today, data, finance }: Snapshot): WeeklySummary => weeklySummary({
  today,
  currency: primaryCurrency(finance),
  transactions: finance.transactions,
  categoryName: categoryNameOf(finance),
  habits: data.habits,
  events: data.events,
});

export const buildAchievementContext = (snapshot: Snapshot, healthScore: number | null): AchievementContext => ({
  today: snapshot.today,
  habits: snapshot.data.habits,
  tasks: snapshot.data.tasks,
  events: snapshot.data.events,
  transactions: snapshot.finance.transactions,
  goals: snapshot.finance.goals,
  budgets: snapshot.finance.budgets,
  bills: snapshot.finance.bills,
  objectives: snapshot.progress.objectives,
  streakGoals: snapshot.progress.streakGoals,
  healthScore,
});

/** Estado atual das três stores, para quem não é componente (avisos em segundo plano). */
export const currentSnapshot = (financeAccess: boolean): Snapshot => ({
  today: toISODate(),
  data: useDataStore.getState(),
  finance: useFinanceStore.getState(),
  progress: useProgressStore.getState(),
  financeAccess,
});

/** Tudo carregado para a conta atual (evita conclusões com dados pela metade). */
export const allLoaded = (s: Snapshot): boolean =>
  !!s.data.userId && s.data.loaded && s.finance.loaded && s.finance.userId === s.data.userId
  && s.progress.loaded && s.progress.userId === s.data.userId;

/** Hook: snapshot que acompanha as mudanças das stores. O dia é relido a cada render. */
export const useSnapshot = (financeAccess: boolean): Snapshot => {
  const data = useDataStore();
  const finance = useFinanceStore();
  const progress = useProgressStore();
  const today = toISODate();
  return useMemo(() => ({ today, data, finance, progress, financeAccess }), [today, data, finance, progress, financeAccess]);
};
