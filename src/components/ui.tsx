import { useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useUiStore } from '../store/ui';

/** Abre o menu no celular (no computador o menu fica fixo e este botão some). */
export const MenuButton = () => {
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  return (
    <motion.button
      type="button"
      className="icon-btn menu-btn"
      whileTap={{ scale: 0.9 }}
      onClick={() => setDrawerOpen(true)}
      aria-label="Abrir menu"
      title="Menu"
    >
      <Menu size={20} />
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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    // Leva o foco para a janela, para o teclado e o leitor de tela começarem nela.
    const focusTimer = window.setTimeout(() => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Só a janela mais à frente fecha com o Esc.
      const panels = document.querySelectorAll('.modal');
      if (panels[panels.length - 1] === panelRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="modal-backdrop"
          className="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, pointerEvents: 'auto' }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          <motion.div
            ref={panelRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
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
