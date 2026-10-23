import { supabase, supabasePublishableKey, supabaseUrl } from './supabase';
import { formatTime, monthOfKey, toISODate } from './dates';
import { confirmAction } from './confirm';
import { useDataStore, type ChatMessage } from '../store/data';
import { useFinanceStore } from '../store/finance';
import { useProgressStore } from '../store/progress';
import { CURRENCIES, formatMoney, parseAmountToCents, totalsByCurrency, type Currency } from './finance';
import { currentTier, LIMITS } from './billing';
import { canEditFinanceDay } from './rules';
import { matchCategory, monthlyEntriesMessage } from './limits';
import { guessCategories } from '../../supabase/functions/_shared/quickEntry';
import { BILL_STATUS_LABEL, billsOfMonth, billsToWatch } from './bills';
import { INVOICE_STATUS_LABEL, cardInvoices, cardUsage, invoiceMonthFor } from './cards';
import { availableBalance, budgetStatus } from './ledger';
import { buildCoach, buildHealth, buildWeekly, currentSnapshot, usedCurrencies } from './derived';
import { currentStreak } from './streaks';
import { objectiveProgress } from './objectives';

/* Cliente do assistente: mesmo contrato da função Edge "nexo-assistant" usada pelo app. */

type ToolArgs = Record<string, unknown>;
type ResponseItem = Record<string, unknown>;
interface Citation { title: string; url: string }

const MAX_CONTEXT_MESSAGES = 8;
const MAX_FUNCTION_ROUNDS = 4;
const MAX_INPUT_ITEMS = 30;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const stringArg = (args: ToolArgs, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`Parâmetro inválido: ${key}.`);
  return value.trim();
};

const boundedArg = (args: ToolArgs, key: string, max: number, label: string): string => {
  const value = stringArg(args, key);
  if (value.length > max) throw new Error(`${label} pode ter no máximo ${max} caracteres.`);
  return value;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const parseLocalDateTime = (date: string, time: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Data ou hora inválida. Use AAAA-MM-DD e HH:MM.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new Error('Essa data não existe.');
  }
  return result;
};

/** Plano com financeiro? Consultado no servidor; sem conta ou sem resposta, não libera. */
const financeAllowed = async (): Promise<boolean> => {
  const userId = useDataStore.getState().userId;
  if (!userId) return false;
  try {
    return LIMITS[await currentTier(userId)].finance;
  } catch {
    return false;
  }
};

const FINANCE_LOCKED = { ok: false, message: 'O controle financeiro faz parte dos planos pagos. O usuário pode assinar em Financeiro.' };

const optionalString = (args: ToolArgs, key: string): string => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');

const currencyArg = (args: ToolArgs, key = 'currency'): Currency => {
  const value = optionalString(args, key).toUpperCase() || 'BRL';
  if (!(CURRENCIES as readonly string[]).includes(value)) throw new Error('Moeda aceita: BRL, USD ou EUR.');
  return value as Currency;
};

const uniqueMatch = <T extends { id: string }>(items: T[], pick: (item: T) => string, value: string, label: string) => {
  const matches = items.filter((item) => normalize(pick(item)) === normalize(value));
  if (!matches.length) return { error: `Não encontrei ${label} com o nome “${value}”.` };
  if (matches.length > 1) return { error: `Encontrei mais de um ${label} com esse nome. Peça uma lista e indique qual quer usar.` };
  return { item: matches[0] };
};

