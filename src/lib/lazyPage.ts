import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'nexo:chunk-reload';

/**
 * Página carregada só quando for aberta (deixa a primeira tela mais leve).
 * Se o arquivo da página sumiu porque saiu uma versão nova do site, recarrega uma vez para buscar a atual.
 */
export const lazyPage = <T extends ComponentType<object>>(load: () => Promise<{ default: T }>) =>
  lazy(() => load()
    .then((module) => {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* sem armazenamento */ }
      return module;
    })
    .catch((error: unknown) => {
      let reloaded = true;
      try {
        reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
        if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
      } catch { /* sem armazenamento: não arrisca recarregar em loop */ }
      if (!reloaded) window.location.reload();
      throw error;
    }));
