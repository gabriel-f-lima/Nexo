/// <reference types="vite/client" />

/** Versão do package.json, injetada pelo Vite no build. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Site key do Cloudflare Turnstile. Vazia = verificação anti-robô desligada no pagamento. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** "true" mostra a opção de vincular o WhatsApp (precisa da função whatsapp-webhook configurada). */
  readonly VITE_WHATSAPP_ENABLED?: string;
  /** Número do Nexo no WhatsApp, só dígitos com DDI (ex.: 5511999999999). */
  readonly VITE_WHATSAPP_NUMBER?: string;
}
