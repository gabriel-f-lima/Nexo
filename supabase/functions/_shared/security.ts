// Proteções das funções de pagamento: sessão verificada no servidor, rate limit com bloqueio temporário,
// travas contra pedidos simultâneos, captcha (Cloudflare Turnstile, opcional) e registro de eventos suspeitos.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { appOrigin, HttpError } from './http.ts';

export const adminClient = (): SupabaseClient => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) throw new HttpError(503, 'Pagamentos indisponíveis no momento. Tente mais tarde.', 'not_configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

/** Confere o token no Supabase Auth (assinatura e validade) e devolve o usuário. */
export const requireUser = async (req: Request, admin: SupabaseClient): Promise<User> => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Entre na sua conta para continuar.', 'auth_required');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.', 'auth_invalid');
  const bannedUntil = (data.user as { banned_until?: string | null }).banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) throw new HttpError(403, 'Conta bloqueada. Fale com o suporte.', 'banned');
  return data.user;
};

/** Para cobrar: conta de verdade (não anônima) e e-mail confirmado. Barra contas descartáveis criadas por robôs. */
export const requirePayingUser = async (req: Request, admin: SupabaseClient): Promise<User & { email: string }> => {
  const user = await requireUser(req, admin);
  if (user.is_anonymous) throw new HttpError(403, 'Crie uma conta para assinar um plano.', 'account_required');
  if (!user.email || !user.email_confirmed_at) {
    throw new HttpError(403, 'Confirme seu e-mail antes de assinar. Procure a mensagem do Nexo na sua caixa de entrada.', 'email_unconfirmed');
  }
  return user as User & { email: string };
};

export interface SecurityEvent {
  source: string;
  kind: string;
  userId?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

/** Registra uma tentativa suspeita. Nunca interrompe a requisição. */
export const logSecurityEvent = async (admin: SupabaseClient, event: SecurityEvent): Promise<void> => {
  try {
    const { error } = await admin.from('nexo_security_events').insert({
      source: event.source,
      kind: event.kind,
      user_id: event.userId ?? null,
      ip: event.ip && event.ip !== 'unknown' ? event.ip : null,
      detail: event.detail ?? {},
    });
    if (error) console.error('security-log', error.message);
  } catch (error) {
    console.error('security-log', String(error));
  }
};

/** Identificador do IP para os baldes de rate limit (hash: o IP em si não fica nessas tabelas). */
export const ipKey = async (ip: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nexo-rl:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
};

export interface Limit {
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Bloqueio ao passar do limite; dobra a cada reincidência em 24 h. Use valor >= windowSeconds. */
  blockSeconds: number;
}

interface LimitRow { allowed: boolean; retry_after: number; blocked_now: boolean }

const waitText = (seconds: number): string => {
  if (seconds < 90) return 'alguns segundos';
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90 ? `${minutes} minutos` : `${Math.ceil(minutes / 60)} horas`;
};

/** Conta o acesso em cada balde; se algum passou do limite, responde 429 (e registra quando o bloqueio começa). */
export const rateLimit = async (
  admin: SupabaseClient,
  limits: Limit[],
  context: { source: string; ip: string; userId?: string },
): Promise<void> => {
  for (const item of limits) {
    const { data, error } = await admin.rpc('nexo_rate_limit_hit', {
      p_bucket: item.bucket,
      p_limit: item.limit,
      p_window_seconds: item.windowSeconds,
      p_block_seconds: item.blockSeconds,
    });
    // Sem o controle de abuso, não segue: melhor recusar do que cobrar sem proteção.
    if (error) {
      console.error('rate-limit', error.message);
      throw new HttpError(503, 'Pagamentos indisponíveis no momento. Tente de novo em instantes.', 'unavailable');
    }
    const row = (Array.isArray(data) ? data[0] : data) as LimitRow | null;
    if (row && !row.allowed) {
      if (row.blocked_now) {
        await logSecurityEvent(admin, {
          source: context.source,
          kind: 'rate_limited',
          userId: context.userId,
          ip: context.ip,
          detail: { bucket: item.bucket.split(':').slice(0, 2).join(':'), retryAfter: row.retry_after },
        });
      }
      throw new HttpError(429, `Muitas tentativas seguidas. Aguarde ${waitText(row.retry_after)} e tente de novo.`, 'rate_limited', row.retry_after);
    }
  }
};

/** Trava curta por chave. Devolve false se outra requisição já está fazendo a mesma operação. */
export const acquireLock = async (admin: SupabaseClient, key: string, ttlSeconds: number): Promise<boolean> => {
  const { data, error } = await admin.rpc('nexo_lock_acquire', { p_key: key, p_ttl_seconds: ttlSeconds });
  if (error) {
    console.error('lock', error.message);
    throw new HttpError(503, 'Pagamentos indisponíveis no momento. Tente de novo em instantes.', 'unavailable');
  }
  return data === true;
};

export const releaseLock = async (admin: SupabaseClient, key: string): Promise<void> => {
  const { error } = await admin.from('nexo_billing_locks').delete().eq('key', key);
  if (error) console.error('lock-release', error.message);
};

/** Captcha ligado quando TURNSTILE_SECRET_KEY existe. O site precisa de VITE_TURNSTILE_SITE_KEY do mesmo widget. */
export const captchaEnabled = (): boolean => !!Deno.env.get('TURNSTILE_SECRET_KEY');

/** Valida o token do Turnstile na Cloudflare (uso único, vale 5 minutos) para a ação esperada. */
export const verifyCaptcha = async (token: unknown, action: string, ip: string): Promise<boolean> => {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip !== 'unknown') form.append('remoteip', ip);

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = await response.json();
  } catch (error) {
    console.error('captcha', String(error));
    throw new HttpError(503, 'A verificação de segurança está indisponível. Tente de novo em instantes.', 'captcha_unavailable');
  }

  if (result.success !== true || result.action !== action) return false;
  const expected = new URL(appOrigin()).hostname;
  const local = expected === 'localhost' || expected === '127.0.0.1';
  return local || result.hostname === expected;
};
