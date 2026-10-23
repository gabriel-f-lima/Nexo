import { addDaysToKey, addMonthsToMonth, daysBetween, formatShortDate, monthOfKey, relativeDay } from './dates';
import { formatMoney, type Currency } from './finance';
import { billsToWatch, type BillLike, type BillPaymentLike } from './bills';
import { cardInvoices, cardUsage, type CardLike, type CardPaymentLike, type CardTransactionLike } from './cards';
import { availableBalance, budgetStatus, spendingByCategory, type BudgetLike, type LedgerTransaction } from './ledger';
import { currentStreak, streakGoalProgress, type HabitLike, type StreakGoalLike } from './streaks';

/* Coach: avisos práticos tirados dos seus dados. Cada aviso tem um id estável (para não repetir notificação)
   e uma prioridade; a tela mostra os mais importantes primeiro. */

export type InsightTone = 'alert' | 'tip' | 'good';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  text: string;
  priority: number;
  action?: { label: string; to: string };
}

export interface CoachInput {
  today: string;
  /** Moedas com lançamentos; os avisos de saldo valem por moeda. */
  currencies: Currency[];
  transactions: Array<LedgerTransaction & CardTransactionLike & BillPaymentLike>;
  categoryName: (id: string | null) => string;
  budgets: BudgetLike[];
  goals: Array<{ id: string; name: string; currency: Currency; targetCents: number; savedCents: number; deadline: string | null }>;
  bills: BillLike[];
  cards: Array<CardLike & { name: string; archived?: boolean }>;
  cardPayments: CardPaymentLike[];
  habits: HabitLike[];
  streakGoals: StreakGoalLike[];
  /** Plano com financeiro: sem ele, só os avisos de rotina. */
  finance: boolean;
}

const FINANCE = '/app/financas';

