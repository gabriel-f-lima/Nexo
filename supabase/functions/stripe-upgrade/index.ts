// Upgrade de Básico para Pro com cobrança proporcional: cobra a diferença agora e o valor cheio nas próximas renovações.
// O plano atual é conferido na Stripe (não no banco nem no navegador). Se a cobrança da diferença não for aprovada,
// nada muda (payment_behavior: error_if_incomplete). Uma confirmação por vez por usuário, com captcha opcional.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, errorResponse, http, readJsonBody, type Http } from '../_shared/http.ts';
import {
  acquireLock, adminClient, ipKey, logSecurityEvent, rateLimit, releaseLock, requirePayingUser, verifyCaptcha,
} from '../_shared/security.ts';
import { idOf, PAID_STATUSES, planItem, priceIdFor, stripeClient, syncCustomer } from '../_shared/stripe.ts';

const SOURCE = 'stripe-upgrade';

const handle = async (req: Request, h: Http): Promise<Response> => {
  if (req.method === 'OPTIONS') return h.preflight();
  if (!h.originAllowed) return h.json({ error: 'Origem não permitida.' }, 403);
  if (req.method !== 'POST') return h.json({ error: 'Método não permitido.' }, 405);

  const admin = adminClient();
  const ip = clientIp(req);

  await rateLimit(admin, [{ bucket: `upgrade:ip:${await ipKey(ip)}`, limit: 30, windowSeconds: 600, blockSeconds: 1800 }], { source: SOURCE, ip });
  const user = await requirePayingUser(req, admin);

  const body = await readJsonBody(req);
  const action = body?.action;
  if (action !== 'preview' && action !== 'confirm') return h.json({ error: 'Pedido inválido.', code: 'invalid_action' }, 400);

  await rateLimit(admin, [
    action === 'confirm'
      ? { bucket: `upgrade:confirm:${user.id}`, limit: 5, windowSeconds: 600, blockSeconds: 1800 }
      : { bucket: `upgrade:preview:${user.id}`, limit: 20, windowSeconds: 600, blockSeconds: 900 },
  ], { source: SOURCE, ip, userId: user.id });

  if (action === 'confirm' && !(await verifyCaptcha(body?.captchaToken, 'upgrade', ip))) {
    await logSecurityEvent(admin, { source: SOURCE, kind: 'captcha_failed', userId: user.id, ip });
    return h.json({ error: 'Não conseguimos confirmar que é você. Tente de novo.', code: 'captcha_failed' }, 403);
  }

  if (action === 'preview') return await upgrade(admin, h, user.id, ip, 'preview');

  // Trava antes de ler o plano: um segundo clique só lê a assinatura depois do primeiro terminar,
  // encontra o Pro já aplicado e não cobra de novo.
  const lockKey = `upgrade:${user.id}`;
  if (!(await acquireLock(admin, lockKey, 60))) {
    return h.json({ error: 'Já estamos atualizando seu plano. Aguarde alguns segundos.', code: 'in_progress' }, 409);
  }
  try {
    return await upgrade(admin, h, user.id, ip, 'confirm');
  } finally {
    await releaseLock(admin, lockKey);
  }
};

const upgrade = async (admin: SupabaseClient, h: Http, userId: string, ip: string, action: 'preview' | 'confirm'): Promise<Response> => {
  const { data: row, error: readError } = await admin
    .from('nexo_subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) throw new Error(`nexo_subscriptions: ${readError.message}`);
  const customerId = row?.stripe_customer_id as string | undefined;
  const subId = row?.stripe_subscription_id as string | undefined;
  if (!customerId || !subId) return h.json({ error: 'Você não tem uma assinatura ativa para atualizar.', code: 'no_subscription' }, 409);

  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(subId);
  if (idOf(sub.customer) !== customerId) {
    await logSecurityEvent(admin, { source: SOURCE, kind: 'subscription_customer_mismatch', userId, ip, detail: { subscription: subId } });
    return h.json({ error: 'Não foi possível conferir sua assinatura. Fale com o suporte.', code: 'mismatch' }, 409);
  }
  if (!PAID_STATUSES.has(sub.status)) return h.json({ error: 'Você não tem uma assinatura ativa para atualizar.', code: 'no_subscription' }, 409);

  const current = planItem(sub);
  if (current?.plan === 'pro') return h.json({ error: 'Você já está no plano Pro.', code: 'already_pro' }, 409);
  if (!current) {
    await logSecurityEvent(admin, { source: SOURCE, kind: 'unknown_price', userId, detail: { subscription: subId } });
    return h.json({ error: 'Não foi possível identificar seu plano atual. Fale com o suporte.', code: 'unknown_plan' }, 409);
  }

  const interval = current.item.price.recurring?.interval === 'year' ? 'year' : 'month';
  const targetPrice = priceIdFor('pro', interval === 'year' ? 'yearly' : 'monthly');
  if (!targetPrice) return h.json({ error: 'O plano Pro está indisponível no momento.', code: 'not_configured' }, 503);

  if (action === 'preview') {
    const upcoming = await stripe.invoices.retrieveUpcoming({
      customer: customerId,
      subscription: subId,
      subscription_items: [{ id: current.item.id, price: targetPrice }],
      subscription_proration_behavior: 'always_invoice',
    });
    return h.json({ amountNowCents: upcoming.amount_due, currency: upcoming.currency.toUpperCase(), interval });
  }

  try {
    await stripe.subscriptions.update(
      subId,
      {
        items: [{ id: current.item.id, price: targetPrice }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
      },
      { idempotencyKey: `nexo-upgrade-${subId}-${crypto.randomUUID()}` },
    );
  } catch (error) {
    const stripeError = error as { type?: string; code?: string; statusCode?: number };
    if (stripeError.type === 'StripeCardError' || stripeError.statusCode === 402) {
      await logSecurityEvent(admin, {
        source: SOURCE, kind: 'upgrade_payment_failed', userId, ip, detail: { code: stripeError.code ?? null },
      });
      return h.json({
        error: 'O pagamento da diferença não foi aprovado. Atualize o cartão em “Gerenciar assinatura” e tente de novo. Nada foi alterado.',
        code: 'payment_failed',
      }, 402);
    }
    throw error;
  }

  const result = await syncCustomer(admin, stripe, customerId, userId);
  return h.json({ status: result.status, plan: result.plan });
};

Deno.serve(async (req) => {
  const h = http(req);
  try {
    return await handle(req, h);
  } catch (error) {
    return errorResponse(h, SOURCE, error);
  }
});
