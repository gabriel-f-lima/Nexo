import { addDaysToKey, toISODate } from './dates';
import { formatMoney, type Currency } from './finance';
import { spendingByCategory, type LedgerTransaction } from './ledger';
import { perfectDaysBetween, type HabitLike } from './streaks';

/* Resumo da semana: os últimos 7 dias completos comparados com os 7 anteriores. */

export interface WeeklyInput {
  today: string;
  currency: Currency;
  transactions: LedgerTransaction[];
  categoryName: (id: string | null) => string;
  habits: HabitLike[];
  events: Array<{ start: string }>;
}

export interface CategoryChange {
  name: string;
  currentCents: number;
  previousCents: number;
  /** Variação relativa (0,2 = 20% a mais); null quando não havia gasto antes. */
  change: number | null;
}

export interface WeeklySummary {
  start: string;
  end: string;
  /** Semana ISO do fim do período, para não repetir o aviso. */
  key: string;
  currency: Currency;
  spentCents: number;
  previousSpentCents: number;
  incomeCents: number;
  highlight: CategoryChange | null;
  habits: { perfectDays: number; checkIns: number; possible: number } | null;
  tomorrowEvents: number;
  lines: string[];
}

/** Diferença mínima para destacar uma categoria (evita "100% a mais" por R$ 2). */
const MIN_CHANGE_CENTS = 2000;

const percent = (value: number) => `${Math.round(Math.abs(value) * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const weeklySummary = (input: WeeklyInput): WeeklySummary => {
  const end = addDaysToKey(input.today, -1);
  const start = addDaysToKey(input.today, -7);
  const prevEnd = addDaysToKey(start, -1);
  const prevStart = addDaysToKey(start, -7);

  const current = spendingByCategory(input.transactions, input.currency, start, end);
  const previous = spendingByCategory(input.transactions, input.currency, prevStart, prevEnd);
  const sum = (map: Map<string | null, number>) => Array.from(map.values()).reduce((a, b) => a + b, 0);
  const spentCents = sum(current);
  const previousSpentCents = sum(previous);
  const incomeCents = input.transactions
    .filter((t) => t.type === 'income' && t.currency === input.currency && t.occurredOn >= start && t.occurredOn <= end)
    .reduce((a, t) => a + t.amountCents, 0);

  // Maior aumento relevante; sem aumento, a maior queda (boa notícia); sem histórico, a categoria nova mais cara.
  const changes: CategoryChange[] = [];
  for (const id of new Set([...current.keys(), ...previous.keys()])) {
    const cur = current.get(id) ?? 0;
    const prev = previous.get(id) ?? 0;
    changes.push({ name: input.categoryName(id), currentCents: cur, previousCents: prev, change: prev ? (cur - prev) / prev : null });
  }
  const rises = changes.filter((c) => c.change !== null && c.change >= 0.1 && c.currentCents - c.previousCents >= MIN_CHANGE_CENTS)
    .sort((a, b) => (b.currentCents - b.previousCents) - (a.currentCents - a.previousCents));
  const drops = changes.filter((c) => c.change !== null && c.change <= -0.1 && c.previousCents - c.currentCents >= MIN_CHANGE_CENTS)
    .sort((a, b) => (b.previousCents - b.currentCents) - (a.previousCents - a.currentCents));
  const fresh = changes.filter((c) => c.change === null && c.currentCents >= MIN_CHANGE_CENTS * 2).sort((a, b) => b.currentCents - a.currentCents);
  const highlight = rises[0] ?? drops[0] ?? fresh[0] ?? null;

  let habits: WeeklySummary['habits'] = null;
  if (input.habits.length) {
    const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i));
    const checkIns = input.habits.reduce((n, h) => n + days.filter((d) => h.doneDates.includes(d)).length, 0);
    habits = {
      perfectDays: perfectDaysBetween(input.habits, start, end).length,
      checkIns,
      possible: input.habits.length * 7,
    };
  }

  const tomorrow = addDaysToKey(input.today, 1);
  const tomorrowEvents = input.events.filter((e) => {
    const date = new Date(e.start);
    return !Number.isNaN(date.getTime()) && toISODate(date) === tomorrow;
  }).length;

  const money = (cents: number) => formatMoney(cents, input.currency);
  const lines: string[] = [];
  if (spentCents || previousSpentCents) {
    const diff = previousSpentCents ? (spentCents - previousSpentCents) / previousSpentCents : null;
    lines.push(diff === null || Math.abs(diff) < 0.05
      ? `Você gastou ${money(spentCents)} nos últimos 7 dias.`
      : `Você gastou ${money(spentCents)} nos últimos 7 dias, ${percent(diff)} ${diff > 0 ? 'a mais' : 'a menos'} que na semana anterior.`);
  }
  if (highlight) {
    if (highlight.change === null) lines.push(`Gasto novo: ${money(highlight.currentCents)} com ${highlight.name}.`);
    else if (highlight.change > 0) lines.push(`Você gastou ${percent(highlight.change)} a mais com ${highlight.name} (${money(highlight.currentCents)}).`);
    else lines.push(`Boa: ${percent(highlight.change)} a menos com ${highlight.name} (${money(highlight.previousCents - highlight.currentCents)} de economia).`);
  }
  if (habits) {
    lines.push(habits.perfectDays === 7
      ? 'Cumpriu todos os hábitos nos 7 dias. Semana perfeita!'
      : `Cumpriu todos os hábitos em ${habits.perfectDays} de 7 dias (${Math.round((habits.checkIns / habits.possible) * 100)}% das marcações).`);
  }
  lines.push(tomorrowEvents ? `Tem ${plural(tomorrowEvents, 'compromisso', 'compromissos')} amanhã.` : 'Nenhum compromisso amanhã.');

  return {
    start, end, key: isoWeekKey(end), currency: input.currency,
    spentCents, previousSpentCents, incomeCents, highlight, habits, tomorrowEvents, lines,
  };
};

/** 'AAAA-Www' da semana ISO (segunda a domingo) que contém a data. */
export const isoWeekKey = (dateKey: string): string => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};
