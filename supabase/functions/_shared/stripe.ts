// Stripe no servidor: lista de preços permitidos, mapa preço → plano e sincronização da assinatura com o banco.
// O plano gravado vem sempre do preço lido na própria Stripe, nunca de dados enviados pelo navegador ou de metadados.
import Stripe from 'npm:stripe@17.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';
import { logSecurityEvent } from './security.ts';

export { Stripe };

export type PlanId = 'basico' | 'pro';
export type Interval = 'monthly' | 'yearly';

export const isPlanId = (value: unknown): value is PlanId => value === 'basico' || value === 'pro';
export const isInterval = (value: unknown): value is Interval => value === 'monthly' || value === 'yearly';

/** Um secret por plano e intervalo. São os únicos preços que o checkout aceita. */
export const PRICE_ENV: Record<`${PlanId}_${Interval}`, string> = {
  basico_monthly: 'STRIPE_PRICE_BASICO_MONTHLY',
  basico_yearly: 'STRIPE_PRICE_BASICO_YEARLY',
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_yearly: 'STRIPE_PRICE_PRO_YEARLY',
};

export const priceIdFor = (plan: PlanId, interval: Interval): string | null =>
  Deno.env.get(PRICE_ENV[`${plan}_${interval}`])?.trim() || null;

/**
 * Plano de um preço. Além dos quatro preços atuais, aceita preços antigos que ainda tenham assinantes em
 * STRIPE_LEGACY_PRICES, no formato "price_abc:basico,price_def:pro". Preço desconhecido = sem plano.
 */
export const planFromPrice = (priceId: string | null | undefined): PlanId | null => {
  if (!priceId) return null;
  for (const [key, envName] of Object.entries(PRICE_ENV)) {
    if (Deno.env.get(envName)?.trim() === priceId) return key.split('_')[0] as PlanId;
  }
  for (const pair of (Deno.env.get('STRIPE_LEGACY_PRICES') ?? '').split(',')) {
    const [id, plan] = pair.split(':').map((part) => part.trim());
    if (id === priceId && isPlanId(plan)) return plan;
  }
  return null;
};

export const stripeClient = (): Stripe => {
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (!key) throw new HttpError(503, 'Pagamentos indisponíveis no momento. Tente mais tarde.', 'not_configured');
  // Tempo limite por chamada e novas tentativas automáticas (a biblioteca repete com a mesma chave de idempotência).
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), timeout: 15000, maxNetworkRetries: 2 });
};

export const isLiveKey = (): boolean => (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_live_')
  || (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('rk_live_');

export const idOf = (value: string | { id: string } | null | undefined): string | null =>
  !value ? null : typeof value === 'string' ? value : value.id;

/** Status que liberam o plano. */
export const PAID_STATUSES = new Set(['active', 'trialing']);
/** Status de uma assinatura que ainda existe na Stripe (não deve haver outra paralela). */
export const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);

const STATUS_ORDER = ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'canceled'];

/** Item da assinatura que corresponde a um plano conhecido (o Pro tem prioridade). */
export const planItem = (sub: Stripe.Subscription): { item: Stripe.SubscriptionItem; plan: PlanId } | null => {
  const known = sub.items.data
    .map((item) => ({ item, plan: planFromPrice(item.price?.id) }))
    .filter((entry): entry is { item: Stripe.SubscriptionItem; plan: PlanId } => entry.plan !== null);
  return known.find((entry) => entry.plan === 'pro') ?? known[0] ?? null;
};

/** A assinatura que define o plano: a de melhor status (ativa primeiro) e, no empate, a mais recente. */
const pickSubscription = (subs: Stripe.Subscription[]): Stripe.Subscription | null => {
  const rank = (s: Stripe.Subscription) => {
    const index = STATUS_ORDER.indexOf(s.status);
    return index === -1 ? STATUS_ORDER.length : index;
  };
  return [...subs].sort((a, b) => rank(a) - rank(b) || b.created - a.created)[0] ?? null;
};

export interface SyncResult {
  status: string;
  plan: PlanId | null;
}

/**
 * Lê da Stripe as assinaturas do cliente e grava o estado no banco. Usada pelo webhook, pela sincronização
 * e após o upgrade. Leituras mais antigas que a última gravada são ignoradas pelo banco (eventos fora de ordem).
 */
export const syncCustomer = async (
  admin: SupabaseClient,
  stripe: Stripe,
  customerId: string,
  userId: string,
  event?: { id: string; createdAt: string },
): Promise<SyncResult> => {
  const syncedAt = new Date().toISOString();
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  const sub = pickSubscription(list.data);
  const match = sub ? planItem(sub) : null;
  const item = match?.item ?? sub?.items.data[0] ?? null;
  const plan = match?.plan ?? null;
  const status = sub?.status ?? 'none';

  if (sub && PAID_STATUSES.has(status) && !plan) {
    // Assinatura paga num preço fora da lista: não libera nada até o preço ser cadastrado (STRIPE_LEGACY_PRICES).
    await logSecurityEvent(admin, {
      source: 'stripe-sync',
      kind: 'unknown_price',
      userId,
      detail: { subscription: sub.id, price: item?.price?.id ?? null },
    });
  }

  const periodEnd = (sub as unknown as { current_period_end?: number } | null)?.current_period_end
    ?? (item as unknown as { current_period_end?: number } | null)?.current_period_end;

  const { error } = await admin.rpc('nexo_apply_subscription', {
    p_user_id: userId,
    p_customer_id: customerId,
    p_subscription_id: sub?.id ?? null,
    p_status: status,
    p_price_id: item?.price?.id ?? null,
    p_plan: plan,
    p_interval: item?.price?.recurring?.interval ?? null,
    p_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_cancel_at_period_end: sub?.cancel_at_period_end ?? false,
    p_synced_at: syncedAt,
    p_event_id: event?.id ?? null,
    p_event_at: event?.createdAt ?? null,
  });
  // Conta excluída no meio do caminho (23503): não há o que atualizar.
  if (error && error.code !== '23503') throw new Error(`nexo_apply_subscription: ${error.message}`);

  if (PAID_STATUSES.has(status)) {
    await admin.from('nexo_billing_checkouts').delete().eq('user_id', userId);
  }
  return { status, plan };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Usuário dono de um cliente da Stripe. Primeiro pelo vínculo no banco; se não houver, pelo user_id que o próprio
 * servidor gravou no cliente ao criá-lo (o cliente da Stripe não consegue alterar esse campo).
 */
export const userForCustomer = async (admin: SupabaseClient, stripe: Stripe, customerId: string): Promise<string | null> => {
  const { data, error } = await admin
    .from('nexo_subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw new Error(`nexo_subscriptions: ${error.message}`);
  if (data?.user_id) return data.user_id as string;

  const customer = await stripe.customers.retrieve(customerId);
  if ((customer as Stripe.DeletedCustomer).deleted) return null;
  const userId = (customer as Stripe.Customer).metadata?.user_id;
  if (!userId || !UUID.test(userId)) return null;

  const { data: found } = await admin.auth.admin.getUserById(userId);
  if (!found?.user) return null;

  const { data: linked, error: linkError } = await admin.rpc('nexo_link_customer', { p_user_id: userId, p_customer_id: customerId });
  if (linkError || linked !== customerId) {
    await logSecurityEvent(admin, {
      source: 'stripe-webhook',
      kind: 'customer_mismatch',
      userId,
      detail: { customer: customerId, linked: linked ?? null },
    });
    return null;
  }
  return userId;
};
