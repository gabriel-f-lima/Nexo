import { addDaysToKey, addMonthsToMonth, monthOfKey } from './dates';
import { billOccurrence, type BillLike, type BillPaymentLike } from './bills';
import { cardInvoices, type CardLike, type CardPaymentLike, type CardTransactionLike } from './cards';
import { budgetStatus, type BudgetLike, type LedgerTransaction } from './ledger';
import { formatMoney, type Currency } from './finance';

/* Saúde financeira: nota de 0 a 100 em quatro partes de 25 pontos, cada uma com uma dica do que melhorar. */

export type HealthLevel = 'atencao' | 'construcao' | 'saudavel' | 'excelente';

export interface HealthFactor {
  id: 'savings' | 'budgets' | 'bills' | 'credit';
  label: string;
  points: number;
  max: number;
  detail: string;
  tip: string | null;
}

export interface FinancialHealth {
  score: number;
  level: HealthLevel;
  label: string;
  currency: Currency;
  factors: HealthFactor[];
}

export interface HealthInput {
  today: string;
  currency: Currency;
  transactions: Array<LedgerTransaction & CardTransactionLike & BillPaymentLike>;
  budgets: BudgetLike[];
  bills: BillLike[];
  cards: Array<CardLike & { name: string; archived?: boolean }>;
  cardPayments: CardPaymentLike[];
  categoryName: (id: string) => string;
}

export const HEALTH_LEVELS: Record<HealthLevel, { label: string; min: number }> = {
  excelente: { label: 'Excelente', min: 80 },
  saudavel: { label: 'Saudável', min: 60 },
  construcao: { label: 'Em construção', min: 40 },
  atencao: { label: 'Atenção', min: 0 },
};

export const levelOfScore = (score: number): HealthLevel =>
  score >= 80 ? 'excelente' : score >= 60 ? 'saudavel' : score >= 40 ? 'construcao' : 'atencao';

/** Mínimo de lançamentos nos últimos 60 dias para a nota fazer sentido. */
export const HEALTH_MIN_ENTRIES = 5;

const pct = (value: number) => `${Math.round(value * 100)}%`;

const savingsFactor = (input: HealthInput): HealthFactor => {
  const start = addDaysToKey(input.today, -29);
  let income = 0;
  let expense = 0;
  for (const t of input.transactions) {
    if (t.currency !== input.currency || t.occurredOn < start || t.occurredOn > input.today) continue;
    if (t.type === 'income') income += t.amountCents;
    else expense += t.amountCents;
  }
  const base = { id: 'savings' as const, label: 'Quanto sobra', max: 25 };
  if (income === 0) {
    return { ...base, points: 5, detail: 'Nenhuma receita nos últimos 30 dias.', tip: 'Registre suas receitas para o Nexo medir quanto sobra do que entra.' };
  }
  const rate = (income - expense) / income;
  const points = rate >= 0.2 ? 25 : rate >= 0.1 ? 20 : rate >= 0.05 ? 15 : rate >= 0 ? 10 : rate >= -0.1 ? 5 : 0;
  const detail = rate >= 0
    ? `Sobrou ${pct(rate)} do que entrou nos últimos 30 dias.`
    : `Você gastou ${pct(-rate)} a mais do que recebeu nos últimos 30 dias.`;
  const tip = rate >= 0.2 ? null : rate >= 0
    ? 'Tente guardar pelo menos 20% do que entra: comece separando um valor fixo assim que receber.'
    : 'Os gastos passaram das receitas. Veja em Gráficos onde dá para cortar primeiro.';
  return { ...base, points, detail, tip };
};

const budgetsFactor = (input: HealthInput): HealthFactor => {
  const base = { id: 'budgets' as const, label: 'Orçamentos', max: 25 };
  const budgets = input.budgets.filter((b) => b.currency === input.currency);
  if (!budgets.length) {
    return { ...base, points: 10, detail: 'Nenhum orçamento definido.', tip: 'Defina um limite mensal para as categorias em que você mais gasta.' };
  }
  const statuses = budgets.map((b) => budgetStatus(b, input.transactions, input.today));
  const healthy = statuses.filter((s) => s.state === 'ok' || s.state === 'warning').length;
  const exceeded = statuses.filter((s) => s.state === 'exceeded');
  const overPace = statuses.filter((s) => s.state === 'over_pace');
  const points = Math.round((25 * healthy) / statuses.length);
  const detail = `${healthy} de ${statuses.length} ${statuses.length === 1 ? 'orçamento está' : 'orçamentos estão'} no ritmo certo.`;
  const tip = exceeded.length
    ? `${input.categoryName(exceeded[0].categoryId)} já passou do limite deste mês.`
    : overPace.length
      ? `No ritmo atual, ${input.categoryName(overPace[0].categoryId)} estoura o orçamento no dia ${overPace[0].exceedDay}.`
      : null;
  return { ...base, points, detail, tip };
};

