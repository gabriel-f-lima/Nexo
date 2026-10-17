// Atualiza nexo_subscriptions direto da Stripe, sem depender do webhook.
import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const PLAN_BY_PRICE_ENV: Array<[string, string]> = [
  ['STRIPE_PRICE_BASICO_MONTHLY', 'basico'],
  ['STRIPE_PRICE_BASICO_YEARLY', 'basico'],
  ['STRIPE_PRICE_PRO_MONTHLY', 'pro'],
  ['STRIPE_PRICE_PRO_YEARLY', 'pro'],
];
const planFromPrice = (priceId: string | undefined | null): string | null => {
  if (!priceId) return null;
  for (const [envName, plan] of PLAN_BY_PRICE_ENV) {
    if (Deno.env.get(envName) === priceId) return plan;
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Sessão inválida.' }, 401);
    const user = userData.user;

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });

    const { data: row } = await admin
      .from('nexo_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const customerId = row?.stripe_customer_id as string | undefined;
    if (!customerId) return json({ status: 'none', plan: null });

    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    const sub = list.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status)) ?? list.data[0];
    if (!sub) return json({ status: 'none', plan: null });

    const item = sub.items.data[0];
    const priceId = item?.price.id ?? null;
    const active = sub.status === 'active' || sub.status === 'trialing';
    const plan = planFromPrice(priceId)
      ?? (sub.metadata?.plan as string | undefined)
      ?? (active ? 'basico' : null);
    const periodEnd = item?.current_period_end
      ?? (sub as unknown as { current_period_end?: number }).current_period_end;

    const { error } = await admin.from('nexo_subscriptions').upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: priceId,
      plan,
      interval: item?.price.recurring?.interval ?? null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;

    return json({ status: sub.status, plan });
  } catch (error) {
    console.error('stripe-sync', error);
    return json({ error: 'Não foi possível atualizar sua assinatura.' }, 500);
  }
});
