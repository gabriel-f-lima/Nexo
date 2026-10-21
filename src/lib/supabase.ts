import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error('Supabase não configurado. Crie o arquivo .env (veja .env.example) e reinicie o servidor.');
}

/** Endereço do projeto e chave pública, usados nas chamadas diretas às funções (respostas em streaming). */
export const supabaseUrl = url.replace(/\/$/, '');
export const supabasePublishableKey = key;

// Mesmo projeto e mesmas tabelas do aplicativo mobile. O PKCE é o fluxo recomendado para web.
export const supabase = createClient(url, key, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