export const coachInsights = (input: CoachInput): Insight[] => {
  const { today } = input;
  const out: Insight[] = [];
  const month = monthOfKey(today);

  if (input.finance) {
    // Orçamentos.
    for (const budget of input.budgets) {
      const status = budgetStatus(budget, input.transactions, today);
      const name = input.categoryName(budget.categoryId);
      const money = (c: number) => formatMoney(c, budget.currency);
      if (status.state === 'exceeded') {
        out.push({
          id: `budget-exceeded:${budget.categoryId}:${month}`, tone: 'alert', priority: 90,
          title: `Orçamento de ${name} estourado`,
          text: `Já são ${money(status.spentCents + status.scheduledCents)} de ${money(status.budgetCents)} neste mês.`,
          action: { label: 'Ver orçamentos', to: `${FINANCE}?aba=orcamentos` },
        });
      } else if (status.state === 'over_pace' && status.exceedDay) {
        out.push({
          id: `budget-pace:${budget.categoryId}:${month}`, tone: 'alert', priority: 80,
          title: `${name} acima do ritmo`,
          text: `Nesse ritmo você estoura o orçamento de ${name} no dia ${status.exceedDay}. Faltam ${money(Math.max(0, status.budgetCents - status.spentCents - status.scheduledCents))} para o limite.`,
          action: { label: 'Ver orçamentos', to: `${FINANCE}?aba=orcamentos` },
        });
      } else if (status.state === 'warning') {
        out.push({
          id: `budget-warning:${budget.categoryId}:${month}`, tone: 'tip', priority: 50,
          title: `${name} perto do limite`,
          text: `Você já usou ${Math.round(status.ratio * 100)}% do orçamento de ${name} neste mês.`,
          action: { label: 'Ver orçamentos', to: `${FINANCE}?aba=orcamentos` },
        });
      }
    }

    // Contas.
    for (const o of billsToWatch(input.bills, input.transactions, today, 3)) {
      const money = formatMoney(o.bill.amountCents, o.bill.currency);
      if (o.status === 'overdue') {
        out.push({
          id: `bill-overdue:${o.bill.id}:${o.period}`, tone: 'alert', priority: 95,
          title: `${o.bill.name} venceu`,
          text: `Venceu ${relativeDay(o.dueDate, today)} (${money}). Pague ou marque como paga.`,
          action: { label: 'Ver contas', to: `${FINANCE}?aba=contas` },
        });
      } else {
        out.push({
          id: `bill-due:${o.bill.id}:${o.period}`, tone: 'tip', priority: o.status === 'due_today' ? 88 : 70,
          title: o.status === 'due_today' ? `${o.bill.name} vence hoje` : `${o.bill.name} vence ${relativeDay(o.dueDate, today)}`,
          text: `${money}. Já separou o valor?`,
          action: { label: 'Ver contas', to: `${FINANCE}?aba=contas` },
        });
      }
    }

    // Cartões: fatura vencida, vencendo, fechando e limite apertado.
    for (const card of input.cards.filter((c) => !c.archived)) {
      const money = (c: number) => formatMoney(c, card.currency);
      for (const invoice of cardInvoices(card, input.transactions, input.cardPayments, today)) {
        if (invoice.status === 'overdue') {
          out.push({
            id: `invoice-overdue:${card.id}:${invoice.month}`, tone: 'alert', priority: 96,
            title: `Fatura do ${card.name} vencida`,
            text: `Faltam ${money(invoice.remainingCents)}. Pagar logo evita os juros do rotativo.`,
            action: { label: 'Ver cartões', to: `${FINANCE}?aba=cartoes` },
          });
        } else if (invoice.status === 'closed' && invoice.remainingCents > 0) {
          const days = daysBetween(today, invoice.due);
          out.push({
            id: `invoice-due:${card.id}:${invoice.month}`, tone: days <= 1 ? 'alert' : 'tip', priority: days <= 1 ? 89 : 72,
            title: `Fatura do ${card.name} vence ${relativeDay(invoice.due, today)}`,
            text: `Valor a pagar: ${money(invoice.remainingCents)}.`,
            action: { label: 'Ver cartões', to: `${FINANCE}?aba=cartoes` },
          });
        } else if (invoice.status === 'open' && invoice.totalCents > 0) {
          const days = daysBetween(today, invoice.closing);
          if (days >= 0 && days <= 2) {
            out.push({
              id: `invoice-closing:${card.id}:${invoice.month}`, tone: 'tip', priority: 45,
              title: `Fatura do ${card.name} fecha ${relativeDay(invoice.closing, today)}`,
              text: `Até agora: ${money(invoice.totalCents)}. Compras a partir do fechamento ficam para a próxima fatura.`,
              action: { label: 'Ver cartões', to: `${FINANCE}?aba=cartoes` },
            });
          }
        }
      }
      const usage = cardUsage(card, input.transactions, input.cardPayments, today);
      if (usage.ratio !== null && usage.ratio >= 0.8) {
        out.push({
          id: `card-limit:${card.id}:${month}`, tone: 'alert', priority: 60,
          title: `Limite do ${card.name} quase no fim`,
          text: `Você já usou ${Math.round(usage.ratio * 100)}% do limite. Disponível: ${money(Math.max(0, usage.availableCents ?? 0))}.`,
          action: { label: 'Ver cartões', to: `${FINANCE}?aba=cartoes` },
        });
      }
    }

    // Saldo do mês: depois das contas e faturas que ainda vencem neste mês, sobra dinheiro?
    const cardCurrency = (id: string) => input.cards.find((c) => c.id === id)?.currency;
    for (const currency of input.currencies) {
      const balance = availableBalance(input.transactions, input.cardPayments, cardCurrency, currency, today);
      const endOfMonth = addDaysToKey(`${addMonthsToMonth(month, 1)}-01`, -1);
      const bills = billsToWatch(input.bills.filter((b) => b.currency === currency), input.transactions, today, daysBetween(today, endOfMonth))
        .reduce((sum, o) => sum + o.bill.amountCents, 0);
      const invoices = input.cards.filter((c) => c.currency === currency && !c.archived)
        .flatMap((c) => cardInvoices(c, input.transactions, input.cardPayments, today))
        .filter((i) => (i.status === 'closed' || i.status === 'overdue') || (i.status === 'open' && i.due <= endOfMonth))
        .reduce((sum, i) => sum + i.remainingCents, 0);
      const after = balance - bills - invoices;
      if ((bills || invoices) && after < 0) {
        out.push({
          id: `balance-short:${currency}:${month}`, tone: 'alert', priority: 85,
          title: 'O saldo pode não cobrir o mês',
          text: `Depois das contas e faturas que vencem até o fim do mês, faltariam ${formatMoney(-after, currency)}.`,
          action: { label: 'Ver financeiro', to: FINANCE },
        });
      }
    }

    // Gasto fora do comum na última semana (comparado à média das 4 anteriores).
    for (const currency of input.currencies) {
      const lastWeek = spendingByCategory(input.transactions, currency, addDaysToKey(today, -6), today);
      const before = spendingByCategory(input.transactions, currency, addDaysToKey(today, -34), addDaysToKey(today, -7));
      for (const [categoryId, cents] of lastWeek) {
        const weeklyAverage = (before.get(categoryId) ?? 0) / 4;
        if (weeklyAverage > 0 && cents >= weeklyAverage * 1.5 && cents - weeklyAverage >= 5000) {
          const name = input.categoryName(categoryId);
          out.push({
            id: `spike:${categoryId ?? 'none'}:${today}`, tone: 'tip', priority: 40,
            title: `Gastos com ${name} subiram`,
            text: `${formatMoney(cents, currency)} nos últimos 7 dias, ${(cents / weeklyAverage).toFixed(1).replace('.', ',')}x a sua média semanal.`,
            action: { label: 'Ver gráficos', to: `${FINANCE}?aba=graficos` },
          });
        }
      }
    }

    // Metas financeiras com prazo: quanto guardar por semana.
    const goalTips = input.goals
      .filter((g) => g.deadline && g.deadline > today && g.savedCents < g.targetCents)
      .map((g) => {
        const remaining = g.targetCents - g.savedCents;
        const weeks = Math.max(1, Math.ceil(daysBetween(today, g.deadline as string) / 7));
        return { goal: g, remaining, perWeek: Math.ceil(remaining / weeks / 100) * 100 };
      })
      .sort((a, b) => (a.goal.deadline as string).localeCompare(b.goal.deadline as string))
      .slice(0, 2);
    for (const { goal, remaining, perWeek } of goalTips) {
      out.push({
        id: `goal-pace:${goal.id}:${month}`, tone: 'tip', priority: 55,
        title: `Faltam ${formatMoney(remaining, goal.currency)} para ${goal.name}`,
        text: `Que tal guardar ${formatMoney(perWeek, goal.currency)} por semana até ${formatShortDate(goal.deadline as string, today)}?`,
        action: { label: 'Ver metas', to: '/app/metas' },
      });
    }
    for (const goal of input.goals.filter((g) => g.savedCents >= g.targetCents)) {
      out.push({
        id: `goal-done:${goal.id}`, tone: 'good', priority: 20,
        title: `Meta ${goal.name} concluída`,
        text: `Você juntou ${formatMoney(goal.savedCents, goal.currency)}. Que tal definir a próxima?`,
        action: { label: 'Ver metas', to: '/app/metas' },
      });
    }
  }

  // Rotina: sequência em risco e meta de sequência perto do fim.
  for (const habit of input.habits) {
    const streak = currentStreak(habit.doneDates, today);
    if (streak >= 3 && !habit.doneDates.includes(today)) {
      out.push({
        id: `streak-risk:${habit.id}:${today}`, tone: 'tip', priority: 65,
        title: `Sequência de ${streak} dias em ${habit.name}`,
        text: 'Marque hoje para não perder a sequência.',
        action: { label: 'Abrir rotina', to: '/app/rotina' },
      });
    }
  }
  for (const goal of input.streakGoals) {
    const habit = input.habits.find((h) => h.id === goal.habitId);
    const progress = streakGoalProgress(goal, habit, today);
    if (habit && !progress.achieved && progress.remaining <= 2 && progress.current > 0) {
      out.push({
        id: `streak-goal-near:${goal.habitId}:${goal.targetDays}:${today}`, tone: 'good', priority: 58,
        title: `Falta pouco para ${goal.targetDays} dias de ${habit.name}`,
        text: progress.remaining === 1 ? 'Só mais 1 dia para cumprir a meta de sequência.' : `Mais ${progress.remaining} dias para cumprir a meta de sequência.`,
        action: { label: 'Ver metas', to: '/app/metas' },
      });
    }
  }

  return out.sort((a, b) => b.priority - a.priority);
};
