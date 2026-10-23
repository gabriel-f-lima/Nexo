import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { DEFAULT_CATEGORIES, type Currency, type TransactionType } from '../lib/finance';
import { selectAll, writeOp } from './data';
import { canEditFinanceDay } from '../lib/rules';
import { invoiceMonthFor, planInstallments } from '../lib/cards';
import { notify } from '../lib/toast';

export interface Category { id: string; name: string; color: string; kind: TransactionType }
export interface Transaction {
  id: string;
  type: TransactionType;
  amountCents: number;
  currency: Currency;
  categoryId: string | null;
  occurredOn: string; // AAAA-MM-DD
  description: string;
  /** Compra no cartão de crédito: cartão e fatura ('AAAA-MM' do vencimento). */
  cardId: string | null;
  invoiceMonth: string | null;
  /** Compra parcelada: todas as parcelas têm o mesmo purchaseId. */
  purchaseId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  /** Pagamento de conta: qual conta e de qual mês. */
  billId: string | null;
  billPeriod: string | null;
}
export interface TransactionInput {
  type: TransactionType;
  amountCents: number;
  currency: Currency;
  categoryId: string | null;
  occurredOn: string;
  description: string;
  /** Compra no cartão (só despesa). */
  cardId?: string | null;
  installments?: number;
}
export interface Goal {
  id: string;
  name: string;
  currency: Currency;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
}
export interface Card {
  id: string;
  name: string;
  color: string;
  currency: Currency;
  limitCents: number | null;
  closingDay: number;
  dueDay: number;
  archived: boolean;
}
export type CardInput = Omit<Card, 'id' | 'archived'>;
export interface CardPayment {
  id: string;
  cardId: string;
  invoiceMonth: string;
  amountCents: number;
  paidOn: string;
}
export interface Bill {
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
export type BillInput = Omit<Bill, 'id' | 'active'>;
export interface Budget { categoryId: string; currency: Currency; amountCents: number }

interface FinanceState {
  userId: string | null;
  loaded: boolean;
  /** false quando o banco ainda não tem a migration de planejamento (cartões, contas, orçamentos). */
  planningReady: boolean;
  categories: Category[];
  transactions: Transaction[];
  goals: Goal[];
  cards: Card[];
  cardPayments: CardPayment[];
  bills: Bill[];
  budgets: Budget[];

  load: (userId: string) => Promise<void>;
  reset: () => void;
  addTransaction: (input: TransactionInput) => boolean;
  updateTransaction: (id: string, input: TransactionInput) => void;
  /** Muda descrição e categoria de todas as parcelas de uma compra. */
  updatePurchaseDetails: (purchaseId: string, description: string, categoryId: string | null) => void;
  /** Apaga o lançamento; numa compra parcelada, as parcelas que ainda podem ser editadas. Devolve quantas saíram. */
  removeTransaction: (id: string) => number;
  addCategory: (name: string, color: string, kind: TransactionType) => void;
  removeCategory: (id: string) => void;
  addGoal: (name: string, currency: Currency, targetCents: number, deadline: string | null) => string | null;
  addGoalSaving: (id: string, cents: number) => void;
  removeGoal: (id: string) => void;

  addCard: (input: CardInput) => void;
  updateCard: (id: string, input: CardInput) => void;
  setCardArchived: (id: string, archived: boolean) => void;
  removeCard: (id: string) => void;
  payInvoice: (cardId: string, invoiceMonth: string, amountCents: number, paidOn: string) => void;
  removeCardPayment: (id: string) => void;

  addBill: (input: BillInput) => void;
  updateBill: (id: string, input: BillInput) => void;
  setBillActive: (id: string, active: boolean) => void;
  removeBill: (id: string) => void;
  /** Registra o pagamento da conta no mês como despesa. */
  payBill: (billId: string, period: string, amountCents: number, paidOn: string) => boolean;
  unpayBill: (billId: string, period: string) => void;

