import { useDataStore } from '../store/data';
import { useFinanceStore } from '../store/finance';
import { useProgressStore } from '../store/progress';
import { notify } from './toast';
import { currentTier, LIMITS, TIER_CHANGED_EVENT } from './billing';
import { ACHIEVEMENTS, earnedNow } from './achievements';
import { allLoaded, buildAchievementContext, buildCoach, buildHealth, buildWeekly, currentSnapshot } from './derived';
import { getAlertPrefs, getPermission, showNotification } from './reminder';
import { streakGoalProgress } from './streaks';

/**
 * Avisos em segundo plano enquanto o app está aberto: conquistas novas, metas de sequência cumpridas,
 * contas e faturas que vencem, dicas do coach e o resumo da semana. Cada aviso sai uma vez (registro no navegador).
 */

const FIRED_KEY = 'nexo-alerts-fired-v1';
const FIRED_RETENTION_MS = 40 * 24 * 60 * 60 * 1000;
/** Notificações do coach por dia, para não virar ruído. */
const COACH_DAILY_LIMIT = 2;
/** Antes disso, nada de notificação (ninguém quer aviso de conta de madrugada). */
const QUIET_UNTIL_HOUR = 8;
const WEEKLY_FROM_HOUR = 9;

const readFired = (): Record<string, number> => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, unknown>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, at]) => typeof at === 'number' && now - at < FIRED_RETENTION_MS)) as Record<string, number>;
  } catch {
    return {};
  }
};

const writeFired = (fired: Record<string, number>) => {
  try {
    window.localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    // Sem armazenamento: o aviso pode repetir, mas nada quebra.
  }
};

let financeAccess = false;
let tierUser: string | null = null;

const refreshTier = async () => {
  const userId = useDataStore.getState().userId;
  tierUser = userId;
  if (!userId) { financeAccess = false; return; }
  try {
    const tier = await currentTier(userId);
    if (tierUser === userId) financeAccess = LIMITS[tier].finance;
  } catch {
    financeAccess = false;
  }
};

const checkProgress = () => {
  const snapshot = currentSnapshot(financeAccess);
  if (!allLoaded(snapshot) || !snapshot.progress.ready) return;
  const progress = useProgressStore.getState();

  // Metas de sequência cumpridas ficam registradas com a data.
  for (const goal of snapshot.progress.streakGoals) {
    if (goal.achievedOn) continue;
    const habit = snapshot.data.habits.find((h) => h.id === goal.habitId);
    if (habit && streakGoalProgress(goal, habit, snapshot.today).achieved) {
      progress.markStreakGoalAchieved(goal.habitId, snapshot.today);
      notify(`Meta de sequência cumprida: ${goal.targetDays} dias de ${habit.name}!`, 'success');
    }
  }

  const health = buildHealth(currentSnapshot(financeAccess));
  const fresh = progress.unlockAchievements(earnedNow(buildAchievementContext(currentSnapshot(financeAccess), health?.score ?? null)));
  if (fresh.length === 1) {
    const achievement = ACHIEVEMENTS.find((a) => a.id === fresh[0]);
    if (achievement) notify(`Conquista desbloqueada: ${achievement.title} (+${achievement.points} pontos)`, 'success');
  } else if (fresh.length > 1) {
    notify(`Você desbloqueou ${fresh.length} conquistas. Veja em Conquistas.`, 'success');
  }
};

const checkNotifications = () => {
  if (getPermission() !== 'granted') return;
  const now = new Date();
  if (now.getHours() < QUIET_UNTIL_HOUR) return;
  const snapshot = currentSnapshot(financeAccess);
  if (!allLoaded(snapshot)) return;

  const prefs = getAlertPrefs();
  const fired = readFired();
  let changed = false;
  const once = (key: string, send: () => void) => {
    if (fired[key]) return;
    fired[key] = Date.now();
    changed = true;
    send();
  };

  const insights = buildCoach(snapshot);
  const isMoneyDue = (id: string) => /^(bill-|invoice-)/.test(id);

  if (prefs.bills && financeAccess) {
    for (const insight of insights.filter((i) => isMoneyDue(i.id) && i.priority >= 70)) {
      once(`${insight.id}:${snapshot.today}`, () => {
        void showNotification(insight.title, insight.text, insight.id, '/app/home', `${insight.title}. ${insight.text}`);
      });
    }
  }

  if (prefs.coach) {
    const sentToday = Object.keys(fired).filter((k) => k.startsWith('coach:') && k.endsWith(`:${snapshot.today}`)).length;
    const candidates = insights.filter((i) => !isMoneyDue(i.id) && (i.tone === 'alert' || i.priority >= 55));
    let budget = COACH_DAILY_LIMIT - sentToday;
    for (const insight of candidates) {
      if (budget <= 0) break;
      // O id já traz o mês ou o dia: o mesmo aviso não volta no mesmo período.
      const key = `coach:${insight.id}:${snapshot.today}`;
      if (fired[key] || Object.keys(fired).some((k) => k.startsWith(`coach:${insight.id}:`))) continue;
      budget -= 1;
      once(key, () => { void showNotification(insight.title, insight.text, insight.id, '/app/home', `${insight.title}. ${insight.text}`); });
    }
  }

  // Resumo da semana: a partir de segunda às 9h, uma vez por semana.
  if (prefs.weekly && now.getHours() >= WEEKLY_FROM_HOUR) {
    const summary = buildWeekly(snapshot);
    if (summary.lines.length > 1) {
      once(`weekly:${summary.key}`, () => {
        void showNotification('Seu resumo da semana', summary.lines.slice(0, 2).join(' '), `nexo-weekly-${summary.key}`, '/app/home');
      });
    }
  }

  if (changed) writeFired(fired);
};

/** Liga os avisos; devolve a função para desligar. */
export const startAlertsWatcher = (): (() => void) => {
  let timer: number | undefined;
  const run = () => {
    window.clearTimeout(timer);
    // Junta várias mudanças seguidas (ex.: marcar hábitos) numa só verificação.
    timer = window.setTimeout(() => {
      if (useDataStore.getState().userId !== tierUser) {
        void refreshTier().then(() => { checkProgress(); checkNotifications(); });
        return;
      }
      checkProgress();
      checkNotifications();
    }, 1500);
  };
  const onTier = () => { void refreshTier().then(run); };

  const unsubscribers = [useDataStore.subscribe(run), useFinanceStore.subscribe(run), useProgressStore.subscribe(run)];
  const interval = window.setInterval(run, 5 * 60 * 1000);
  window.addEventListener(TIER_CHANGED_EVENT, onTier);
  document.addEventListener('visibilitychange', run);
  void refreshTier().then(run);

  return () => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
    unsubscribers.forEach((off) => off());
    window.removeEventListener(TIER_CHANGED_EVENT, onTier);
    document.removeEventListener('visibilitychange', run);
  };
};
