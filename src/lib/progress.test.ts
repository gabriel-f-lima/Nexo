import { describe, expect, it } from 'vitest';
import { addDaysToKey } from './dates';
import {
  activeDaysStreak, currentStreak, longestPerfectRun, longestStreak, perfectDaysBetween, streakGoalProgress, type HabitLike,
} from './streaks';
import { ACHIEVEMENTS, earnedNow, levelFor, pointsOf, type AchievementContext } from './achievements';
import { objectiveProgress, type ObjectiveLike } from './objectives';

const today = '2026-10-23';
const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDaysToKey(from, i));

describe('sequências', () => {
  it('conta até hoje, ou até ontem se hoje ainda não foi marcado', () => {
    expect(currentStreak(days('2026-10-20', 4), today)).toBe(4);
    expect(currentStreak(days('2026-10-20', 3), today)).toBe(3);
    expect(currentStreak(days('2026-10-20', 2), today)).toBe(0);
    expect(currentStreak([], today)).toBe(0);
  });

  it('maior sequência, ignorando repetidos e datas inválidas', () => {
    expect(longestStreak(['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', 'x'])).toBe(3);
    expect(longestStreak(['2026-02-28', '2026-03-01'])).toBe(2);
    expect(longestStreak([])).toBe(0);
  });

  it('dias perfeitos e sequência de dias ativos', () => {
    const habits: HabitLike[] = [
      { id: 'a', name: 'Água', doneDates: days('2026-10-17', 7) },
      { id: 'b', name: 'Ler', doneDates: ['2026-10-18', '2026-10-19', '2026-10-21'] },
    ];
    expect(perfectDaysBetween(habits, '2026-10-17', '2026-10-23')).toEqual(['2026-10-18', '2026-10-19', '2026-10-21']);
    expect(longestPerfectRun(habits)).toBe(2);
    expect(activeDaysStreak(habits, today)).toBe(7);
  });

  it('meta de sequência: progresso, risco e conclusão', () => {
    const habit: HabitLike = { id: 'a', name: 'Água', doneDates: days('2026-10-14', 9) };
    expect(streakGoalProgress({ habitId: 'a', targetDays: 10, startedOn: '2026-10-01', achievedOn: null }, habit, today))
      .toMatchObject({ current: 9, remaining: 1, achieved: false, atRisk: true });
    expect(streakGoalProgress({ habitId: 'a', targetDays: 7, startedOn: '2026-10-01', achievedOn: null }, habit, today))
      .toMatchObject({ achieved: true, ratio: 1 });
    expect(streakGoalProgress({ habitId: 'a', targetDays: 30, startedOn: '2026-10-01', achievedOn: '2026-09-30' }, undefined, today))
      .toMatchObject({ achieved: true, current: 0 });
  });
});

const baseContext = (patch: Partial<AchievementContext> = {}): AchievementContext => ({
  today, habits: [], tasks: [], events: [], transactions: [], goals: [], budgets: [], bills: [], objectives: [], streakGoals: [], healthScore: null, ...patch,
});

