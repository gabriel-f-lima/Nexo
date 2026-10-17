import { notify } from './toast';
import { toISODate } from './dates';

/**
 * Lembrete diário no navegador. Diferente do app, que usa o sistema do celular, aqui o aviso
 * depende de a aba estar aberta (ou do navegador permitir notificações em segundo plano).
 */
const KEY = 'nexo-daily-reminder-v1';

export interface DailyReminder {
  hour: number;
  minute: number;
  lastFiredOn?: string;
}

export const getReminder = (): DailyReminder | null => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyReminder;
    return typeof parsed.hour === 'number' && typeof parsed.minute === 'number' ? parsed : null;
  } catch {
    return null;
  }
};

const save = (reminder: DailyReminder) => window.localStorage.setItem(KEY, JSON.stringify(reminder));

export const canNotify = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

const ensurePermission = async (): Promise<void> => {
  if (!canNotify()) throw new Error('NOTIFICATIONS_UNSUPPORTED');
  if (Notification.permission === 'granted') return;
  const result = await Notification.requestPermission();
  if (result !== 'granted') throw new Error('NOTIFICATIONS_PERMISSION_DENIED');
};

const minutesOfDay = (hour: number, minute: number) => hour * 60 + minute;

export const enableReminder = async (hour: number, minute: number): Promise<DailyReminder> => {
  await ensurePermission();
  const now = new Date();
  // Se o horário escolhido já passou hoje, o primeiro aviso fica para amanhã.
  const passedToday = minutesOfDay(now.getHours(), now.getMinutes()) >= minutesOfDay(hour, minute);
  const reminder: DailyReminder = { hour, minute, lastFiredOn: passedToday ? toISODate(now) : undefined };
  save(reminder);
  return reminder;
};

export const disableReminder = (): void => window.localStorage.removeItem(KEY);

const showNotification = (title: string, body: string) => {
  try {
    new Notification(title, { body, icon: '/nexo-logo.png' });
  } catch {
    // Alguns navegadores móveis só exibem notificações via service worker.
  }
  notify(body, 'info');
};

export const sendTestNotification = async (): Promise<void> => {
  await ensurePermission();
  showNotification('Nuvora', 'Tudo certo! Assim vai aparecer o seu lembrete diário.');
};

/** Verifica a cada 20 segundos se chegou a hora do lembrete. Retorna a função para parar. */
export const startReminderWatcher = (): (() => void) => {
  const tick = () => {
    const reminder = getReminder();
    if (!reminder || !canNotify() || Notification.permission !== 'granted') return;
    const now = new Date();
    const today = toISODate(now);
    if (reminder.lastFiredOn === today) return;
    if (minutesOfDay(now.getHours(), now.getMinutes()) < minutesOfDay(reminder.hour, reminder.minute)) return;
    save({ ...reminder, lastFiredOn: today });
    showNotification('Nuvora', 'Hora de conferir o seu dia: compromissos, tarefas e rotina.');
  };
  const id = window.setInterval(tick, 20_000);
  tick();
  return () => window.clearInterval(id);
};
