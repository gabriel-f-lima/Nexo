export type ToastTone = 'info' | 'success' | 'error';
export interface Toast { id: number; message: string; tone: ToastTone }

let items: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((listener) => listener([...items]));

/** Mostra uma mensagem curta que some sozinha. */
export const notify = (message: string, tone: ToastTone = 'info'): void => {
  const id = nextId++;
  items = [...items, { id, message, tone }];
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 3800);
};

export const subscribeToasts = (listener: (t: Toast[]) => void): (() => void) => {
  listeners.add(listener);
  listener([...items]);
  return () => { listeners.delete(listener); };
};
