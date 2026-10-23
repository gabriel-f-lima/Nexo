export const CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];
export type TransactionType = 'income' | 'expense';

export const CURRENCY_LABEL: Record<Currency, string> = {
  BRL: 'Real (R$)',
  USD: 'Dólar (US$)',
  EUR: 'Euro (€)',
};

export const CATEGORY_COLORS = ['#5AF0AA', '#83B5FF', '#F6A75D', '#FF7185', '#C9A7FF', '#F6C35D', '#7DD3FC', '#A1ADA6'];

export interface CategoryDef {
  id: string;
  name: string;
  color: string;
  kind: TransactionType;
}

/** Sugestões criadas uma única vez no primeiro acesso. O usuário pode editar ou apagar. */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'default-alimentacao', name: 'Alimentação', color: '#F6A75D', kind: 'expense' },
  { id: 'default-transporte', name: 'Transporte', color: '#83B5FF', kind: 'expense' },
  { id: 'default-moradia', name: 'Moradia', color: '#FF7185', kind: 'expense' },
  { id: 'default-lazer', name: 'Lazer', color: '#C9A7FF', kind: 'expense' },
  { id: 'default-salario', name: 'Salário', color: '#5AF0AA', kind: 'income' },
];

export const MAX_AMOUNT_CENTS = 100_000_000_000; // 1 bilhão na moeda

/**
 * Converte o texto digitado em centavos.
 * Aceita "1.234,56", "1234,56", "1234.56", "1.234" (milhar) e "12". Retorna null se for inválido.
 */
export const parseAmountToCents = (raw: string): number | null => {
  let text = raw.trim().replace(/\s/g, '').replace(/^(R\$|US\$|€|\$)/, '');
  if (!text) return null;
  if (text.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d*$|^\d+,\d*$/.test(text)) return null;
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // Só pontos a cada três dígitos: separador de milhar, como se escreve no Brasil.
    text = text.replace(/\./g, '');
  }
  if (text.endsWith('.')) text = text.slice(0, -1);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
};

/** Texto para o campo de valor, sem símbolo de moeda (ex.: 1234,5 → "1.234,50"). */
export const centsToInput = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (cents: number, currency: Currency): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

/** 'AAAA-MM' para filtrar um mês. */
export const monthKeyOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export interface CurrencyTotals {
  currency: Currency;
  income: number;
  expense: number;
  balance: number;
}

/** Totais separados por moeda. Não há conversão entre moedas. */
export const totalsByCurrency = (items: Array<{ type: TransactionType; amountCents: number; currency: Currency }>): CurrencyTotals[] =>
  CURRENCIES.map((currency) => {
    const scoped = items.filter((item) => item.currency === currency);
    const income = scoped.filter((i) => i.type === 'income').reduce((sum, i) => sum + i.amountCents, 0);
    const expense = scoped.filter((i) => i.type === 'expense').reduce((sum, i) => sum + i.amountCents, 0);
    return { currency, income, expense, balance: income - expense };
  }).filter((total) => items.some((item) => item.currency === total.currency));
