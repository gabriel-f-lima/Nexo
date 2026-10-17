import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast';
import { toISODate } from '../lib/dates';
import { canEditHabitDay, isPastEvent } from '../lib/rules';

/* Tipos espelham o aplicativo mobile (src/types/index.ts). */

export interface Task { id: string; title: string; done: boolean; dueDate?: string }
export interface AgendaEvent { id: string; title: string; start: string; end?: string; location?: string }
export interface Habit { id: string; name: string; doneDates: string[] }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string }
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  important: boolean;
  messageCount: number;
  messages: ChatMessage[];
  messagesLoaded: boolean;
}
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

const RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const MAX_TITLE = 80;
const MAX_MESSAGE = 2500;
const PAGE = 500;

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Hábitos iniciais criados na primeira vez que a conta é usada (igual ao app). */
const starterHabits = (): Habit[] => [
  { id: 'h1', name: 'Beber 2L de água', doneDates: [] },
  { id: 'h2', name: 'Treinar 1h30', doneDates: [] },
];

const lastAccess = (c: Conversation): number => {
  const value = Date.parse(c.lastAccessedAt || c.updatedAt || c.createdAt);
  return Number.isFinite(value) ? value : 0;
};
const sortConversations = (list: Conversation[]): Conversation[] =>
  [...list].sort((a, b) => Number(b.important) - Number(a.important) || lastAccess(b) - lastAccess(a));

const mapMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatMessage =>
    !!item && typeof item === 'object'
    && typeof (item as ChatMessage).id === 'string'
    && ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant')
    && typeof (item as ChatMessage).content === 'string',
  );
};

/* Linhas do banco <-> objetos do app */

const taskRow = (t: Task, userId: string) => ({
  user_id: userId, id: t.id, title: t.title, done: t.done, due_date: t.dueDate ?? null, updated_at: new Date().toISOString(),
});
const eventRow = (e: AgendaEvent, userId: string) => ({
  user_id: userId, id: e.id, title: e.title, start_at: e.start, end_at: e.end ?? null, location: e.location ?? null, updated_at: new Date().toISOString(),
});
const habitRow = (h: Habit, userId: string) => ({
  user_id: userId, id: h.id, name: h.name, done_dates: h.doneDates, updated_at: new Date().toISOString(),
});
const conversationRow = (c: Conversation, userId: string) => ({
  user_id: userId,
  id: c.id,
  title: c.title,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
  last_accessed_at: c.lastAccessedAt,
  important: c.important,
  message_count: c.messages.length,
  messages: c.messages,
});

/** Grava na nuvem e atualiza o estado de sincronização exibido nas configurações. */
export const writeOp = async (label: string, op: () => PromiseLike<{ error: unknown }>): Promise<void> => {
  useDataStore.setState({ syncStatus: 'syncing', syncMessage: 'Salvando na nuvem…' });
  try {
    const { error } = await op();
    if (error) throw error;
    useDataStore.setState({ syncStatus: 'synced', syncMessage: 'Seus dados estão sincronizados com a nuvem.' });
  } catch (error) {
    useDataStore.setState({ syncStatus: 'error', syncMessage: 'Não foi possível sincronizar. Verifique a conexão.' });
    notify('Não foi possível salvar na nuvem. Tente novamente.', 'error');
    if (import.meta.env.DEV) console.warn(`[nuvora] ${label}`, error);
  }
};

const upsertRow = (table: string, build: (userId: string) => Record<string, unknown>) => {
  const userId = useDataStore.getState().userId;
  if (!userId) return Promise.resolve();
  return writeOp(`salvar em ${table}`, () =>
    supabase.from(table).upsert(build(userId), { onConflict: 'user_id,id' }));
};

const deleteRow = (table: string, id: string) => {
  const userId = useDataStore.getState().userId;
  if (!userId) return Promise.resolve();
  return writeOp(`apagar em ${table}`, () =>
    supabase.from(table).delete().eq('user_id', userId).eq('id', id));
};

export const selectAll = async (table: string, columns: string, userId: string): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
};

interface DataState {
  userId: string | null;
  loaded: boolean;
  tasks: Task[];
  events: AgendaEvent[];
  habits: Habit[];
  conversations: Conversation[];
  chatMessages: ChatMessage[];
  activeConversationId: string | null;
  syncStatus: SyncStatus;
  syncMessage: string | null;

  activate: (user: { id: string }) => Promise<void>;
  reset: () => void;

  addTask: (title: string) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  addEvent: (title: string, start: string, location?: string) => void;
  removeEvent: (id: string) => void;
  addHabit: (name: string) => void;
  removeHabit: (id: string) => void;
  toggleHabitForDate: (id: string, date: string) => void;

  appendMessage: (role: ChatMessage['role'], content: string) => ChatMessage | null;
  startNewConversation: () => void;
  openConversation: (id: string) => Promise<boolean>;
  deleteConversation: (id: string) => Promise<void>;
  setConversationImportant: (id: string, important: boolean) => Promise<void>;
  pruneExpiredLocal: () => void;
}

