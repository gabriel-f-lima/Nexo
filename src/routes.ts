import { lazyPage } from './lib/lazyPage';

/* Cada tela vira um arquivo separado, baixado só quando é aberta. */

export const appPageLoaders = {
  chat: () => import('./pages/Chat'),
  home: () => import('./pages/Home'),
  agenda: () => import('./pages/Agenda'),
  rotina: () => import('./pages/Rotina'),
  financas: () => import('./pages/Financas'),
  metas: () => import('./pages/Metas'),
  conquistas: () => import('./pages/Conquistas'),
  configuracoes: () => import('./pages/Configuracoes'),
  ajuda: () => import('./pages/Ajuda'),
  perfil: () => import('./pages/Perfil'),
};

export const Landing = lazyPage(() => import('./pages/Landing'));
export const Termos = lazyPage(() => import('./pages/Termos'));
export const NotFound = lazyPage(() => import('./pages/NotFound'));
export const AppShell = lazyPage(() => import('./components/AppShell'));

export const Chat = lazyPage(appPageLoaders.chat);
export const Home = lazyPage(appPageLoaders.home);
export const Agenda = lazyPage(appPageLoaders.agenda);
export const Rotina = lazyPage(appPageLoaders.rotina);
export const Financas = lazyPage(appPageLoaders.financas);
export const Metas = lazyPage(appPageLoaders.metas);
export const Conquistas = lazyPage(appPageLoaders.conquistas);
export const Configuracoes = lazyPage(appPageLoaders.configuracoes);
export const Ajuda = lazyPage(appPageLoaders.ajuda);
export const Perfil = lazyPage(appPageLoaders.perfil);
