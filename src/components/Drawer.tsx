import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellOff, CalendarDays, CheckSquare, HelpCircle, Settings, Sparkles, Wallet, X, Zap, Shield, Calendar, ChevronRight } from 'lucide-react';
import { useUiStore } from '../store/ui';
import { useAuthStore } from '../store/auth';
import { useTier } from '../lib/useTier';
import { notify } from '../lib/toast';
import {
  canNotify, disableReminder, enableReminder, getReminder, sendTestNotification, type DailyReminder,
} from '../lib/reminder';

const MENU = [
  { to: '/app/chat', label: 'Assistente', icon: Sparkles },
  { to: '/app/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/app/rotina', label: 'Rotina', icon: CheckSquare },
  { to: '/app/financas', label: 'Controle financeiro', icon: Wallet },
  { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
  { to: '/app/ajuda', label: 'Ajuda', icon: HelpCircle },
];

const TIMES = [
  { label: 'Manhã', value: '08:00' },
  { label: 'Meio do dia', value: '13:00' },
  { label: 'Noite', value: '20:00' },
];

const formatHM = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Menu lateral: mesmas opções e cartões do menu do aplicativo. */
export default function Drawer() {
  const open = useUiStore((s) => s.drawerOpen);
  const setOpen = useUiStore((s) => s.setDrawerOpen);
  const location = useLocation();
  const navigate = useNavigate();
  const [reminder, setReminder] = useState<DailyReminder | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState('08:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setReminder(getReminder()); }, [reminderOpen, open]);
  useEffect(() => { setOpen(false); }, [location.pathname, setOpen]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const describeError = (e: unknown) => {
    const message = e instanceof Error ? e.message : '';
    if (message === 'NOTIFICATIONS_UNSUPPORTED') return 'Este navegador não oferece notificações.';
    if (message === 'NOTIFICATIONS_PERMISSION_DENIED') {
      return 'A permissão de notificações está bloqueada. Libere-a nas configurações do navegador e tente de novo.';
    }
    return 'Não foi possível configurar o lembrete. Tente novamente.';
  };

  const activate = async () => {
    setBusy(true);
    setError('');
    try {
      const [h, m] = selectedTime.split(':').map(Number);
      const saved = await enableReminder(h, m);
      setReminder(saved);
      setReminderOpen(false);
      notify(`Lembrete ativado: todos os dias às ${selectedTime}.`, 'success');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = () => {
    disableReminder();
    setReminder(null);
    setReminderOpen(false);
    notify('Lembrete desativado.', 'info');
  };

  const test = async () => {
    setBusy(true);
    setError('');
    try {
      await sendTestNotification();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="overlay"
              className="drawer-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
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
              <div className="row between">
                <span className="drawer-title">Menu</span>
                <motion.button
                  type="button"
                  className="icon-btn plain sm"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setOpen(false)}
                  aria-label="Fechar menu"
                >
                  <X size={17} />
                </motion.button>
              </div>

              <button type="button" className="drawer-card" onClick={() => navigate('/app/home')}>
                <div className="row between" style={{ marginBottom: 12 }}>
                  <span className="text-2" style={{ fontSize: 13 }}>Hoje</span>
                  <span className="eyebrow" style={{ background: 'var(--accent-soft)', padding: '3px 10px', borderRadius: 12 }}>Seu dia</span>
                </div>
                <div className="row gap-md">
                  <Calendar size={26} />
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Organize seu dia</div>
                    <div className="text-2" style={{ fontSize: 13, marginTop: 2 }}>Tarefas, compromissos e metas da rotina</div>
                  </div>
                </div>
              </button>

              <PlanBadge />
              <nav className="card menu-card" aria-label="Principal">
                {MENU.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`}
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </nav>

              <div className="eyebrow" style={{ color: 'var(--text-2)', marginTop: 4 }}>Dicas rápidas</div>
              <button type="button" className="drawer-card" onClick={() => setReminderOpen(true)}>
                <div className="tip-row">
                  <div className={`tip-icon${reminder ? ' on' : ''}`}>
                    {reminder ? <Bell size={18} /> : <BellOff size={18} />}
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{reminder ? 'Lembrete ativo' : 'Ative lembretes'}</div>
                    <div className="text-2" style={{ fontSize: 12, marginTop: 2 }}>
                      {reminder ? `Todos os dias às ${formatHM(reminder.hour, reminder.minute)} · neste navegador` : 'Escolha um horário para organizar seu dia'}
                    </div>
                  </div>
                  <ChevronRight size={17} className="muted" />
                </div>
              </button>
              <button type="button" className="drawer-card" onClick={() => navigate('/app/financas')}>
                <div className="tip-row">
                  <div className="tip-icon"><Zap size={18} /></div>
                  <div className="grow">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Revise o mês</div>
                    <div className="text-2" style={{ fontSize: 12, marginTop: 2 }}>Acompanhe seus gastos e metas</div>
                  </div>
                </div>
              </button>

              <button type="button" className="drawer-card" onClick={() => navigate('/termos')}>
                <div className="tip-row">
                  <div className="tip-icon"><Shield size={18} /></div>
                  <div className="grow">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Termos e privacidade</div>
                    <div className="text-2" style={{ fontSize: 12, marginTop: 2 }}>Como usamos e protegemos seus dados</div>
                  </div>
                </div>
              </button>

              <p className="center muted" style={{ fontSize: 12, marginTop: 6 }}>NuvoraAi · versão 1.2.0</p>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {reminderOpen ? (
          <motion.div
            key="reminder-backdrop"
            className="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => { if (event.target === event.currentTarget) setReminderOpen(false); }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              <div className="modal-head">
                <div className="tip-icon" style={{ width: 42, height: 42, borderRadius: 14 }}><Bell size={22} /></div>
                <button type="button" className="icon-btn plain sm" onClick={() => setReminderOpen(false)} aria-label="Fechar lembretes">
                  <X size={17} />
                </button>
              </div>
              <h2 className="modal-title">Lembrete diário</h2>
              <p className="text-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
                Escolha quando o Nuvora deve lembrar você de conferir o seu dia. O aviso aparece neste navegador enquanto ele estiver aberto.
              </p>

              <div className="row gap-sm">
                {TIMES.map((time) => {
                  const selected = selectedTime === time.value;
                  return (
                    <motion.button
                      key={time.value}
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      className="grow"
                      onClick={() => setSelectedTime(time.value)}
                      role="radio"
                      aria-checked={selected}
                      style={{
                        minHeight: 64, borderRadius: 13, display: 'grid', placeItems: 'center', gap: 4,
                        background: selected ? 'var(--accent-soft)' : 'var(--bg)',
                        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                        color: selected ? 'var(--accent)' : 'var(--muted)',
                      }}
                    >
                      <span style={{ fontSize: 11 }}>{time.label}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{time.value}</span>
                    </motion.button>
                  );
                })}
              </div>

              {error ? <div className="warn-block"><span className="error">{error}</span></div> : null}

              <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block" onClick={activate} disabled={busy}>
                {reminder ? `Atualizar para ${selectedTime}` : `Ativar às ${selectedTime}`}
              </motion.button>
              <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-blue btn-block" onClick={test} disabled={busy}>
                Testar notificação agora
              </motion.button>
              {reminder ? (
                <button type="button" className="link-btn" style={{ color: 'var(--danger)', alignSelf: 'center' }} onClick={deactivate} disabled={busy}>
                  Desativar lembrete diário
                </button>
              ) : null}
              {!canNotify() ? <p className="footnote">Este navegador não oferece notificações do sistema.</p> : null}
              <p className="footnote">Você pode alterar ou cancelar este lembrete a qualquer momento.</p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

/** Mostra o plano atual no menu. Toque leva às configurações do plano. */
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