export const useDataStore = create<DataState>()((set, get) => ({
  userId: null,
  loaded: false,
  tasks: [],
  events: [],
  habits: starterHabits(),
  conversations: [],
  chatMessages: [],
  activeConversationId: null,
  syncStatus: 'idle',
  syncMessage: null,

  activate: async (user) => {
    if (get().userId === user.id && get().loaded) return;
    set({ userId: user.id, loaded: false, syncStatus: 'syncing', syncMessage: 'Carregando seus dados…' });

    try {
      // Primeiro acesso da conta: cria os hábitos iniciais e a marca de inicialização (como o app faz).
      const { data: marker, error: markerError } = await supabase
        .from('nexo_user_state')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (markerError) throw markerError;

      if (!marker) {
        const { error: habitsError } = await supabase
          .from('nexo_habits')
          .upsert(starterHabits().map((h) => habitRow(h, user.id)), { onConflict: 'user_id,id' });
        if (habitsError) throw habitsError;
        const { error: stateError } = await supabase
          .from('nexo_user_state')
          .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (stateError) throw stateError;
      }

      // Remove conversas comuns sem acesso há mais de 15 dias, como o app.
      const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
      const { error: pruneError } = await supabase
        .from('nexo_conversations')
        .delete()
        .eq('user_id', user.id)
        .eq('important', false)
        .lt('last_accessed_at', cutoff);
      if (pruneError) throw pruneError;

      const [taskRows, eventRows, habitRows, conversationRows] = await Promise.all([
        selectAll('nexo_tasks', 'id,title,done,due_date', user.id),
        selectAll('nexo_events', 'id,title,start_at,end_at,location', user.id),
        selectAll('nexo_habits', 'id,name,done_dates', user.id),
        selectAll('nexo_conversations', 'id,title,created_at,updated_at,last_accessed_at,important,message_count', user.id),
      ]);

      // A conta pode ter mudado enquanto os dados carregavam.
      if (get().userId !== user.id) return;

      set({
        tasks: taskRows.map((row) => ({
          id: String(row.id),
          title: String(row.title),
          done: Boolean(row.done),
          ...(row.due_date ? { dueDate: String(row.due_date) } : {}),
        })),
        events: eventRows.map((row) => ({
          id: String(row.id),
          title: String(row.title),
          start: String(row.start_at),
          ...(row.end_at ? { end: String(row.end_at) } : {}),
          ...(row.location ? { location: String(row.location) } : {}),
        })),
        habits: habitRows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          doneDates: Array.isArray(row.done_dates) ? row.done_dates.map(String) : [],
        })),
        conversations: sortConversations(conversationRows.map((row) => {
          const updated = String(row.updated_at ?? new Date().toISOString());
          return {
            id: String(row.id),
            title: String(row.title ?? 'Conversa'),
            createdAt: String(row.created_at ?? updated),
            updatedAt: updated,
            lastAccessedAt: String(row.last_accessed_at ?? updated),
            important: Boolean(row.important),
            messageCount: Number(row.message_count ?? 0),
            messages: [],
            messagesLoaded: false,
          };
        })),
        chatMessages: [],
        activeConversationId: null,
        loaded: true,
        syncStatus: 'synced',
        syncMessage: 'Seus dados estão sincronizados com a nuvem.',
      });
    } catch (error) {
      if (get().userId !== user.id) return;
      set({ loaded: true, syncStatus: 'error', syncMessage: 'Não foi possível carregar seus dados. Verifique a conexão e se a migração do Supabase foi aplicada.' });
      if (import.meta.env.DEV) console.warn('[nuvora] carregamento', error);
    }
  },

  reset: () => set({
    userId: null,
    loaded: false,
    tasks: [],
    events: [],
    habits: [],
    conversations: [],
    chatMessages: [],
    activeConversationId: null,
    syncStatus: 'idle',
    syncMessage: null,
  }),

  addTask: (title) => {
    const clean = title.trim().slice(0, MAX_TITLE);
    if (!clean) return;
    const task: Task = { id: createId(), title: clean, done: false };
    set((s) => ({ tasks: [...s.tasks, task] }));
    void upsertRow('nexo_tasks', (uid) => taskRow(task, uid));
  },

  toggleTask: (id) => {
    let changed: Task | undefined;
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        changed = { ...t, done: !t.done };
        return changed;
      }),
    }));
    if (changed) void upsertRow('nexo_tasks', (uid) => taskRow(changed as Task, uid));
  },

  removeTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    void deleteRow('nexo_tasks', id);
  },

  addEvent: (title, start, location) => {
    const clean = title.trim().slice(0, MAX_TITLE);
    if (!clean || isPastEvent(start)) return;
    const event: AgendaEvent = {
      id: createId(),
      title: clean,
      start,
      ...(location?.trim() ? { location: location.trim().slice(0, 80) } : {}),
    };
    set((s) => ({ events: [...s.events, event] }));
    void upsertRow('nexo_events', (uid) => eventRow(event, uid));
  },

  removeEvent: (id) => {
    const current = get().events.find((e) => e.id === id);
    if (current && isPastEvent(current.start)) return;
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    void deleteRow('nexo_events', id);
  },

  addHabit: (name) => {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    const habit: Habit = { id: createId(), name: clean, doneDates: [] };
    set((s) => ({ habits: [...s.habits, habit] }));
    void upsertRow('nexo_habits', (uid) => habitRow(habit, uid));
  },

  removeHabit: (id) => {
    set((s) => ({ habits: s.habits.filter((h) => h.id !== id) }));
    void deleteRow('nexo_habits', id);
  },

  toggleHabitForDate: (id, date) => {
    if (!canEditHabitDay(date)) return;
    let changed: Habit | undefined;
    set((s) => ({
      habits: s.habits.map((h) => {
        if (h.id !== id) return h;
        const done = h.doneDates.includes(date);
        changed = { ...h, doneDates: done ? h.doneDates.filter((d) => d !== date) : [...h.doneDates, date] };
        return changed;
      }),
    }));
    if (changed) void upsertRow('nexo_habits', (uid) => habitRow(changed as Habit, uid));
  },

  appendMessage: (role, content) => {
    const { userId, conversations, activeConversationId, chatMessages } = get();
    if (!userId) return null;

    const message: ChatMessage = { id: createId(), role, content: content.slice(0, MAX_MESSAGE) };
    const now = new Date().toISOString();
    const current = conversations.find((c) => c.id === activeConversationId);
    const messages = current ? [...chatMessages, message] : [message];
    const firstUser = messages.find((m) => m.role === 'user')?.content.trim() ?? '';
    const conversation: Conversation = {
      id: current?.id ?? createId(),
      title: current?.title ?? (firstUser.slice(0, 48) || 'Nova conversa'),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      lastAccessedAt: now,
      important: current?.important ?? false,
      messageCount: messages.length,
      messages,
      messagesLoaded: true,
    };

    set({
      activeConversationId: conversation.id,
      chatMessages: messages,
      conversations: sortConversations([...conversations.filter((c) => c.id !== conversation.id), conversation]),
    });
    void upsertRow('nexo_conversations', (uid) => conversationRow(conversation, uid));
    return message;
  },

  startNewConversation: () => set({ activeConversationId: null, chatMessages: [] }),

  openConversation: async (id) => {
    const { userId, conversations } = get();
    const conversation = conversations.find((c) => c.id === id);
    if (!userId || !conversation) return false;

    let messages = conversation.messages;
    if (!conversation.messagesLoaded) {
      const { data, error } = await supabase
        .from('nexo_conversations')
        .select('messages')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) {
        notify('Não foi possível abrir a conversa. Verifique a conexão.', 'error');
        return false;
      }
      messages = mapMessages((data as { messages?: unknown } | null)?.messages);
    }

    const now = new Date().toISOString();
    const opened: Conversation = {
      ...conversation,
      messages,
      messageCount: messages.length,
      messagesLoaded: true,
      lastAccessedAt: now,
    };
    set((s) => ({
      conversations: sortConversations(s.conversations.map((c) => (c.id === id ? opened : c))),
      activeConversationId: id,
      chatMessages: messages,
    }));
    // Atualiza só a data de acesso, sem regravar as mensagens.
    void writeOp('registrar acesso à conversa', () =>
      supabase.from('nexo_conversations').update({ last_accessed_at: now }).eq('user_id', userId).eq('id', id));
    return true;
  },

  deleteConversation: async (id) => {
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      ...(s.activeConversationId === id ? { activeConversationId: null, chatMessages: [] } : {}),
    }));
    await deleteRow('nexo_conversations', id);
  },

  setConversationImportant: async (id, important) => {
    const { userId, conversations } = get();
    if (!userId) return;

    // A regra do banco permite só uma conversa importante: desmarca as outras antes de marcar esta.
    if (important) {
      for (const other of conversations.filter((c) => c.important && c.id !== id)) {
        await writeOp('desmarcar conversa importante', () =>
          supabase.from('nexo_conversations').update({ important: false }).eq('user_id', userId).eq('id', other.id));
      }
    }

    set((s) => ({
      conversations: sortConversations(s.conversations.map((c) => {
        if (c.id === id) return { ...c, important };
        if (important && c.important) return { ...c, important: false };
        return c;
      })),
    }));
    await writeOp('marcar conversa importante', () =>
      supabase.from('nexo_conversations').update({ important }).eq('user_id', userId).eq('id', id));
  },

  pruneExpiredLocal: () => {
    const now = Date.now();
    const kept = get().conversations.filter((c) => c.important || now - lastAccess(c) < RETENTION_MS);
    if (kept.length === get().conversations.length) return;
    const activeKept = kept.some((c) => c.id === get().activeConversationId);
    set({
      conversations: kept,
      ...(activeKept ? {} : { activeConversationId: null, chatMessages: [] }),
    });
  },
}));

export const todayKey = (): string => toISODate();
