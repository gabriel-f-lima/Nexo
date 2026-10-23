import { addMonthsToKey, addMonthsToMonth, dayInMonth, monthOfKey } from './dates';
import type { Currency } from './finance';

/* Cartões de crédito: em qual fatura cai cada compra, parcelas e situação de cada fatura. */

export interface CardCycle {
  /** Dia em que a fatura fecha. Compras nesse dia ou depois vão para a fatura seguinte. */
  closingDay: number;
  /** Dia do vencimento. Se for menor ou igual ao fechamento, vence no mês seguinte ao fechamento. */
  dueDay: number;
}

export interface CardLike extends CardCycle {
  id: string;
  currency: Currency;
  limitCents: number | null;
}

export interface CardTransactionLike {
  type: 'income' | 'expense';
  amountCents: number;
  cardId: string | null;
  invoiceMonth: string | null;
  occurredOn: string;
}

export interface CardPaymentLike {
  cardId: string;
  invoiceMonth: string;
  amountCents: number;
  paidOn: string;
}

/** Mês de vencimento ('AAAA-MM') da fatura onde cai uma compra feita em purchaseDate ('AAAA-MM-DD'). */
export const invoiceMonthFor = (purchaseDate: string, cycle: CardCycle): string => {
  const month = monthOfKey(purchaseDate);
  const closingThisMonth = dayInMonth(month, cycle.closingDay);
  const closingMonth = purchaseDate < closingThisMonth ? month : addMonthsToMonth(month, 1);
  return cycle.dueDay > cycle.closingDay ? closingMonth : addMonthsToMonth(closingMonth, 1);
};

/** Datas de fechamento e de vencimento da fatura que vence em invoiceMonth. */
export const invoiceDates = (invoiceMonth: string, cycle: CardCycle): { closing: string; due: string } => {
  const closingMonth = cycle.dueDay > cycle.closingDay ? invoiceMonth : addMonthsToMonth(invoiceMonth, -1);
  return { closing: dayInMonth(closingMonth, cycle.closingDay), due: dayInMonth(invoiceMonth, cycle.dueDay) };
};

/** Divide o total em parcelas de centavos inteiros; a diferença do arredondamento fica na primeira. */
export const splitInstallments = (totalCents: number, count: number): number[] => {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? totalCents - base * (n - 1) : base));
};

export interface InstallmentPlan {
  number: number;
  amountCents: number;
  /** Data de referência da parcela (mesmo dia da compra, mês a mês). */
  occurredOn: string;
  invoiceMonth: string;
}

/** Parcelas de uma compra no cartão: valor, data e fatura de cada uma. */
export const planInstallments = (purchaseDate: string, totalCents: number, count: number, cycle: CardCycle): InstallmentPlan[] => {
  const first = invoiceMonthFor(purchaseDate, cycle);
  return splitInstallments(totalCents, count).map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    occurredOn: addMonthsToKey(purchaseDate, i),
    invoiceMonth: addMonthsToMonth(first, i),
  }));
};

export type InvoiceStatus = 'open' | 'closed' | 'overdue' | 'paid' | 'future';

export interface InvoiceSummary {
  cardId: string;
  month: string;
  closing: string;
  due: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  status: InvoiceStatus;
  itemCount: number;
}

/** Situação de uma fatura em `today`. */
export const summarizeInvoice = (
  card: CardLike,
  month: string,
  transactions: CardTransactionLike[],
  payments: CardPaymentLike[],
  today: string,
): InvoiceSummary => {
  const items = transactions.filter((t) => t.cardId === card.id && t.invoiceMonth === month && t.type === 'expense');
  const totalCents = items.reduce((sum, t) => sum + t.amountCents, 0);
  const paidCents = payments
    .filter((p) => p.cardId === card.id && p.invoiceMonth === month)
    .reduce((sum, p) => sum + p.amountCents, 0);
  const remainingCents = Math.max(0, totalCents - paidCents);
  const { closing, due } = invoiceDates(month, card);
  const openMonth = invoiceMonthFor(today, card);

  let status: InvoiceStatus;
  if (month > openMonth) status = 'future';
  else if (month === openMonth) status = 'open';
  else if (remainingCents === 0) status = 'paid';
  else status = today > due ? 'overdue' : 'closed';

  return { cardId: card.id, month, closing, due, totalCents, paidCents, remainingCents, status, itemCount: items.length };
};

/** Faturas do cartão com algum valor, da mais antiga em aberto até as futuras, mais a atual (mesmo vazia). */
export const cardInvoices = (
  card: CardLike,
  transactions: CardTransactionLike[],
  payments: CardPaymentLike[],
  today: string,
): InvoiceSummary[] => {
  const months = new Set<string>([invoiceMonthFor(today, card)]);
  for (const t of transactions) if (t.cardId === card.id && t.invoiceMonth) months.add(t.invoiceMonth);
  for (const p of payments) if (p.cardId === card.id) months.add(p.invoiceMonth);
  return Array.from(months)
    .sort()
    .map((month) => summarizeInvoice(card, month, transactions, payments, today));
};

export interface CardUsage {
  /** Tudo o que ainda não foi pago (faturas fechadas, a atual e as parcelas futuras). */
  usedCents: number;
  availableCents: number | null;
  /** 0 a 1; null sem limite cadastrado. */
  ratio: number | null;
}

export const cardUsage = (
  card: CardLike,
  transactions: CardTransactionLike[],
  payments: CardPaymentLike[],
  today: string,
): CardUsage => {
  const usedCents = cardInvoices(card, transactions, payments, today).reduce((sum, inv) => sum + inv.remainingCents, 0);
  if (!card.limitCents) return { usedCents, availableCents: null, ratio: null };
  return { usedCents, availableCents: card.limitCents - usedCents, ratio: usedCents / card.limitCents };
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  overdue: 'Vencida',
  paid: 'Paga',
  future: 'Próxima',
};
