// Upgrade de Básico para Pro com cobrança proporcional: cobra a diferença agora e o valor cheio nas próximas renovações.
import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

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

    let body: { action?: string } = {};
    try { body = await req.json(); } catch { /* corpo vazio */ }
    const action = body.action === 'confirm' ? 'confirm' : 'preview';

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });

    const { data: row } = await admin
      .from('nexo_subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status, plan')
      .eq('user_id', user.id)
      .maybeSingle();
    const active = row?.status === 'active' || row?.status === 'trialing';
    if (!row || !active || !row.stripe_subscription_id || !row.stripe_customer_id) {
      return json({ error: 'Você não tem uma assinatura ativa para atualizar.' }, 409);
    }
    if (row.plan === 'pro') return json({ error: 'Você já está no plano Pro.' }, 409);

    const subId = row.stripe_subscription_id as string;
    const sub = await stripe.subscriptions.retrieve(subId);
    const item = sub.items.data[0];
    const interval = item?.price.recurring?.interval === 'year' ? 'year' : 'month';
    const targetPrice = Deno.env.get(interval === 'year' ? 'STRIPE_PRICE_PRO_YEARLY' : 'STRIPE_PRICE_PRO_MONTHLY');
    if (!targetPrice) return json({ error: 'Plano Pro não configurado no servidor.' }, 500);

    if (action === 'preview') {
      const upcoming = await stripe.invoices.retrieveUpcoming({
        customer: row.stripe_customer_id as string,
        subscription: subId,
        subscription_items: [{ id: item.id, price: targetPrice }],
        subscription_proration_behavior: 'always_invoice',
      });
      return json({
        amountNowCents: upcoming.amount_due,
        currency: upcoming.currency.toUpperCase(),
        interval,
      });
    }

    const updated = await stripe.subscriptions.update(subId, {
      items: [{ id: item.id, price: targetPrice }],
      proration_behavior: 'always_invoice',
      metadata: { ...(sub.metadata ?? {}), plan: 'pro' },
    });

    const { error } = await admin.from('nexo_subscriptions').update({
      plan: 'pro',
      price_id: targetPrice,
      status: updated.status,
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id);
    if (error) throw error;

    return json({ status: updated.status });
  } catch (error) {
    console.error('stripe-upgrade', error);
    return json({ error: 'Não foi possível atualizar o plano. Verifique o cartão e tente de novo.' }, 500);
  }
});
