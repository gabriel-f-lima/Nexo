// Webhook do WhatsApp (Cloud API da Meta): base da integração.
// - GET: verificação do webhook pela Meta (hub.challenge).
// - POST: confere a assinatura (X-Hub-Signature-256), ignora mensagens repetidas ou antigas, vincula o número
//   à conta com o código gerado no site ("vincular 123456") e registra gastos, receitas e compromissos
//   escritos em português ("gastei 45 no mercado ontem", "dentista terça às 15h").
// Só para planos pagos (Básico e Pro): o vínculo exige plano e cada mensagem confere o plano de novo.
// Sem WHATSAPP_ENABLED=true a função só responde à verificação: nada é processado.
// Publicar com: supabase functions deploy whatsapp-webhook --no-verify-jwt (a Meta não envia JWT).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { foldName, guessCategories, parseQuickEntry } from '../_shared/quickEntry.ts';

const SOURCE = 'whatsapp-webhook';
const MAX_BODY = 256 * 1024;
/** Mensagens mais antigas que isso (reentregas atrasadas) não são processadas. */
const MAX_AGE_SECONDS = 10 * 60;
const PHONE = /^[1-9][0-9]{7,14}$/;

const env = (key: string) => (Deno.env.get(key) ?? '').trim();
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/* ---------- Assinatura ---------- */

const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** Comparação em tempo constante (não revela onde as strings diferem). */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const validSignature = async (rawBody: string, header: string | null, appSecret: string): Promise<boolean> => {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  return safeEqual(header.slice(7).toLowerCase(), expected);
};

/* ---------- Datas no fuso do usuário ---------- */

const todayIn = (timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
};

/** Diferença (ms) entre o horário local do fuso e o UTC num instante. */
const zoneOffset = (instant: number, timeZone: string): number => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - instant;
};

/** Instante UTC (ISO) de uma data e hora locais do fuso. */
export const zonedToUtc = (date: string, time: string, timeZone: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - zoneOffset(guess, timeZone);
  // Segunda passada acerta dias de troca de horário de verão.
  return new Date(guess - zoneOffset(first, timeZone)).toISOString();
};

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/* ---------- Envio ---------- */

const sendText = async (admin: SupabaseClient, to: string, body: string, userId: string | null): Promise<void> => {
  const token = env('WHATSAPP_TOKEN');
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) return;
  const version = env('WHATSAPP_GRAPH_VERSION') || 'v21.0';
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: body.slice(0, 4000) } }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
    const id = data.messages?.[0]?.id;
    if (id) await admin.from('nexo_whatsapp_messages').insert({ id, user_id: userId, direction: 'out', kind: 'text', status: response.ok ? 'sent' : 'failed' });
    if (!response.ok) console.error(SOURCE, 'envio recusado', response.status);
  } catch (error) {
    console.error(SOURCE, 'envio falhou', String(error));
  }
};

const HELP = [
  'Posso anotar gastos, receitas e compromissos. Exemplos:',
  '• gastei 45 no mercado ontem',
  '• recebi 3000 de salário',
  '• dentista terça às 15h',
].join('\n');

/* ---------- Ações ---------- */

interface Linked { userId: string; timeZone: string }

const PLAN_REQUIRED = 'O Nexo no WhatsApp faz parte dos planos pagos (Básico e Pro). Assine pelo site, em Configurações › Plano, para voltar a usar por aqui.';

/** Plano pago ativo? Sem resposta do banco, não libera. */
const paidPlan = async (admin: SupabaseClient, userId: string): Promise<boolean> => {
  const { data, error } = await admin.rpc('nexo_tier_of', { p_user_id: userId });
  if (error) {
    console.error(SOURCE, 'plano', error.message);
    return false;
  }
  return data === 'basico' || data === 'pro';
};

const rateLimited = async (admin: SupabaseClient, bucket: string, limit: number, windowSeconds: number, blockSeconds: number): Promise<boolean> => {
  const { data, error } = await admin.rpc('nexo_rate_limit_hit', {
    p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds, p_block_seconds: blockSeconds,
  });
  if (error) {
    console.error(SOURCE, 'rate limit', error.message);
    return true; // Sem controle de abuso, não processa.
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean } | null;
  return row?.allowed === false;
};

const planMessage = (message: string): string | null => {
  if (message.includes('nexo_plan_required')) return 'O controle financeiro faz parte dos planos pagos do Nexo. Assine pelo site para registrar por aqui.';
  if (message.includes('nexo_limit_monthly_entries')) return 'Você atingiu o limite de lançamentos do seu plano neste mês.';
  return null;
};

