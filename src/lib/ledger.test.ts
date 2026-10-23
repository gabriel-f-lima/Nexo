import { describe, expect, it } from 'vitest';
import { availableBalance, budgetStatus, mainCurrency, monthWithinBudgets, spendingByCategory, type LedgerTransaction } from './ledger';

const t = (patch: Partial<LedgerTransaction>): LedgerTransaction => ({
  type: 'expense', amountCents: 1000, currency: 'BRL', categoryId: 'lazer', occurredOn: '2026-10-05', cardId: null, ...patch,
});

describe('availableBalance', () => {
  const transactions = [
    t({ type: 'income', amountCents: 500_000, occurredOn: '2026-10-01', categoryId: null }),
    t({ amountCents: 20_000 }),
    t({ amountCents: 30_000, cardId: 'nu' }),
    t({ amountCents: 99_000, occurredOn: '2026-10-30' }),
    t({ type: 'income', amountCents: 100, currency: 'USD' }),
  ];
  const payments = [
    { cardId: 'nu', amountCents: 25_000, paidOn: '2026-10-12' },
    { cardId: 'eu', amountCents: 5_000, paidOn: '2026-10-12' },
  ];
  const currencyOf = (id: string) => (id === 'nu' ? 'BRL' : 'EUR') as 'BRL' | 'EUR';

  it('receitas menos despesas à vista e faturas pagas, só até hoje', () => {
    expect(availableBalance(transactions, payments, currencyOf, 'BRL', '2026-10-15')).toBe(500_000 - 20_000 - 25_000);
  });

  it('compra no cartão não sai do saldo antes de pagar a fatura', () => {
    expect(availableBalance(transactions, payments, currencyOf, 'BRL', '2026-10-10')).toBe(480_000);
  });

  it('cada moeda tem seu saldo', () => {
    expect(availableBalance(transactions, payments, currencyOf, 'USD', '2026-10-15')).toBe(100);
    expect(availableBalance(transactions, payments, currencyOf, 'EUR', '2026-10-15')).toBe(-5_000);
  });
});

describe('mainCurrency', () => {
  it('a mais usada, ou BRL', () => {
    expect(mainCurrency([])).toBe('BRL');
    expect(mainCurrency([{ currency: 'USD' }, { currency: 'USD' }, { currency: 'BRL' }])).toBe('USD');
  });
});

describe('spendingByCategory', () => {
  it('soma despesas, inclusive no cartão, dentro do período', () => {
    const totals = spendingByCategory([t({}), t({ cardId: 'nu' }), t({ categoryId: null }), t({ occurredOn: '2026-11-01' }), t({ type: 'income' })], 'BRL', '2026-10-01', '2026-10-31');
    expect(totals.get('lazer')).toBe(2000);
    expect(totals.get(null)).toBe(1000);
  });
});

describe('budgetStatus', () => {
  const budget = { categoryId: 'lazer', currency: 'BRL' as const, amountCents: 60_000 };

  it('no ritmo atual, estoura num dia do mês', () => {
    // 10 dias, R$ 300 gastos: R$ 30/dia; faltam R$ 300 → mais 10 dias → dia 20.
    const status = budgetStatus(budget, [t({ amountCents: 30_000, occurredOn: '2026-10-03' })], '2026-10-10');
    expect(status).toMatchObject({ spentCents: 30_000, state: 'over_pace', exceedDay: 20 });
    expect(status.projectedCents).toBe(93_000);
  });

  it('dentro do ritmo', () => {
    const status = budgetStatus(budget, [t({ amountCents: 10_000, occurredOn: '2026-10-03' })], '2026-10-20');
    expect(status).toMatchObject({ state: 'ok', exceedDay: null });
  });

  it('já estourado', () => {
    const status = budgetStatus(budget, [t({ amountCents: 70_000, occurredOn: '2026-10-02' })], '2026-10-03');
    expect(status.state).toBe('exceeded');
  });

  it('parcela agendada para o mesmo mês entra no comprometido', () => {
    const status = budgetStatus(budget, [t({ amountCents: 50_000, occurredOn: '2026-10-25' })], '2026-10-03');
    expect(status).toMatchObject({ spentCents: 0, scheduledCents: 50_000, state: 'warning' });
  });

  it('no começo do mês não projeta (uma compra grande distorceria)', () => {
    const status = budgetStatus(budget, [t({ amountCents: 20_000, occurredOn: '2026-10-01' })], '2026-10-02');
    expect(status).toMatchObject({ state: 'ok', exceedDay: null, projectedCents: 20_000 });
  });
});

describe('monthWithinBudgets', () => {
  it('todos os orçamentos respeitados no mês', () => {
    const budgets = [{ categoryId: 'lazer', currency: 'BRL' as const, amountCents: 5000 }];
    expect(monthWithinBudgets(budgets, [t({ amountCents: 4000 })], '2026-10')).toBe(true);
    expect(monthWithinBudgets(budgets, [t({ amountCents: 6000 })], '2026-10')).toBe(false);
    expect(monthWithinBudgets([], [], '2026-10')).toBe(false);
  });
});
