import { create } from 'zustand';

interface UiState {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** Janela de configuração das notificações, aberta pelo menu. */
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  notificationsOpen: false,
  setNotificationsOpen: (open) => set({ notificationsOpen: open }),
}));
