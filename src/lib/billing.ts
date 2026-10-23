import { supabase } from './supabase';
import type { Period } from './period';
import { whatsappEnabled } from './whatsapp';

export type Interval = 'monthly' | 'yearly';
export type PlanId = 'basico' | 'pro';
export type Tier = 'free' | PlanId;

export interface Limits {
  goals: number | null;          // metas financeiras; null = sem limite
  habits: number | null;         // metas de rotina simultâneas; null = sem limite
  eventsPerDay: number | null;
  monthlyEntries: number | null; // lançamentos financeiros por mês
  finance: boolean;              // acesso à gestão financeira
  periods: Period[];             // análises disponíveis
  csvExport: boolean;
  xlsxExport: boolean;
  /** Registrar pelo WhatsApp (o banco e a função whatsapp-webhook conferem o mesmo). */
  whatsapp: boolean;
}

/**
 * Limites por nível. Telas e avisos leem daqui. Os limites que protegem dados (metas, lançamentos por mês,
 * acesso ao financeiro) também são conferidos no banco: ao mudar aqui, mude junto em public.nexo_tier_limit.
 */
export const LIMITS: Record<Tier, Limits> = {
  free: {
    goals: 3, habits: 3, eventsPerDay: 2, monthlyEntries: 0,
    finance: false, periods: [], csvExport: false, xlsxExport: false, whatsapp: false,
  },
  basico: {
    goals: 10, habits: 10, eventsPerDay: 5, monthlyEntries: 50,
    finance: true, periods: ['week', 'month'], csvExport: true, xlsxExport: false, whatsapp: true,
  },
  pro: {
    goals: null, habits: null, eventsPerDay: null, monthlyEntries: null,
    finance: true, periods: ['week', 'month', 'quarter', 'semester', 'year'], csvExport: true, xlsxExport: true, whatsapp: true,
  },
};

const B = LIMITS.basico;
/** Só aparece nos planos quando a integração está ligada no site. */
const WHATSAPP_BENEFIT = whatsappEnabled ? ['Gastos e compromissos pelo WhatsApp'] : [];

