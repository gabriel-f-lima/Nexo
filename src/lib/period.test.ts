import { describe, expect, it } from 'vitest';
import { parseDateKey, toISODate } from './dates';
import { inBucket, periodRange, shiftReference } from './period';

describe('periodRange', () => {
  it('semana: segunda a domingo, um intervalo por dia', () => {
    const range = periodRange('week', parseDateKey('2026-10-23'));
    expect(range.start).toBe('2026-10-19');
    expect(range.end).toBe('2026-10-25');
    expect(range.buckets.map((b) => b.label)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
    expect(range.buckets[6]).toEqual({ label: 'Dom', key: '2026-10-25', granularity: 'day' });
  });

  it('mês: todos os dias do mês, inclusive fevereiro bissexto', () => {
    const feb = periodRange('month', parseDateKey('2024-02-10'));
    expect(feb.start).toBe('2024-02-01');
    expect(feb.end).toBe('2024-02-29');
    expect(feb.buckets).toHaveLength(29);
    expect(feb.label).toBe('fevereiro de 2024');
    expect(periodRange('month', parseDateKey('2026-10-31')).buckets).toHaveLength(31);
  });

  it('trimestre: três meses do trimestre da data', () => {
    const range = periodRange('quarter', parseDateKey('2026-08-15'));
    expect(range.start).toBe('2026-07-01');
    expect(range.end).toBe('2026-09-30');
    expect(range.buckets.map((b) => b.key)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(range.label).toBe('3º trimestre de 2026');
  });

  it('semestre: primeiro ou segundo conforme o mês', () => {
    expect(periodRange('semester', parseDateKey('2026-06-30')).label).toBe('1º semestre de 2026');
    const second = periodRange('semester', parseDateKey('2026-07-01'));
    expect(second.label).toBe('2º semestre de 2026');
    expect(second.start).toBe('2026-07-01');
    expect(second.end).toBe('2026-12-31');
  });

  it('ano: doze meses', () => {
    const range = periodRange('year', parseDateKey('2026-10-23'));
    expect(range.buckets).toHaveLength(12);
    expect(range.buckets[0]).toEqual({ label: 'jan', key: '2026-01', granularity: 'month' });
    expect(range.end).toBe('2026-12-31');
  });
});

describe('shiftReference', () => {
  it('semana anda 7 dias', () => {
    expect(toISODate(shiftReference('week', parseDateKey('2026-10-23'), -1))).toBe('2026-10-16');
  });

  it('mês parte do dia 1, sem pular fevereiro a partir do dia 31', () => {
    expect(toISODate(shiftReference('month', parseDateKey('2026-01-31'), 1))).toBe('2026-02-01');
    expect(toISODate(shiftReference('month', parseDateKey('2026-01-15'), -1))).toBe('2025-12-01');
  });

  it('trimestre, semestre e ano andam 3, 6 e 12 meses', () => {
    const ref = parseDateKey('2026-10-23');
    expect(toISODate(shiftReference('quarter', ref, 1))).toBe('2027-01-01');
    expect(toISODate(shiftReference('semester', ref, -1))).toBe('2026-04-01');
    expect(toISODate(shiftReference('year', ref, 1))).toBe('2027-10-01');
  });
});

describe('inBucket', () => {
  it('compara o dia exato ou o mês', () => {
    expect(inBucket('2026-10-23', { label: 'Sex', key: '2026-10-23', granularity: 'day' })).toBe(true);
    expect(inBucket('2026-10-24', { label: 'Sex', key: '2026-10-23', granularity: 'day' })).toBe(false);
    expect(inBucket('2026-10-23', { label: 'out', key: '2026-10', granularity: 'month' })).toBe(true);
    expect(inBucket('2026-11-01', { label: 'out', key: '2026-10', granularity: 'month' })).toBe(false);
  });
});
