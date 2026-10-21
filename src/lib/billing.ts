import { supabase } from './supabase';
import type { Period } from './period';

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
}

/** Limites por nível. Para ajustar, mude aqui: telas e avisos leem daqui. */
export const LIMITS: Record<Tier, Limits> = {
  free: {
    goals: 3, habits: 3, eventsPerDay: 2, monthlyEntries: 0,
    finance: false, periods: [], csvExport: false, xlsxExport: false,
  },
  basico: {
    goals: 10, habits: 10, eventsPerDay: 5, monthlyEntries: 50,
    finance: true, periods: ['week', 'month'], csvExport: true, xlsxExport: false,
  },
  pro: {
    goals: null, habits: null, eventsPerDay: null, monthlyEntries: null,
    finance: true, periods: ['week', 'month', 'quarter', 'semester', 'year'], csvExport: true, xlsxExport: true,
  },
};

const B = LIMITS.basico;

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
      'Análises por semana e por mês',
      'Exportação em CSV',
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
      'Análises por semana, mês, trimestre, semestre e ano',
      'Exportação em CSV e planilha Excel',
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

const readError = async (error: unknown): Promise<string> => {
  const response = (error as { context?: Response }).context;
  if (response) {
    try {
      const body = (await response.clone().json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // Sem JSON: usa a mensagem padrão.
    }
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
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

const callFunction = async (name: string, body: Record<string, unknown>): Promise<string> => {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(await readError(error));
  const url = (data as { url?: string } | null)?.url;
  if (!url || !isStripeUrl(url)) throw new Error('Não foi possível abrir a página de pagamento.');
  return url;
};

/** Abre o checkout da Stripe para o plano e o intervalo escolhidos. */
export const startCheckout = async (plan: PlanId, interval: Interval): Promise<void> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Entre na sua conta para assinar um plano.');
  window.location.assign(await callFunction('stripe-checkout', { plan, interval }));
};

/** Abre o portal da Stripe para trocar cartão, ver faturas ou cancelar. */
export const openBillingPortal = async (): Promise<void> => {
  window.location.assign(await callFunction('stripe-portal', {}));
};

/** Valores atuais dos preços, lidos da Stripe. */
export const loadPlanPrices = async (): Promise<PlanPrice[]> => {
  const { data, error } = await supabase.functions.invoke('stripe-prices', { body: {} });
  if (error) throw new Error(await readError(error));
  return (data as { prices?: PlanPrice[] } | null)?.prices ?? [];
};

export interface UpgradePreview {
  amountNowCents: number;
  currency: string;
  interval: 'month' | 'year';
}

/** Quanto será cobrado agora para mudar de Básico para Pro (proporcional ao período atual). */
export const previewUpgrade = async (): Promise<UpgradePreview> => {
  const { data, error } = await supabase.functions.invoke('stripe-upgrade', { body: { action: 'preview' } });
  if (error) throw new Error(await readError(error));
  return data as UpgradePreview;
};

/** Efetiva o upgrade para o Pro e cobra a diferença agora. */
export const confirmUpgrade = async (): Promise<{ status: string }> => {
  const { data, error } = await supabase.functions.invoke('stripe-upgrade', { body: { action: 'confirm' } });
  if (error) throw new Error(await readError(error));
  return data as { status: string };
};

/** Atualiza o registro da assinatura direto pela Stripe. Falhas são ignoradas: o webhook continua valendo. */
export const syncSubscription = async (): Promise<void> => {
  try {
    await supabase.functions.invoke('stripe-sync', { body: {} });
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

/** Nível atual da conta: gratuito, sem assinatura ativa; básico ou pro, conforme o plano assinado. */
export const currentTier = async (userId: string): Promise<Tier> => {
  const sub = await loadSubscription(userId);
  const active = sub?.status === 'active' || sub?.status === 'trialing';
  if (!active) return 'free';
  return sub?.plan === 'pro' ? 'pro' : 'basico';
};
