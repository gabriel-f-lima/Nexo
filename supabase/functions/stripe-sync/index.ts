// Atualiza nexo_subscriptions direto da Stripe, sem depender do webhook (por exemplo, logo após o checkout).
// Só sincroniza o cliente vinculado ao usuário logado; o plano vem do preço lido na Stripe.
import { clientIp, errorResponse, http, type Http } from '../_shared/http.ts';
import { adminClient, ipKey, rateLimit, requireUser } from '../_shared/security.ts';
import { stripeClient, syncCustomer } from '../_shared/stripe.ts';

const SOURCE = 'stripe-sync';

const handle = async (req: Request, h: Http): Promise<Response> => {
  if (req.method === 'OPTIONS') return h.preflight();
  if (!h.originAllowed) return h.json({ error: 'Origem não permitida.' }, 403);
  if (req.method !== 'POST') return h.json({ error: 'Método não permitido.' }, 405);

  const admin = adminClient();
  const ip = clientIp(req);

  await rateLimit(admin, [{ bucket: `sync:ip:${await ipKey(ip)}`, limit: 60, windowSeconds: 600, blockSeconds: 1800 }], { source: SOURCE, ip });
  const user = await requireUser(req, admin);
  await rateLimit(admin, [{ bucket: `sync:user:${user.id}`, limit: 15, windowSeconds: 600, blockSeconds: 600 }], { source: SOURCE, ip, userId: user.id });

  const { data: row, error } = await admin
    .from('nexo_subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error(`nexo_subscriptions: ${error.message}`);
  const customerId = row?.stripe_customer_id as string | undefined;
  if (!customerId) return h.json({ status: 'none', plan: null, tier: 'free' });

  const result = await syncCustomer(admin, stripeClient(), customerId, user.id);
  const { data: tier } = await admin.rpc('nexo_tier_of', { p_user_id: user.id });
  return h.json({ status: result.status, plan: result.plan, tier: typeof tier === 'string' ? tier : 'free' });
};

Deno.serve(async (req) => {
  const h = http(req);
  try {
    return await handle(req, h);
  } catch (error) {
    return errorResponse(h, SOURCE, error);
  }
});
