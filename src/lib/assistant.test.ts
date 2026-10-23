import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Banco simulado: registra o que seria gravado e responde o plano da conta.
const db = vi.hoisted(() => {
  const state = { tier: 'pro', writes: [] as Array<{ table: string; op: string; payload?: unknown }> };
  const builder = (table: string) => {
    const result = { error: null, data: [] as unknown[] };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      upsert: (payload: unknown) => { state.writes.push({ table, op: 'upsert', payload }); return chain; },
      delete: () => { state.writes.push({ table, op: 'delete' }); return chain; },
      update: (payload: unknown) => { state.writes.push({ table, op: 'update', payload }); return chain; },
      select: self, eq: self, in: self, range: self, lt: self, maybeSingle: self,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    });
    return chain;
  };
  return {
    state,
    client: {
      from: builder,
      rpc: async () => ({ data: state.tier, error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
vi.mock('./supabase', () => ({ supabase: db.client, supabaseUrl: 'https://mock.supabase.co', supabasePublishableKey: 'pk' }));
vi.mock('./confirm', () => ({ confirmAction: async () => true }));

const { executeAssistantTool } = await import('./assistant');
const { useDataStore } = await import('../store/data');
const { useFinanceStore } = await import('../store/finance');
const { useProgressStore } = await import('../store/progress');
const { DEFAULT_CATEGORIES } = await import('./finance');

const run = (name: string, args: Record<string, unknown>) => executeAssistantTool(name, args) as Promise<Record<string, unknown>>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0)); // sexta, 23/10/2026
  db.state.tier = 'pro';
  db.state.writes = [];
  useDataStore.setState({
    userId: 'u1', loaded: true, tasks: [], events: [],
    habits: [{ id: 'h1', name: 'Ler', doneDates: ['2026-10-21', '2026-10-22'] }],
  });
  useFinanceStore.setState({
    userId: 'u1', loaded: true, planningReady: true, transactions: [], goals: [], bills: [], budgets: [], cardPayments: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    cards: [{ id: 'nu', name: 'Nubank', color: '#8A05BE', currency: 'BRL', limitCents: 300000, closingDay: 5, dueDay: 12, archived: false }],
  });
  useProgressStore.setState({ userId: 'u1', loaded: true, ready: true, objectives: [], streakGoals: [], achievements: {} });
});
afterEach(() => vi.useRealTimers());

describe('create_transaction (registro em linguagem natural)', () => {
  it('“gastei 45 no mercado ontem”: moeda padrão e categoria pelo sentido', async () => {
    const result = await run('create_transaction', { type: 'expense', amount: '45', currency: '', category: 'mercado', date: '2026-10-22', description: 'Mercado' });
    expect(result).toMatchObject({ ok: true, category: 'Alimentação', card: null, installments: 1 });
    const [tx] = useFinanceStore.getState().transactions;
    expect(tx).toMatchObject({ amountCents: 4500, currency: 'BRL', categoryId: 'default-alimentacao', occurredOn: '2026-10-22', cardId: null });
    expect(db.state.writes.some((w) => w.table === 'nexo_transactions')).toBe(true);
  });

  it('no cartão em 3x: três parcelas, cada uma na sua fatura', async () => {
    const result = await run('create_transaction', {
      type: 'expense', amount: '300', currency: 'BRL', category: '', date: '2026-10-23', description: 'Tênis', payment: 'card', card: 'nubank', installments: 3,
    });
    expect(result).toMatchObject({ ok: true, card: 'Nubank', installments: 3, invoice: '2026-11' });
    const parts = useFinanceStore.getState().transactions.sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
    expect(parts.map((t) => [t.amountCents, t.invoiceMonth, t.installmentNumber])).toEqual([[10000, '2026-11', 1], [10000, '2026-12', 2], [10000, '2027-01', 3]]);
    expect(new Set(parts.map((t) => t.purchaseId)).size).toBe(1);
  });

  it('cartão que não existe: pergunta em qual', async () => {
    const result = await run('create_transaction', { type: 'expense', amount: '10', currency: '', category: '', date: '2026-10-23', description: '', payment: 'card', card: 'Inter' });
    expect(result.ok).toBe(false);
    expect(String(result.message)).toMatch(/Nubank/);
  });

  it('plano gratuito não registra', async () => {
    db.state.tier = 'free';
    const result = await run('create_transaction', { type: 'expense', amount: '10', currency: '', category: '', date: '2026-10-23', description: '' });
    expect(result.ok).toBe(false);
    expect(useFinanceStore.getState().transactions).toHaveLength(0);
  });

  it('data antiga fica só para consulta', async () => {
    const result = await run('create_transaction', { type: 'expense', amount: '10', currency: '', category: '', date: '2026-10-01', description: '' });
    expect(result).toMatchObject({ ok: false });
  });

  it('limite do Básico por mês', async () => {
    db.state.tier = 'basico';
    useFinanceStore.setState({
      transactions: Array.from({ length: 50 }, (_, i) => ({
        id: `t${i}`, type: 'expense' as const, amountCents: 100, currency: 'BRL' as const, categoryId: null, occurredOn: '2026-10-02', description: '',
        cardId: null, invoiceMonth: null, purchaseId: null, installmentNumber: null, installmentTotal: null, billId: null, billPeriod: null,
      })),
    });
    const result = await run('create_transaction', { type: 'expense', amount: '10', currency: '', category: '', date: '2026-10-23', description: '' });
    expect(result.ok).toBe(false);
    expect(String(result.message)).toMatch(/50 lançamentos/);
  });
});

