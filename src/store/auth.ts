import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useDataStore } from './data';
import { useFinanceStore } from './finance';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** true até descobrir se já existe uma sessão salva no navegador. */
  initializing: boolean;
  /** Modal de login visível. */
  promptVisible: boolean;
  /** Ação que o usuário tentou fazer e que roda logo após o login. */
  pendingAction: (() => void) | null;
  /** Por que o login foi pedido, exibido no topo do modal. */
  promptReason: string | null;

  init: () => () => void;
  /** Executa a ação se houver sessão; senão abre o login (com o motivo) e executa depois de entrar. */
  requireAuth: (action?: () => void, reason?: string) => void;
  closePrompt: () => void;
}

/** Aplica a sessão à store de dados: carrega a conta ou limpa tudo ao sair. */
const applySession = (session: Session | null) => {
  useAuthStore.setState({ session, user: session?.user ?? null, initializing: false });
  if (session) {
    // getSession e o primeiro evento de autenticação chegam juntos: evita carregar a mesma conta duas vezes.
    if (useDataStore.getState().userId === session.user.id) return;
    // O financeiro carrega depois da conta, para que a marca de inicialização já exista.
    const userId = session.user.id;
    void useDataStore.getState().activate(session.user).then(() => useFinanceStore.getState().load(userId));
  } else {
    useDataStore.getState().reset();
    useFinanceStore.getState().reset();
  }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  initializing: true,
  promptVisible: false,
  pendingAction: null,
  promptReason: null,

  init: () => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      applySession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Renovações de token não mudam a conta; só o login e a saída importam.
      if (event === 'TOKEN_REFRESHED') {
        set({ session, user: session?.user ?? null });
        return;
      }
      applySession(session);

      if (session) {
        const { pendingAction, promptVisible } = get();
        if (promptVisible || pendingAction) {
          set({ promptVisible: false, pendingAction: null, promptReason: null });
          if (pendingAction) window.setTimeout(pendingAction, 0);
        }
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  },

  requireAuth: (action, reason) => {
    if (get().session) {
      action?.();
      return;
    }
    set({ promptVisible: true, pendingAction: action ?? null, promptReason: reason ?? null });
  },

  closePrompt: () => set({ promptVisible: false, pendingAction: null, promptReason: null }),
}));
