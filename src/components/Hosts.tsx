import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveConfirm, subscribeConfirm, type ConfirmRequest } from '../lib/confirm';
import { subscribeToasts, type Toast } from '../lib/toast';

/** Renderiza a caixa de confirmação solicitada por confirmAction(). */
export const ConfirmHost = () => {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  useEffect(() => subscribeConfirm(setRequest), []);
  useEffect(() => {
    if (!request) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') resolveConfirm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  return (
    <AnimatePresence>
      {request ? (
        <motion.div
          key="confirm"
          className="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, pointerEvents: 'auto' }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) resolveConfirm(false); }}
          role="alertdialog"
          aria-modal="true"
        >
          <motion.div
            className="modal"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <h2 className="modal-title">{request.title}</h2>
            <p className="text-2" style={{ fontSize: 14, lineHeight: 1.55 }}>{request.message}</p>
            <div className="row gap-sm" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => resolveConfirm(false)}>Cancelar</button>
              <button
                type="button"
                className={`btn btn-sm ${request.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => resolveConfirm(true)}
              >
                {request.confirmText ?? 'Confirmar'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

/** Mensagens curtas no topo da tela. */
export const ToastHost = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {items.map((toast) => (
          <motion.div
            key={toast.id}
            className={`toast ${toast.tone}`}
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