describe('conquistas', () => {
  it('ids únicos e pontos positivos', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.points).toBeGreaterThan(0);
      expect(a.id).toMatch(/^[a-z0-9_]{1,40}$/);
    }
  });

  it('conta vazia não ganha nada', () => {
    expect(earnedNow(baseContext())).toEqual([]);
  });

  it('rotina: primeiro passo, sequências e dia perfeito', () => {
    const ctx = baseContext({
      habits: [
        { id: 'a', name: 'Água', doneDates: days('2026-10-10', 8) },
        { id: 'b', name: 'Ler', doneDates: ['2026-10-12'] },
      ],
    });
    const earned = earnedNow(ctx);
    expect(earned).toEqual(expect.arrayContaining(['first_habit', 'streak_3', 'streak_7', 'perfect_day']));
    expect(earned).not.toContain('streak_30');
    expect(earned).not.toContain('perfect_week');
  });

  it('finanças e metas', () => {
    const tx = { type: 'expense' as const, amountCents: 1000, currency: 'BRL' as const, categoryId: 'c', occurredOn: '2026-09-10', cardId: null, billId: 'b1', billPeriod: '2026-09' };
    const ctx = baseContext({
      transactions: [tx, { ...tx, billPeriod: '2026-08', occurredOn: '2026-08-11' }],
      bills: [{ id: 'b1', name: 'Luz', amountCents: 1000, currency: 'BRL', categoryId: null, recurrence: 'monthly', dueDay: 10, dueDate: null, startsOn: '2026-01-01', active: true }],
      budgets: [{ categoryId: 'c', currency: 'BRL', amountCents: 5000 }],
      goals: [{ targetCents: 100, savedCents: 100 }],
      objectives: [{ goalId: 'g', eventId: 'e', habitIds: ['h'] }],
      streakGoals: [{ habitId: 'h', targetDays: 7, startedOn: '2026-10-01', achievedOn: '2026-10-08' }],
      healthScore: 82,
    });
    const earned = earnedNow(ctx);
    expect(earned).toEqual(expect.arrayContaining(['first_entry', 'budget_set', 'first_goal', 'goal_done', 'objective_linked', 'streak_goal', 'streak_goal_done', 'health_80']));
    // Uma conta paga no prazo (setembro) e uma atrasada (agosto): ainda não são 3.
    expect(earned).not.toContain('bills_on_time');
    // Setembro (mês anterior) teve gasto dentro do orçamento.
    expect(earned).toContain('budget_month');
  });

  it('nível pelos pontos', () => {
    expect(levelFor(0)).toMatchObject({ level: 1, name: 'Iniciante', next: 40 });
    expect(levelFor(39).level).toBe(1);
    expect(levelFor(40)).toMatchObject({ level: 2, name: 'Aprendiz', ratio: 0 });
    expect(levelFor(70).ratio).toBeCloseTo(0.5);
    const max = pointsOf(ACHIEVEMENTS.map((a) => a.id));
    expect(levelFor(max)).toMatchObject({ next: null, ratio: 1 });
    expect(pointsOf(['first_habit', 'inexistente'])).toBe(10);
  });
});

describe('objetivos', () => {
  const objective: ObjectiveLike = {
    id: 'o1', title: 'Viagem em julho', targetDate: '2027-07-01', goalId: 'g1', eventId: 'e1', habitIds: ['h1'],
    startedOn: '2026-10-01', completedAt: null,
  };
  const goal = { id: 'g1', name: 'Viagem', currency: 'BRL' as const, targetCents: 300_000, savedCents: 30_000, deadline: '2027-07-01' };
  const habit: HabitLike = { id: 'h1', name: 'Não pedir delivery', doneDates: days('2026-10-10', 13) };
  const event = { id: 'e1', title: 'Viagem', start: '2027-07-01T12:00:00.000Z' };

  it('junta dinheiro, hábito e compromisso, e diz o próximo passo', () => {
    const p = objectiveProgress(objective, { goals: [goal], events: [event], habits: [habit] }, today);
    expect(p.daysLeft).toBe(251);
    expect(p.money).toMatchObject({ savedCents: 30_000, remainingCents: 270_000, ratio: 0.1 });
    // 270.000 em 36 semanas = 7.500 por semana.
    expect(p.money?.perWeekCents).toBe(7_500);
    expect(p.habits).toEqual([{ id: 'h1', name: 'Não pedir delivery', doneToday: false, doneLast7: 6, streak: 13 }]);
    expect(p.event?.title).toBe('Viagem');
    expect(p.status).toBe('on_track');
    expect(p.nextSteps[0]).toMatch(/^Guarde R\$\s75,00 por semana até 01\/07\/2027\.$/);
    expect(p.nextSteps[1]).toBe('Marque “Não pedir delivery” hoje para manter o ritmo.');
    expect(p.overall).toBeCloseTo(0.1 * 0.6 + (13 / 23) * 0.4);
  });

  it('atrasado quando o dinheiro guardado está abaixo do ritmo', () => {
    const p = objectiveProgress({ ...objective, startedOn: '2026-01-01' }, { goals: [goal], events: [], habits: [] }, today);
    expect(p.money?.onTrack).toBe(false);
    expect(p.status).toBe('behind');
    expect(p.event).toBeNull();
  });

  it('itens apagados não quebram o objetivo', () => {
    const p = objectiveProgress(objective, { goals: [], events: [], habits: [] }, today);
    expect(p.money).toBeNull();
    expect(p.habits).toEqual([]);
    expect(p.habitRatio).toBeNull();
    expect(p.nextSteps).toEqual(['Tudo no ritmo. Continue assim!']);
  });

  it('prazo passado e concluído', () => {
    expect(objectiveProgress({ ...objective, targetDate: '2026-10-01' }, { goals: [], events: [], habits: [] }, today).status).toBe('overdue');
    expect(objectiveProgress({ ...objective, completedAt: '2026-10-20T10:00:00Z' }, { goals: [], events: [], habits: [] }, today))
      .toMatchObject({ status: 'done', nextSteps: [] });
  });
});