  setBudget: (categoryId: string, currency: Currency, amountCents: number | null) => void;
}

const MAX_CATEGORIES = 40;
const MAX_GOALS = 30;
const MAX_CARDS = 20;
const MAX_BILLS = 100;

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const str = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

const mapCategory = (row: Record<string, unknown>): Category => ({
  id: String(row.id),
  name: String(row.name),
  color: String(row.color),
  kind: row.kind === 'income' ? 'income' : 'expense',
});

const mapTransaction = (row: Record<string, unknown>): Transaction => ({
  id: String(row.id),
  type: row.type === 'income' ? 'income' : 'expense',
  amountCents: Number(row.amount_cents),
  currency: (row.currency as Currency) ?? 'BRL',
  categoryId: str(row.category_id),
  occurredOn: String(row.occurred_on),
  description: String(row.description ?? ''),
  cardId: str(row.card_id),
  invoiceMonth: str(row.invoice_month),
  purchaseId: str(row.purchase_id),
  installmentNumber: num(row.installment_number),
  installmentTotal: num(row.installment_total),
  billId: str(row.bill_id),
  billPeriod: str(row.bill_period),
});

const mapGoal = (row: Record<string, unknown>): Goal => ({
  id: String(row.id),
  name: String(row.name),
  currency: (row.currency as Currency) ?? 'BRL',
  targetCents: Number(row.target_cents),
  savedCents: Number(row.saved_cents ?? 0),
  deadline: str(row.deadline),
});

const mapCard = (row: Record<string, unknown>): Card => ({
  id: String(row.id),
  name: String(row.name),
  color: String(row.color),
  currency: (row.currency as Currency) ?? 'BRL',
  limitCents: num(row.limit_cents),
  closingDay: Number(row.closing_day),
  dueDay: Number(row.due_day),
  archived: Boolean(row.archived),
});

const mapCardPayment = (row: Record<string, unknown>): CardPayment => ({
  id: String(row.id),
  cardId: String(row.card_id),
  invoiceMonth: String(row.invoice_month),
  amountCents: Number(row.amount_cents),
  paidOn: String(row.paid_on),
});

const mapBill = (row: Record<string, unknown>): Bill => ({
  id: String(row.id),
  name: String(row.name),
  amountCents: Number(row.amount_cents),
  currency: (row.currency as Currency) ?? 'BRL',
  categoryId: str(row.category_id),
  recurrence: row.recurrence === 'once' ? 'once' : 'monthly',
  dueDay: num(row.due_day),
  dueDate: str(row.due_date),
  startsOn: String(row.starts_on),
  active: row.active !== false,
});

const mapBudget = (row: Record<string, unknown>): Budget => ({
  categoryId: String(row.category_id),
  currency: (row.currency as Currency) ?? 'BRL',
  amountCents: Number(row.amount_cents),
});

const BASE_TX_COLUMNS = 'id,type,amount_cents,currency,category_id,occurred_on,description';
const PLANNING_TX_COLUMNS = `${BASE_TX_COLUMNS},card_id,invoice_month,purchase_id,installment_number,installment_total,bill_id,bill_period`;

/** Erro de "coluna/tabela ainda não existe": o site foi publicado antes da migration. */
const missingSchema = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code ?? '';
  return code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205';
};

const transactionRow = (t: Transaction, userId: string, planning: boolean) => ({
  user_id: userId,
  id: t.id,
  type: t.type,
  amount_cents: t.amountCents,
  currency: t.currency,
  category_id: t.categoryId,
  occurred_on: t.occurredOn,
  description: t.description.trim().slice(0, 120),
  ...(planning ? {
    card_id: t.cardId,
    invoice_month: t.invoiceMonth,
    purchase_id: t.purchaseId,
    installment_number: t.installmentNumber,
    installment_total: t.installmentTotal,
    bill_id: t.billId,
    bill_period: t.billPeriod,
  } : {}),
  updated_at: new Date().toISOString(),
});

const goalRow = (goal: Goal, userId: string) => ({
  user_id: userId, id: goal.id, name: goal.name, currency: goal.currency, target_cents: goal.targetCents,
  saved_cents: goal.savedCents, deadline: goal.deadline, updated_at: new Date().toISOString(),
});

const cardRow = (card: Card, userId: string) => ({
  user_id: userId, id: card.id, name: card.name, color: card.color, currency: card.currency, limit_cents: card.limitCents,
  closing_day: card.closingDay, due_day: card.dueDay, archived: card.archived, updated_at: new Date().toISOString(),
});

