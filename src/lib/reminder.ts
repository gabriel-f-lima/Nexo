import { useEffect, useState } from 'react';
import { notify } from './toast';
import { formatTime, toISODate } from './dates';
import { useDataStore } from '../store/data';

/**
 * Notificações da versão web. Sem um servidor de push, os avisos só chegam enquanto o Nexo estiver
 * aberto em alguma aba do navegador (ela pode ficar minimizada ou em segundo plano).
 * O service worker (/sw.js) exibe a notificação do sistema e traz o app para frente ao clicar nela.
 */
const REMINDER_KEY = 'nexo-daily-reminder-v1';
const EVENT_ALERT_KEY = 'nexo-event-alerts-v1';
const FIRED_KEY = 'nexo-event-alerts-fired-v1';
const FIRED_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export interface DailyReminder {
  hour: number;
  minute: number;
  lastFiredOn?: string;
}

export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

/** Antecedência dos avisos de compromisso, em minutos. 0 = desligado. */
export const EVENT_ALERT_OPTIONS = [
  { value: 0, label: 'Desligado' },
  { value: 10, label: '10 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
] as const;

const readJson = <T>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Armazenamento bloqueado (modo privado): o aviso só não fica salvo.
  }
};

const removeKey = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Sem armazenamento disponível.
  }
};

/* Assinantes: as telas se atualizam quando as preferências mudam (inclusive em outra aba). */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const isValidTime = (hour: unknown, minute: unknown): boolean =>
  Number.isInteger(hour) && Number.isInteger(minute)
  && (hour as number) >= 0 && (hour as number) <= 23
  && (minute as number) >= 0 && (minute as number) <= 59;

export const getReminder = (): DailyReminder | null => {
  const parsed = readJson<DailyReminder>(REMINDER_KEY);
  if (!parsed || !isValidTime(parsed.hour, parsed.minute)) return null;
  return {
    hour: parsed.hour,
    minute: parsed.minute,
    ...(typeof parsed.lastFiredOn === 'string' ? { lastFiredOn: parsed.lastFiredOn } : {}),
  };
};

export const getEventAlertMinutes = (): number => {
  const parsed = readJson<{ minutes?: unknown }>(EVENT_ALERT_KEY);
  const minutes = parsed?.minutes;
  return EVENT_ALERT_OPTIONS.some((option) => option.value === minutes) ? (minutes as number) : 0;
};

export const canNotify = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

export const getPermission = (): NotificationPermissionState =>
  canNotify() ? Notification.permission : 'unsupported';

/** Pede a permissão (só funciona a partir de um clique do usuário). */
const ensurePermission = async (): Promise<void> => {
  if (!canNotify()) throw new Error('NOTIFICATIONS_UNSUPPORTED');
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') throw new Error('NOTIFICATIONS_PERMISSION_DENIED');
  const result = await Notification.requestPermission();
  emit();
  if (result !== 'granted') throw new Error('NOTIFICATIONS_PERMISSION_DENIED');
};

export const describeNotificationError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'NOTIFICATIONS_UNSUPPORTED') return 'Este navegador não oferece notificações.';
  if (message === 'NOTIFICATIONS_PERMISSION_DENIED') {
    return 'As notificações estão bloqueadas para este site. Clique no cadeado ao lado do endereço, permita as notificações e tente de novo.';
  }
  return 'Não foi possível salvar a configuração. Tente novamente.';
};

const minutesOfDay = (hour: number, minute: number) => hour * 60 + minute;

export const enableReminder = async (hour: number, minute: number): Promise<DailyReminder> => {
  if (!isValidTime(hour, minute)) throw new Error('INVALID_TIME');
  await ensurePermission();
  const now = new Date();
  // Se o horário escolhido já passou hoje, o primeiro aviso fica para amanhã.
  const passedToday = minutesOfDay(now.getHours(), now.getMinutes()) >= minutesOfDay(hour, minute);
  const reminder: DailyReminder = { hour, minute, ...(passedToday ? { lastFiredOn: toISODate(now) } : {}) };
  writeJson(REMINDER_KEY, reminder);
  emit();
  return reminder;
};

export const disableReminder = (): void => {
  removeKey(REMINDER_KEY);
  emit();
};

export const setEventAlertMinutes = async (minutes: number): Promise<void> => {
  if (!EVENT_ALERT_OPTIONS.some((option) => option.value === minutes)) throw new Error('INVALID_OPTION');
  if (minutes > 0) await ensurePermission();
  if (minutes > 0) writeJson(EVENT_ALERT_KEY, { minutes });
  else removeKey(EVENT_ALERT_KEY);
  emit();
};

/** Mostra a notificação do sistema (via service worker quando houver) e, com a aba visível, um aviso na tela. */
const showNotification = async (title: string, body: string, tag: string, url: string, toastText = body): Promise<void> => {
  const visible = document.visibilityState === 'visible';
  if (visible) notify(toastText, 'info');
  if (getPermission() !== 'granted') return;

  const options: NotificationOptions = { body, tag, icon: '/nexo-logo.png', badge: '/nexo-logo.png', data: { url } };
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // Sem service worker ativo: tenta a notificação direta abaixo.
  }
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
      window.dispatchEvent(new CustomEvent('nexo:navigate', { detail: url }));
    };
  } catch {
    // Alguns navegadores móveis só exibem notificações pelo service worker.
  }
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Data local AAAA-MM-DD de um prazo, aceitando data simples ou data e hora ISO. */
const dueKey = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toISODate(date);
};

