import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, BellOff, CalendarDays, CheckSquare, ChevronRight, HelpCircle, LogIn, Settings, Sparkles, Sun, Wallet, X,
} from 'lucide-react';
import { useUiStore } from '../store/ui';
import { useAuthStore } from '../store/auth';
import { useTier } from '../lib/useTier';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNotificationSettings } from '../lib/reminder';
import { displayName } from '../lib/user';
import { Modal } from './ui';
import NotificationSettings from './NotificationSettings';

const MENU = [
  { to: '/app/chat', label: 'Assistente', icon: Sparkles },
  { to: '/app/home', label: 'Seu dia', icon: Sun },
  { to: '/app/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/app/rotina', label: 'Rotina', icon: CheckSquare },
  { to: '/app/financas', label: 'Controle financeiro', icon: Wallet },
  { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
  { to: '/app/ajuda', label: 'Ajuda', icon: HelpCircle },
];

/** Largura a partir da qual o menu fica fixo ao lado do conteúdo. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

const formatHM = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Menu do app: fixo na lateral no computador e em gaveta no celular. */
export default function Drawer() {
  const open = useUiStore((s) => s.drawerOpen);
  const setOpen = useUiStore((s) => s.setDrawerOpen);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname, setOpen]);
  useEffect(() => { if (desktop) setOpen(false); }, [desktop, setOpen]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <>
      {desktop ? (
        <aside className="sidebar" aria-label="Menu">
          <SidebarContent />
        </aside>
      ) : (
        <AnimatePresence>
          {open ? (
            <>
              <motion.div
                key="overlay"
                className="drawer-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, pointerEvents: 'auto' }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                onClick={() => setOpen(false)}
              />
              <motion.aside
                key="drawer"
                className="drawer"
                initial={{ x: '-102%' }}
                animate={{ x: 0 }}
                exit={{ x: '-102%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 36 }}
                aria-label="Menu"
              >
                <SidebarContent onClose={() => setOpen(false)} />
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>
      )}

      <Modal open={notificationsOpen} onClose={() => setNotificationsOpen(false)} title="Notificações">
        <NotificationSettings />
      </Modal>
    </>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);
  const { reminder, eventAlertMinutes, permission } = useNotificationSettings();

  const notificationsOn = permission === 'granted' && (!!reminder || eventAlertMinutes > 0);
  const notificationSummary = permission === 'denied'
    ? 'Bloqueadas no navegador'
    : !notificationsOn
      ? 'Toque para configurar'
      : reminder
        ? `Lembrete às ${formatHM(reminder.hour, reminder.minute)}${eventAlertMinutes ? ' · agenda' : ''}`
        : 'Avisos da agenda ativos';
  const name = displayName(user);

  return (
    <div className="sidebar-inner">
      <div className="sidebar-brand">
        <img src="/nexo-logo.png" alt="" width={30} height={30} />
        <span>Nexo</span>
        {onClose ? (
          <motion.button
            type="button"
            className="icon-btn plain sm sidebar-close"
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Fechar menu"
          >
            <X size={17} />
          </motion.button>
        ) : null}
      </div>

      <nav className="sidebar-nav" aria-label="Principal">
        {MENU.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`}
          >
            <item.icon size={19} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-section">
        <button
          type="button"
          className={`sidebar-card${notificationsOn ? ' on' : ''}`}
          onClick={() => { onClose?.(); setNotificationsOpen(true); }}
          aria-label={`Notificações: ${notificationSummary}`}
        >
          <span className="tip-icon">{notificationsOn ? <Bell size={17} /> : <BellOff size={17} />}</span>
          <span className="grow">
            <span className="sidebar-card-title">Notificações</span>
            <span className="sidebar-card-desc">{notificationSummary}</span>
          </span>
          <span className={`status-dot${notificationsOn ? ' on' : ''}`} aria-hidden="true" />
        </button>
        <PlanBadge />
      </div>

      <div className="sidebar-footer">
        {user ? (
          <button type="button" className="account-chip" onClick={() => navigate('/app/configuracoes')}>
            <span className="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
            <span className="grow">
              <span className="account-name">{name}</span>
              <span className="account-mail">{user.email ?? 'Conta conectada'}</span>
            </span>
            <ChevronRight size={16} className="muted" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-block" onClick={() => { onClose?.(); requireAuth(); }}>
            <LogIn size={17} /> Entrar ou criar conta
          </button>
        )}
        <div className="sidebar-meta">
          <button type="button" className="link-btn" onClick={() => navigate('/termos')}>Termos e privacidade</button>
          <span>Nexo · v{__APP_VERSION__}</span>
        </div>
      </div>
    </div>
  );
}

/** Mostra o plano atual no menu. Leva às configurações do plano. */
function PlanBadge() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const tier = useTier(userId);
  const label = tier === 'loading'
    ? 'Carregando plano…'
    : tier === 'pro' ? 'Plano Pro' : tier === 'basico' ? 'Plano Básico' : 'Plano gratuito';
  return (
    <button type="button" className="plan-menu-chip" onClick={() => navigate('/app/configuracoes')}>
      <span className={`plan-dot ${tier === 'loading' ? 'free' : tier}`} />
      <span className="grow">{label}</span>
      <ChevronRight size={16} />
    </button>
  );
}
