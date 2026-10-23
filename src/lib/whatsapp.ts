/** Número do Nexo no WhatsApp (só dígitos, com DDI). Sem ele, a integração fica escondida. */
export const NEXO_WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');

/** Integração ligada no site: a função whatsapp-webhook precisa estar configurada (docs/whatsapp.md). */
export const whatsappEnabled = import.meta.env.VITE_WHATSAPP_ENABLED === 'true' && NEXO_WHATSAPP_NUMBER.length >= 10;