/** Texto do lembrete diário com o que ainda falta hoje, quando a conta está carregada. */
const dailySummary = (): string => {
  const { userId, loaded, events, tasks, habits } = useDataStore.getState();
  if (!userId || !loaded) return 'Hora de conferir o seu dia: compromissos, tarefas e rotina.';

  const today = toISODate();
  const now = Date.now();
  const eventsLeft = events.filter((event) => {
    const start = new Date(event.start);
    return toISODate(start) === today && start.getTime() >= now;
  }).length;
  // Mesma regra do resumo do dia: sem prazo, com prazo hoje ou vencidas.
  const tasksLeft = tasks.filter((task) => {
    if (task.done) return false;
    if (!task.dueDate) return true;
    const due = dueKey(task.dueDate);
    return due !== '' && due <= today;
  }).length;
  const habitsLeft = habits.filter((habit) => !habit.doneDates.includes(today)).length;

  const parts = [
    eventsLeft ? plural(eventsLeft, 'compromisso', 'compromissos') : '',
    tasksLeft ? plural(tasksLeft, 'tarefa', 'tarefas') : '',
    habitsLeft ? plural(habitsLeft, 'hábito', 'hábitos') : '',
  ].filter(Boolean);
  if (!parts.length) return 'Tudo em dia por hoje. Aproveite para planejar os próximos dias.';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0];
  return `Para hoje: ${list} em aberto.`;
};

const checkDailyReminder = () => {
  const reminder = getReminder();
  if (!reminder) return;
  const now = new Date();
  const today = toISODate(now);
  if (reminder.lastFiredOn === today) return;
  if (minutesOfDay(now.getHours(), now.getMinutes()) < minutesOfDay(reminder.hour, reminder.minute)) return;
  writeJson(REMINDER_KEY, { ...reminder, lastFiredOn: today });
  void showNotification('Seu dia no Nexo', dailySummary(), `nexo-daily-${today}`, '/app/home');
};

const checkEventAlerts = () => {
  const minutes = getEventAlertMinutes();
  if (!minutes) return;
  const { userId, loaded, events } = useDataStore.getState();
  if (!userId || !loaded) return;

  const now = Date.now();
  const limit = now + minutes * 60_000;
  const stored = readJson<Record<string, number>>(FIRED_KEY) ?? {};
  const fired: Record<string, number> = {};
  for (const [key, at] of Object.entries(stored)) {
    if (typeof at === 'number' && now - at < FIRED_RETENTION_MS) fired[key] = at;
  }

  for (const event of events) {
    const start = Date.parse(event.start);
    if (!Number.isFinite(start) || start <= now || start > limit) continue;
    // O horário faz parte da chave: se o compromisso for remarcado, o aviso volta a valer.
    const key = `${userId}:${event.id}:${event.start}`;
    if (fired[key]) continue;
    fired[key] = now;
    const inMinutes = Math.max(1, Math.round((start - now) / 60_000));
    const when = inMinutes >= 60 ? 'em 1 hora' : `em ${inMinutes} min`;
    const place = event.location ? ` · ${event.location}` : '';
    const body = `Começa às ${formatTime(event.start)} (${when})${place}`;
    void showNotification(event.title, body, `nexo-event-${event.id}`, '/app/agenda', `${event.title}: ${body}`);
  }
  writeJson(FIRED_KEY, fired);
};

/** Confere os avisos a cada 20 segundos e quando a aba volta ao foco. Retorna a função para parar. */
export const startReminderWatcher = (): (() => void) => {
  const tick = () => {
    checkDailyReminder();
    checkEventAlerts();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === REMINDER_KEY || event.key === EVENT_ALERT_KEY) emit();
  };
  const id = window.setInterval(tick, 20_000);
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);
  window.addEventListener('storage', onStorage);
  tick();
  return () => {
    window.clearInterval(id);
    document.removeEventListener('visibilitychange', tick);
    window.removeEventListener('focus', tick);
    window.removeEventListener('storage', onStorage);
  };
};

export interface NotificationSettings {
  permission: NotificationPermissionState;
  reminder: DailyReminder | null;
  eventAlertMinutes: number;
}

const snapshot = (): NotificationSettings => ({
  permission: getPermission(),
  reminder: getReminder(),
  eventAlertMinutes: getEventAlertMinutes(),
});

/** Preferências de notificação atuais; atualiza quando mudam aqui, em outra aba ou na permissão do navegador. */
export const useNotificationSettings = (): NotificationSettings => {
  const [state, setState] = useState(snapshot);

  useEffect(() => {
    const refresh = () => setState(snapshot());
    listeners.add(refresh);
    window.addEventListener('focus', refresh);

    let status: PermissionStatus | null = null;
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((result) => {
          status = result;
          result.onchange = refresh;
        })
        .catch(() => undefined);
    }
    refresh();

    return () => {
      listeners.delete(refresh);
      window.removeEventListener('focus', refresh);
      if (status) status.onchange = null;
    };
  }, []);

  return state;
};

/** Registra o service worker usado para exibir notificações. */
export const registerNotificationWorker = (): void => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
};
