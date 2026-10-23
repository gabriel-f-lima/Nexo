export type ToastTone = 'info' | 'success' | 'error';
export interface Toast { id: number; message: string; tone: ToastTone; key: string }

const DURATION = 3800;
const MAX_VISIBLE = 3;

let items: Toast[] = [];
let nextId = 1;
const timers = new Map<number, number>();
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((listener) => listener([...items]));

const remove = (id: number) => {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((item) => item.id !== id);
  emit();
};

const schedule = (id: number) => {
  window.clearTimeout(timers.get(id));
  timers.set(id, window.setTimeout(() => remove(id), DURATION));
};

/**
 * Mostra uma mensagem curta que some sozinha.
 * Avisos com a mesma chave (ou o mesmo texto) substituem o anterior em vez de empilhar,
 * para cliques repetidos não encherem a tela.
 */
export const notify = (message: string, tone: ToastTone = 'info', key: string = message): void => {
  const existing = items.find((item) => item.key === key);
  if (existing) {
    items = items.map((item) => (item.id === existing.id ? { ...item, message, tone } : item));
    schedule(existing.id);
    emit();
    return;
  }
  const id = nextId++;
  items = [...items, { id, message, tone, key }];
  while (items.length > MAX_VISIBLE) remove(items[0].id);
  schedule(id);
  emit();
};

export const subscribeToasts = (listener: (t: Toast[]) => void): (() => void) => {
  listeners.add(listener);
  listener([...items]);
  return () => { listeners.delete(listener); };
};
