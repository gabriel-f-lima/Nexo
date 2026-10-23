import { addMonthsToMonth, daysBetween, dayInMonth, monthOfKey } from './dates';
import type { Currency } from './finance';

/* Contas a pagar: vencimento de cada mês, situação e o que vence nos próximos dias. */

export interface BillLike {
  id: string;
  name: string;
  amountCents: number;
  currency: Currency;
  categoryId: string | null;
  recurrence: 'monthly' | 'once';
  dueDay: number | null;
  dueDate: string | null;
  startsOn: string;
  active: boolean;
}

export interface BillPaymentLike {
  billId: string | null;
  billPeriod: string | null;
  amountCents: number;
  occurredOn: string;
}

export type BillStatus = 'paid' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming';

export interface BillOccurrence {
  bill: BillLike;
  /** Mês de referência ('AAAA-MM') do pagamento. */
  period: string;
  dueDate: string;
  status: BillStatus;
  /** Dias até o vencimento (negativo se já venceu). */
  daysLeft: number;
  paidOn: string | null;
}

/**
 * Vencimento da conta no mês, ou null se ela não vence nesse mês. Contas mensais só contam a partir de startsOn:
 * quem cadastra "aluguel, dia 5" no dia 8 não vê o aluguel deste mês como vencido.
 */
export const billDueDate = (bill: BillLike, period: string): string | null => {
  if (bill.recurrence === 'once') return bill.dueDate && monthOfKey(bill.dueDate) === period ? bill.dueDate : null;
  if (!bill.dueDay) return null;
  const due = dayInMonth(period, bill.dueDay);
  return due >= bill.startsOn ? due : null;
};

/** Primeiro vencimento de uma conta mensal cadastrada em `from`. */
export const firstMonthlyDue = (dueDay: number, from: string): string => {
  const thisMonth = dayInMonth(monthOfKey(from), dueDay);
  return thisMonth >= from ? thisMonth : dayInMonth(addMonthsToMonth(monthOfKey(from), 1), dueDay);
};

/** Dias de antecedência em que a conta aparece como "vence em breve". */
export const DUE_SOON_DAYS = 3;

export const billOccurrence = (
  bill: BillLike,
  period: string,
  payments: BillPaymentLike[],
  today: string,
): BillOccurrence | null => {
  const dueDate = billDueDate(bill, period);
  if (!dueDate) return null;
  const payment = payments.find((p) => p.billId === bill.id && p.billPeriod === period);
  const daysLeft = daysBetween(today, dueDate);
  let status: BillStatus;
  if (payment) status = 'paid';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft === 0) status = 'due_today';
  else if (daysLeft <= DUE_SOON_DAYS) status = 'due_soon';
  else status = 'upcoming';
  return { bill, period, dueDate, status, daysLeft, paidOn: payment?.occurredOn ?? null };
};

/**
 * Contas que pedem atenção: vencidas (até `lookbackMonths` meses atrás, sem pagamento) e as que vencem
 * nos próximos `days` dias. Ordenadas pelo vencimento.
 */
export const billsToWatch = (
  bills: BillLike[],
  payments: BillPaymentLike[],
  today: string,
  days = 7,
  lookbackMonths = 2,
): BillOccurrence[] => {
  const current = monthOfKey(today);
  const periods = Array.from({ length: lookbackMonths + 2 }, (_, i) => addMonthsToMonth(current, i - lookbackMonths));
  const result: BillOccurrence[] = [];
  for (const bill of bills.filter((b) => b.active)) {
    for (const period of periods) {
      const occurrence = billOccurrence(bill, period, payments, today);
      if (!occurrence || occurrence.status === 'paid') continue;
      if (occurrence.status === 'overdue' || occurrence.daysLeft <= days) result.push(occurrence);
    }
  }
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bill.name.localeCompare(b.bill.name));
};

/** Todas as contas do mês, pagas ou não, para a lista de contas. */
export const billsOfMonth = (bills: BillLike[], payments: BillPaymentLike[], period: string, today: string): BillOccurrence[] =>
  bills
    .map((bill) => billOccurrence(bill, period, payments, today))
    .filter((o): o is BillOccurrence => o !== null && (o.bill.active || o.status === 'paid'))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bill.name.localeCompare(b.bill.name));

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  paid: 'Paga',
  overdue: 'Vencida',
  due_today: 'Vence hoje',
  due_soon: 'Vence em breve',
  upcoming: 'A vencer',
};
