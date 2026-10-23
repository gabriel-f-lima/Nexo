// HTTP das funções de pagamento: CORS só para o site, respostas JSON sem detalhes internos e leitura segura do corpo.

/** Erro com status e mensagem que podem ir para o usuário. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

/** Origem do site (APP_URL). Só https, exceto localhost para desenvolvimento. */
export const appOrigin = (): string => {
  const raw = (Deno.env.get('APP_URL') ?? '').trim();
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (local && url.protocol === 'http:')) return url.origin;
  } catch {
    // Valor ausente ou inválido.
  }
  throw new HttpError(503, 'Pagamentos indisponíveis no momento. Tente mais tarde.', 'not_configured');
};

/** Origens que podem chamar pelo navegador: APP_URL e as de ALLOWED_ORIGINS (separadas por vírgula). */
const allowedOrigins = (): Set<string> => {
  const list = [Deno.env.get('APP_URL') ?? '', ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',')];
  const origins = new Set<string>();
  for (const item of list) {
    try {
      if (item.trim()) origins.add(new URL(item.trim()).origin);
    } catch {
      // Ignora valores inválidos.
    }
  }
  return origins;
};

export interface Http {
  /** false quando o navegador chama de um site que não é o Nexo. Sem Origin (app mobile, servidor) é permitido. */
  originAllowed: boolean;
  json: (body: unknown, status?: number, extra?: Record<string, string>) => Response;
  preflight: () => Response;
}

export const http = (req: Request): Http => {
  const origin = req.headers.get('Origin');
  const originAllowed = !origin || allowedOrigins().has(origin);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin && originAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type, x-region';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '600';
  }
  return {
    originAllowed,
    json: (body, status = 200, extra) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } }),
    preflight: () => new Response(null, { status: originAllowed ? 204 : 403, headers }),
  };
};

/** IP de quem chama, para rate limit e registro. */
export const clientIp = (req: Request): string => {
  const value = req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]
    ?? '';
  const clean = value.trim().slice(0, 64);
  return /^[0-9a-fA-F:.]+$/.test(clean) ? clean : 'unknown';
};

/** Corpo JSON pequeno (objeto). Devolve null se for grande demais ou inválido. */
export const readJsonBody = async (req: Request, maxBytes = 4096): Promise<Record<string, unknown> | null> => {
  if (Number(req.headers.get('content-length') ?? '0') > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

/** Converte qualquer falha em resposta JSON com mensagem segura; o detalhe fica só no log da função. */
export const errorResponse = (h: Http, source: string, error: unknown): Response => {
  if (error instanceof HttpError) {
    const extra = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined;
    return h.json({ error: error.message, code: error.code, retryAfter: error.retryAfter }, error.status, extra);
  }
  const stripe = error as { type?: string; code?: string; statusCode?: number; message?: string };
  console.error(source, stripe?.type ?? 'erro', stripe?.code ?? '', stripe?.message ?? String(error));
  if (stripe?.type === 'StripeCardError') {
    return h.json({ error: 'O pagamento não foi aprovado. Confira o cartão em “Gerenciar assinatura” e tente de novo.', code: 'card_declined' }, 402);
  }
  if (stripe?.type === 'StripeConnectionError' || stripe?.type === 'StripeRateLimitError' || stripe?.type === 'StripeAPIError') {
    return h.json({ error: 'O serviço de pagamento está instável agora. Tente de novo em alguns minutos.', code: 'upstream_unavailable' }, 503);
  }
  return h.json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.', code: 'internal' }, 500);
};
