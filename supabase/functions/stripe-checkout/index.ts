// Cria a sessão de checkout de assinatura (mensal ou anual).
// Proteções: sessão verificada no servidor, e-mail confirmado, rate limit por IP e por usuário, captcha opcional,
// preço só da lista do servidor, um cliente da Stripe por usuário, uma sessão aberta por vez (reaproveitada)
// e chaves de idempotência na Stripe. As URLs de retorno são fixas (APP_URL).
import { appOrigin, clientIp, errorResponse, http, readJsonBody, type Http } from '../_shared/http.ts';
import {
  acquireLock, adminClient, ipKey, logSecurityEvent, rateLimit, releaseLock, requirePayingUser, verifyCaptcha,
} from '../_shared/security.ts';
import { idOf, isInterval, isPlanId, LIVE_STATUSES, priceIdFor, stripeClient, syncCustomer } from '../_shared/stripe.ts';

const SOURCE = 'stripe-checkout';
/** Validade da sessão na Stripe (mínimo permitido: 30 minutos). */
const SESSION_TTL_MS = 60 * 60 * 1000;
/** Reaproveita a sessão aberta só se ainda faltar pelo menos isso para expirar. */
const REUSE_MARGIN_MS = 10 * 60 * 1000;

const handle = async (req: Request, h: Http): Promise<Response> => {
  if (req.method === 'OPTIONS') return h.preflight();
  if (!h.originAllowed) return h.json({ error: 'Origem não permitida.' }, 403);
  if (req.method !== 'POST') return h.json({ error: 'Método não permitido.' }, 405);

  const app = appOrigin();
  const admin = adminClient();
  const ip = clientIp(req);

  await rateLimit(admin, [{ bucket: `checkout:ip:${await ipKey(ip)}`, limit: 20, windowSeconds: 600, blockSeconds: 1800 }], { source: SOURCE, ip });
  const user = await requirePayingUser(req, admin);
  await rateLimit(admin, [{ bucket: `checkout:user:${user.id}`, limit: 8, windowSeconds: 600, blockSeconds: 900 }], { source: SOURCE, ip, userId: user.id });

  const body = await readJsonBody(req);
  if (!body || !isPlanId(body.plan) || !isInterval(body.interval)) return h.json({ error: 'Plano inválido.', code: 'invalid_plan' }, 400);

  if (!(await verifyCaptcha(body.captchaToken, 'checkout', ip))) {
    await logSecurityEvent(admin, { source: SOURCE, kind: 'captcha_failed', userId: user.id, ip });
    return h.json({ error: 'Não conseguimos confirmar que é você. Tente de novo.', code: 'captcha_failed' }, 403);
  }

  const price = priceIdFor(body.plan, body.interval);
  if (!price) return h.json({ error: 'Este plano está indisponível no momento.', code: 'not_configured' }, 503);

  // Um checkout por usuário de cada vez: cliques repetidos, abas ou robôs não criam sessões em paralelo.
  const lockKey = `checkout:${user.id}`;
  if (!(await acquireLock(admin, lockKey, 60))) {
    return h.json({ error: 'Já estamos preparando seu pagamento. Aguarde alguns segundos.', code: 'in_progress' }, 409);
  }
  try {
    const stripe = stripeClient();

    const { data: row, error: readError } = await admin
      .from('nexo_subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) throw new Error(`nexo_subscriptions: ${readError.message}`);
    let customerId = (row?.stripe_customer_id as string | null) ?? null;
    if (row && LIVE_STATUSES.has(row.status as string)) {
      // O banco diz que há assinatura: confirma na Stripe antes de recusar (o webhook de cancelamento pode ter falhado).
      const current = customerId ? await syncCustomer(admin, stripe, customerId, user.id) : null;
      if (!current || LIVE_STATUSES.has(current.status)) {
        return h.json({ error: 'Você já tem uma assinatura. Use “Gerenciar assinatura” para alterar ou regularizar.', code: 'already_subscribed' }, 409);
      }
    }

    // Cliente da Stripe: um por usuário. A chave de idempotência evita dois clientes se o vínculo falhar no meio.
    if (!customerId) {
      const name = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? '').slice(0, 120);
      const customer = await stripe.customers.create(
        { email: user.email, name: name || undefined, metadata: { user_id: user.id } },
        { idempotencyKey: `nexo-customer-${user.id}` },
      );
      const { data: linked, error: linkError } = await admin.rpc('nexo_link_customer', { p_user_id: user.id, p_customer_id: customer.id });
      if (linkError || typeof linked !== 'string') throw new Error(`nexo_link_customer: ${linkError?.message ?? 'sem retorno'}`);
      customerId = linked;
    }

    // Confere na Stripe se já existe assinatura viva (no cliente vinculado ou em outro com o mesmo e-mail),
    // porque o banco pode estar atrasado em relação à Stripe.
    const candidates = new Set<string>([customerId]);
    const byEmail = await stripe.customers.list({ email: user.email, limit: 10 });
    byEmail.data.forEach((c) => candidates.add(c.id));
    for (const id of candidates) {
      const subs = await stripe.subscriptions.list({ customer: id, status: 'all', limit: 10 });
      if (subs.data.some((s) => LIVE_STATUSES.has(s.status))) {
        if (id === customerId) {
          await syncCustomer(admin, stripe, customerId, user.id);
        } else {
          await logSecurityEvent(admin, { source: SOURCE, kind: 'duplicate_customer', userId: user.id, ip, detail: { customer: id } });
        }
        return h.json({ error: 'Você já tem uma assinatura. Use “Gerenciar assinatura” para alterar ou regularizar.', code: 'already_subscribed' }, 409);
      }
    }

    // Sessão ainda aberta: devolve a mesma se for o mesmo preço; se trocou de plano, encerra a anterior.
    const { data: open } = await admin
      .from('nexo_billing_checkouts')
      .select('session_id, price_id, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (open?.session_id) {
      const previous = await stripe.checkout.sessions.retrieve(open.session_id as string).catch(() => null);
      if (previous?.status === 'open' && idOf(previous.customer) === customerId) {
        const fresh = previous.expires_at * 1000 > Date.now() + REUSE_MARGIN_MS;
        if (fresh && open.price_id === price && previous.url) return h.json({ url: previous.url });
        await stripe.checkout.sessions.expire(previous.id).catch(() => undefined);
      }
    }

    const require3ds = Deno.env.get('STRIPE_REQUIRE_3DS') === 'true';
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        success_url: `${app}/app/configuracoes?checkout=success`,
        cancel_url: `${app}/app/configuracoes?checkout=cancel`,
        customer_update: { address: 'auto', name: 'auto' },
        billing_address_collection: 'auto',
        metadata: { user_id: user.id },
        subscription_data: { metadata: { user_id: user.id } },
        expires_at: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
        locale: 'pt-BR',
        allow_promotion_codes: true,
        ...(require3ds ? { payment_method_options: { card: { request_three_d_secure: 'any' as const } } } : {}),
      },
      // Mesmo pedido no mesmo minuto (duplo clique, nova tentativa de rede) devolve a mesma sessão.
      { idempotencyKey: `nexo-checkout-${user.id}-${price}-${Math.floor(Date.now() / 60000)}` },
    );
    if (!session.url) throw new Error('Sessão de checkout sem URL.');

    const { error: saveError } = await admin.from('nexo_billing_checkouts').upsert({
      user_id: user.id,
      session_id: session.id,
      price_id: price,
      expires_at: new Date(session.expires_at * 1000).toISOString(),
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (saveError) console.error(SOURCE, 'salvar sessão', saveError.message);

    return h.json({ url: session.url });
  } finally {
    await releaseLock(admin, lockKey);
  }
};

Deno.serve(async (req) => {
  const h = http(req);
  try {
    return await handle(req, h);
  } catch (error) {
    return errorResponse(h, SOURCE, error);
  }
});
