// Exclui a conta do usuário autenticado e, em cascata, todos os seus dados.
// Só funciona se a sessão foi confirmada há pouco (código enviado por e-mail).
import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const RECENT_LOGIN_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sessão ausente.' }, 401);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Sessão inválida.' }, 401);

  const user = userData.user;
  const lastLogin = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
  if (Date.now() - lastLogin > RECENT_LOGIN_MS) {
    return json({ error: 'Confirme novamente com o código enviado ao seu e-mail.', code: 'reauth_required' }, 403);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Cancela a assinatura antes de apagar a conta, para não haver cobranças depois da exclusão.
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (stripeKey) {
    const { data: sub } = await admin
      .from('nexo_subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();
    const billable = ['active', 'trialing', 'past_due', 'unpaid'].includes(sub?.status ?? '');
    if (sub?.stripe_subscription_id && billable) {
      const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } catch {
        return json({ error: 'Não foi possível cancelar sua assinatura. Tente novamente ou fale com o suporte.' }, 500);
      }
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return json({ error: 'Não foi possível excluir a conta. Tente novamente.' }, 500);

  return json({ ok: true });
});
