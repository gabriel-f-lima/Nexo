import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Mail } from 'lucide-react';
import { Modal } from './ui';
import { sendDeletionCode, confirmDeletionCode, deleteAccountNow } from '../lib/account';
import { translateAuthError } from '../lib/authErrors';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  email: string;
}

const COOLDOWN = 60;

/** Exclusão de conta em duas etapas: confirmação da ação e código enviado ao e-mail. */
export default function DeleteAccountModal({ open, onClose, email }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Excluir minha conta">
      {open ? <DeleteAccountBody email={email} onClose={onClose} /> : null}
    </Modal>
  );
}

function DeleteAccountBody({ email, onClose }: { email: string; onClose: () => void }) {
  const [step, setStep] = useState<'explain' | 'code'>('explain');
  const [understood, setUnderstood] = useState(false);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    setError('');
    setLoading(true);
    try {
      await sendDeletionCode(email);
      setStep('code');
      setCooldown(COOLDOWN);
    } catch (e) {
      setError(translateAuthError(e, 'Não foi possível enviar o código. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || loading) return;
    await sendCode();
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (code.length < 6) { setError('Digite o código de 6 dígitos enviado ao seu e-mail.'); return; }
    setLoading(true);
    try {
      await confirmDeletionCode(email, code);
      await deleteAccountNow();
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      notify('Sua conta e seus dados foram excluídos.', 'success');
      onClose();
      window.location.assign('/');
    } catch (e) {
      setError(e instanceof Error && e.message !== 'Failed to fetch'
        ? e.message
        : translateAuthError(e, 'Não foi possível excluir a conta. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'explain') {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="warn-block" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            Esta ação é permanente e não pode ser desfeita.
          </span>
        </div>
        <ul style={{ paddingLeft: 18, color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7, display: 'grid', gap: 4 }}>
          <li>Sua conta de acesso será removida.</li>
          <li>Agenda, rotina, tarefas, conversas, lançamentos, categorias e metas serão apagados.</li>
          <li>Cópias de segurança mantidas pelos provedores são apagadas conforme o prazo descrito na Política de Privacidade.</li>
        </ul>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--danger)' }} />
          Entendo que a exclusão é permanente.
        </label>
        {error ? <p className="error">{error}</p> : null}
        <motion.button type="button" whileTap={{ scale: 0.98 }} className="btn btn-danger btn-block" disabled={!understood || loading} onClick={sendCode}>
          {loading ? 'Enviando código…' : 'Enviar código de confirmação'}
        </motion.button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} style={{ display: 'grid', gap: 14 }}>
      <div className="auth-hero">
        <div className="icon-btn" style={{ width: 52, height: 52 }}><Mail size={24} /></div>
        <p className="text-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          Enviamos um código para <strong style={{ color: 'var(--accent)' }}>{email}</strong>. Digite-o abaixo para confirmar a exclusão.
        </p>
      </div>
      <input
        className="input code-input"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
        placeholder="Código"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        disabled={loading}
      />
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-danger btn-block" disabled={loading}>
        {loading ? 'Excluindo…' : 'Excluir minha conta agora'}
      </motion.button>
      <button type="button" className="link-btn" style={{ alignSelf: 'center' }} onClick={resend} disabled={cooldown > 0 || loading}>
        {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Reenviar código'}
      </button>
    </form>
  );
}