const handleEntry = async (admin: SupabaseClient, linked: Linked, text: string): Promise<string> => {
  const today = todayIn(linked.timeZone);
  const [{ data: cards }, { data: categories }] = await Promise.all([
    admin.from('nexo_cards').select('id,name').eq('user_id', linked.userId).eq('archived', false),
    admin.from('nexo_categories').select('id,name,kind').eq('user_id', linked.userId),
  ]);
  const entry = parseQuickEntry(text, { today, cardNames: (cards ?? []).map((c: { name: string }) => c.name) });

  if (entry.kind === 'transaction') {
    if (entry.card) return 'Compras no cartão de crédito ainda são registradas pelo site (para cair na fatura certa). Se foi à vista, mande de novo sem "cartão".';
    if (entry.date < addDays(today, -1)) return 'Só dá para lançar hoje, ontem ou datas futuras. Dias anteriores ficam só para consulta.';
    const options = (categories ?? []).filter((c: { kind: string }) => c.kind === entry.type) as Array<{ id: string; name: string }>;
    const hints = [entry.description, ...entry.categoryHints, ...guessCategories(entry.description)];
    const category = hints.map((h) => options.find((c) => foldName(c.name) === foldName(h))).find(Boolean) ?? null;
    const { error } = await admin.from('nexo_transactions').insert({
      user_id: linked.userId,
      id: crypto.randomUUID(),
      type: entry.type,
      amount_cents: entry.amountCents,
      currency: entry.currency,
      category_id: category?.id ?? null,
      occurred_on: entry.date,
      description: entry.description.slice(0, 120),
    });
    if (error) return planMessage(error.message) ?? 'Não consegui registrar agora. Tente de novo em instantes.';
    const what = entry.type === 'income' ? 'receita' : 'despesa';
    return `Anotado: ${what} de ${money(entry.amountCents, entry.currency)}${category ? ` em ${category.name}` : ''}${entry.description ? ` (${entry.description})` : ''}, ${shortDate(entry.date)}.`;
  }

  if (entry.kind === 'event') {
    if (!entry.time) return `Qual horário? Mande de novo com a hora, por exemplo: "${entry.title.toLowerCase()} ${shortDate(entry.date)} às 15h".`;
    if (entry.date < today) return 'Essa data já passou. Compromissos podem ser marcados de hoje em diante.';
    // Mesmo limite de compromissos por dia do site, conferido aqui porque a service role passa pelas políticas.
    const { data: tier } = await admin.rpc('nexo_tier_of', { p_user_id: linked.userId });
    const { data: limit } = await admin.rpc('nexo_tier_limit', { p_tier: tier ?? 'free', p_resource: 'events_per_day' });
    if (typeof limit === 'number') {
      const { count } = await admin.from('nexo_events').select('id', { count: 'exact', head: true }).eq('user_id', linked.userId)
        .gte('start_at', zonedToUtc(entry.date, '00:00', linked.timeZone)).lt('start_at', zonedToUtc(addDays(entry.date, 1), '00:00', linked.timeZone));
      if ((count ?? 0) >= limit) return `Você já tem ${limit} compromissos nesse dia, o limite do seu plano.`;
    }
    const { error } = await admin.from('nexo_events').insert({
      user_id: linked.userId,
      id: crypto.randomUUID(),
      title: entry.title.slice(0, 80),
      start_at: zonedToUtc(entry.date, entry.time, linked.timeZone),
    });
    if (error) return 'Não consegui marcar agora. Tente de novo em instantes.';
    return `Marcado: ${entry.title}, ${shortDate(entry.date)} às ${entry.time}.`;
  }

  return `Não entendi. ${HELP}`;
};

interface IncomingMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
}

