import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildCsv, buildXlsx, toExportRows } from './export';
import type { Card, Category, Goal, Transaction } from '../store/finance';

const categories: Category[] = [{ id: 'c1', name: 'Mercado', color: '#F6A75D', kind: 'expense' }];
const links = { cardId: null, invoiceMonth: null, purchaseId: null, installmentNumber: null, installmentTotal: null, billId: null, billPeriod: null };
const transactions: Transaction[] = [
  { id: 't1', type: 'expense', amountCents: 4590, currency: 'BRL', categoryId: 'c1', occurredOn: '2026-10-22', description: 'Compras; da "semana"', ...links },
  { id: 't2', type: 'income', amountCents: 500000, currency: 'BRL', categoryId: null, occurredOn: '2026-10-05', description: '=HYPERLINK("http://x")', ...links },
];
const cards: Card[] = [{ id: 'nu', name: 'Nubank', color: '#8A05BE', currency: 'BRL', limitCents: null, closingDay: 5, dueDay: 12, archived: false }];
const goals: Goal[] = [{ id: 'g1', name: 'Viagem', currency: 'BRL', targetCents: 300000, savedCents: 75000, deadline: '2027-07-01' }];

describe('toExportRows', () => {
  it('traduz tipo, valor, categoria e forma de pagamento', () => {
    const rows = toExportRows(transactions, categories);
    expect(rows[0]).toEqual({
      data: '2026-10-22', tipo: 'Despesa', valor: 45.9, moeda: 'BRL', categoria: 'Mercado', descricao: 'Compras; da "semana"', pagamento: 'À vista',
    });
    expect(rows[1].categoria).toBe('Sem categoria');
    expect(rows[1].pagamento).toBe('');
  });

  it('mostra o cartão e a parcela', () => {
    const parcel = { ...transactions[0], cardId: 'nu', invoiceMonth: '2026-11', purchaseId: 'p', installmentNumber: 2, installmentTotal: 3 };
    expect(toExportRows([parcel], categories, cards)[0].pagamento).toBe('Cartão Nubank (2/3)');
    expect(toExportRows([{ ...parcel, installmentNumber: null, installmentTotal: null }], categories, cards)[0].pagamento).toBe('Cartão Nubank');
  });
});

describe('buildCsv', () => {
  const csv = buildCsv(toExportRows(transactions, categories));
  const lines = csv.slice(1).split('\r\n');

  it('começa com BOM e cabeçalho em português', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe('Data;Tipo;Valor;Moeda;Categoria;Descrição;Pagamento');
  });

  it('usa vírgula decimal e escapa ponto e vírgula e aspas', () => {
    expect(lines[1]).toBe('2026-10-22;Despesa;45,90;BRL;Mercado;"Compras; da ""semana""";À vista');
  });

  it('neutraliza fórmulas digitadas pelo usuário', () => {
    expect(lines[2]).toBe('2026-10-05;Receita;5000,00;BRL;Sem categoria;"\'=HYPERLINK(""http://x"")";');
  });
});

describe('buildXlsx', () => {
  it('gera uma planilha válida com lançamentos e metas', async () => {
    const bytes = await buildXlsx(toExportRows(transactions, categories), goals);
    const book = XLSX.read(new Uint8Array(bytes), { type: 'array' });
    expect(book.SheetNames).toEqual(['Lançamentos', 'Metas']);

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['Lançamentos']);
    expect(rows[0]).toMatchObject({ Data: '2026-10-22', Tipo: 'Despesa', Valor: 45.9, Categoria: 'Mercado', Pagamento: 'À vista' });
    expect(rows[1].Valor).toBe(5000);

    const metas = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Metas);
    expect(metas).toEqual([{ Meta: 'Viagem', Moeda: 'BRL', Objetivo: 3000, Guardado: 750, Prazo: '2027-07-01' }]);
  });

  it('texto que parece fórmula fica como texto', async () => {
    const bytes = await buildXlsx(toExportRows(transactions, categories), []);
    const book = XLSX.read(new Uint8Array(bytes), { type: 'array', cellFormula: true });
    const sheet = book.Sheets['Lançamentos'];
    expect(book.SheetNames).toEqual(['Lançamentos']);
    expect(sheet.F3.t).toBe('s');
    expect(sheet.F3.f).toBeUndefined();
    expect(sheet.F3.v).toBe('=HYPERLINK("http://x")');
  });
});