/** Executa apenas as ferramentas permitidas. Nunca avalia código enviado pelo modelo. */
export const executeAssistantTool = async (name: string, args: ToolArgs): Promise<unknown> => {
  const store = useDataStore.getState();

  switch (name) {
    case 'list_agenda_events': {
      const requested = typeof args.date === 'string' ? args.date.trim() : '';
      if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) throw new Error('A data precisa estar no formato AAAA-MM-DD.');
      const matching = store.events
        .filter((event) => !requested || toISODate(new Date(event.start)) === requested)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const items = matching.slice(0, 40).map((event) => ({
        id: event.id,
        title: event.title,
        date: toISODate(new Date(event.start)),
        time: formatTime(event.start),
        location: event.location ?? null,
      }));
      return { items, truncated: matching.length > items.length };
    }

    case 'create_agenda_event': {
      const title = boundedArg(args, 'title', 80, 'O título do compromisso');
      const date = stringArg(args, 'date');
      const time = stringArg(args, 'time');
      const location = typeof args.location === 'string' ? args.location.trim() : '';
      if (location.length > 80) throw new Error('O local pode ter no máximo 80 caracteres.');
      if (!title) throw new Error('O título do compromisso não pode ficar vazio.');
      const start = parseLocalDateTime(date, time);
      store.addEvent(title, start.toISOString(), location);
      return { ok: true, title, date, time, location: location || null };
    }

    case 'delete_agenda_event': {
      const eventId = stringArg(args, 'event_id');
      const event = store.events.find((item) => item.id === eventId);
      if (!event) return { ok: false, message: 'Esse compromisso já não existe na agenda.' };
      const confirmed = await confirmAction({
        title: 'Remover compromisso?',
        message: `O assistente pediu para remover “${event.title}”. Esta ação não pode ser desfeita.`,
        confirmText: 'Remover',
        danger: true,
      });
      if (!confirmed) return { ok: false, cancelled: true, message: 'O usuário cancelou a remoção.' };
      useDataStore.getState().removeEvent(event.id);
      return { ok: true, removed: event.title };
    }

    case 'list_habits': {
      const today = toISODate();
      const items = store.habits.slice(0, 50).map((habit) => ({
        id: habit.id,
        name: habit.name,
        doneToday: habit.doneDates.includes(today),
        recentCompletionDates: habit.doneDates.slice(-7),
      }));
      return { items, truncated: store.habits.length > items.length };
    }

    case 'create_habit': {
      const habitName = boundedArg(args, 'name', 60, 'O nome do hábito');
      if (!habitName) throw new Error('O nome do hábito não pode ficar vazio.');
      store.addHabit(habitName);
      return { ok: true, name: habitName };
    }

    case 'complete_habit': {
      const habitName = stringArg(args, 'habit_name');
      const date = stringArg(args, 'date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A data precisa estar no formato AAAA-MM-DD.');
      if (date > toISODate()) return { ok: false, message: 'Não é possível marcar um hábito como concluído numa data futura.' };
      const match = uniqueMatch(store.habits, (h) => h.name, habitName, 'hábito');
      if (!match.item) return { ok: false, message: match.error };
      if (match.item.doneDates.includes(date)) return { ok: true, alreadyDone: true, name: match.item.name, date };
      store.toggleHabitForDate(match.item.id, date);
      return { ok: true, name: match.item.name, date };
    }

    case 'delete_habit': {
      const habitName = stringArg(args, 'habit_name');
      const match = uniqueMatch(store.habits, (h) => h.name, habitName, 'hábito');
      if (!match.item) return { ok: false, message: match.error };
      const confirmed = await confirmAction({
        title: 'Remover hábito?',
        message: `O assistente pediu para remover “${match.item.name}” e todo o seu histórico. Esta ação não pode ser desfeita.`,
        confirmText: 'Remover',
        danger: true,
      });
      if (!confirmed) return { ok: false, cancelled: true, message: 'O usuário cancelou a remoção.' };
      useDataStore.getState().removeHabit(match.item.id);
      return { ok: true, removed: match.item.name };
    }

    case 'list_tasks': {
      const items = store.tasks.slice(0, 50).map((task) => ({ id: task.id, title: task.title, done: task.done, dueDate: task.dueDate ?? null }));
      return { items, truncated: store.tasks.length > items.length };
    }

    case 'create_task': {
      const title = boundedArg(args, 'title', 80, 'O título da tarefa');
      if (!title) throw new Error('O título da tarefa não pode ficar vazio.');
      store.addTask(title);
      return { ok: true, title };
    }

    case 'complete_task': {
      const title = stringArg(args, 'title');
      const match = uniqueMatch(store.tasks, (t) => t.title, title, 'tarefa');
      if (!match.item) return { ok: false, message: match.error };
      if (match.item.done) return { ok: true, alreadyDone: true, title: match.item.title };
      store.toggleTask(match.item.id);
      return { ok: true, title: match.item.title };
    }

    case 'delete_task': {
      const title = stringArg(args, 'title');
      const match = uniqueMatch(store.tasks, (t) => t.title, title, 'tarefa');
      if (!match.item) return { ok: false, message: match.error };
      const confirmed = await confirmAction({
        title: 'Remover tarefa?',
        message: `O assistente pediu para remover “${match.item.title}”. Esta ação não pode ser desfeita.`,
        confirmText: 'Remover',
        danger: true,
      });
      if (!confirmed) return { ok: false, cancelled: true, message: 'O usuário cancelou a remoção.' };
      useDataStore.getState().removeTask(match.item.id);
      return { ok: true, removed: match.item.title };
    }

    case 'get_month_summary': {
      const month = stringArg(args, 'month');
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('O mês precisa estar no formato AAAA-MM.');
      const items = useFinanceStore.getState().transactions.filter((t) => t.occurredOn.startsWith(month));
      const totals = totalsByCurrency(items).map((t) => ({
        currency: t.currency,
        income: formatMoney(t.income, t.currency),
        expense: formatMoney(t.expense, t.currency),
        balance: formatMoney(t.balance, t.currency),
      }));
      return { month, totals, lancamentos: items.length };
    }

    case 'list_transactions': {
      const month = stringArg(args, 'month');
      if (month && !/^\d{4}-\d{2}$/.test(month)) throw new Error('O mês precisa estar no formato AAAA-MM.');
      const finance = useFinanceStore.getState();
      const matching = finance.transactions.filter((t) => !month || t.occurredOn.startsWith(month));
      const items = matching.slice(0, 40).map((t) => ({
        id: t.id,
        date: t.occurredOn,
        type: t.type === 'income' ? 'receita' : 'despesa',
        amount: formatMoney(t.amountCents, t.currency),
        category: finance.categories.find((c) => c.id === t.categoryId)?.name ?? null,
        description: t.description || null,
      }));
      return { items, truncated: matching.length > items.length };
    }

    case 'create_transaction': {
      const finance = useFinanceStore.getState();
      const type = stringArg(args, 'type');
      if (type !== 'income' && type !== 'expense') throw new Error('O tipo deve ser income (receita) ou expense (despesa).');
      const cents = parseAmountToCents(stringArg(args, 'amount'));
      if (cents === null) throw new Error('Valor inválido. Use, por exemplo, 25,90.');
      let currency = currencyArg(args);
      const date = stringArg(args, 'date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A data precisa estar no formato AAAA-MM-DD.');
      if (!canEditFinanceDay(date)) return { ok: false, message: 'Só dá para lançar hoje, ontem ou datas futuras. Dias anteriores ficam só para consulta.' };
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const userId = useDataStore.getState().userId as string;
      const limit = monthlyEntriesMessage(await currentTier(userId), finance.transactions.filter((t) => monthOfKey(t.occurredOn) === monthOfKey(date)).length);
      if (limit) return { ok: false, message: limit };

      const description = optionalString(args, 'description').slice(0, 120);
      const categoryName = optionalString(args, 'category');
      const category = matchCategory(finance.categories, type, categoryName || description, guessCategories(`${categoryName} ${description}`));

      let cardId: string | null = null;
      let installments = 1;
      if (type === 'expense' && optionalString(args, 'payment') === 'card') {
        const active = finance.cards.filter((c) => !c.archived);
        const cardName = optionalString(args, 'card');
        const card = cardName ? active.find((c) => normalize(c.name) === normalize(cardName)) ?? active.find((c) => normalize(c.name).includes(normalize(cardName))) : active.length === 1 ? active[0] : undefined;
        if (!card) {
          return { ok: false, message: active.length ? `Em qual cartão? Cartões: ${active.map((c) => c.name).join(', ')}.` : 'Nenhum cartão cadastrado. Cadastre em Financeiro › Cartões ou registre como à vista.' };
        }
        cardId = card.id;
        currency = card.currency;
        const parts = Number(args.installments ?? 1);
        installments = Number.isInteger(parts) && parts >= 1 && parts <= 48 ? parts : 1;
      }
      const saved = finance.addTransaction({
        type, amountCents: cents, currency, categoryId: category?.id ?? null, occurredOn: date, description, cardId, installments,
      });
      if (!saved) return { ok: false, message: 'Não foi possível registrar o lançamento.' };
      const card = cardId ? finance.cards.find((c) => c.id === cardId) : undefined;
      return {
        ok: true, type, amount: formatMoney(cents, currency), date, category: category?.name ?? null,
        card: card?.name ?? null, installments, invoice: card ? invoiceMonthFor(date, card) : null,
      };
    }

    case 'list_categories': {
      const { categories } = useFinanceStore.getState();
      return {
        expense: categories.filter((c) => c.kind === 'expense').map((c) => c.name),
        income: categories.filter((c) => c.kind === 'income').map((c) => c.name),
      };
    }

    case 'get_financial_overview': {
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const finance = useFinanceStore.getState();
      const today = toISODate();
      const currencies = usedCurrencies(finance);
      const cardCurrency = (id: string) => finance.cards.find((c) => c.id === id)?.currency;
      const health = buildHealth(currentSnapshot(true));
      return {
        today,
        availableBalance: currencies.map((currency) => ({ currency, amount: formatMoney(availableBalance(finance.transactions, finance.cardPayments, cardCurrency, currency, today), currency) })),
        billsToWatch: billsToWatch(finance.bills, finance.transactions, today, 7).map((o) => ({
          name: o.bill.name, amount: formatMoney(o.bill.amountCents, o.bill.currency), due: o.dueDate, status: BILL_STATUS_LABEL[o.status],
        })),
        cards: finance.cards.filter((c) => !c.archived).map((card) => {
          const invoices = cardInvoices(card, finance.transactions, finance.cardPayments, today);
          const open = invoices.find((i) => i.status === 'open');
          const pending = invoices.filter((i) => i.status === 'closed' || i.status === 'overdue');
          return {
            name: card.name,
            currentInvoice: open ? { total: formatMoney(open.totalCents, card.currency), closes: open.closing, due: open.due } : null,
            toPay: pending.map((i) => ({ month: i.month, remaining: formatMoney(i.remainingCents, card.currency), due: i.due, status: INVOICE_STATUS_LABEL[i.status] })),
          };
        }),
        budgets: finance.budgets.map((b) => {
          const status = budgetStatus(b, finance.transactions, today);
          return {
            category: finance.categories.find((c) => c.id === b.categoryId)?.name ?? 'Categoria',
            spent: formatMoney(status.spentCents + status.scheduledCents, b.currency),
            limit: formatMoney(b.amountCents, b.currency),
            exceedsOnDay: status.exceedDay,
            exceeded: status.state === 'exceeded',
          };
        }),
        financialHealth: health ? { score: health.score, level: health.label, tips: health.factors.map((f) => f.tip).filter(Boolean) } : null,
      };
    }

    case 'list_cards': {
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const finance = useFinanceStore.getState();
      const today = toISODate();
      return {
        items: finance.cards.filter((c) => !c.archived).map((card) => {
          const usage = cardUsage(card, finance.transactions, finance.cardPayments, today);
          return {
            name: card.name, currency: card.currency, closingDay: card.closingDay, dueDay: card.dueDay,
            limit: card.limitCents ? formatMoney(card.limitCents, card.currency) : null,
            available: usage.availableCents !== null ? formatMoney(usage.availableCents, card.currency) : null,
            invoices: cardInvoices(card, finance.transactions, finance.cardPayments, today).slice(-6).map((i) => ({
              month: i.month, total: formatMoney(i.totalCents, card.currency), remaining: formatMoney(i.remainingCents, card.currency),
              closes: i.closing, due: i.due, status: INVOICE_STATUS_LABEL[i.status],
            })),
          };
        }),
      };
    }

    case 'list_bills': {
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const month = optionalString(args, 'month') || monthOfKey(toISODate());
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('O mês precisa estar no formato AAAA-MM.');
      const finance = useFinanceStore.getState();
      return {
        month,
        items: billsOfMonth(finance.bills, finance.transactions, month, toISODate()).map((o) => ({
          name: o.bill.name, amount: formatMoney(o.bill.amountCents, o.bill.currency), due: o.dueDate,
          status: BILL_STATUS_LABEL[o.status], monthly: o.bill.recurrence === 'monthly',
        })),
      };
    }

    case 'create_bill': {
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const finance = useFinanceStore.getState();
      if (!finance.planningReady) return { ok: false, message: 'As contas a pagar ainda não estão disponíveis nesta conta.' };
      const name = boundedArg(args, 'name', 60, 'O nome da conta');
      if (!name) throw new Error('O nome da conta não pode ficar vazio.');
      const cents = parseAmountToCents(stringArg(args, 'amount'));
      if (cents === null) throw new Error('Valor inválido. Use, por exemplo, 99,90.');
      const currency = currencyArg(args);
      const dueDate = optionalString(args, 'due_date');
      const dueDay = Number(args.due_day ?? 0);
      const monthly = !dueDate;
      if (monthly && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) throw new Error('Informe o dia do vencimento (1 a 31) ou a data, para conta única.');
      if (!monthly && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('A data precisa estar no formato AAAA-MM-DD.');
      const category = matchCategory(finance.categories, 'expense', optionalString(args, 'category') || name, guessCategories(name));
      finance.addBill({
        name, amountCents: cents, currency, categoryId: category?.id ?? null,
        recurrence: monthly ? 'monthly' : 'once', dueDay: monthly ? dueDay : null, dueDate: monthly ? null : dueDate, startsOn: toISODate(),
      });
      return { ok: true, name, amount: formatMoney(cents, currency), due: monthly ? `todo dia ${dueDay}` : dueDate, category: category?.name ?? null };
    }

    case 'mark_bill_paid': {
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const finance = useFinanceStore.getState();
      const match = uniqueMatch(finance.bills, (b) => b.name, stringArg(args, 'bill_name'), 'conta');
      if (!match.item) return { ok: false, message: match.error };
      const today = toISODate();
      const period = optionalString(args, 'month') || monthOfKey(today);
      if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('O mês precisa estar no formato AAAA-MM.');
      const amountText = optionalString(args, 'amount');
      const cents = amountText ? parseAmountToCents(amountText) : match.item.amountCents;
      if (cents === null) throw new Error('Valor inválido.');
      if (finance.transactions.some((t) => t.billId === match.item?.id && t.billPeriod === period)) return { ok: true, alreadyPaid: true, name: match.item.name, month: period };
      if (!finance.payBill(match.item.id, period, cents, today)) return { ok: false, message: 'Não foi possível registrar o pagamento.' };
      return { ok: true, name: match.item.name, month: period, amount: formatMoney(cents, match.item.currency) };
    }

    case 'set_budget': {
      if (!(await financeAllowed())) return FINANCE_LOCKED;
      const finance = useFinanceStore.getState();
      if (!finance.planningReady) return { ok: false, message: 'Os orçamentos ainda não estão disponíveis nesta conta.' };
      const categoryName = stringArg(args, 'category');
      const category = matchCategory(finance.categories, 'expense', categoryName, guessCategories(categoryName));
      if (!category) return { ok: false, message: `Não encontrei a categoria de despesa “${categoryName}”. Categorias: ${finance.categories.filter((c) => c.kind === 'expense').map((c) => c.name).join(', ')}.` };
      const cents = parseAmountToCents(stringArg(args, 'amount'));
      if (cents === null) throw new Error('Valor inválido. Use, por exemplo, 600,00.');
      const currency = currencyArg(args);
      finance.setBudget(category.id, currency, cents);
      return { ok: true, category: category.name, monthlyLimit: formatMoney(cents, currency) };
    }

    case 'get_weekly_summary': {
      const allowed = await financeAllowed();
      const summary = buildWeekly(currentSnapshot(allowed));
      return { from: summary.start, to: summary.end, lines: allowed ? summary.lines : summary.lines.filter((l) => !/R\$|US\$|€|gast/i.test(l)) };
    }

    case 'get_coach_tips': {
      const insights = buildCoach(currentSnapshot(await financeAllowed())).slice(0, 5);
      return { items: insights.map((i) => ({ title: i.title, text: i.text })) };
    }

    case 'list_goals': {
      const finance = useFinanceStore.getState();
      const data = useDataStore.getState();
      const today = toISODate();
      return {
        financialGoals: finance.goals.map((g) => ({
          name: g.name, saved: formatMoney(g.savedCents, g.currency), target: formatMoney(g.targetCents, g.currency), deadline: g.deadline,
        })),
        objectives: useProgressStore.getState().objectives.map((o) => {
          const p = objectiveProgress(o, { goals: finance.goals, events: data.events, habits: data.habits }, today);
          return { title: o.title, targetDate: o.targetDate, status: p.status, progressPercent: Math.round(p.overall * 100), nextSteps: p.nextSteps };
        }),
        streakGoals: useProgressStore.getState().streakGoals.map((g) => {
          const habit = data.habits.find((h) => h.id === g.habitId);
          return habit ? { habit: habit.name, targetDays: g.targetDays, currentStreak: currentStreak(habit.doneDates, today), achieved: !!g.achievedOn } : null;
        }).filter(Boolean),
      };
    }

    case 'set_streak_goal': {
      const progress = useProgressStore.getState();
      if (!progress.ready) return { ok: false, message: 'As metas de sequência ainda não estão disponíveis nesta conta.' };
      const match = uniqueMatch(useDataStore.getState().habits, (h) => h.name, stringArg(args, 'habit_name'), 'hábito');
      if (!match.item) return { ok: false, message: match.error };
      const days = Number(args.days);
      if (!Number.isInteger(days) || days < 2 || days > 365) throw new Error('Escolha entre 2 e 365 dias.');
      progress.setStreakGoal(match.item.id, days);
      return { ok: true, habit: match.item.name, targetDays: days, currentStreak: currentStreak(match.item.doneDates, toISODate()) };
    }

    case 'delete_transaction': {
      const id = stringArg(args, 'transaction_id');
      const item = useFinanceStore.getState().transactions.find((t) => t.id === id);
      if (!item) return { ok: false, message: 'Esse lançamento não existe mais.' };
      const confirmed = await confirmAction({
        title: 'Apagar lançamento?',
        message: `O assistente pediu para apagar o lançamento de ${formatMoney(item.amountCents, item.currency)} em ${item.occurredOn}. Esta ação não pode ser desfeita.`,
        confirmText: 'Apagar',
        danger: true,
      });
      if (!confirmed) return { ok: false, cancelled: true, message: 'O usuário cancelou a remoção.' };
      useFinanceStore.getState().removeTransaction(id);
      return { ok: true, removed: id };
    }

    case 'create_goal': {
      const name = boundedArg(args, 'name', 60, 'O nome da meta');
      if (!name) throw new Error('O nome da meta não pode ficar vazio.');
      const target = parseAmountToCents(stringArg(args, 'target_amount'));
      if (target === null) throw new Error('Valor objetivo inválido. Use, por exemplo, 5000,00.');
      const currency = stringArg(args, 'currency').toUpperCase();
      if (!(CURRENCIES as readonly string[]).includes(currency)) throw new Error('Moeda aceita: BRL, USD ou EUR.');
      const deadline = typeof args.deadline === 'string' && args.deadline.trim() ? args.deadline.trim() : null;
      if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error('O prazo precisa estar no formato AAAA-MM-DD.');
      useFinanceStore.getState().addGoal(name, currency as Currency, target, deadline);
      return { ok: true, name, target: formatMoney(target, currency as Currency), deadline };
    }

    case 'add_goal_saving': {
      const goalName = stringArg(args, 'goal_name');
      const finance = useFinanceStore.getState();
      const match = uniqueMatch(finance.goals, (g) => g.name, goalName, 'meta');
      if (!match.item) return { ok: false, message: match.error };
      const cents = parseAmountToCents(stringArg(args, 'amount'));
      if (cents === null) throw new Error('Valor inválido. Use, por exemplo, 150,00.');
      const currency = stringArg(args, 'currency').toUpperCase();
      if (currency !== match.item.currency) return { ok: false, message: `Esta meta é em ${match.item.currency}.` };
      finance.addGoalSaving(match.item.id, cents);
      return { ok: true, goal: match.item.name, added: formatMoney(cents, match.item.currency) };
    }

    default:
      return { ok: false, message: `Ação não permitida: ${name}.` };
  }
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, message: 'Não foi possível formatar o resultado da ação.' });
  }
};