const processMessage = async (admin: SupabaseClient, message: IncomingMessage): Promise<void> => {
  const id = typeof message.id === 'string' ? message.id.slice(0, 200) : '';
  const phone = typeof message.from === 'string' ? message.from.replace(/\D/g, '') : '';
  if (!id || !PHONE.test(phone)) return;

  // Idempotência: a mesma mensagem só é processada uma vez, mesmo que a Meta reenvie.
  const { error: duplicate } = await admin.from('nexo_whatsapp_messages').insert({ id, direction: 'in', kind: String(message.type ?? 'unknown').slice(0, 40) });
  if (duplicate) {
    // 23505 = já recebida. Qualquer outro erro: sem como garantir que não repete, então não processa.
    if (duplicate.code !== '23505') console.error(SOURCE, 'registro da mensagem', duplicate.message);
    return;
  }

  const sentAt = Number(message.timestamp ?? 0) * 1000;
  if (!sentAt || Date.now() - sentAt > MAX_AGE_SECONDS * 1000) {
    await admin.from('nexo_whatsapp_messages').update({ status: 'stale' }).eq('id', id);
    return;
  }

  const phoneKey = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nexo-wa:${phone}`))).slice(0, 24);
  if (await rateLimited(admin, `wa:msg:${phoneKey}`, 20, 600, 1800)) return;

  const { data: link } = await admin.from('nexo_whatsapp_links').select('user_id,timezone').eq('phone', phone).not('verified_at', 'is', null).maybeSingle();
  const linked: Linked | null = link ? { userId: String(link.user_id), timeZone: String(link.timezone || 'America/Sao_Paulo') } : null;
  await admin.from('nexo_whatsapp_messages').update({ user_id: linked?.userId ?? null, status: 'processing' }).eq('id', id);

  const text = message.type === 'text' && typeof message.text?.body === 'string' ? message.text.body.trim().slice(0, 300) : '';
  if (!text) {
    await sendText(admin, phone, 'Por enquanto eu só entendo mensagens de texto.', linked?.userId ?? null);
    return;
  }

  const linkCommand = /^vincular\s+(\d{6})$/i.exec(text);
  if (linkCommand) {
    if (await rateLimited(admin, `wa:link:${phoneKey}`, 5, 600, 3600)) {
      await sendText(admin, phone, 'Muitas tentativas. Aguarde alguns minutos e gere um código novo no site.', null);
      return;
    }
    const { data: userId, error } = await admin.rpc('nexo_whatsapp_confirm_link', { p_phone: phone, p_code: linkCommand[1] });
    await sendText(admin, phone, !error && userId
      ? `Pronto! Este número está ligado à sua conta do Nexo.\n\n${HELP}`
      : 'Código inválido ou vencido, ou a conta não tem plano pago. Gere um novo em Configurações › WhatsApp, no site do Nexo.', userId ? String(userId) : null);
    return;
  }

  if (!linked) {
    await sendText(admin, phone, 'Olá! O Nexo no WhatsApp faz parte dos planos pagos. Com um plano ativo, gere um código em Configurações › WhatsApp, no site, e mande: vincular 123456', null);
    return;
  }

  // Quem cancelou o plano depois de vincular é avisado, e nada é registrado.
  if (!(await paidPlan(admin, linked.userId))) {
    await sendText(admin, phone, PLAN_REQUIRED, linked.userId);
    await admin.from('nexo_whatsapp_messages').update({ status: 'plan_required' }).eq('id', id);
    return;
  }

  const answer = /^(ajuda|help|menu|oi|olá|ola)$/i.test(text) ? HELP : await handleEntry(admin, linked, text);
  await sendText(admin, phone, answer, linked.userId);
  await admin.from('nexo_whatsapp_messages').update({ status: 'done' }).eq('id', id);
};

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const verifyToken = env('WHATSAPP_VERIFY_TOKEN');
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && !!verifyToken && safeEqual(url.searchParams.get('hub.verify_token') ?? '', verifyToken);
    return ok
      ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return reply({ error: 'Método não permitido' }, 405);

  const appSecret = env('WHATSAPP_APP_SECRET');
  if (env('WHATSAPP_ENABLED') !== 'true' || !appSecret) return reply({ error: 'Integração desligada' }, 503);
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY) return reply({ error: 'Grande demais' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply({ error: 'Grande demais' }, 413);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256'), appSecret))) {
    try {
      await admin.from('nexo_security_events').insert({ source: SOURCE, kind: 'invalid_signature', detail: {} });
    } catch {
      // Registro é opcional.
    }
    return reply({ error: 'Assinatura inválida' }, 401);
  }

  let payload: { entry?: Array<{ changes?: Array<{ value?: { messages?: IncomingMessage[] } }> }> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply({ error: 'JSON inválido' }, 400);
  }

  const messages = (payload.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []).slice(0, 20);
  for (const message of messages) {
    try {
      await processMessage(admin, message);
    } catch (error) {
      console.error(SOURCE, 'mensagem', String(error));
    }
  }
  // A Meta só precisa do 200; erros por mensagem ficam no log.
  return reply({ ok: true });
});
