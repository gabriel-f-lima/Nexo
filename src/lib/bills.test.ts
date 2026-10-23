import { describe, expect, it } from 'vitest';
import { billDueDate, billOccurrence, billsOfMonth, billsToWatch, firstMonthlyDue, type BillLike, type BillPaymentLike } from './bills';

const bill = (patch: Partial<BillLike> = {}): BillLike => ({
  id: 'b1', name: 'Internet', amountCents: 9990, currency: 'BRL', categoryId: null,
  recurrence: 'monthly', dueDay: 10, dueDate: null, startsOn: '2026-08-01', active: true, ...patch,
});

describe('billDueDate', () => {
  it('mensal: vence no dia, ajustado ao mês', () => {
    expect(billDueDate(bill(), '2026-10')).toBe('2026-10-10');
    expect(billDueDate(bill({ dueDay: 31 }), '2027-02')).toBe('2027-02-28');
  });

  it('mensal: não vence antes de começar', () => {
    expect(billDueDate(bill(), '2026-07')).toBeNull();
    expect(billDueDate(bill(), '2026-08')).toBe('2026-08-10');
    // Cadastrada no dia 12: o vencimento do dia 10 daquele mês não conta.
    expect(billDueDate(bill({ startsOn: '2026-08-12' }), '2026-08')).toBeNull();
    expect(billDueDate(bill({ startsOn: '2026-08-12' }), '2026-09')).toBe('2026-09-10');
  });

  it('primeiro vencimento de uma conta nova', () => {
    expect(firstMonthlyDue(10, '2026-10-08')).toBe('2026-10-10');
    expect(firstMonthlyDue(10, '2026-10-10')).toBe('2026-10-10');
    expect(firstMonthlyDue(5, '2026-10-08')).toBe('2026-11-05');
    expect(firstMonthlyDue(31, '2027-01-31')).toBe('2027-01-31');
  });

  it('única: só no mês da data', () => {
    const once = bill({ recurrence: 'once', dueDay: null, dueDate: '2026-11-15' });
    expect(billDueDate(once, '2026-11')).toBe('2026-11-15');
    expect(billDueDate(once, '2026-12')).toBeNull();
  });
});

describe('billOccurrence', () => {
  const payments: BillPaymentLike[] = [{ billId: 'b1', billPeriod: '2026-09', amountCents: 9990, occurredOn: '2026-09-09' }];

  it('situação conforme o dia', () => {
    expect(billOccurrence(bill(), '2026-10', payments, '2026-10-01')?.status).toBe('upcoming');
    expect(billOccurrence(bill(), '2026-10', payments, '2026-10-07')?.status).toBe('due_soon');
    expect(billOccurrence(bill(), '2026-10', payments, '2026-10-10')?.status).toBe('due_today');
    expect(billOccurrence(bill(), '2026-10', payments, '2026-10-11')).toMatchObject({ status: 'overdue', daysLeft: -1 });
    expect(billOccurrence(bill(), '2026-09', payments, '2026-10-11')).toMatchObject({ status: 'paid', paidOn: '2026-09-09' });
  });
});

describe('billsToWatch', () => {
  it('traz vencidas sem pagamento e as dos próximos dias, em ordem', () => {
    const bills = [
      bill({ startsOn: '2026-09-01' }),
      bill({ id: 'b2', name: 'Aluguel', dueDay: 5, amountCents: 150_000, startsOn: '2026-09-01' }),
      bill({ id: 'b3', name: 'Academia', dueDay: 25, startsOn: '2026-09-01' }),
      bill({ id: 'b4', name: 'Antiga', active: false, dueDay: 8 }),
    ];
    const payments: BillPaymentLike[] = [
      { billId: 'b1', billPeriod: '2026-09', amountCents: 9990, occurredOn: '2026-09-09' },
      { billId: 'b2', billPeriod: '2026-09', amountCents: 150_000, occurredOn: '2026-09-05' },
      { billId: 'b3', billPeriod: '2026-09', amountCents: 9990, occurredOn: '2026-09-25' },
    ];
    const watch = billsToWatch(bills, payments, '2026-10-08');
    expect(watch.map((o) => [o.bill.name, o.period, o.status])).toEqual([
      ['Aluguel', '2026-10', 'overdue'],
      ['Internet', '2026-10', 'due_soon'],
    ]);
  });

  it('mês anterior sem pagamento aparece como vencido', () => {
    const watch = billsToWatch([bill()], [], '2026-10-01');
    expect(watch.map((o) => [o.period, o.status])).toEqual([['2026-08', 'overdue'], ['2026-09', 'overdue']]);
  });
});

describe('billsOfMonth', () => {
  it('lista as contas ativas do mês e as já pagas', () => {
    const list = billsOfMonth(
      [bill(), bill({ id: 'b9', name: 'Desativada', active: false })],
      [{ billId: 'b9', billPeriod: '2026-10', amountCents: 100, occurredOn: '2026-10-01' }],
      '2026-10',
      '2026-10-02',
    );
    expect(list.map((o) => [o.bill.name, o.status])).toEqual([['Desativada', 'paid'], ['Internet', 'upcoming']]);
  });
});