const withSources = (answer: string, citations: Citation[]): string => {
  const unique = citations
    .filter((c) => /^https:\/\//i.test(c.url))
    .filter((c, i, all) => all.findIndex((item) => item.url === c.url) === i)
    .slice(0, 3);
  if (!unique.length) return answer || 'Concluído.';
  const list = unique.map((c, i) => `${i + 1}. ${c.title || 'Fonte'}\n${c.url}`).join('\n');
  return `${answer || 'Encontrei estas informações.'}\n\nFontes consultadas:\n${list}`;
};

type AssistantPayload = { output?: unknown; text?: string; citations?: unknown } | null;

/** Pede à função as ferramentas da web (cartões, contas, orçamentos, resumo e metas), além das do app. */
const TOOLSET = 'web-2';
const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const FUNCTION_URL = `${supabaseUrl}/functions/v1/nexo-assistant`;
/** Um pouco acima do limite da função (45 s), para a mensagem de erro dela chegar primeiro. */
const ROUND_TIMEOUT_MS = 60_000;
const CONNECTION_ERROR = 'Não consegui ligar ao assistente. Confirme a configuração da função Supabase e tente novamente.';

const errorFromResponse = async (response: Response): Promise<Error> => {
  let message: string | undefined;
  try {
    message = ((await response.json()) as { error?: string }).error;
  } catch {
    // Resposta sem JSON legível.
  }
  return new Error(typeof message === 'string' && message ? message : CONNECTION_ERROR);
};

/** Lê os eventos enviados pela função: "delta" (trecho de texto), "done" (resultado final) e "error". */
const readEventStream = async (body: ReadableStream<Uint8Array>, onDelta: (chunk: string) => void): Promise<AssistantPayload> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AssistantPayload | undefined;

  const handleBlock = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join('\n'));
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (event === 'delta' && typeof parsed.text === 'string') onDelta(parsed.text);
    else if (event === 'done') result = parsed as AssistantPayload;
    else if (event === 'error') throw new Error(typeof parsed.error === 'string' && parsed.error ? parsed.error : CONNECTION_ERROR);
  };

  try {
    while (result === undefined) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1 && result === undefined) {
        handleBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (result === undefined) {
      buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
      if (buffer.trim()) handleBlock(buffer);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  if (result === undefined) throw new Error('A resposta do assistente foi interrompida. Tente novamente.');
  return result;
};

/**
 * Uma etapa da conversa com a função "nexo-assistant". Pede a resposta aos poucos (streaming);
 * se a função publicada ainda responder só em JSON, o resultado é o mesmo, apenas chega de uma vez.
 */
const requestRound = async (body: Record<string, unknown>, onDelta: (chunk: string) => void): Promise<AssistantPayload> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Entre na sua conta para usar o assistente.');

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ROUND_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabasePublishableKey,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new Error(controller.signal.aborted
        ? 'O assistente demorou demais para responder. Tente novamente.'
        : 'Sem conexão com o assistente. Verifique a internet e tente novamente.');
    }

    if (!response.ok) throw await errorFromResponse(response);
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream') && response.body) {
      try {
        return await readEventStream(response.body, onDelta);
      } catch (error) {
        if (controller.signal.aborted) {
          // eslint-disable-next-line preserve-caught-error -- a mensagem é para o usuário; o erro do stream interrompido não acrescenta nada.
          throw new Error('O assistente demorou demais para responder. Tente novamente.');
        }
        throw error;
      }
    }
    return (await response.json()) as AssistantPayload;
  } finally {
    window.clearTimeout(timer);
  }
};

