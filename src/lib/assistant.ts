import { supabase } from './supabase';
import { formatTime, toISODate } from './dates';
import { confirmAction } from './confirm';
import { useDataStore, type ChatMessage } from '../store/data';
import { useFinanceStore } from '../store/finance';
import { CURRENCIES, formatMoney, monthKeyOf, parseAmountToCents, totalsByCurrency, type Currency } from './finance';

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
      const currency = stringArg(args, 'currency').toUpperCase();
      if (!(CURRENCIES as readonly string[]).includes(currency)) throw new Error('Moeda aceita: BRL, USD ou EUR.');
      const date = stringArg(args, 'date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A data precisa estar no formato AAAA-MM-DD.');
      const categoryName = typeof args.category === 'string' ? args.category.trim() : '';
      const category = categoryName
        ? finance.categories.find((c) => normalize(c.name) === normalize(categoryName) && c.kind === type)
        : undefined;
      const description = typeof args.description === 'string' ? args.description.trim().slice(0, 120) : '';
      finance.addTransaction({
        type, amountCents: cents, currency: currency as Currency,
        categoryId: category?.id ?? null, occurredOn: date, description,
      });
      return { ok: true, type, amount: formatMoney(cents, currency as Currency), date, category: category?.name ?? null };
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

const functionErrorMessage = async (error: unknown, data: unknown): Promise<string> => {
  let message = (data as { error?: string } | null)?.error;
  const response = (error as { context?: Response } | null)?.context;
  if (!message && response) {
    try {
      message = (await response.clone().json() as { error?: string }).error;
    } catch {
      // Resposta sem JSON legível.
    }
  }
  return message ?? 'Não consegui ligar ao assistente. Confirme a configuração da função Supabase e tente novamente.';
};

export const aiService = {
  async sendMessage(history: ChatMessage[]): Promise<string> {
    const now = new Date();
    const context = {
      today: toISODate(now),
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

      const { data, error } = await supabase.functions.invoke('nexo-assistant', {
        body: { input, context, allowWebSearch: !webSearchUsed },
      });
      if (error) throw new Error(await functionErrorMessage(error, data));

      const payload = data as { output?: unknown; text?: string; citations?: unknown } | null;
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
