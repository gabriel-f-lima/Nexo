import { currentTier, LIMITS, type Tier } from './billing';
import { toISODate } from './dates';
import { foldName } from '../../supabase/functions/_shared/quickEntry';
import type { TransactionType } from './finance';

/* Regras de plano usadas em mais de uma tela, e a escolha de categoria a partir de um texto. */

/** Mensagem de limite de compromissos no dia, ou null se ainda cabe mais um. */
export const eventLimitMessage = (tier: Tier, events: Array<{ start: string }>, dateKey: string): string | null => {
  const max = LIMITS[tier].eventsPerDay;
  if (max === null) return null;
  const sameDay = events.filter((e) => toISODate(new Date(e.start)) === dateKey).length;
  if (sameDay < max) return null;
  return tier === 'free'
    ? `No plano gratuito você tem até ${max} compromissos por dia. Assine para ter mais.`
    : `Você já tem ${max} compromissos neste dia, o limite do seu plano. Assine o Pro para compromissos ilimitados.`;
};

/** Confere no servidor o plano e, se couber, devolve null; senão, a mensagem do limite. */
export const checkEventLimit = async (userId: string, events: Array<{ start: string }>, dateKey: string): Promise<string | null> =>
  eventLimitMessage(await currentTier(userId), events, dateKey);

export const habitLimitMessage = (tier: Tier, count: number): string | null => {
  const max = LIMITS[tier].habits;
  if (max === null || count < max) return null;
  return tier === 'free'
    ? `Você já tem ${max} metas de rotina, o limite do plano gratuito. Exclua uma para criar outra, ou assine para ter mais.`
    : `Você já tem ${max} metas de rotina, o limite do seu plano. Assine o Pro para metas ilimitadas.`;
};

export const monthlyEntriesMessage = (tier: Tier, monthCount: number): string | null => {
  const max = LIMITS[tier].monthlyEntries;
  if (max === null || monthCount < max) return null;
  return `Seu plano permite até ${max} lançamentos por mês. Assine o Pro para lançamentos ilimitados.`;
};

/**
 * Categoria do usuário que melhor combina com o texto: nome igual, nome contido no texto,
 * ou um dos nomes sugeridos (ex.: "Mercado" → "Alimentação"). Null se nenhuma servir.
 */
export const matchCategory = <C extends { id: string; name: string; kind: TransactionType }>(
  categories: C[],
  type: TransactionType,
  text: string,
  hints: string[] = [],
): C | null => {
  const options = categories.filter((c) => c.kind === type);
  const folded = foldName(text);
  if (folded) {
    const exact = options.find((c) => foldName(c.name) === folded);
    if (exact) return exact;
    const contained = options.find((c) => {
      const name = foldName(c.name);
      return name.length >= 3 && new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(folded);
    });
    if (contained) return contained;
  }
  for (const hint of hints) {
    const match = options.find((c) => foldName(c.name) === foldName(hint));
    if (match) return match;
  }
  return null;
};
