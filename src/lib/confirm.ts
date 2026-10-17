/** Caixa de confirmação (substitui o Alert do React Native). */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<(r: ConfirmRequest | null) => void>();
const emit = () => listeners.forEach((listener) => listener(current));

export const confirmAction = (options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    if (current) current.resolve(false);
    current = { ...options, resolve };
    emit();
  });

export const resolveConfirm = (value: boolean): void => {
  if (!current) return;
  const request = current;
  current = null;
  request.resolve(value);
  emit();
};

export const subscribeConfirm = (listener: (r: ConfirmRequest | null) => void): (() => void) => {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
};