const billsFactor = (input: HealthInput): HealthFactor => {
  const base = { id: 'bills' as const, label: 'Contas em dia', max: 25 };
  const since = addDaysToKey(input.today, -60);
  const current = monthOfKey(input.today);
  const periods = [addMonthsToMonth(current, -2), addMonthsToMonth(current, -1), current];
  let onTime = 0;
  let late = 0;
  let overdue = 0;
  for (const bill of input.bills.filter((b) => b.currency === input.currency)) {
    for (const period of periods) {
      const o = billOccurrence(bill, period, input.transactions, input.today);
      if (!o || o.dueDate < since || o.dueDate > input.today) continue;
      if (o.status === 'paid') {
        if (o.paidOn && o.paidOn <= o.dueDate) onTime += 1;
        else late += 1;
      } else if (o.status === 'overdue' && bill.active) {
        overdue += 1;
      }
    }
  }
  const total = onTime + late + overdue;
  if (!total) {
    return { ...base, points: 18, detail: 'Nenhuma conta venceu nos últimos 60 dias.', tip: input.bills.length ? null : 'Cadastre suas contas fixas para receber aviso antes do vencimento.' };
  }
  const points = Math.max(0, Math.round((25 * (onTime + late * 0.5)) / total) - overdue * 5);
  const detail = `${onTime} de ${total} ${total === 1 ? 'conta paga' : 'contas pagas'} até o vencimento nos últimos 60 dias.`;
  const tip = overdue
    ? `Você tem ${overdue} ${overdue === 1 ? 'conta vencida' : 'contas vencidas'}. Pague ou marque como paga para evitar multa.`
    : late ? 'Ative os avisos de contas nas notificações para pagar antes do vencimento.' : null;
  return { ...base, points, detail, tip };
};

const creditFactor = (input: HealthInput): HealthFactor => {
  const base = { id: 'credit' as const, label: 'Uso do cartão', max: 25 };
  const cards = input.cards.filter((c) => c.currency === input.currency && !c.archived);
  if (!cards.length) return { ...base, points: 20, detail: 'Nenhum cartão de crédito cadastrado.', tip: null };

  let used = 0;
  let limit = 0;
  let overdue: { name: string; cents: number } | null = null;
  for (const card of cards) {
    const invoices = cardInvoices(card, input.transactions, input.cardPayments, input.today);
    const late = invoices.find((i) => i.status === 'overdue');
    if (late && !overdue) overdue = { name: card.name, cents: late.remainingCents };
    if (card.limitCents) {
      limit += card.limitCents;
      used += invoices.reduce((sum, i) => sum + i.remainingCents, 0);
    }
  }
  if (overdue) {
    return { ...base, points: 0, detail: `A fatura do ${overdue.name} está vencida.`, tip: `Pague os ${formatMoney(overdue.cents, input.currency)} da fatura vencida para evitar juros do rotativo.` };
  }
  if (!limit) return { ...base, points: 18, detail: 'Cartões sem limite informado.', tip: 'Informe o limite dos cartões para acompanhar quanto você já usou.' };
  const ratio = used / limit;
  const points = ratio <= 0.3 ? 25 : ratio <= 0.5 ? 20 : ratio <= 0.7 ? 14 : ratio <= 0.9 ? 8 : 3;
  return {
    ...base,
    points,
    detail: `Você está usando ${pct(ratio)} do limite dos cartões.`,
    tip: ratio > 0.3 ? 'Usar até 30% do limite deixa folga para imprevistos e para as próximas faturas.' : null,
  };
};

/** Nota de saúde financeira na moeda; null quando ainda não há lançamentos suficientes. */
export const financialHealth = (input: HealthInput): FinancialHealth | null => {
  const since = addDaysToKey(input.today, -60);
  const recent = input.transactions.filter((t) => t.currency === input.currency && t.occurredOn >= since && t.occurredOn <= input.today);
  if (recent.length < HEALTH_MIN_ENTRIES) return null;
  const factors = [savingsFactor(input), budgetsFactor(input), billsFactor(input), creditFactor(input)];
  const score = Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.points, 0)));
  const level = levelOfScore(score);
  return { score, level, label: HEALTH_LEVELS[level].label, currency: input.currency, factors };
};
