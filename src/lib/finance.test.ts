import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS, centsToInput, formatMoney, monthKeyOf, parseAmountToCents, totalsByCurrency } from './finance';

const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('parseAmountToCents', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12,', 1200],
    ['1234,56', 123456],
    ['1.234,56', 123456],
    ['1234.56', 123456],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['R$ 10,90', 1090],
    ['  45 ', 4500],
    ['0,01', 1],
  ])('"%s" → %i centavos', (raw, cents) => {
    expect(parseAmountToCents(raw)).toBe(cents);
  });

  it.each(['', 'abc', '0', '0,00', '-5', '1,234.56', '12,345', '1.2,50', '1,2,3', '10e3', 'R$'])('recusa "%s"', (raw) => {
    expect(parseAmountToCents(raw)).toBeNull();
  });

  it('respeita o valor máximo', () => {
    expect(parseAmountToCents('1000000000')).toBe(MAX_AMOUNT_CENTS);
    expect(parseAmountToCents('1000000000,01')).toBeNull();
  });
});

describe('formatação', () => {
  it('formatMoney usa o padrão brasileiro em cada moeda', () => {
    expect(plain(formatMoney(123456, 'BRL'))).toBe('R$ 1.234,56');
    expect(plain(formatMoney(-500, 'BRL'))).toBe('-R$ 5,00');
    expect(plain(formatMoney(990, 'USD'))).toBe('US$ 9,90');
    expect(plain(formatMoney(100, 'EUR'))).toBe('€ 1,00');
  });

  it('centsToInput devolve o texto do campo, que volta ao mesmo valor', () => {
    expect(centsToInput(123450)).toBe('1.234,50');
    expect(parseAmountToCents(centsToInput(987654321))).toBe(987654321);
  });

  it('monthKeyOf gera AAAA-MM', () => {
    expect(monthKeyOf(new Date(2026, 0, 31))).toBe('2026-01');
    expect(monthKeyOf(new Date(2026, 11, 1))).toBe('2026-12');
  });
});

describe('totalsByCurrency', () => {
  it('soma por moeda, sem converter, e só lista moedas usadas', () => {
    const totals = totalsByCurrency([
      { type: 'income', amountCents: 10000, currency: 'BRL' },
      { type: 'expense', amountCents: 2500, currency: 'BRL' },
      { type: 'expense', amountCents: 999, currency: 'EUR' },
    ]);
    expect(totals).toEqual([
      { currency: 'BRL', income: 10000, expense: 2500, balance: 7500 },
      { currency: 'EUR', income: 0, expense: 999, balance: -999 },
    ]);
  });

  it('lista vazia não gera totais', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});
