import { lazyPage } from '../lib/lazyPage';

/** Telas do app, cada uma em um arquivo separado, baixado quando for aberta (ou antes, em segundo plano). */
const loaders = {
  Chat: () => import('./Chat'),
  Home: () => import('./Home'),
  Agenda: () => import('./Agenda'),
  Rotina: () => import('./Rotina'),
  Financas: () => import('./Financas'),
  Configuracoes: () => import('./Configuracoes'),
  Ajuda: () => import('./Ajuda'),
  Perfil: () => import('./Perfil'),
};

export const appPages = {
  Chat: lazyPage(loaders.Chat),
  Home: lazyPage(loaders.Home),
  Agenda: lazyPage(loaders.Agenda),
  Rotina: lazyPage(loaders.Rotina),
  Financas: lazyPage(loaders.Financas),
  Configuracoes: lazyPage(loaders.Configuracoes),
  Ajuda: lazyPage(loaders.Ajuda),
  Perfil: lazyPage(loaders.Perfil),
};

/** Baixa as outras telas quando o navegador estiver livre, para a troca de tela ser instantânea. */
export const prefetchAppPages = (): (() => void) => {
  const run = () => { Object.values(loaders).forEach((load) => { void load().catch(() => undefined); }); };
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
};
