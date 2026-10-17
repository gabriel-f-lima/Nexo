import { addDays, toISODate, weekStart } from './dates';

export type Period = 'week' | 'month' | 'quarter' | 'semester' | 'year';

export const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'semester', label: 'Semestre' },
  { value: 'year', label: 'Ano' },
];

export interface Bucket {
  label: string;
  /** Filtro: 'AAAA-MM-DD' para dias ou 'AAAA-MM' para meses. */
  key: string;
  granularity: 'day' | 'month';
}

export interface PeriodRange {
  start: string;
  end: string;
  label: string;
  buckets: Bucket[];
}

const WEEK_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Intervalo do período que contém a data de referência, com os intervalos do gráfico. */
export const periodRange = (period: Period, ref: Date): PeriodRange => {
  if (period === 'week') {
    const start = weekStart(ref);
    const buckets: Bucket[] = WEEK_LABELS.map((label, i) => ({
      label, key: toISODate(addDays(start, i)), granularity: 'day',
    }));
    const end = addDays(start, 6);
    return { start: toISODate(start), end: toISODate(end), label: `${toISODate(start)} a ${toISODate(end)}`, buckets };
  }

  if (period === 'month') {
    const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const count = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
    const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
      label: String(i + 1), key: toISODate(addDays(first, i)), granularity: 'day',
    }));
    return {
      start: toISODate(first),
      end: toISODate(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)),
      label: `${MONTH_NAMES[ref.getMonth()]} de ${ref.getFullYear()}`,
      buckets,
    };
  }

  const monthsCount = period === 'quarter' ? 3 : period === 'semester' ? 6 : 12;
  const firstMonth = period === 'year'
    ? 0
    : period === 'quarter'
      ? Math.floor(ref.getMonth() / 3) * 3
      : ref.getMonth() < 6 ? 0 : 6;
  const first = new Date(ref.getFullYear(), firstMonth, 1);
  const last = new Date(ref.getFullYear(), firstMonth + monthsCount, 0);
  const buckets: Bucket[] = Array.from({ length: monthsCount }, (_, i) => {
    const d = new Date(ref.getFullYear(), firstMonth + i, 1);
    return { label: MONTH_SHORT[d.getMonth()], key: monthKey(d), granularity: 'month' };
  });
  const name = period === 'year'
    ? `${ref.getFullYear()}`
    : period === 'quarter'
      ? `${Math.floor(ref.getMonth() / 3) + 1}º trimestre de ${ref.getFullYear()}`
      : `${firstMonth === 0 ? '1º' : '2º'} semestre de ${ref.getFullYear()}`;
  return { start: toISODate(first), end: toISODate(last), label: name, buckets };
};

/** Move a referência para o período anterior (-1) ou seguinte (1). */
export const shiftReference = (period: Period, ref: Date, direction: 1 | -1): Date => {
  if (period === 'week') return addDays(ref, 7 * direction);
  const months = period === 'month' ? 1 : period === 'quarter' ? 3 : period === 'semester' ? 6 : 12;
  return new Date(ref.getFullYear(), ref.getMonth() + months * direction, 1);
};

/** Verdadeiro se o lançamento (AAAA-MM-DD) cai dentro do bucket. */
export const inBucket = (occurredOn: string, bucket: Bucket): boolean =>
  bucket.granularity === 'day' ? occurredOn === bucket.key : occurredOn.startsWith(bucket.key);
