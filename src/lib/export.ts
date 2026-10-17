import * as XLSX from 'xlsx';
import type { Goal, Transaction, Category } from '../store/finance';
import { formatMoney, type Currency } from './finance';
import { formatLongDate, parseDateKey } from './dates';

export interface ExportRow {
  data: string;
  tipo: string;
  valor: number;
  moeda: Currency;
  categoria: string;
  descricao: string;
}

export const toExportRows = (items: Transaction[], categories: Category[]): ExportRow[] =>
  items.map((t) => ({
    data: t.occurredOn,
    tipo: t.type === 'income' ? 'Receita' : 'Despesa',
    valor: t.amountCents / 100,
    moeda: t.currency,
    categoria: categories.find((c) => c.id === t.categoryId)?.name ?? 'Sem categoria',
    descricao: t.description,
  }));

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** CSV com ponto e vírgula e BOM, para abrir direto no Excel em português. */
export const downloadCsv = (rows: ExportRow[], fileName: string): void => {
  const header = ['Data', 'Tipo', 'Valor', 'Moeda', 'Categoria', 'Descrição'].join(';');
  const lines = rows.map((r) => [
    r.data,
    r.tipo,
    r.valor.toFixed(2).replace('.', ','),
    r.moeda,
    r.categoria,
    r.descricao,
  ].map(csvCell).join(';'));
  const content = `\uFEFF${[header, ...lines].join('\r\n')}`;
  triggerDownload(new Blob([content], { type: 'text/csv;charset=utf-8' }), fileName);
};

/** Planilha .xlsx com lançamentos e metas. */
export const downloadXlsx = (rows: ExportRow[], goals: Goal[], fileName: string): void => {
  const workbook = XLSX.utils.book_new();
  const transactionsSheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
    Data: r.data,
    Tipo: r.tipo,
    Valor: r.valor,
    Moeda: r.moeda,
    Categoria: r.categoria,
    Descrição: r.descricao,
  })));
  XLSX.utils.book_append_sheet(workbook, transactionsSheet, 'Lançamentos');

  if (goals.length) {
    const goalsSheet = XLSX.utils.json_to_sheet(goals.map((g) => ({
      Meta: g.name,
      Moeda: g.currency,
      Objetivo: g.targetCents / 100,
      Guardado: g.savedCents / 100,
      Prazo: g.deadline ?? '',
    })));
    XLSX.utils.book_append_sheet(workbook, goalsSheet, 'Metas');
  }

  XLSX.writeFile(workbook, fileName);
};

/** Rótulo legível da data para mensagens. */
export const describeDay = (key: string): string => formatLongDate(parseDateKey(key));
export const describeMoney = (cents: number, currency: Currency): string => formatMoney(cents, currency);
