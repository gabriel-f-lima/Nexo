import { describe, expect, it } from 'vitest';
import { addDaysToKey } from './dates';
import { coachInsights, type CoachInput } from './coach';
import { financialHealth, levelOfScore, type HealthInput } from './health';
import { isoWeekKey, weeklySummary } from './weekly';
import type { BillLike } from './bills';

// Sexta-feira, 23 de outubro de 2026.
const today = '2026-10-23';

type Tx = HealthInput['transactions'][number];
const tx = (patch: Partial<Tx>): Tx => ({
  type: 'expense', amountCents: 1000, currency: 'BRL', categoryId: 'lazer', occurredOn: today,
  cardId: null, invoiceMonth: null, billId: null, billPeriod: null, ...patch,
});
const names: Record<string, string> = { lazer: 'Lazer', delivery: 'Delivery', mercado: 'Mercado' };
const categoryName = (id: string | null) => (id ? names[id] ?? 'Outra' : 'Sem categoria');

describe('weeklySummary', () => {
  const transactions = [
    // Semana passada (16 a 22/10)
    tx({ categoryId: 'delivery', amountCents: 12_000, occurredOn: '2026-10-20' }),
    tx({ categoryId: 'mercado', amountCents: 30_000, occurredOn: '2026-10-18' }),
    tx({ type: 'income', categoryId: null, amountCents: 500_000, occurredOn: '2026-10-16' }),
    // Semana anterior (9 a 15/10)
    tx({ categoryId: 'delivery', amountCents: 10_000, occurredOn: '2026-10-12' }),
    tx({ categoryId: 'mercado', amountCents: 30_000, occurredOn: '2026-10-11' }),
    // Hoje não entra.
    tx({ categoryId: 'delivery', amountCents: 99_000, occurredOn: today }),
  ];
  const habits = [
    { id: 'a', name: 'Água', doneDates: ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'] },
    { id: 'b', name: 'Ler', doneDates: ['2026-10-16', '2026-10-17', '2026-10-19', '2026-10-21'] },
  ];
  const events = [
    { start: new Date(2026, 9, 24, 9).toISOString() },
    { start: new Date(2026, 9, 24, 15).toISOString() },
    { start: new Date(2026, 9, 24, 19).toISOString() },
    { start: new Date(2026, 9, 25, 9).toISOString() },
  ];

  it('compara com a semana anterior e destaca a categoria que mais subiu', () => {
    const s = weeklySummary({ today, currency: 'BRL', transactions, categoryName, habits, events });
    expect(s).toMatchObject({ start: '2026-10-16', end: '2026-10-22', spentCents: 42_000, previousSpentCents: 40_000, incomeCents: 500_000, tomorrowEvents: 3 });
    expect(s.highlight).toMatchObject({ name: 'Delivery', change: 0.2 });
    expect(s.habits).toEqual({ perfectDays: 3, checkIns: 9, possible: 14 });
    expect(s.lines.map((l) => l.replace(/\s/g, ' '))).toEqual([
      'Você gastou R$ 420,00 nos últimos 7 dias, 5% a mais que na semana anterior.',
      'Você gastou 20% a mais com Delivery (R$ 120,00).',
      'Cumpriu todos os hábitos em 3 de 7 dias (64% das marcações).',
      'Tem 3 compromissos amanhã.',
    ]);
  });

  it('semana sem dados', () => {
    const s = weeklySummary({ today, currency: 'BRL', transactions: [], categoryName, habits: [], events: [] });
    expect(s.lines).toEqual(['Nenhum compromisso amanhã.']);
    expect(s.highlight).toBeNull();
  });

  it('semana ISO', () => {
    expect(isoWeekKey('2026-10-22')).toBe('2026-W43');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  });
});

const healthInput = (patch: Partial<HealthInput> = {}): HealthInput => ({
  today, currency: 'BRL', transactions: [], budgets: [], bills: [], cards: [], cardPayments: [], categoryName: (id) => names[id] ?? id, ...patch,
});

describe('financialHealth', () => {
  const income = tx({ type: 'income', amountCents: 500_000, categoryId: null, occurredOn: '2026-10-05' });
  const spend = (cents: number, i: number) => tx({ amountCents: cents, occurredOn: addDaysToKey(today, -i) });

  it('precisa de lançamentos suficientes', () => {
    expect(financialHealth(healthInput({ transactions: [income, spend(100, 1)] }))).toBeNull();
  });

  it('nota alta: sobra dinheiro, sem contas atrasadas, cartão pouco usado', () => {
    const transactions = [income, spend(50_000, 1), spend(50_000, 2), spend(50_000, 3), spend(50_000, 4)];
    const h = financialHealth(healthInput({
      transactions,
      budgets: [{ categoryId: 'lazer', currency: 'BRL', amountCents: 900_000 }],
      cards: [{ id: 'nu', name: 'Nubank', currency: 'BRL', limitCents: 1_000_000, closingDay: 5, dueDay: 12 }],
    }));
    expect(h?.factors.map((f) => [f.id, f.points])).toEqual([['savings', 25], ['budgets', 25], ['bills', 18], ['credit', 25]]);
    expect(h).toMatchObject({ score: 93, level: 'excelente', label: 'Excelente' });
  });

  it('gastar mais do que recebe e fatura vencida derrubam a nota', () => {
    const transactions = [
      tx({ type: 'income', amountCents: 100_000, categoryId: null, occurredOn: '2026-10-05' }),
      spend(60_000, 1), spend(60_000, 2), spend(10_000, 3),
      tx({ amountCents: 40_000, cardId: 'nu', invoiceMonth: '2026-10', occurredOn: '2026-09-20' }),
    ];
    const bills: BillLike[] = [{ id: 'b', name: 'Luz', amountCents: 9000, currency: 'BRL', categoryId: null, recurrence: 'monthly', dueDay: 10, dueDate: null, startsOn: '2026-09-01', active: true }];
    const h = financialHealth(healthInput({
      transactions, bills,
      cards: [{ id: 'nu', name: 'Nubank', currency: 'BRL', limitCents: 100_000, closingDay: 5, dueDay: 12 }],
    }));
    const byId = Object.fromEntries((h?.factors ?? []).map((f) => [f.id, f]));
    expect(byId.savings.points).toBe(0);
    expect(byId.credit.points).toBe(0);
    expect(byId.credit.tip).toMatch(/fatura vencida/);
    expect(byId.bills.points).toBe(0);
    expect(h?.level).toBe('atencao');
  });

  it('faixas de nível', () => {
    expect([0, 39, 40, 59, 60, 79, 80, 100].map(levelOfScore)).toEqual(['atencao', 'atencao', 'construcao', 'construcao', 'saudavel', 'saudavel', 'excelente', 'excelente']);
  });
});

const coachInput = (patch: Partial<CoachInput> = {}): CoachInput => ({
  today, currencies: ['BRL'], transactions: [], categoryName, budgets: [], goals: [], bills: [], cards: [], cardPayments: [],
  habits: [], streakGoals: [], finance: true, ...patch,
});

describe('coachInsights', () => {
  it('orçamento acima do ritmo diz o dia em que estoura', () => {
    // Dia 23: R$ 460 gastos → R$ 20/dia; faltam R$ 40 → estoura no dia 25.
    const insights = coachInsights(coachInput({
      transactions: [tx({ amountCents: 46_000, occurredOn: '2026-10-05' })],
      budgets: [{ categoryId: 'lazer', currency: 'BRL', amountCents: 50_000 }],
    }));
    expect(insights[0]).toMatchObject({ id: 'budget-pace:lazer:2026-10', tone: 'alert' });
    expect(insights[0].text).toMatch(/estoura o orçamento de Lazer no dia 25/);
  });

  it('meta com prazo sugere quanto guardar por semana', () => {
    const insights = coachInput({ goals: [{ id: 'g', name: 'Viagem', currency: 'BRL', targetCents: 100_000, savedCents: 70_000, deadline: '2026-11-20' }] });
    const tip = coachInsights(insights).find((i) => i.id.startsWith('goal-pace'));
    expect(tip?.title.replace(/\s/g, ' ')).toBe('Faltam R$ 300,00 para Viagem');
    expect(tip?.text.replace(/\s/g, ' ')).toBe('Que tal guardar R$ 75,00 por semana até 20/11?');
  });

  it('contas e faturas vencidas vêm primeiro', () => {
    const insights = coachInsights(coachInput({
      bills: [{ id: 'b', name: 'Luz', amountCents: 9000, currency: 'BRL', categoryId: null, recurrence: 'monthly', dueDay: 20, dueDate: null, startsOn: '2026-10-01', active: true }],
      cards: [{ id: 'nu', name: 'Nubank', currency: 'BRL', limitCents: null, closingDay: 5, dueDay: 12 }],
      transactions: [tx({ amountCents: 40_000, cardId: 'nu', invoiceMonth: '2026-10', occurredOn: '2026-09-20' })],
    }));
    expect(insights.slice(0, 2).map((i) => i.id)).toEqual(['invoice-overdue:nu:2026-10', 'bill-overdue:b:2026-10']);
  });

  it('saldo que não cobre as contas do mês', () => {
    const insights = coachInsights(coachInput({
      transactions: [tx({ type: 'income', amountCents: 10_000, categoryId: null, occurredOn: '2026-10-01' })],
      bills: [{ id: 'b', name: 'Aluguel', amountCents: 150_000, currency: 'BRL', categoryId: null, recurrence: 'monthly', dueDay: 28, dueDate: null, startsOn: '2026-10-01', active: true }],
    }));
    const short = insights.find((i) => i.id === 'balance-short:BRL:2026-10');
    expect(short?.text.replace(/\s/g, ' ')).toBe('Depois das contas e faturas que vencem até o fim do mês, faltariam R$ 1.400,00.');
  });

  it('sequência em risco e meta de sequência perto do fim', () => {
    const doneDates = Array.from({ length: 9 }, (_, i) => addDaysToKey('2026-10-14', i));
    const insights = coachInsights(coachInput({
      finance: false,
      habits: [{ id: 'h', name: 'Ler', doneDates }],
      streakGoals: [{ habitId: 'h', targetDays: 10, startedOn: '2026-10-01', achievedOn: null }],
      budgets: [{ categoryId: 'lazer', currency: 'BRL', amountCents: 1 }],
    }));
    expect(insights.map((i) => i.id)).toEqual(['streak-risk:h:2026-10-23', 'streak-goal-near:h:10:2026-10-23']);
  });

  it('sem plano com financeiro, nada de finanças', () => {
    const insights = coachInsights(coachInput({ finance: false, budgets: [{ categoryId: 'lazer', currency: 'BRL', amountCents: 1 }], transactions: [tx({})] }));
    expect(insights).toEqual([]);
  });
});
