import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import Drawer from './Drawer';
import AuthModal from './AuthModal';
import { ConfirmHost, ToastHost } from './Hosts';
import { ErrorBoundary } from './ErrorBoundary';
import { useAuthStore } from '../store/auth';
import { useDataStore } from '../store/data';
import { startReminderWatcher } from '../lib/reminder';

/** Só caminhos internos do app vindos de notificações. */
const isAppPath = (value: unknown): value is string => typeof value === 'string' && /^\/app(\/[a-z-]*)?$/.test(value);

/** Casca do aplicativo: menu, botão do assistente, modais e a página atual. */
export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const initializing = useAuthStore((s) => s.initializing);

  useEffect(() => startReminderWatcher(), []);
  useEffect(() => {
    const id = window.setInterval(() => useDataStore.getState().pruneExpiredLocal(), 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Clique numa notificação: abre a tela indicada sem recarregar o app.
  useEffect(() => {
    const onWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown } | null;
      if (data?.type === 'nexo:navigate' && isAppPath(data.url)) navigate(data.url);
    };
    const onLocal = (event: Event) => {
      const url = (event as CustomEvent).detail;
      if (isAppPath(url)) navigate(url);
    };
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
    window.addEventListener('nexo:navigate', onLocal);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
      window.removeEventListener('nexo:navigate', onLocal);
    };
  }, [navigate]);

  if (initializing) {
    return (
      <div className="loading" role="status" aria-label="Carregando">
        <div className="spinner" />
      </div>
    );
  }

  const onChat = location.pathname === '/app/chat';

  return (
    <div className="app-root">
      <Drawer />

      <div className="app-main">
        <ErrorBoundary key={location.pathname}>
          <motion.main
            key={location.pathname}
            // No chat só esmaece: um transform aqui deslocaria a tela fixa do assistente.
            initial={onChat ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={onChat ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.main>
        </ErrorBoundary>
      </div>

      {!onChat ? (
        <motion.button
          type="button"
          className="fab"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          onClick={() => navigate('/app/chat')}
          aria-label="Abrir assistente de IA"
          title="Abrir assistente"
        >
          <Sparkles size={24} />
        </motion.button>
      ) : null}

      <AuthModal />
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
