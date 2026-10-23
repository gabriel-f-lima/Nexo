import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canEditFinanceDay, canEditHabitDay, earliestFinanceDay, isPastDay, isPastEvent } from './rules';

describe('regras de edição por data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 1º de março: "ontem" é o último dia de fevereiro.
    vi.setSystemTime(new Date(2026, 2, 1, 0, 30));
  });
  afterEach(() => vi.useRealTimers());

  it('hábitos: só hoje e ontem', () => {
    expect(canEditHabitDay('2026-03-01')).toBe(true);
    expect(canEditHabitDay('2026-02-28')).toBe(true);
    expect(canEditHabitDay('2026-02-27')).toBe(false);
    expect(canEditHabitDay('2026-03-02')).toBe(false);
  });

  it('financeiro: de ontem em diante', () => {
    expect(earliestFinanceDay()).toBe('2026-02-28');
    expect(canEditFinanceDay('2026-02-28')).toBe(true);
    expect(canEditFinanceDay('2026-12-31')).toBe(true);
    expect(canEditFinanceDay('2026-02-27')).toBe(false);
  });

  it('compromissos de dias anteriores ficam só para consulta', () => {
    expect(isPastDay('2026-02-28')).toBe(true);
    expect(isPastDay('2026-03-01')).toBe(false);
    expect(isPastEvent(new Date(2026, 1, 28, 23, 59).toISOString())).toBe(true);
    expect(isPastEvent(new Date(2026, 2, 1, 0, 0).toISOString())).toBe(false);
  });
});
