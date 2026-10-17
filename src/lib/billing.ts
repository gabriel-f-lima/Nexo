import { supabase } from './supabase';

export type Interval = 'monthly' | 'yearly';

export interface Subscription {
  status: string;
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
  return 'Não foi possível concluir o pagamento. Tente novamente.';
};

const callFunction = async (name: string, body: Record<string, unknown>): Promise<string> => {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(await readError(error));
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error('Não foi possível abrir a página de pagamento.');
  return url;
};

/** Abre o checkout da Stripe para o plano escolhido. */
export const startCheckout = async (interval: Interval): Promise<void> => {
  window.location.assign(await callFunction('stripe-checkout', { interval }));
};

/** Abre o portal da Stripe para trocar cartão, ver faturas ou cancelar. */
export const openBillingPortal = async (): Promise<void> => {
  window.location.assign(await callFunction('stripe-portal', {}));
};

export const loadSubscription = async (userId: string): Promise<Subscription | null> => {
  const { data, error } = await supabase
    .from('nexo_subscriptions')
    .select('status, interval, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Subscription | null) ?? null;
};
