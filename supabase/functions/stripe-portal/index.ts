// Abre o portal de cliente da Stripe (trocar cartão, ver faturas, cancelar).
import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await admin
    .from('nexo_subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!data?.stripe_customer_id) return json({ error: 'Você ainda não tem uma assinatura.' }, 404);

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const portal = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${appUrl}/app/configuracoes`,
  });

  return json({ url: portal.url });
};

// Qualquer falha inesperada vira uma resposta JSON com CORS, em vez de quebrar a função.
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('stripe-portal', error);
    return json({ error: 'Não foi possível abrir o portal. Tente novamente.' }, 500);
  }
});
