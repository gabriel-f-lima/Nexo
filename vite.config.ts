import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

interface HeaderRule { source: string; headers: { key: string; value: string }[] }

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as T;
const pkg = readJson<{ version: string }>('./package.json');
// Os cabeçalhos de segurança ficam em vercel.json; o `vite preview` usa os mesmos para testar localmente,
// menos o que só faz sentido com HTTPS (o preview roda em http://localhost).
const vercel = readJson<{ headers?: HeaderRule[] }>('./vercel.json');
const previewHeaders = Object.fromEntries(
  (vercel.headers ?? [])
    .filter((rule) => rule.source === '/(.*)')
    .flatMap((rule) => rule.headers)
    .filter((h) => h.key !== 'Strict-Transport-Security')
    .map((h) => [h.key, h.key === 'Content-Security-Policy' ? h.value.replace(/;\s*upgrade-insecure-requests/, '') : h.value]),
);

/** Endereço do Cloudflare Turnstile (script e iframe da verificação anti-robô). */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * Política de conteúdo: só o próprio site e o projeto Supabase configurado no .env. Com VITE_TURNSTILE_SITE_KEY,
 * libera também o Turnstile. A Stripe não entra: o pagamento abre em checkout.stripe.com, fora do site.
 */
const contentSecurityPolicy = (supabaseUrl: string, captcha: boolean): string => {
  const origin = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    `script-src 'self'${captcha ? ` ${TURNSTILE_ORIGIN}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${origin} ${origin.replace(/^http/, 'ws')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    `frame-src ${captcha ? TURNSTILE_ORIGIN : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
};

/** No build, coloca a CSP no index.html. Assim ela vale em qualquer hospedagem (no dev atrapalharia o recarregamento). */
const securityMeta = (supabaseUrl: string | undefined, captcha: boolean): Plugin => ({
  name: 'nexo-security-meta',
  apply: 'build',
  transformIndexHtml(html) {
    if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL ausente: não é possível gerar a política de segurança.');
    const charset = '<meta charset="UTF-8" />';
    if (!html.includes(charset)) throw new Error('index.html sem <meta charset="UTF-8" />: não é possível inserir a política de segurança.');
    // Logo depois do charset, antes de qualquer script ou estilo.
    return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(supabaseUrl, captcha)}" />`);
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), securityMeta(env.VITE_SUPABASE_URL, Boolean(env.VITE_TURNSTILE_SITE_KEY?.trim()))],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { port: 5173 },
    preview: { headers: previewHeaders },
    // A planilha (SheetJS, ~500 kB) fica num arquivo à parte, baixado só ao exportar: o aviso de tamanho não se aplica a ela.
    build: { sourcemap: false, chunkSizeWarningLimit: 560 },
  };
});