/** Planos oferecidos. Os valores vêm da Stripe (função stripe-prices); os benefícios vêm de LIMITS. */
export const PLANS: { id: PlanId; name: string; tagline: string; highlight?: boolean; benefits: string[] }[] = [
  {
    id: 'basico',
    name: 'Básico',
    tagline: 'Para organizar o dia a dia',
    benefits: [
      `Até ${B.goals} metas financeiras`,
      `Até ${B.habits} metas de rotina`,
      `Até ${B.eventsPerDay} compromissos por dia`,
      `Gestão financeira com até ${B.monthlyEntries} lançamentos por mês`,
      'Cartões com fatura, contas a pagar e orçamentos',
      'Coach financeiro e nota de saúde financeira',
      'Análises por semana e por mês',
      'Exportação em CSV',
      ...WHATSAPP_BENEFIT,
      'Assistente de IA, lembretes e sincronização',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Gestão financeira completa, sem limites',
    highlight: true,
    benefits: [
      'Metas financeiras, de rotina e compromissos ilimitados',
      'Lançamentos financeiros ilimitados',
      'Cartões com fatura, contas a pagar e orçamentos',
      'Coach financeiro e nota de saúde financeira',
      'Análises por semana, mês, trimestre, semestre e ano',
      'Exportação em CSV e planilha Excel',
      ...WHATSAPP_BENEFIT,
      'Assistente de IA, lembretes e sincronização',
      'Suporte prioritário',
    ],
  },
];

export interface PlanPrice {
  plan: PlanId;
  interval: Interval;
  amountCents: number;
  currency: string;
}

export interface Subscription {
  status: string;
  plan: string | null;
  interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/** Erro com mensagem pronta para mostrar ao usuário e, quando houver, o código enviado pelo servidor. */
export class BillingError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Tempo máximo de espera pelas funções de pagamento. */
const FUNCTION_TIMEOUT_MS = 20_000;

/** Traduz falhas das funções em mensagens claras. O servidor só devolve mensagens seguras, sem detalhes internos. */
const readError = async (error: unknown): Promise<BillingError> => {
  const { name, context } = error as { name?: string; context?: unknown };
  if (name === 'FunctionsFetchError') {
    const cause = (context as { name?: string } | undefined)?.name;
    return cause === 'AbortError' || cause === 'TimeoutError'
      ? new BillingError('O servidor demorou para responder. Verifique sua conexão e tente de novo.', 'timeout')
      : new BillingError('Sem conexão com o servidor. Verifique sua internet e tente de novo.', 'network');
  }
  if (name === 'FunctionsRelayError') return new BillingError('O serviço está instável agora. Tente de novo em instantes.', 'unavailable');
  const response = context as Response | undefined;
  if (response && typeof response.clone === 'function') {
    try {
      const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
      if (typeof body.error === 'string' && body.error) {
        return new BillingError(body.error.slice(0, 300), typeof body.code === 'string' ? body.code : undefined);
      }
    } catch {
      // Sem JSON: usa a mensagem padrão.
    }
    if (response.status === 429) return new BillingError('Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.', 'rate_limited');
  }
  return new BillingError('Não foi possível concluir a operação. Tente novamente.');
};

const invoke = async <T>(name: string, body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(name, { body, timeout: FUNCTION_TIMEOUT_MS });
  if (error) throw await readError(error);
  return data as T;
};

/** Só sai do site para as páginas oficiais de pagamento da Stripe (checkout e portal). */
const STRIPE_HOSTS = new Set(['checkout.stripe.com', 'billing.stripe.com']);
const isStripeUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && STRIPE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

const stripeUrl = async (name: string, body: Record<string, unknown>): Promise<string> => {
  const url = (await invoke<{ url?: string } | null>(name, body))?.url;
  if (!url || !isStripeUrl(url)) throw new BillingError('Não foi possível abrir a página de pagamento.');
  return url;
};

/**
 * Abre o checkout da Stripe para o plano e o intervalo escolhidos. O preço é decidido no servidor;
 * captchaToken é o token do Turnstile, quando a verificação está ligada.
 */
export const startCheckout = async (plan: PlanId, interval: Interval, captchaToken?: string): Promise<void> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new BillingError('Entre na sua conta para assinar um plano.');
  window.location.assign(await stripeUrl('stripe-checkout', { plan, interval, captchaToken }));
};

/** Abre o portal da Stripe para trocar cartão, ver faturas ou cancelar. */
export const openBillingPortal = async (): Promise<void> => {
  window.location.assign(await stripeUrl('stripe-portal', {}));
};

/** Valores atuais dos preços, lidos da Stripe. */
export const loadPlanPrices = async (): Promise<PlanPrice[]> =>
  (await invoke<{ prices?: PlanPrice[] } | null>('stripe-prices', {}))?.prices ?? [];

export interface UpgradePreview {
  amountNowCents: number;
  currency: string;
  interval: 'month' | 'year';
}

/** Quanto será cobrado agora para mudar de Básico para Pro (proporcional ao período atual). */
export const previewUpgrade = (): Promise<UpgradePreview> => invoke<UpgradePreview>('stripe-upgrade', { action: 'preview' });

/** Efetiva o upgrade para o Pro e cobra a diferença agora. O plano devolvido já foi relido na Stripe. */
export const confirmUpgrade = (captchaToken?: string): Promise<{ status: string; plan: string | null }> =>
  invoke('stripe-upgrade', { action: 'confirm', captchaToken });

/** Atualiza o registro da assinatura direto pela Stripe. Falhas são ignoradas: o webhook continua valendo. */
export const syncSubscription = async (): Promise<void> => {
  try {
    await invoke('stripe-sync', {});
  } catch {
    // Sem efeito para o usuário.
  }
};

export const loadSubscription = async (userId: string): Promise<Subscription | null> => {
  const { data, error } = await supabase
    .from('nexo_subscriptions')
    .select('status, plan, interval, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Subscription | null) ?? null;
};

const isTier = (value: unknown): value is Tier => value === 'free' || value === 'basico' || value === 'pro';

/**
 * Nível atual da conta, calculado no banco (nexo_my_tier) com a mesma regra que libera as gravações pagas.
 * O navegador só exibe: quem decide o que pode ser gravado é o servidor.
 */
export const currentTier = async (userId: string): Promise<Tier> => {
  const { data, error } = await supabase.rpc('nexo_my_tier');
  if (!error) return isTier(data) ? data : 'free';
  // Banco ainda sem a migration de endurecimento (função inexistente): lê o status da assinatura como antes.
  if (error.code !== 'PGRST202') throw error;
  const sub = await loadSubscription(userId);
  const active = sub?.status === 'active' || sub?.status === 'trialing';
  if (!active) return 'free';
  return sub?.plan === 'pro' ? 'pro' : sub?.plan === 'basico' ? 'basico' : 'free';
};

/** Avisa as telas abertas que o plano mudou (por exemplo, depois que o servidor confirmou o checkout). */
export const TIER_CHANGED_EVENT = 'nexo:tier-changed';
export const announceTierChange = (): void => {
  window.dispatchEvent(new Event(TIER_CHANGED_EVENT));
};

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/**
 * Depois de voltar do checkout: pergunta ao servidor até o plano pago aparecer (a confirmação da Stripe pode
 * levar alguns segundos). Nunca libera nada por conta própria; devolve 'free' se ainda não houver confirmação.
 */
export const waitForPaidTier = async (userId: string, attempts = 6): Promise<Tier> => {
  for (let i = 0; i < attempts; i += 1) {
    await syncSubscription();
    const tier = await currentTier(userId).catch((): Tier => 'free');
    if (tier !== 'free') return tier;
    if (i < attempts - 1) await sleep(2000 + i * 1500);
  }
  return 'free';
};

const PLAN_ERRORS: Array<[string, string]> = [
  ['nexo_plan_required', 'Este recurso faz parte dos planos pagos. Assine um plano para salvar.'],
  ['nexo_limit_monthly_entries', 'Você atingiu o limite de lançamentos do seu plano neste mês.'],
  ['nexo_limit_goals', 'Você atingiu o limite de metas do seu plano.'],
  ['nexo_limit_habits', 'Você atingiu o limite de metas de rotina do seu plano.'],
  ['nexo_limit_events_per_day', 'Você atingiu o limite de compromissos por dia do seu plano.'],
];

/** Mensagem para gravações que o banco recusou por causa do plano (os limites são conferidos no servidor). */
export const planErrorMessage = (error: unknown): string | null => {
  const { message = '', code = '' } = (error ?? {}) as { message?: string; code?: string };
  for (const [marker, text] of PLAN_ERRORS) {
    if (message.includes(marker)) return text;
  }
  // A política de segurança do financeiro recusou a gravação: o plano atual não permite.
  if (code === '42501' && /nexo_(transactions|goals)/.test(message)) return PLAN_ERRORS[0][1];
  return null;
};
