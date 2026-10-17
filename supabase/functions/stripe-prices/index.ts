// Devolve os valores atuais dos preços direto da Stripe, para a tela de planos mostrar o que será cobrado.
import Stripe from 'npm:stripe@17.4.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

// Mesma ordem de chaves do stripe-checkout: plano_intervalo -> nome do secret.
const PRICE_ENV: Record<string, string> = {
  basico_monthly: 'STRIPE_PRICE_BASICO_MONTHLY',
  basico_yearly: 'STRIPE_PRICE_BASICO_YEARLY',
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_yearly: 'STRIPE_PRICE_PRO_YEARLY',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    if (!stripeKey) return json({ error: 'Pagamentos não configurados no servidor.' }, 500);
    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });

    const entries = await Promise.all(
      Object.entries(PRICE_ENV).map(async ([key, envName]) => {
        const id = Deno.env.get(envName);
        if (!id) return null;
        const price = await stripe.prices.retrieve(id);
        const [plan, interval] = key.split('_');
        return {
          plan,
          interval,
          amountCents: price.unit_amount ?? 0,
          currency: (price.currency ?? 'brl').toUpperCase(),
        };
      }),
    );
    return json({ prices: entries.filter(Boolean) });
  } catch (error) {
    console.error('stripe-prices', error);
    return json({ error: 'Não foi possível carregar os preços.' }, 500);
  }
});
