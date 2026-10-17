import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useUiStore } from '../store/ui';

export const MenuButton = () => {
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  return (
    <motion.button
      type="button"
      className="icon-btn"
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.04 }}
      onClick={() => setDrawerOpen(true)}
      aria-label="Abrir menu"
    >
      <Menu size={21} />
    </motion.button>
  );
};

export const Header = ({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) => (
  <header className="app-header">
    <MenuButton />
    <div className="copy">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
    {action}
  </header>
);

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Janela sobreposta com fundo escurecido, que fecha ao clicar fora ou com Esc. */
export const Modal = ({ open, onClose, title, children }: ModalProps) => {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="modal-backdrop"
          className="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
          onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className="modal"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {title ? (
              <div className="modal-head">
                <h2 className="modal-title">{title}</h2>
                <button type="button" className="icon-btn plain sm" onClick={onClose} aria-label="Fechar">
                  <X size={17} />
                </button>
              </div>
            ) : null}
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
