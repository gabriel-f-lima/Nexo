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

/** Política de conteúdo: só o próprio site e o projeto Supabase configurado no .env. */
const contentSecurityPolicy = (supabaseUrl: string): string => {
  const origin = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // https: libera as imagens externas que o assistente mostra nas respostas.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${origin} ${origin.replace(/^http/, 'ws')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
};

/** No build, coloca a CSP no index.html. Assim ela vale em qualquer hospedagem (no dev atrapalharia o recarregamento). */
const securityMeta = (supabaseUrl: string | undefined): Plugin => ({
  name: 'nexo-security-meta',
  apply: 'build',
  transformIndexHtml(html) {
    if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL ausente: não é possível gerar a política de segurança.');
    const charset = '<meta charset="UTF-8" />';
    if (!html.includes(charset)) throw new Error('index.html sem <meta charset="UTF-8" />: não é possível inserir a política de segurança.');
    // Logo depois do charset, antes de qualquer script ou estilo.
    return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(supabaseUrl)}" />`);
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), securityMeta(env.VITE_SUPABASE_URL)],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { port: 5173 },
    preview: { headers: previewHeaders },
    build: { sourcemap: false },
  };
});
