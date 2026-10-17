import { addDays, parseDateKey, toISODate } from './dates';

/** Metas (hábitos) só podem ser marcadas hoje ou no dia anterior. Dias passados e futuros ficam para consulta. */
export const canEditHabitDay = (dateKey: string): boolean => {
  const today = toISODate();
  const yesterday = toISODate(addDays(parseDateKey(today), -1));
  return dateKey === today || dateKey === yesterday;
};

/** Dia anterior a hoje: somente consulta para compromissos. */
export const isPastDay = (dateKey: string): boolean => dateKey < toISODate();

/** Compromisso com data de início anterior a hoje: somente consulta. */
export const isPastEvent = (startIso: string): boolean => isPastDay(toISODate(new Date(startIso)));

/** Lançamentos de receitas e despesas: hoje, ontem e datas futuras. Dias anteriores a ontem ficam só para consulta. */
export const canEditFinanceDay = (dateKey: string): boolean => {
  const today = toISODate();
  const yesterday = toISODate(addDays(parseDateKey(today), -1));
  return dateKey >= yesterday;
};

/** Menor data aceita para lançamentos (ontem). */
export const earliestFinanceDay = (): string => toISODate(addDays(parseDateKey(toISODate()), -1));