const billRow = (bill: Bill, userId: string) => ({
  user_id: userId, id: bill.id, name: bill.name, amount_cents: bill.amountCents, currency: bill.currency,
  category_id: bill.categoryId, recurrence: bill.recurrence, due_day: bill.dueDay, due_date: bill.dueDate,
  starts_on: bill.startsOn, active: bill.active, updated_at: new Date().toISOString(),
});

const sortTransactions = (list: Transaction[]): Transaction[] =>
  [...list].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));

const emptyLinks = { cardId: null, invoiceMonth: null, purchaseId: null, installmentNumber: null, installmentTotal: null, billId: null, billPeriod: null };

export const useFinanceStore = create<FinanceState>()((set, get) => {
  /** Grava linhas na nuvem para o usuário dono da store. Se o banco recusar pelo plano, volta ao que está salvo. */
  const save = (table: string, rows: Record<string, unknown> | Record<string, unknown>[], conflict = 'user_id,id') => {
    const userId = get().userId;
    if (!userId) return;
    void writeOp(
      `salvar ${table}`,
      () => supabase.from(table).upsert(rows, { onConflict: conflict }),
      () => { if (get().userId === userId) void get().load(userId); },
    );
  };

  const remove = (table: string, label: string, match: Record<string, string>) => {
    const userId = get().userId;
    if (!userId) return;
    void writeOp(label, () => {
      let query = supabase.from(table).delete().eq('user_id', userId);
      for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
      return query;
    }, () => { if (get().userId === userId) void get().load(userId); });
  };

  const requirePlanning = (): boolean => {
    if (get().planningReady) return true;
    notify('Este recurso precisa de uma atualização do banco de dados. Avise o suporte.', 'error');
    return false;
  };

  return {
    userId: null,
    loaded: false,
    planningReady: false,
    categories: [],
    transactions: [],
    goals: [],
    cards: [],
    cardPayments: [],
    bills: [],
    budgets: [],

    load: async (userId) => {
      set({ userId, loaded: false });
      try {
        const [categoryRows, goalRows, state] = await Promise.all([
          selectAll('nexo_categories', 'id,name,color,kind', userId),
          selectAll('nexo_goals', 'id,name,currency,target_cents,saved_cents,deadline', userId),
          supabase.from('nexo_user_state').select('finance_seeded').eq('user_id', userId).maybeSingle(),
        ]);
        if (state.error) throw state.error;

        // Cartões, contas e orçamentos: só se o banco já tiver a migration de planejamento.
        let planningReady = true;
        type Rows = Record<string, unknown>[];
        let transactionRows: Rows;
        let planning: [Rows, Rows, Rows, Rows] = [[], [], [], []];
        try {
          const rows = await Promise.all([
            selectAll('nexo_transactions', PLANNING_TX_COLUMNS, userId),
            selectAll('nexo_cards', 'id,name,color,currency,limit_cents,closing_day,due_day,archived', userId),
            selectAll('nexo_card_payments', 'id,card_id,invoice_month,amount_cents,paid_on', userId),
            selectAll('nexo_bills', 'id,name,amount_cents,currency,category_id,recurrence,due_day,due_date,starts_on,active', userId),
            selectAll('nexo_budgets', 'category_id,currency,amount_cents', userId),
          ]);
          transactionRows = rows[0];
          planning = [rows[1], rows[2], rows[3], rows[4]];
        } catch (error) {
          if (!missingSchema(error)) throw error;
          planningReady = false;
          transactionRows = await selectAll('nexo_transactions', BASE_TX_COLUMNS, userId);
        }
        if (get().userId !== userId) return;

        let categories = categoryRows.map(mapCategory);
        const seeded = Boolean((state.data as { finance_seeded?: boolean } | null)?.finance_seeded);

        // Primeiro acesso ao financeiro: cria as categorias sugeridas, uma única vez.
        if (categories.length === 0 && !seeded) {
          const { error } = await supabase.from('nexo_categories').upsert(
            DEFAULT_CATEGORIES.map((c) => ({ user_id: userId, id: c.id, name: c.name, color: c.color, kind: c.kind })),
            { onConflict: 'user_id,id' },
          );
          if (error) throw error;
          await supabase.from('nexo_user_state').update({ finance_seeded: true }).eq('user_id', userId);
          categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
        }

        if (get().userId !== userId) return;
        const [cardRows, paymentRows, billRows, budgetRows] = planning;
        set({
          planningReady,
          categories,
          transactions: sortTransactions(transactionRows.map(mapTransaction)),
          goals: goalRows.map(mapGoal),
          cards: cardRows.map(mapCard),
          cardPayments: paymentRows.map(mapCardPayment),
          bills: billRows.map(mapBill),
          budgets: budgetRows.map(mapBudget),
          loaded: true,
        });
      } catch (error) {
        if (get().userId !== userId) return;
        set({ loaded: true });
        if (import.meta.env.DEV) console.warn('[nexo] financeiro', error);
      }
    },

    reset: () => set({
      userId: null, loaded: false, planningReady: false, categories: [], transactions: [], goals: [],
      cards: [], cardPayments: [], bills: [], budgets: [],
    }),

    addTransaction: (input) => {
      if (!canEditFinanceDay(input.occurredOn)) return false;
      const { userId, planningReady } = get();
      if (!userId) return false;
      const description = input.description.trim().slice(0, 120);
      const card = input.type === 'expense' && input.cardId ? get().cards.find((c) => c.id === input.cardId) : undefined;
      if (input.cardId && !card) return false;
      if (card && !requirePlanning()) return false;

      let created: Transaction[];
      if (card) {
        const count = Math.min(48, Math.max(1, Math.floor(input.installments ?? 1)));
        const purchaseId = count > 1 ? createId() : null;
        created = planInstallments(input.occurredOn, input.amountCents, count, card).map((part) => ({
          id: count > 1 ? `${purchaseId}-${part.number}` : createId(),
          type: 'expense',
          amountCents: part.amountCents,
          currency: card.currency,
          categoryId: input.categoryId,
          occurredOn: part.occurredOn,
          description,
          ...emptyLinks,
          cardId: card.id,
          invoiceMonth: part.invoiceMonth,
          purchaseId,
          installmentNumber: count > 1 ? part.number : null,
          installmentTotal: count > 1 ? count : null,
        }));
      } else {
        created = [{
          id: createId(), type: input.type, amountCents: input.amountCents, currency: input.currency,
          categoryId: input.categoryId, occurredOn: input.occurredOn, description, ...emptyLinks,
        }];
      }
      set((s) => ({ transactions: sortTransactions([...s.transactions, ...created]) }));
      save('nexo_transactions', created.map((t) => transactionRow(t, userId, planningReady)));
      return true;
    },

    updateTransaction: (id, input) => {
      const current = get().transactions.find((t) => t.id === id);
      if (!current || !canEditFinanceDay(input.occurredOn) || !canEditFinanceDay(current.occurredOn)) return;
      // Compra parcelada: valor e datas ficam como estão (só descrição e categoria, em updatePurchaseDetails).
      if (current.purchaseId) return;
      const { userId, planningReady } = get();
      if (!userId) return;
      const card = input.type === 'expense' && input.cardId ? get().cards.find((c) => c.id === input.cardId) : undefined;
      const next: Transaction = {
        ...current,
        type: input.type,
        amountCents: input.amountCents,
        currency: card ? card.currency : input.currency,
        categoryId: input.categoryId,
        occurredOn: input.occurredOn,
        description: input.description.trim().slice(0, 120),
        cardId: card ? card.id : null,
        invoiceMonth: card ? invoiceMonthFor(input.occurredOn, card) : null,
      };
      set((s) => ({ transactions: sortTransactions(s.transactions.map((t) => (t.id === id ? next : t))) }));
      save('nexo_transactions', transactionRow(next, userId, planningReady));
    },

    updatePurchaseDetails: (purchaseId, description, categoryId) => {
      const { userId, planningReady } = get();
      if (!userId) return;
      const clean = description.trim().slice(0, 120);
      const changed: Transaction[] = [];
      set((s) => ({
        transactions: s.transactions.map((t) => {
          if (t.purchaseId !== purchaseId) return t;
          const next = { ...t, description: clean, categoryId };
          changed.push(next);
          return next;
        }),
      }));
      if (changed.length) save('nexo_transactions', changed.map((t) => transactionRow(t, userId, planningReady)));
    },

    removeTransaction: (id) => {
      const current = get().transactions.find((t) => t.id === id);
      const userId = get().userId;
      if (!current || !userId) return 0;
      const targets = current.purchaseId
        ? get().transactions.filter((t) => t.purchaseId === current.purchaseId && canEditFinanceDay(t.occurredOn))
        : canEditFinanceDay(current.occurredOn) ? [current] : [];
      if (!targets.length) return 0;
      const ids = new Set(targets.map((t) => t.id));
      set((s) => ({ transactions: s.transactions.filter((t) => !ids.has(t.id)) }));
      void writeOp('apagar lançamento', () =>
        supabase.from('nexo_transactions').delete().eq('user_id', userId).in('id', Array.from(ids)));
      return targets.length;
    },

    addCategory: (name, color, kind) => {
      const userId = get().userId;
      const clean = name.trim().slice(0, 40);
      if (!userId || !clean || get().categories.length >= MAX_CATEGORIES) return;
      const category: Category = { id: createId(), name: clean, color, kind };
      set((s) => ({ categories: [...s.categories, category] }));
      save('nexo_categories', { user_id: userId, id: category.id, name: clean, color, kind, updated_at: new Date().toISOString() });
    },

    removeCategory: (id) => {
      const userId = get().userId;
      if (!userId) return;
      // O banco define category_id como nulo nos lançamentos e contas afetados e apaga o orçamento da categoria.
      set((s) => ({
        categories: s.categories.filter((c) => c.id !== id),
        transactions: s.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)),
        bills: s.bills.map((b) => (b.categoryId === id ? { ...b, categoryId: null } : b)),
        budgets: s.budgets.filter((b) => b.categoryId !== id),
      }));
      void writeOp('apagar categoria', () =>
        supabase.from('nexo_categories').delete().eq('user_id', userId).eq('id', id));
    },

    addGoal: (name, currency, targetCents, deadline) => {
      const userId = get().userId;
      const clean = name.trim().slice(0, 60);
      if (!userId || !clean || targetCents <= 0 || get().goals.length >= MAX_GOALS) return null;
      const goal: Goal = { id: createId(), name: clean, currency, targetCents, savedCents: 0, deadline };
      set((s) => ({ goals: [...s.goals, goal] }));
      save('nexo_goals', goalRow(goal, userId));
      return goal.id;
    },

    addGoalSaving: (id, cents) => {
      const userId = get().userId;
      if (!userId || cents <= 0) return;
      set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, savedCents: g.savedCents + cents } : g)) }));
      const goal = get().goals.find((g) => g.id === id);
      if (goal) save('nexo_goals', goalRow(goal, userId));
    },

    removeGoal: (id) => {
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
      remove('nexo_goals', 'apagar meta', { id });
    },

    /* Cartões */

    addCard: (input) => {
      const userId = get().userId;
      const name = input.name.trim().slice(0, 40);
      if (!userId || !name || get().cards.length >= MAX_CARDS || !requirePlanning()) return;
      const card: Card = { ...input, name, id: createId(), archived: false };
      set((s) => ({ cards: [...s.cards, card] }));
      save('nexo_cards', cardRow(card, userId));
    },

    updateCard: (id, input) => {
      const userId = get().userId;
      const current = get().cards.find((c) => c.id === id);
      const name = input.name.trim().slice(0, 40);
      if (!userId || !current || !name) return;
      // A moeda não muda depois de haver compras: as faturas antigas continuam na moeda em que foram feitas.
      const hasPurchases = get().transactions.some((t) => t.cardId === id);
      const card: Card = { ...current, ...input, name, currency: hasPurchases ? current.currency : input.currency };
      set((s) => ({ cards: s.cards.map((c) => (c.id === id ? card : c)) }));
      save('nexo_cards', cardRow(card, userId));
    },

    setCardArchived: (id, archived) => {
      const userId = get().userId;
      const current = get().cards.find((c) => c.id === id);
      if (!userId || !current) return;
      const card = { ...current, archived };
      set((s) => ({ cards: s.cards.map((c) => (c.id === id ? card : c)) }));
      save('nexo_cards', cardRow(card, userId));
    },

    removeCard: (id) => {
      // Com compras, o banco recusa (o histórico das faturas depende do cartão): a tela oferece arquivar.
      if (get().transactions.some((t) => t.cardId === id)) return;
      set((s) => ({ cards: s.cards.filter((c) => c.id !== id), cardPayments: s.cardPayments.filter((p) => p.cardId !== id) }));
      remove('nexo_cards', 'apagar cartão', { id });
    },

    payInvoice: (cardId, invoiceMonth, amountCents, paidOn) => {
      const userId = get().userId;
      if (!userId || amountCents <= 0 || !requirePlanning()) return;
      const payment: CardPayment = { id: createId(), cardId, invoiceMonth, amountCents, paidOn };
      set((s) => ({ cardPayments: [...s.cardPayments, payment] }));
      save('nexo_card_payments', {
        user_id: userId, id: payment.id, card_id: cardId, invoice_month: invoiceMonth, amount_cents: amountCents, paid_on: paidOn,
      });
    },

    removeCardPayment: (id) => {
      set((s) => ({ cardPayments: s.cardPayments.filter((p) => p.id !== id) }));
      remove('nexo_card_payments', 'desfazer pagamento de fatura', { id });
    },

    /* Contas */

    addBill: (input) => {
      const userId = get().userId;
      const name = input.name.trim().slice(0, 60);
      if (!userId || !name || get().bills.length >= MAX_BILLS || !requirePlanning()) return;
      const bill: Bill = { ...input, name, id: createId(), active: true };
      set((s) => ({ bills: [...s.bills, bill] }));
      save('nexo_bills', billRow(bill, userId));
    },

    updateBill: (id, input) => {
      const userId = get().userId;
      const current = get().bills.find((b) => b.id === id);
      const name = input.name.trim().slice(0, 60);
      if (!userId || !current || !name) return;
      const bill: Bill = { ...current, ...input, name };
      set((s) => ({ bills: s.bills.map((b) => (b.id === id ? bill : b)) }));
      save('nexo_bills', billRow(bill, userId));
    },

    setBillActive: (id, active) => {
      const userId = get().userId;
      const current = get().bills.find((b) => b.id === id);
      if (!userId || !current) return;
      const bill = { ...current, active };
      set((s) => ({ bills: s.bills.map((b) => (b.id === id ? bill : b)) }));
      save('nexo_bills', billRow(bill, userId));
    },

    removeBill: (id) => {
      // Os pagamentos já feitos continuam como despesas (o banco só desfaz o vínculo).
      set((s) => ({
        bills: s.bills.filter((b) => b.id !== id),
        transactions: s.transactions.map((t) => (t.billId === id ? { ...t, billId: null } : t)),
      }));
      remove('nexo_bills', 'apagar conta', { id });
    },

    payBill: (billId, period, amountCents, paidOn) => {
      const { userId, planningReady } = get();
      const bill = get().bills.find((b) => b.id === billId);
      if (!userId || !bill || !planningReady || amountCents <= 0) return false;
      if (!canEditFinanceDay(paidOn)) return false;
      if (get().transactions.some((t) => t.billId === billId && t.billPeriod === period)) return false;
      const transaction: Transaction = {
        id: createId(), type: 'expense', amountCents, currency: bill.currency, categoryId: bill.categoryId,
        occurredOn: paidOn, description: bill.name, ...emptyLinks, billId, billPeriod: period,
      };
      set((s) => ({ transactions: sortTransactions([...s.transactions, transaction]) }));
      save('nexo_transactions', transactionRow(transaction, userId, true));
      return true;
    },

    unpayBill: (billId, period) => {
      const payment = get().transactions.find((t) => t.billId === billId && t.billPeriod === period);
      if (payment) get().removeTransaction(payment.id);
    },

    /* Orçamentos */

    setBudget: (categoryId, currency, amountCents) => {
      const userId = get().userId;
      if (!userId || !requirePlanning()) return;
      if (amountCents === null || amountCents <= 0) {
        set((s) => ({ budgets: s.budgets.filter((b) => b.categoryId !== categoryId) }));
        remove('nexo_budgets', 'apagar orçamento', { category_id: categoryId });
        return;
      }
      const budget: Budget = { categoryId, currency, amountCents };
      set((s) => ({ budgets: [...s.budgets.filter((b) => b.categoryId !== categoryId), budget] }));
      save('nexo_budgets', {
        user_id: userId, category_id: categoryId, currency, amount_cents: amountCents, updated_at: new Date().toISOString(),
      }, 'user_id,category_id');
    },
  };
});
