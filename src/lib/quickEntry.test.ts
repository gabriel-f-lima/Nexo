import { describe, expect, it } from 'vitest';
import { parseQuickEntry, type QuickEntry } from '../../supabase/functions/_shared/quickEntry';

// Sexta-feira, 23 de outubro de 2026.
const today = '2026-10-23';
const parse = (text: string, cardNames?: string[]): QuickEntry => parseQuickEntry(text, { today, cardNames });

describe('lançamentos', () => {
  it('gastei 45 no mercado ontem', () => {
    expect(parse('gastei 45 no mercado ontem')).toEqual({
      kind: 'transaction', type: 'expense', amountCents: 4500, currency: 'BRL', date: '2026-10-22',
      description: 'Mercado', categoryHints: ['Mercado', 'Alimentação'], card: false, cardName: null, installments: 1,
    });
  });

  it.each([
    ['paguei R$ 89,90 de internet', 8990, 'Internet', '2026-10-23'],
    ['uber 23,50', 2350, 'Uber', '2026-10-23'],
    ['Gastei 1.200 no aluguel dia 5', 120000, 'Aluguel', '2026-10-05'],
    ['gastei 2 mil na viagem', 200000, 'Viagem', '2026-10-23'],
    ['comprei pizza por 60 reais anteontem', 6000, 'Pizza', '2026-10-21'],
    ['almoço com a equipe 72,5', 7250, 'Almoço com a equipe', '2026-10-23'],
    ['gastei 30 na farmácia segunda', 3000, 'Farmácia', '2026-10-19'],
    ['gastei 50 no cinema dia 28', 5000, 'Cinema', '2026-09-28'],
    ['paguei 150 de luz em 20/09', 15000, 'Luz', '2026-09-20'],
    ['gastei 15 em 28/12', 1500, '', '2025-12-28'],
  ])('%s', (text, cents, description, date) => {
    const entry = parse(text);
    expect(entry).toMatchObject({ kind: 'transaction', type: 'expense', amountCents: cents, description, date });
  });

  it('receitas', () => {
    expect(parse('recebi 3000 de salário')).toMatchObject({ type: 'income', amountCents: 300000, description: 'Salário', categoryHints: ['Salário'] });
    expect(parse('salário 4.500,00')).toMatchObject({ type: 'income', amountCents: 450000 });
    expect(parse('ganhei 200 de freela ontem')).toMatchObject({ type: 'income', date: '2026-10-22', categoryHints: ['Freelance', 'Salário'] });
  });

  it('cartão e parcelas', () => {
    expect(parse('gastei 300 no cartão em 3x')).toMatchObject({ amountCents: 30000, card: true, installments: 3, description: '' });
    expect(parse('comprei um tênis de 400 reais no nubank em 2 vezes', ['Nubank'])).toMatchObject({
      amountCents: 40000, card: true, cardName: 'Nubank', installments: 2, description: 'Tênis', categoryHints: ['Compras', 'Lazer'],
    });
    expect(parse('gastei 80 no crédito', ['Inter'])).toMatchObject({ card: true, cardName: null, installments: 1 });
    expect(parse('paguei 80 no pix')).toMatchObject({ card: false });
    expect(parse('gastei 120 parcelado em 4 vezes')).toMatchObject({ card: true, installments: 4 });
  });

  it('outras moedas', () => {
    expect(parse('gastei US$ 25 no hotel')).toMatchObject({ currency: 'USD', amountCents: 2500 });
    expect(parse('paguei 12,50 euros de café')).toMatchObject({ currency: 'EUR', amountCents: 1250, description: 'Café' });
  });

  it('recebimento não vai para o cartão', () => {
    expect(parse('recebi 100 no cartão')).toMatchObject({ type: 'income', card: false, installments: 1 });
  });
});

describe('compromissos', () => {
  it('dentista terça às 15h', () => {
    expect(parse('dentista terça às 15h')).toEqual({ kind: 'event', title: 'Dentista', date: '2026-10-27', time: '15:00' });
  });

  it.each([
    ['reunião amanhã 9:30', 'Reunião', '2026-10-24', '09:30'],
    ['consulta dia 12 às 14h30', 'Consulta', '2026-11-12', '14:30'],
    ['Marcar academia sexta que vem às 7h', 'Academia', '2026-10-30', '07:00'],
    ['aniversário da Ana 15/11 às 20h', 'Aniversário da Ana', '2026-11-15', '20:00'],
    ['jantar com a família sábado às 8 da noite', 'Jantar com a família', '2026-10-24', '20:00'],
    ['call com cliente hoje às 3', 'Call com cliente', '2026-10-23', '15:00'],
    ['entrevista 5 de novembro ao meio-dia', 'Entrevista', '2026-11-05', '12:00'],
    ['reunião às 15h na sala 3', 'Reunião na sala 3', '2026-10-23', '15:00'],
    ['me lembra de reunião com o João amanhã às 10', 'Reunião com o João', '2026-10-24', '10:00'],
  ])('%s', (text, title, date, time) => {
    expect(parse(text)).toEqual({ kind: 'event', title, date, time });
  });

  it('sem hora: compromisso com a hora em aberto', () => {
    expect(parse('dentista dia 30')).toEqual({ kind: 'event', title: 'Dentista', date: '2026-10-30', time: null });
  });
});

describe('frases que não dá para entender', () => {
  it.each(['', 'oi', 'como está meu mês?', 'dia 31/02 às 10h reunião', 'x'.repeat(301)])('"%s"', (text) => {
    expect(parse(text).kind).toBe('unknown');
  });

  it('data de hoje inválida', () => {
    expect(parseQuickEntry('gastei 10', { today: 'ontem' }).kind).toBe('unknown');
  });

  it('emoji não desalinha o texto', () => {
    expect(parse('gastei 20 no 🍕 rodízio')).toMatchObject({ amountCents: 2000, description: '🍕 rodízio' });
  });
});
