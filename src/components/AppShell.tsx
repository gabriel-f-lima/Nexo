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

      <ErrorBoundary key={location.pathname}>
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.main>
      </ErrorBoundary>

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
        >
          <Sparkles size={26} />
        </motion.button>
      ) : null}

      <AuthModal />
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
