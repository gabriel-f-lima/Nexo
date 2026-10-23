// Cloudflare Turnstile (verificação anti-robô) nas ações que cobram. Só é usado quando VITE_TURNSTILE_SITE_KEY existe;
// o servidor confere o token com TURNSTILE_SECRET_KEY do mesmo widget.

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 60_000;

export const captchaEnabled = (): boolean => SITE_KEY.length > 0;

let loading: Promise<TurnstileApi> | null = null;

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  });
  return loading;
};

/** Token de uso único para a ação. O desafio só aparece no container se a Cloudflare pedir interação. */
export const getCaptchaToken = async (container: HTMLElement, action: 'checkout' | 'upgrade'): Promise<string | undefined> => {
  if (!captchaEnabled()) return undefined;
  let api: TurnstileApi;
  try {
    api = await loadTurnstile();
  } catch {
    throw new Error('Não foi possível carregar a verificação de segurança. Confira a conexão ou libere este site no bloqueador de anúncios.');
  }

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    let timer = 0;
    const finish = (done: () => void) => {
      window.clearTimeout(timer);
      if (widgetId) {
        try { api.remove(widgetId); } catch { /* widget já removido */ }
        widgetId = null;
      }
      done();
    };
    const fail = (message: string) => () => finish(() => reject(new Error(message)));

    timer = window.setTimeout(fail('A verificação de segurança demorou demais. Tente de novo.'), TIMEOUT_MS);
    try {
      widgetId = api.render(container, {
        sitekey: SITE_KEY,
        action,
        theme: 'dark',
        language: 'pt-br',
        appearance: 'interaction-only',
        callback: (token: string) => finish(() => resolve(token)),
        'error-callback': fail('Não conseguimos confirmar que é você. Tente de novo.'),
        'expired-callback': fail('A verificação expirou. Tente de novo.'),
        'timeout-callback': fail('A verificação expirou. Tente de novo.'),
      });
    } catch {
      fail('Não foi possível iniciar a verificação de segurança. Recarregue a página.')();
    }
  });
};
