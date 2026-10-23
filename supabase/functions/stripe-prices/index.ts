// Devolve os valores atuais dos preços direto da Stripe, para a tela de planos mostrar o que será cobrado.
// Pública (a tela de planos aparece antes do login), com rate limit por IP e cache curto para poupar a Stripe.
import { clientIp, errorResponse, http, type Http } from '../_shared/http.ts';
import { adminClient, ipKey, rateLimit } from '../_shared/security.ts';
import { PRICE_ENV, stripeClient, type Interval, type PlanId } from '../_shared/stripe.ts';

const SOURCE = 'stripe-prices';
const CACHE_MS = 5 * 60 * 1000;

interface PlanPrice { plan: PlanId; interval: Interval; amountCents: number; currency: string }
let cache: { at: number; prices: PlanPrice[] } | null = null;

const loadPrices = async (): Promise<PlanPrice[]> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.prices;
  const stripe = stripeClient();
  const entries = await Promise.all(
    Object.entries(PRICE_ENV).map(async ([key, envName]): Promise<PlanPrice | null> => {
      const id = Deno.env.get(envName)?.trim();
      if (!id) return null;
      const [plan, interval] = key.split('_') as [PlanId, Interval];
      const price = await stripe.prices.retrieve(id);
      // Só mostra preço que o checkout de fato cobraria: ativo, recorrente e no intervalo certo.
      const expected = interval === 'yearly' ? 'year' : 'month';
      if (!price.active || price.unit_amount == null || price.recurring?.interval !== expected || price.recurring.interval_count !== 1) {
        console.error(SOURCE, 'preço inválido ou inativo', envName);
        return null;
      }
      return { plan, interval, amountCents: price.unit_amount, currency: price.currency.toUpperCase() };
    }),
  );
  const prices = entries.filter((entry): entry is PlanPrice => entry !== null);
  cache = { at: Date.now(), prices };
  return prices;
};

const handle = async (req: Request, h: Http): Promise<Response> => {
  if (req.method === 'OPTIONS') return h.preflight();
  if (!h.originAllowed) return h.json({ error: 'Origem não permitida.' }, 403);
  if (req.method !== 'POST' && req.method !== 'GET') return h.json({ error: 'Método não permitido.' }, 405);

  const ip = clientIp(req);
  await rateLimit(adminClient(), [{ bucket: `prices:ip:${await ipKey(ip)}`, limit: 60, windowSeconds: 600, blockSeconds: 600 }], { source: SOURCE, ip });
  return h.json({ prices: await loadPrices() });
};

Deno.serve(async (req) => {
  const h = http(req);
  try {
    return await handle(req, h);
  } catch (error) {
    return errorResponse(h, SOURCE, error);
  }
});
