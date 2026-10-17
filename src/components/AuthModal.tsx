import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, Key, Mail, Sparkles, X } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { authService } from '../lib/auth';
import { translateAuthError } from '../lib/authErrors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
const MIN_CODE = 6;
const COOLDOWN = 60;

type Mode = 'signIn' | 'signUp';
type Step = 'form' | 'verify' | 'otp';
type Loading = 'email' | 'google' | 'verify' | 'otp' | 'resend' | null;

/** Modal de login: aparece quando uma ação exige conta. Mesmos passos do app. */
export default function AuthModal() {
  const visible = useAuthStore((s) => s.promptVisible);
  const close = useAuthStore((s) => s.closePrompt);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="auth-backdrop"
          className="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <motion.div
            className="auth-panel"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            role="dialog"
            aria-modal="true"
            aria-label="Entrar no Nuvora"
          >
            <AuthPanel onClose={close} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function AuthPanel({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('form');
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';
  const busy = loading !== null;

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const clear = () => { setError(null); setInfo(null); };

  const goToVerify = (address: string) => {
    setPendingEmail(address);
    setCode('');
    setCooldown(COOLDOWN);
    clear();
    setStep('verify');
  };

  const submitEmail = async (event?: FormEvent) => {
    event?.preventDefault();
    clear();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(clean)) { setError('Digite um e-mail válido.'); return; }
    if (password.length < MIN_PASSWORD) { setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`); return; }

    setLoading('email');
    try {
      if (isSignUp) {
        const { needsEmailConfirmation } = await authService.signUpWithEmail(clean, password, name.trim());
        if (needsEmailConfirmation) goToVerify(clean);
      } else {
        await authService.signInWithEmail(clean, password);
      }
    } catch (e) {
      const errorCode = (e as { code?: string } | null)?.code;
      if (!isSignUp && errorCode === 'email_not_confirmed') {
        try {
          await authService.resendSignupCode(clean);
          goToVerify(clean);
          setInfo('Seu e-mail ainda não foi confirmado. Enviamos um novo código.');
        } catch (resendError) {
          setError(translateAuthError(resendError));
        }
      } else {
        setError(translateAuthError(e));
      }
    } finally {
      setLoading(null);
    }
  };

  const sendLoginCode = async () => {
    clear();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(clean)) { setError('Digite um e-mail válido para receber o código.'); return; }
    setLoading('otp');
    try {
      await authService.sendLoginCode(clean);
      setPendingEmail(clean);
      setCode('');
      setCooldown(COOLDOWN);
      setStep('otp');
      setInfo('Enviamos um código de acesso para o seu e-mail.');
    } catch (e) {
      setError(translateAuthError(e, 'Não foi possível enviar o código. Verifique o e-mail e tente novamente.'));
    } finally {
      setLoading(null);
    }
  };

  const verify = async (event?: FormEvent) => {
    event?.preventDefault();
    clear();
    if (code.length < MIN_CODE) { setError('Digite o código que enviamos para o seu e-mail.'); return; }
    setLoading('verify');
    try {
      if (step === 'otp') await authService.verifyLoginCode(pendingEmail, code);
      else await authService.verifyEmailCode(pendingEmail, code);
      // Sucesso: a sessão é criada e o modal fecha pelo estado de autenticação.
    } catch (e) {
      setError(translateAuthError(e, 'Não foi possível validar o código. Tente novamente.'));
    } finally {
      setLoading(null);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    clear();
    setLoading('resend');
    try {
      if (step === 'otp') await authService.sendLoginCode(pendingEmail);
      else await authService.resendSignupCode(pendingEmail);
      setCooldown(COOLDOWN);
      setInfo('Enviamos um novo código para o seu e-mail.');
    } catch (e) {
      setError(translateAuthError(e));
    } finally {
      setLoading(null);
    }
  };

  const google = async () => {
    clear();
    setLoading('google');
    try {
      await authService.signInWithGoogle();
    } catch (e) {
      setError(translateAuthError(e, 'Não foi possível entrar com o Google. Tente novamente.'));
      setLoading(null);
    }
  };

  const messages = (
    <>
      {error ? <p className="error">{error}</p> : null}
      {info ? <p className="info">{info}</p> : null}
    </>
  );

  if (step !== 'form') {
    return (
      <form className="auth-panel-inner" onSubmit={verify} style={{ display: 'grid', gap: 14 }}>
        <button type="button" className="icon-btn plain sm auth-close" onClick={onClose} aria-label="Fechar">
          <X size={17} />
        </button>
        <div className="auth-hero">
          <div className="icon-btn" style={{ width: 52, height: 52 }}>
            {step === 'otp' ? <Key size={24} /> : <Mail size={24} />}
          </div>
          <h2>{step === 'otp' ? 'Entrar com código' : 'Confirme seu e-mail'}</h2>
          <p>
            {step === 'otp' ? 'Enviamos um código de acesso para' : 'Enviamos um código para'}
            <br />
            <strong style={{ color: 'var(--accent)' }}>{pendingEmail}</strong>
          </p>
        </div>

        <input
          className="input code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
          maxLength={10}
          placeholder="Código"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          disabled={busy}
        />
        {messages}
        <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block" disabled={busy}>
          {loading === 'verify' ? 'Validando…' : step === 'otp' ? 'Entrar' : 'Confirmar'}
        </motion.button>
        <button type="button" className="link-btn" onClick={resend} disabled={cooldown > 0 || busy} style={{ alignSelf: 'center' }}>
          {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Reenviar código'}
        </button>
        <button
          type="button"
          className="link-btn"
          style={{ alignSelf: 'center', color: 'var(--text-2)' }}
          onClick={() => { setStep('form'); setCode(''); clear(); }}
          disabled={busy}
        >
          {step === 'otp' ? 'Voltar ao início de sessão' : 'Usar outro e-mail'}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-panel-inner" onSubmit={submitEmail} style={{ display: 'grid', gap: 14 }}>
      <button type="button" className="icon-btn plain sm auth-close" onClick={onClose} aria-label="Fechar">
        <X size={17} />
      </button>
      <div className="auth-hero">
        <div className="icon-btn" style={{ width: 52, height: 52 }}>
          <Sparkles size={24} />
        </div>
        <h2>{isSignUp ? 'Criar conta' : 'Entrar no Nuvora'}</h2>
        <p>
          {isSignUp
            ? 'Crie sua conta para salvar sua agenda e rotina.'
            : 'Entre para usar o assistente, a agenda e a rotina.'}
        </p>
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        className="google-btn"
        onClick={google}
        disabled={busy}
      >
        <GoogleIcon />
        {loading === 'google' ? 'Redirecionando…' : 'Continuar com Google'}
      </motion.button>

      <div className="divider">ou</div>

      {isSignUp ? (
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nome" autoComplete="name" disabled={busy} />
      ) : null}
      <input
        className="input"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
        placeholder="E-mail"
        autoComplete="email"
        autoCapitalize="none"
        disabled={busy}
      />
      <div className="password-wrap">
        <input
          className="input"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={128}
          placeholder="Senha"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          disabled={busy}
        />
        <button
          type="button"
          className="eye"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>

      {messages}

      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block" disabled={busy}>
        {loading === 'email' ? 'Aguarde…' : isSignUp ? 'Criar conta' : 'Entrar'}
      </motion.button>

      {!isSignUp ? (
        <button type="button" className="link-btn" style={{ alignSelf: 'center' }} onClick={sendLoginCode} disabled={busy}>
          Entrar rapidamente com código por e-mail
        </button>
      ) : null}

      <button
        type="button"
        className="link-btn"
        style={{ alignSelf: 'center', color: 'var(--text-2)' }}
        onClick={() => { setMode(isSignUp ? 'signIn' : 'signUp'); clear(); }}
        disabled={busy}
      >
        {isSignUp ? 'Já tem conta? ' : 'Ainda não tem conta? '}
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{isSignUp ? 'Entrar' : 'Criar conta'}</span>
      </button>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C41.1 35.2 44 30 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
