import { create } from 'zustand';

interface UiState {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),
}));
