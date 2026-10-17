// Recebe eventos da Stripe e mantém nexo_subscriptions atualizada.
// Deve ser publicada com --no-verify-jwt (a Stripe não envia token do Supabase).
import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Mapeia o ID do preço da Stripe para o plano (basico | pro), usando os mesmos secrets do checkout.
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
  const signature = req.headers.get('stripe-signature');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (req.method !== 'POST' || !signature || !secret || !stripeKey) return new Response('Requisição inválida', { status: 400 });

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return new Response('Assinatura inválida', { status: 400 });
  }

  if (!event.type.startsWith('customer.subscription.')) {
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let userId = sub.metadata?.user_id as string | undefined;
  if (!userId) {
    const { data } = await admin.from('nexo_subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    userId = data?.user_id as string | undefined;
  }
  if (!userId) return new Response(JSON.stringify({ received: true }), { status: 200 });

  const item = sub.items.data[0];
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? item?.current_period_end;

  const { error } = await admin.from('nexo_subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
    price_id: item?.price.id ?? null,
    plan: planFromPrice(item?.price.id) ?? (sub.metadata?.plan as string | undefined) ?? null,
    interval: item?.price.recurring?.interval ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  // Conta já excluída (23503): não há o que atualizar; a Stripe não deve reenviar.
  if (error && error.code !== '23503') return new Response('Falha ao salvar', { status: 500 });
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
