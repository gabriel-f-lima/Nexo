// Cria a sessão de checkout de assinatura (mensal ou anual), com impostos e faturas automáticos.
import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
// Um secret de preço por plano e intervalo. Os nomes devem existir nos secrets do Supabase.
const PRICE_ENV: Record<string, string> = {
  basico_monthly: 'STRIPE_PRICE_BASICO_MONTHLY',
  basico_yearly: 'STRIPE_PRICE_BASICO_YEARLY',
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_yearly: 'STRIPE_PRICE_PRO_YEARLY',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sessão ausente.' }, 401);
  if (!stripeKey || !appUrl) return json({ error: 'Pagamentos não configurados no servidor.' }, 500);

  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Sessão inválida.' }, 401);
  const user = userData.user;

  let body: { plan?: string; interval?: string } = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const interval = body.interval === 'yearly' ? 'yearly' : 'monthly';
  const plan = typeof body.plan === 'string' ? body.plan : '';
  const priceEnv = PRICE_ENV[`${plan}_${interval}`];
  if (!priceEnv) return json({ error: 'Plano inválido.' }, 400);
  const price = Deno.env.get(priceEnv);
  if (!price) return json({ error: 'Plano não configurado no servidor.' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });

  const { data: existing, error: readError } = await admin
    .from('nexo_subscriptions')
    .select('stripe_customer_id, status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) return json({ error: 'Não foi possível verificar sua assinatura.' }, 500);
  if (existing?.status === 'active' || existing?.status === 'trialing') {
    return json({ error: 'Você já tem uma assinatura ativa. Use “Gerenciar assinatura”.' }, 409);
  }

  let customerId = existing?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const name = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? '') as string;
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: name || undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    const { error: saveError } = await admin.from('nexo_subscriptions').upsert(
      { user_id: user.id, stripe_customer_id: customerId, status: 'none', updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (saveError) return json({ error: 'Não foi possível preparar o pagamento.' }, 500);
  }

  // Confere na Stripe todos os clientes com este e-mail, porque o banco pode ter perdido o vínculo com o cliente antigo.
  const byEmail = user.email ? await stripe.customers.list({ email: user.email, limit: 10 }) : { data: [] };
  const customerIds = new Set<string>([customerId as string, ...byEmail.data.map((c) => c.id)]);
  for (const id of customerIds) {
    const subs = await stripe.subscriptions.list({ customer: id, status: 'all', limit: 10 });
    if (subs.data.some((s) => ['active', 'trialing', 'past_due'].includes(s.status))) {
      return json({ error: 'Você já tem uma assinatura ativa. Use “Gerenciar assinatura”.' }, 409);
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl}/app/configuracoes?checkout=success`,
    cancel_url: `${appUrl}/app/configuracoes?checkout=cancel`,
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    tax_id_collection: { enabled: true },
    subscription_data: { metadata: { user_id: user.id, plan } },
    locale: 'pt-BR',
    allow_promotion_codes: true,
  });

  return json({ url: session.url });
};

// Qualquer falha inesperada vira uma resposta JSON com CORS, em vez de quebrar a função.
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('stripe-checkout', error);
    return json({ error: 'Não foi possível iniciar o pagamento. Tente novamente.' }, 500);
  }
});
