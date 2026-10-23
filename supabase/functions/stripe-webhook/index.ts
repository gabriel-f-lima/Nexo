// Recebe eventos da Stripe e mantém nexo_subscriptions atualizada.
// Deve ser publicada com --no-verify-jwt (a Stripe não envia token do Supabase); a autenticação é a assinatura
// do evento, conferida sempre com STRIPE_WEBHOOK_SECRET.
// - Só processa os tipos de evento da lista; os demais são aceitos e ignorados.
// - Cada event.id é processado uma vez (nexo_stripe_events).
// - Não usa o conteúdo do evento para decidir o plano: relê a assinatura na Stripe, o que torna a ordem de chegada
//   irrelevante, e o banco ainda descarta leituras mais antigas que a última gravada.
// - Fraude (alerta antecipado do Radar) e contestação ficam registradas; com STRIPE_FRAUD_AUTO_CANCEL=true,
//   a assinatura é cancelada na hora e o acesso pago sai junto.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { clientIp } from '../_shared/http.ts';
import { adminClient, ipKey, logSecurityEvent } from '../_shared/security.ts';
import { idOf, isLiveKey, LIVE_STATUSES, Stripe, stripeClient, syncCustomer, userForCustomer } from '../_shared/stripe.ts';

const SOURCE = 'stripe-webhook';
const MAX_BODY = 512 * 1024;

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'radar.early_fraud_warning.created',
  'charge.dispute.created',
]);

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

/** Registra requisições inválidas sem deixar um robô encher a tabela (até 5 registros por IP a cada 10 min). */
const reportInvalid = async (admin: SupabaseClient, ip: string, kind: string) => {
  const { data } = await admin.rpc('nexo_rate_limit_hit', {
    p_bucket: `webhook-invalid:${await ipKey(ip)}`, p_limit: 5, p_window_seconds: 600, p_block_seconds: 600,
  });
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean } | null;
  if (row?.allowed) await logSecurityEvent(admin, { source: SOURCE, kind, ip });
};

/** Cancela na hora as assinaturas vivas do cliente (usado em fraude/contestação quando ligado). */
const cancelForFraud = async (admin: SupabaseClient, stripe: Stripe, customerId: string, userId: string, reason: string) => {
  if (Deno.env.get('STRIPE_FRAUD_AUTO_CANCEL') !== 'true') return;
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  for (const sub of subs.data.filter((s) => LIVE_STATUSES.has(s.status))) {
    await stripe.subscriptions.cancel(sub.id, { prorate: false }, { idempotencyKey: `nexo-fraud-cancel-${sub.id}` });
    await logSecurityEvent(admin, { source: SOURCE, kind: 'subscription_canceled_fraud', userId, detail: { subscription: sub.id, reason } });
  }
};

/** Cliente da Stripe ligado à cobrança (alerta de fraude e contestação só trazem o id da cobrança). */
const customerOfCharge = async (stripe: Stripe, charge: string | Stripe.Charge): Promise<string | null> => {
  const full = typeof charge === 'string' ? await stripe.charges.retrieve(charge) : charge;
  return idOf(full.customer);
};

