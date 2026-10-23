import { describe, expect, it } from 'vitest';
import {
  addDays, addDaysToKey, addMonthsToKey, addMonthsToMonth, dayInMonth, dayLabel, daysBetween, formatConversationDate, formatLongDate,
  formatMonthTitle, formatShortDate, formatTime, getGreeting, parseDateKey, relativeDay, toISODate, weekStart,
} from './dates';

describe('datas locais', () => {
  it('roda no fuso de São Paulo', () => {
    expect(new Date(2026, 9, 23, 12).getTimezoneOffset()).toBe(180);
  });

  it('toISODate usa o dia local, sem o deslocamento do UTC', () => {
    // 23h em São Paulo já é dia seguinte em UTC.
    expect(toISODate(new Date(2026, 9, 23, 23, 30))).toBe('2026-10-23');
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('parseDateKey e toISODate são inversos', () => {
    for (const key of ['2024-02-29', '2026-12-31', '2026-01-01']) {
      expect(toISODate(parseDateKey(key))).toBe(key);
    }
  });

  it('addDays atravessa meses e anos', () => {
    expect(toISODate(addDays(parseDateKey('2026-01-31'), 1))).toBe('2026-02-01');
    expect(toISODate(addDays(parseDateKey('2026-12-31'), 1))).toBe('2027-01-01');
    expect(toISODate(addDays(parseDateKey('2024-03-01'), -1))).toBe('2024-02-29');
  });

  it('addDays não altera a data original', () => {
    const base = parseDateKey('2026-10-23');
    addDays(base, 5);
    expect(toISODate(base)).toBe('2026-10-23');
  });

  it('weekStart começa na segunda-feira', () => {
    expect(toISODate(weekStart(parseDateKey('2026-10-23')))).toBe('2026-10-19'); // sexta
    expect(toISODate(weekStart(parseDateKey('2026-10-19')))).toBe('2026-10-19'); // segunda
    expect(toISODate(weekStart(parseDateKey('2026-10-25')))).toBe('2026-10-19'); // domingo
  });

  it('formatTime mostra HH:mm local', () => {
    expect(formatTime(new Date(2026, 9, 23, 9, 5).toISOString())).toBe('09:05');
  });

  it('formatLongDate escreve o dia por extenso', () => {
    expect(formatLongDate(parseDateKey('2026-10-23'))).toBe('Sexta, 23 de outubro');
  });

  it('formatConversationDate ignora datas inválidas', () => {
    expect(formatConversationDate('não é data')).toBe('');
    expect(formatConversationDate(new Date(2026, 9, 10, 19, 5).toISOString())).toBe('10/10/2026 · 19:05');
  });
});

describe('saudação', () => {
  it('usa o período certo do dia', () => {
    expect(getGreeting(new Date(2026, 9, 23, 3))).toMatch(/^Boa madrugada!/);
    expect(getGreeting(new Date(2026, 9, 23, 9))).toMatch(/^Bom dia!/);
    expect(getGreeting(new Date(2026, 9, 23, 14))).toMatch(/^Boa tarde!/);
    expect(getGreeting(new Date(2026, 9, 23, 21))).toMatch(/^Boa noite!/);
  });

  it('é a mesma dentro da janela de seis horas e muda na seguinte', () => {
    expect(getGreeting(new Date(2026, 9, 23, 6, 1))).toBe(getGreeting(new Date(2026, 9, 23, 11, 59)));
    expect(getGreeting(new Date(2026, 9, 23, 11, 59))).not.toBe(getGreeting(new Date(2026, 9, 23, 12, 0)));
  });
});

describe('chaves de data e de mês', () => {
  it('soma meses e ajusta o dia ao tamanho do mês', () => {
    expect(addMonthsToMonth('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToKey('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToKey('2024-01-31', 1)).toBe('2024-02-29');
    expect(dayInMonth('2026-04', 31)).toBe('2026-04-30');
  });

  it('dias entre datas e soma de dias', () => {
    expect(daysBetween('2026-10-23', '2026-10-27')).toBe(4);
    expect(daysBetween('2026-10-27', '2026-10-23')).toBe(-4);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(addDaysToKey('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('rótulos para a tela', () => {
    expect(formatShortDate('2026-10-27', '2026-10-23')).toBe('27/10');
    expect(formatShortDate('2027-01-02', '2026-10-23')).toBe('02/01/2027');
    expect(formatMonthTitle('2026-10')).toBe('Outubro de 2026');
    expect(dayLabel('2026-10-23', '2026-10-23')).toBe('hoje');
    expect(dayLabel('2026-10-24', '2026-10-23')).toBe('amanhã');
    expect(dayLabel('2026-10-27', '2026-10-23')).toBe('terça, 27/10');
    expect(relativeDay('2026-10-26', '2026-10-23')).toBe('em 3 dias');
    expect(relativeDay('2026-10-20', '2026-10-23')).toBe('há 3 dias');
    expect(relativeDay('2026-08-20', '2026-10-23')).toBe('20/08');
  });
});