export interface SendMessageOptions {
  /**
   * Recebe o texto parcial da resposta enquanto ela chega. Volta a '' quando o assistente
   * troca o texto por uma ação do app (agenda, tarefas...), antes de responder de novo.
   */
  onText?: (text: string) => void;
}

export const aiService = {
  async sendMessage(history: ChatMessage[], options: SendMessageOptions = {}): Promise<string> {
    const now = new Date();
    const context = {
      today: toISODate(now),
      weekday: WEEKDAY_NAMES[now.getDay()],
      localTime: formatTime(now.toISOString()),
      timezoneOffsetMinutes: now.getTimezoneOffset(),
      language: 'pt-BR',
    };

    const input: unknown[] = history.slice(-MAX_CONTEXT_MESSAGES).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1500),
    }));
    const citations: Citation[] = [];
    let webSearchUsed = false;

    for (let round = 0; round < MAX_FUNCTION_ROUNDS; round += 1) {
      if (input.length === 0 || input.length > MAX_INPUT_ITEMS) {
        throw new Error('O assistente acumulou etapas demais neste pedido. Tente dividir a solicitação ou iniciar uma nova conversa.');
      }

      let roundText = '';
      const payload = await requestRound({ input, context, allowWebSearch: !webSearchUsed, toolset: TOOLSET }, (chunk) => {
        roundText += chunk;
        options.onText?.(roundText);
      });

      const output = Array.isArray(payload?.output) ? (payload.output.filter(isRecord) as ResponseItem[]) : [];
      if (Array.isArray(payload?.citations)) {
        for (const raw of payload.citations) {
          if (isRecord(raw) && typeof raw.url === 'string' && /^https:\/\//i.test(raw.url)) {
            citations.push({ title: typeof raw.title === 'string' ? raw.title : raw.url, url: raw.url });
          }
        }
      }
      if (output.some((item) => item.type === 'web_search_call')) webSearchUsed = true;

      const calls = output.filter((item) =>
        item.type === 'function_call'
        && typeof item.call_id === 'string'
        && typeof item.name === 'string'
        && typeof item.arguments === 'string',
      ) as Array<ResponseItem & { call_id: string; name: string; arguments: string }>;

      if (!calls.length) {
        return withSources(typeof payload?.text === 'string' ? payload.text.trim() : '', citations);
      }
      // O texto desta etapa dá lugar às ações; a resposta final vem na próxima.
      if (roundText) options.onText?.('');
      if (input.length + calls.length * 2 > MAX_INPUT_ITEMS) {
        throw new Error('O assistente acumulou etapas demais neste pedido. Tente dividir a solicitação ou iniciar uma nova conversa.');
      }

      input.push(...calls);
      for (const call of calls) {
        let result: unknown;
        try {
          const parsed: unknown = JSON.parse(call.arguments || '{}');
          if (!isRecord(parsed)) throw new Error('Parâmetros inválidos para a ação.');
          result = await executeAssistantTool(call.name, parsed);
        } catch (toolError) {
          result = { ok: false, message: toolError instanceof Error ? toolError.message : 'A ação não pôde ser concluída.' };
        }
        input.push({ type: 'function_call_output', call_id: call.call_id, output: safeJson(result) });
      }
    }

    return withSources('Consegui executar as ações pedidas, mas não consegui concluir a resposta. Pode perguntar novamente se precisar de um resumo.', citations);
  },
};
