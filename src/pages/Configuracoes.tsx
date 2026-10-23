import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, CloudOff, CloudUpload, CheckCircle2, LogOut, RefreshCw, Shield, ChevronRight, User, KeyRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Header } from '../components/ui';
import { useAuthStore } from '../store/auth';
import { useDataStore } from '../store/data';
import { authService } from '../lib/auth';
import { translateAuthError } from '../lib/authErrors';
import { confirmAction } from '../lib/confirm';
import { notify } from '../lib/toast';
import { displayName } from '../lib/user';
import DeleteAccountModal from '../components/DeleteAccountModal';
import NotificationSettings from '../components/NotificationSettings';
import PlanCard from '../components/PlanCard';
import WhatsAppCard from '../components/WhatsAppCard';
import { whatsappEnabled } from '../lib/whatsapp';

/** Conta, sincronização e segurança, como a tela de Configurações do app. */
export default function Configuracoes() {
  const user = useAuthStore((s) => s.user);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const syncStatus = useDataStore((s) => s.syncStatus);
  const syncMessage = useDataStore((s) => s.syncMessage);
  const navigate = useNavigate();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const providers = (user?.app_metadata?.providers as string[] | undefined)
    ?? (user?.app_metadata?.provider ? [String(user.app_metadata.provider)] : []);
  const loginMethod = providers.includes('google') ? 'Google' : 'E-mail e senha ou código por e-mail';

  const SyncIcon = !user ? Cloud
    : syncStatus === 'error' ? CloudOff
    : syncStatus === 'syncing' ? RefreshCw
    : syncStatus === 'synced' ? CheckCircle2
    : CloudUpload;
  const syncColor = syncStatus === 'error' ? 'var(--danger)' : syncStatus === 'synced' ? 'var(--accent)' : 'var(--blue)';
  const syncLabel = syncMessage ?? (user
    ? 'Sincronização pronta.'
    : 'A sincronização começa quando você entrar na sua conta.');

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    if (newPassword.length < 8) { setPasswordError('A nova senha deve ter pelo menos 8 caracteres.'); return; }
    if (!/[A-Za-zÀ-ÿ]/.test(newPassword) || !/\d/.test(newPassword)) { setPasswordError('Use letras e números na nova senha.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('As senhas não coincidem.'); return; }
    setSaving(true);
    try {
      await authService.updatePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOpen(false);
      notify('Senha alterada com sucesso.', 'success');
    } catch (error) {
      setPasswordError(translateAuthError(error, 'Não foi possível alterar a senha. Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    const ok = await confirmAction({
      title: 'Sair da conta',
      message: 'Você terá de entrar novamente para usar as funcionalidades da conta.',
      confirmText: 'Sair',
      danger: true,
    });
    if (!ok) return;
    try {
      await authService.signOut();
      navigate('/app/chat');
    } catch {
      notify('Não foi possível sair. Tente novamente.', 'error');
    }
  };

  return (
    <div className="screen">
      <Header title="Configurações" subtitle="Conta, notificações e segurança" />

      <div className="screen-stack">
        <div className="eyebrow" style={{ color: 'var(--text-2)' }}>A sua conta</div>
        <div className="card">
          {user ? (
            <div className="kv">
              <div className="row gap-md" style={{ marginBottom: 6 }}>
                <div className="icon-btn"><User size={19} /></div>
                <div className="grow">
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{displayName(user)}</div>
                  <div className="text-2" style={{ fontSize: 13 }}>{user.email ?? 'E-mail indisponível'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 600 }}>Ainda não iniciou sessão</div>
              <div className="text-2" style={{ fontSize: 13, lineHeight: 1.5 }}>Entre para gerenciar a conta, a agenda e a rotina.</div>
              <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block" onClick={() => requireAuth()}>
                Entrar ou criar conta
              </motion.button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row gap-md">
            <SyncIcon size={22} color={syncColor} className={syncStatus === 'syncing' ? 'spin-icon' : undefined} />
            <div className="grow">
              <div style={{ fontWeight: 600, fontSize: 15 }}>Dados na nuvem</div>
              <div className="text-2" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>{syncLabel}</div>
            </div>
          </div>
        </div>

        <div className="eyebrow" style={{ color: 'var(--text-2)' }}>Segurança</div>
        <div className="card" style={{ display: 'grid', gap: 14 }}>
          <div className="setting-row">
            <Shield size={20} color="var(--accent)" />
            <div className="grow">
              <div className="title">Método de acesso</div>
              <div className="desc">{user ? loginMethod : 'Google, senha ou código por e-mail'}</div>
            </div>
          </div>

          {user ? (
            <>
              <button type="button" className="setting-row" onClick={() => { setPasswordError(''); setPasswordOpen((v) => !v); }}>
                <KeyRound size={20} color="var(--accent)" />
                <div className="grow">
                  <div className="title">Alterar senha</div>
                  <div className="desc">Defina uma nova senha para a sua conta</div>
                </div>
                <ChevronRight size={17} className="muted" />
              </button>

              <AnimatePresence initial={false}>
                {passwordOpen ? (
                  <motion.form
                    key="password-form"
                    onSubmit={savePassword}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: 'hidden', display: 'grid', gap: 10 }}
                  >
                    <p className="text-2" style={{ fontSize: 12 }}>Use pelo menos 8 caracteres, com letras e números.</p>
                    <input className="input" type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha" autoComplete="new-password" />
                    <input className="input" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirmar nova senha" autoComplete="new-password" />
                    <button type="button" className="link-btn" style={{ justifySelf: 'start', padding: 0 }} onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? 'Ocultar senhas' : 'Mostrar senhas'}
                    </button>
                    {passwordError ? <p className="error">{passwordError}</p> : null}
                    <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block" disabled={saving}>
                      {saving ? 'Salvando…' : 'Guardar nova senha'}
                    </motion.button>
                  </motion.form>
                ) : null}
              </AnimatePresence>

              <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-danger btn-block" onClick={signOut}>
                <LogOut size={17} /> Sair da conta
              </motion.button>
            </>
          ) : null}
        </div>

        <div className="eyebrow" style={{ color: 'var(--text-2)' }}>Notificações</div>
        <div className="card">
          <NotificationSettings />
        </div>

        {whatsappEnabled && user ? (
          <>
            <div className="eyebrow" style={{ color: 'var(--text-2)' }}>Integrações</div>
            <WhatsAppCard />
          </>
        ) : null}

        <div className="eyebrow" style={{ color: 'var(--text-2)' }}>Privacidade</div>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <p className="text-2" style={{ fontSize: 13, lineHeight: 1.6 }}>
            A autenticação e a alteração de senha são feitas com segurança pelo Supabase. Nunca compartilhe os códigos de acesso que você recebe por e-mail.
          </p>
          <Link to="/termos" className="link-btn" style={{ padding: 0 }}>Ler termos de uso e política de privacidade</Link>
        </div>

        {user ? <PlanCard userId={user.id} /> : null}

        {user ? (
          <div className="card" style={{ display: 'grid', gap: 10, borderColor: 'rgba(255,113,133,0.35)' }}>
            <div className="eyebrow" style={{ color: 'var(--danger)' }}>Zona de risco</div>
            <p className="text-2" style={{ fontSize: 13, lineHeight: 1.5 }}>Exclui sua conta e todos os seus dados. A ação não pode ser desfeita.</p>
            <button type="button" className="btn btn-danger btn-block" onClick={() => setDeleteOpen(true)}>Excluir minha conta</button>
            <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} email={user.email ?? ''} />
          </div>
        ) : null}

        {user ? (
          <Link to="/app/perfil" className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text)' }}>
            <User size={18} color="var(--accent)" />
            <span className="grow">Ver perfil</span>
            <ChevronRight size={17} className="muted" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