describe('contas, orçamentos e metas', () => {
  it('cria conta mensal e marca como paga uma vez', async () => {
    expect(await run('create_bill', { name: 'Internet', amount: '99,90', currency: '', due_day: 28, due_date: '', category: '' }))
      .toMatchObject({ ok: true, due: 'todo dia 28', category: 'Moradia' });
    expect(await run('mark_bill_paid', { bill_name: 'internet', month: '', amount: '' })).toMatchObject({ ok: true, month: '2026-10' });
    expect(await run('mark_bill_paid', { bill_name: 'Internet', month: '', amount: '' })).toMatchObject({ ok: true, alreadyPaid: true });
    const paid = useFinanceStore.getState().transactions.filter((t) => t.billId);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amountCents: 9990, billPeriod: '2026-10', categoryId: 'default-moradia' });
  });

  it('orçamento pela categoria', async () => {
    expect(await run('set_budget', { category: 'lazer', amount: '600', currency: '' })).toMatchObject({ ok: true, category: 'Lazer' });
    expect(useFinanceStore.getState().budgets).toEqual([{ categoryId: 'default-lazer', currency: 'BRL', amountCents: 60000 }]);
    expect((await run('set_budget', { category: 'astronomia', amount: '10', currency: '' })).ok).toBe(false);
  });

  it('meta de sequência para um hábito', async () => {
    expect(await run('set_streak_goal', { habit_name: 'ler', days: 30 })).toMatchObject({ ok: true, habit: 'Ler', targetDays: 30, currentStreak: 2 });
    expect(useProgressStore.getState().streakGoals).toEqual([{ habitId: 'h1', targetDays: 30, startedOn: '2026-10-23', achievedOn: null }]);
    await expect(run('set_streak_goal', { habit_name: 'Ler', days: 1000 })).rejects.toThrow(/365/);
  });

  it('resumo da semana e visão geral', async () => {
    const weekly = await run('get_weekly_summary', {});
    expect(weekly).toMatchObject({ from: '2026-10-16', to: '2026-10-22' });
    expect(Array.isArray(weekly.lines)).toBe(true);
    const overview = await run('get_financial_overview', {});
    expect(overview).toMatchObject({ today: '2026-10-23' });
    expect(overview.cards).toEqual([expect.objectContaining({ name: 'Nubank' })]);
  });

  it('ação desconhecida não é executada', async () => {
    expect(await run('apagar_tudo', {})).toMatchObject({ ok: false });
  });
});
