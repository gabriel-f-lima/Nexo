import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'nexo-chunk-reload-at';

const readReloadAt = (): number => {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};

const writeReloadAt = (value: number | null): void => {
  try {
    if (value === null) window.sessionStorage.removeItem(RELOAD_KEY);
    else window.sessionStorage.setItem(RELOAD_KEY, String(value));
  } catch {
    // Sem armazenamento: só não evita recarregar duas vezes seguidas.
  }
};

/**
 * Tela carregada só quando é aberta. Se o arquivo dela não existir mais (o site foi atualizado com a aba aberta),
 * recarrega a página uma vez para buscar a versão nova; se falhar de novo logo em seguida, mostra o erro.
 */
export const lazyPage = <T extends ComponentType>(load: () => Promise<{ default: T }>) =>
  lazy(async () => {
    try {
      const page = await load();
      writeReloadAt(null);
      return page;
    } catch (error) {
      if (Date.now() - readReloadAt() > 15_000) {
        writeReloadAt(Date.now());
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  });

/** Baixa as telas em segundo plano, quando o navegador estiver livre, para a navegação ficar instantânea. */
export const prefetchWhenIdle = (loaders: Array<() => Promise<unknown>>): (() => void) => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;
  const run = () => loaders.forEach((load) => { load().catch(() => undefined); });
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(run, 2500);
  return () => globalThis.clearTimeout(id);
};