const processEvent = async (admin: SupabaseClient, stripe: Stripe, event: Stripe.Event): Promise<void> => {
  let customerId: string | null;
  let fraud: { kind: string; detail: Record<string, unknown>; cancel: boolean } | null = null;

  switch (event.type) {
    case 'checkout.session.expired': {
      await admin.from('nexo_billing_checkouts').delete().eq('session_id', event.data.object.id);
      return;
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') return;
      customerId = idOf(session.customer);
      if (event.type === 'checkout.session.completed') {
        await admin.from('nexo_billing_checkouts').delete().eq('session_id', session.id);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      customerId = idOf(event.data.object.customer);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      customerId = idOf(event.data.object.customer);
      break;
    case 'radar.early_fraud_warning.created': {
      const warning = event.data.object;
      customerId = await customerOfCharge(stripe, warning.charge);
      fraud = {
        kind: 'early_fraud_warning',
        detail: { charge: idOf(warning.charge), fraudType: warning.fraud_type, actionable: warning.actionable },
        cancel: warning.actionable,
      };
      break;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object;
      customerId = await customerOfCharge(stripe, dispute.charge);
      fraud = {
        kind: 'dispute_created',
        detail: { charge: idOf(dispute.charge), reason: dispute.reason, amount: dispute.amount, currency: dispute.currency },
        cancel: true,
      };
      break;
    }
    default:
      return;
  }

  if (!customerId) return;
  const userId = await userForCustomer(admin, stripe, customerId);
  if (!userId) {
    // Cliente que não é do Nexo (ou conta já excluída): nada a fazer.
    console.warn(SOURCE, 'cliente sem usuário', event.type);
    return;
  }

  if (fraud) {
    await logSecurityEvent(admin, { source: SOURCE, kind: fraud.kind, userId, detail: { ...fraud.detail, customer: customerId } });
    if (fraud.cancel) await cancelForFraud(admin, stripe, customerId, userId, fraud.kind);
  }

  await syncCustomer(admin, stripe, customerId, userId, {
    id: event.id,
    createdAt: new Date(event.created * 1000).toISOString(),
  });
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Método não permitido' }, 405);

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!secret || !Deno.env.get('STRIPE_SECRET_KEY')) {
    console.error(SOURCE, 'STRIPE_WEBHOOK_SECRET ou STRIPE_SECRET_KEY ausente');
    return reply({ error: 'Não configurado' }, 500);
  }

  const ip = clientIp(req);
  let admin: SupabaseClient;
  let stripe: Stripe;
  try {
    admin = adminClient();
    stripe = stripeClient();
  } catch {
    return reply({ error: 'Não configurado' }, 500);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    await reportInvalid(admin, ip, 'webhook_missing_signature');
    return reply({ error: 'Requisição inválida' }, 400);
  }
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY) return reply({ error: 'Corpo grande demais' }, 413);
  const payload = await req.text();
  if (payload.length > MAX_BODY) return reply({ error: 'Corpo grande demais' }, 413);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    await reportInvalid(admin, ip, 'webhook_invalid_signature');
    return reply({ error: 'Assinatura inválida' }, 400);
  }

  // Evento de teste chegando na chave de produção (ou o contrário): configuração trocada no painel.
  if (event.livemode !== isLiveKey()) {
    console.error(SOURCE, 'modo do evento diferente da chave', event.livemode);
    return reply({ error: 'Modo incorreto' }, 400);
  }

  if (!HANDLED.has(event.type)) return reply({ received: true, ignored: true });

  const { data: state, error: beginError } = await admin.rpc('nexo_stripe_event_begin', {
    p_id: event.id,
    p_type: event.type,
    p_created_at: new Date(event.created * 1000).toISOString(),
  });
  if (beginError) {
    console.error(SOURCE, 'idempotência', beginError.message);
    return reply({ error: 'Tente novamente' }, 500);
  }
  if (state === 'duplicate') return reply({ received: true, duplicate: true });
  // Outra entrega do mesmo evento está em andamento: a Stripe tenta de novo depois.
  if (state === 'in_progress') return reply({ error: 'Em processamento' }, 409);

  try {
    await processEvent(admin, stripe, event);
    await admin.from('nexo_stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
    return reply({ received: true });
  } catch (error) {
    const detail = error as { type?: string; message?: string };
    console.error(SOURCE, event.type, detail?.type ?? '', detail?.message ?? String(error));
    // Libera o evento para a próxima tentativa da Stripe.
    await admin.from('nexo_stripe_events').delete().eq('id', event.id).is('processed_at', null);
    return reply({ error: 'Falha ao processar' }, 500);
  }
});
