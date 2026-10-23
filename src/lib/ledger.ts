import { daysInMonth, monthOfKey } from './dates';
import type { Currency, TransactionType } from './finance';

/* Saldo disponível e orçamentos. Compras no cartão contam como gasto na data da parcela,
   mas só saem do saldo quando a fatura é paga. */

export interface LedgerTransaction {
  type: TransactionType;
  amountCents: number;
  currency: Currency;
  categoryId: string | null;
  occurredOn: string;
  cardId: string | null;
}

export interface LedgerCardPayment {
  cardId: string;
  amountCents: number;
  paidOn: string;
}

/**
 * Dinheiro disponível na moeda, até `today`: receitas, menos despesas fora do cartão, menos faturas pagas.
 * Lançamentos com data futura (agendados) não entram.
 */
export const availableBalance = (
  transactions: LedgerTransaction[],
  payments: LedgerCardPayment[],
  cardCurrency: (cardId: string) => Currency | undefined,
  currency: Currency,
  today: string,
): number => {
  let total = 0;
  for (const t of transactions) {
    if (t.currency !== currency || t.occurredOn > today) continue;
    if (t.type === 'income') total += t.amountCents;
    else if (!t.cardId) total -= t.amountCents;
  }
  for (const p of payments) {
    if (p.paidOn <= today && cardCurrency(p.cardId) === currency) total -= p.amountCents;
  }
  return total;
};

/** Moeda mais usada nos lançamentos (BRL quando não há nenhum). */
export const mainCurrency = (transactions: Array<{ currency: Currency }>): Currency => {
  const counts = new Map<Currency, number>();
  for (const t of transactions) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  let best: Currency = 'BRL';
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) { best = currency; bestCount = count; }
  }
  return best;
};

/** Total de despesas por categoria no período [start, end] e na moeda (inclui compras no cartão). */
export const spendingByCategory = (
  transactions: LedgerTransaction[],
  currency: Currency,
  start: string,
  end: string,
): Map<string | null, number> => {
  const totals = new Map<string | null, number>();
  for (const t of transactions) {
    if (t.type !== 'expense' || t.currency !== currency || t.occurredOn < start || t.occurredOn > end) continue;
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amountCents);
  }
  return totals;
};

export interface BudgetLike {
  categoryId: string;
  currency: Currency;
  amountCents: number;
}

export interface BudgetStatus {
  categoryId: string;
  currency: Currency;
  budgetCents: number;
  /** Gasto até hoje no mês. */
  spentCents: number;
  /** Já lançado para depois de hoje no mesmo mês (parcelas, agendados). */
  scheduledCents: number;
  /** Projeção para o fim do mês no ritmo atual. */
  projectedCents: number;
  ratio: number;
  state: 'ok' | 'warning' | 'over_pace' | 'exceeded';
  /** Dia do mês em que o orçamento estoura no ritmo atual (só quando ainda não estourou). */
  exceedDay: number | null;
}

/** Ritmo mínimo de dias para projetar o mês: antes disso, uma compra grande distorce tudo. */
const MIN_DAYS_FOR_PACE = 5;

export const budgetStatus = (budget: BudgetLike, transactions: LedgerTransaction[], today: string): BudgetStatus => {
  const month = monthOfKey(today);
  const [year, monthNumber] = month.split('-').map(Number);
  const totalDays = daysInMonth(year, monthNumber - 1);
  const day = Number(today.slice(8, 10));

  let spentCents = 0;
  let scheduledCents = 0;
  for (const t of transactions) {
    if (t.type !== 'expense' || t.categoryId !== budget.categoryId || t.currency !== budget.currency) continue;
    if (monthOfKey(t.occurredOn) !== month) continue;
    if (t.occurredOn <= today) spentCents += t.amountCents;
    else scheduledCents += t.amountCents;
  }

  const dailyRate = spentCents / day;
  const paceReliable = day >= MIN_DAYS_FOR_PACE;
  const projectedCents = Math.round(paceReliable ? spentCents + dailyRate * (totalDays - day) + scheduledCents : spentCents + scheduledCents);
  const committed = spentCents + scheduledCents;
  const ratio = committed / budget.amountCents;

  let exceedDay: number | null = null;
  if (committed < budget.amountCents && paceReliable && dailyRate > 0) {
    const daysToExceed = Math.ceil((budget.amountCents - committed) / dailyRate);
    const dayExceeded = day + daysToExceed;
    if (dayExceeded <= totalDays) exceedDay = dayExceeded;
  }

  let state: BudgetStatus['state'] = 'ok';
  if (committed > budget.amountCents) state = 'exceeded';
  else if (exceedDay !== null) state = 'over_pace';
  else if (ratio >= 0.8) state = 'warning';

  return {
    categoryId: budget.categoryId,
    currency: budget.currency,
    budgetCents: budget.amountCents,
    spentCents,
    scheduledCents,
    projectedCents,
    ratio,
    state,
    exceedDay,
  };
};

/** Mês fechado ('AAAA-MM') em que todas as categorias com orçamento ficaram dentro do limite. */
export const monthWithinBudgets = (budgets: BudgetLike[], transactions: LedgerTransaction[], month: string): boolean => {
  if (!budgets.length) return false;
  return budgets.every((budget) => {
    const spent = transactions
      .filter((t) => t.type === 'expense' && t.categoryId === budget.categoryId && t.currency === budget.currency && monthOfKey(t.occurredOn) === month)
      .reduce((sum, t) => sum + t.amountCents, 0);
    return spent <= budget.amountCents;
  });
};
