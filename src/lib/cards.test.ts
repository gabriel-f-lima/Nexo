import { describe, expect, it } from 'vitest';
import {
  cardInvoices, cardUsage, invoiceDates, invoiceMonthFor, planInstallments, splitInstallments, summarizeInvoice,
  type CardLike, type CardPaymentLike, type CardTransactionLike,
} from './cards';

const nubank: CardLike = { id: 'nu', currency: 'BRL', limitCents: 300_000, closingDay: 5, dueDay: 12 };
const lateClose: CardLike = { id: 'late', currency: 'BRL', limitCents: null, closingDay: 28, dueDay: 5 };

describe('invoiceMonthFor', () => {
  it('fecha e vence no mesmo mês quando o vencimento vem depois do fechamento', () => {
    expect(invoiceMonthFor('2026-10-03', nubank)).toBe('2026-10');
    expect(invoiceMonthFor('2026-10-04', nubank)).toBe('2026-10');
  });

  it('compra no dia do fechamento ou depois vai para a fatura seguinte', () => {
    expect(invoiceMonthFor('2026-10-05', nubank)).toBe('2026-11');
    expect(invoiceMonthFor('2026-10-31', nubank)).toBe('2026-11');
  });

  it('vencimento no mês seguinte ao fechamento', () => {
    expect(invoiceMonthFor('2026-10-20', lateClose)).toBe('2026-11');
    expect(invoiceMonthFor('2026-10-28', lateClose)).toBe('2026-12');
  });

  it('vira o ano', () => {
    expect(invoiceMonthFor('2026-12-10', nubank)).toBe('2027-01');
    expect(invoiceMonthFor('2026-12-29', lateClose)).toBe('2027-02');
  });

  it('fechamento dia 30 em fevereiro usa o último dia do mês', () => {
    const card = { closingDay: 30, dueDay: 10 };
    expect(invoiceMonthFor('2026-02-27', card)).toBe('2026-03');
    expect(invoiceMonthFor('2026-02-28', card)).toBe('2026-04');
  });
});

describe('invoiceDates', () => {
  it('datas da fatura batem com a regra de cada compra', () => {
    expect(invoiceDates('2026-10', nubank)).toEqual({ closing: '2026-10-05', due: '2026-10-12' });
    expect(invoiceDates('2026-11', lateClose)).toEqual({ closing: '2026-10-28', due: '2026-11-05' });
    expect(invoiceDates('2026-02', { closingDay: 31, dueDay: 30 })).toEqual({ closing: '2026-01-31', due: '2026-02-28' });
  });
});

describe('parcelas', () => {
  it('divide sem perder centavos', () => {
    expect(splitInstallments(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(10_000, 1)).toEqual([10_000]);
    expect(splitInstallments(5, 3)).toEqual([3, 1, 1]);
    for (const n of [2, 5, 7, 12, 48]) expect(splitInstallments(123_457, n).reduce((a, b) => a + b, 0)).toBe(123_457);
  });

  it('cada parcela vai para uma fatura seguida, com a data ajustada ao mês', () => {
    const plan = planInstallments('2026-01-31', 30_000, 3, nubank);
    expect(plan).toEqual([
      { number: 1, amountCents: 10_000, occurredOn: '2026-01-31', invoiceMonth: '2026-02' },
      { number: 2, amountCents: 10_000, occurredOn: '2026-02-28', invoiceMonth: '2026-03' },
      { number: 3, amountCents: 10_000, occurredOn: '2026-03-31', invoiceMonth: '2026-04' },
    ]);
  });
});

describe('faturas', () => {
  const tx = (amountCents: number, invoiceMonth: string, cardId = 'nu'): CardTransactionLike => ({
    type: 'expense', amountCents, cardId, invoiceMonth, occurredOn: '2026-10-01',
  });
  const transactions = [tx(10_000, '2026-09'), tx(5_000, '2026-10'), tx(2_500, '2026-10'), tx(7_000, '2026-11'), tx(999, '2026-10', 'outro')];
  const payments: CardPaymentLike[] = [{ cardId: 'nu', invoiceMonth: '2026-09', amountCents: 10_000, paidOn: '2026-09-12' }];

  it('soma só as compras daquele cartão e daquela fatura', () => {
    const invoice = summarizeInvoice(nubank, '2026-10', transactions, payments, '2026-10-08');
    expect(invoice).toMatchObject({ totalCents: 7_500, paidCents: 0, remainingCents: 7_500, itemCount: 2, closing: '2026-10-05', due: '2026-10-12' });
  });

  it('situação ao longo do tempo', () => {
    expect(summarizeInvoice(nubank, '2026-10', transactions, payments, '2026-10-02').status).toBe('open');
    expect(summarizeInvoice(nubank, '2026-10', transactions, payments, '2026-10-08').status).toBe('closed');
    expect(summarizeInvoice(nubank, '2026-10', transactions, payments, '2026-10-12').status).toBe('closed');
    expect(summarizeInvoice(nubank, '2026-10', transactions, payments, '2026-10-13').status).toBe('overdue');
    expect(summarizeInvoice(nubank, '2026-09', transactions, payments, '2026-10-13').status).toBe('paid');
    expect(summarizeInvoice(nubank, '2026-12', transactions, payments, '2026-10-08').status).toBe('future');
  });

  it('pagamento parcial deixa o restante', () => {
    const partial = [...payments, { cardId: 'nu', invoiceMonth: '2026-10', amountCents: 5_000, paidOn: '2026-10-10' }];
    const invoice = summarizeInvoice(nubank, '2026-10', transactions, partial, '2026-10-20');
    expect(invoice.remainingCents).toBe(2_500);
    expect(invoice.status).toBe('overdue');
  });

  it('lista inclui a fatura atual mesmo vazia', () => {
    const list = cardInvoices(nubank, [], [], '2026-10-20');
    expect(list.map((i) => [i.month, i.status, i.totalCents])).toEqual([['2026-11', 'open', 0]]);
  });

  it('limite usado soma tudo o que falta pagar', () => {
    const usage = cardUsage(nubank, transactions, payments, '2026-10-08');
    expect(usage.usedCents).toBe(14_500);
    expect(usage.availableCents).toBe(285_500);
    expect(usage.ratio).toBeCloseTo(14_500 / 300_000);
    expect(cardUsage(lateClose, [], [], '2026-10-08')).toEqual({ usedCents: 0, availableCents: null, ratio: null });
  });
});
