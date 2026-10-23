// Abre o portal de cliente da Stripe (trocar cartão, ver faturas, cancelar).
// Sessão verificada no servidor, rate limit e URL de retorno fixa. STRIPE_PORTAL_CONFIGURATION (opcional)
// fixa qual configuração do portal é usada, para que ninguém troque para planos fora da lista.
import { appOrigin, clientIp, errorResponse, http, type Http } from '../_shared/http.ts';
import { adminClient, ipKey, rateLimit, requireUser } from '../_shared/security.ts';
import { stripeClient } from '../_shared/stripe.ts';

const SOURCE = 'stripe-portal';

const handle = async (req: Request, h: Http): Promise<Response> => {
  if (req.method === 'OPTIONS') return h.preflight();
  if (!h.originAllowed) return h.json({ error: 'Origem não permitida.' }, 403);
  if (req.method !== 'POST') return h.json({ error: 'Método não permitido.' }, 405);

  const app = appOrigin();
  const admin = adminClient();
  const ip = clientIp(req);

  await rateLimit(admin, [{ bucket: `portal:ip:${await ipKey(ip)}`, limit: 30, windowSeconds: 600, blockSeconds: 1800 }], { source: SOURCE, ip });
  const user = await requireUser(req, admin);
  await rateLimit(admin, [{ bucket: `portal:user:${user.id}`, limit: 10, windowSeconds: 600, blockSeconds: 900 }], { source: SOURCE, ip, userId: user.id });

  const { data, error } = await admin
    .from('nexo_subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error(`nexo_subscriptions: ${error.message}`);
  if (!data?.stripe_customer_id) return h.json({ error: 'Você ainda não tem uma assinatura.', code: 'no_customer' }, 404);

  const configuration = Deno.env.get('STRIPE_PORTAL_CONFIGURATION')?.trim();
  const portal = await stripeClient().billingPortal.sessions.create({
    customer: data.stripe_customer_id as string,
    return_url: `${app}/app/configuracoes`,
    ...(configuration ? { configuration } : {}),
  });

  return h.json({ url: portal.url });
};

Deno.serve(async (req) => {
  const h = http(req);
  try {
    return await handle(req, h);
  } catch (error) {
    return errorResponse(h, SOURCE, error);
  }
});
