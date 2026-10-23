import type { Card, Goal, Transaction, Category } from '../store/finance';
import { formatMoney, type Currency } from './finance';
import { formatLongDate, parseDateKey } from './dates';

export interface ExportRow {
  data: string;
  tipo: string;
  valor: number;
  moeda: Currency;
  categoria: string;
  descricao: string;
  /** "À vista", "Cartão Nubank" ou "Cartão Nubank (2/3)". */
  pagamento: string;
}

const paymentLabel = (t: Transaction, cards: Card[]): string => {
  if (!t.cardId) return t.type === 'income' ? '' : 'À vista';
  const name = cards.find((c) => c.id === t.cardId)?.name ?? 'cartão';
  const parcel = t.installmentNumber && t.installmentTotal ? ` (${t.installmentNumber}/${t.installmentTotal})` : '';
  return `Cartão ${name}${parcel}`;
};

export const toExportRows = (items: Transaction[], categories: Category[], cards: Card[] = []): ExportRow[] =>
  items.map((t) => ({
    data: t.occurredOn,
    tipo: t.type === 'income' ? 'Receita' : 'Despesa',
    valor: t.amountCents / 100,
    moeda: t.currency,
    categoria: categories.find((c) => c.id === t.categoryId)?.name ?? 'Sem categoria',
    descricao: t.description,
    pagamento: paymentLabel(t, cards),
  }));

/** Texto que começa com = + - @ viraria fórmula no Excel: o apóstrofo faz a célula ser lida como texto. */
const neutralizeFormula = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const csvCell = (value: string | number): string => {
  const text = typeof value === 'string' ? neutralizeFormula(value) : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

/** Conteúdo do CSV: ponto e vírgula e BOM, para abrir direto no Excel em português. */
export const buildCsv = (rows: ExportRow[]): string => {
  const header = ['Data', 'Tipo', 'Valor', 'Moeda', 'Categoria', 'Descrição', 'Pagamento'].join(';');
  const lines = rows.map((r) => [
    r.data,
    r.tipo,
    r.valor.toFixed(2).replace('.', ','),
    r.moeda,
    r.categoria,
    r.descricao,
    r.pagamento,
  ].map(csvCell).join(';'));
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
};

export const downloadCsv = (rows: ExportRow[], fileName: string): void => {
  triggerDownload(new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' }), fileName);
};

/**
 * Planilha .xlsx com lançamentos e metas, como bytes. A biblioteca (SheetJS, versão oficial do CDN da SheetJS)
 * só é carregada quando usada. Os textos viram células de texto, nunca fórmulas, mesmo começando com "=".
 */
export const buildXlsx = async (rows: ExportRow[], goals: Goal[]): Promise<ArrayBuffer> => {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const transactionsSheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
    Data: r.data,
    Tipo: r.tipo,
    Valor: r.valor,
    Moeda: r.moeda,
    Categoria: r.categoria,
    Descrição: r.descricao,
    Pagamento: r.pagamento,
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

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
};

export const downloadXlsx = async (rows: ExportRow[], goals: Goal[], fileName: string): Promise<void> => {
  const bytes = await buildXlsx(rows, goals);
  triggerDownload(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName,
  );
};

/** Rótulo legível da data para mensagens. */
export const describeDay = (key: string): string => formatLongDate(parseDateKey(key));
export const describeMoney = (cents: number, currency: Currency): string => formatMoney(cents, currency);
