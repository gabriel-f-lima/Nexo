import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, History, SquarePen, Star, Trash2 } from 'lucide-react';
import { MenuButton, Modal } from '../components/ui';
import Markdown from '../components/Markdown';
import { useAuthStore } from '../store/auth';
import { useDataStore, type ChatMessage, type Conversation } from '../store/data';
import { aiService } from '../lib/assistant';
import { confirmAction } from '../lib/confirm';
import { notify } from '../lib/toast';
import { formatConversationDate, getGreeting } from '../lib/dates';

/**
 * Sugestões da tela inicial. As perguntas completas são enviadas na hora; as que precisam de detalhes
 * (como o nome da tarefa) só preenchem o campo para o usuário completar antes de enviar.
 */
const SUGGESTIONS: Array<{ label: string; text: string; fill?: boolean }> = [
  { label: 'O que tenho na agenda hoje?', text: 'O que tenho na agenda hoje?' },
  { label: 'Criar uma tarefa…', text: 'Cria a tarefa: ', fill: true },
  { label: 'Como está minha rotina?', text: 'Como está minha rotina?' },
  { label: 'Quais são as principais notícias de hoje?', text: 'Quais são as principais notícias de hoje?' },
];
const MAX_LENGTH = 2000;
const BUSY_MESSAGE = 'Aguarde o Nexo terminar de responder.';

/** Transforma links em texto em âncoras clicáveis. */
const linkify = (content: string) =>
  content.split(/(https?:\/\/[^\s<>"')\]]+)/g).map((part, index) =>
    /^https?:\/\//i.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
      : <Fragment key={index}>{part}</Fragment>,
  );

/**
 * Revela o texto aos poucos, como se estivesse sendo digitado, acompanhando o que já chegou.
 * Com a aba escondida ou com "reduzir movimento" ligado, mostra tudo de uma vez.
 */
function useTypewriter(target: string): string {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(0);
  const lastFrame = useRef<number | null>(null);

  useEffect(() => {
    if (count > target.length) { setCount(target.length); return undefined; }
    if (count === target.length) { lastFrame.current = null; return undefined; }
    if (reduceMotion || document.visibilityState === 'hidden') { setCount(target.length); return undefined; }
    const frame = window.requestAnimationFrame((now) => {
      // Velocidade por tempo (igual em telas de 60 Hz ou 144 Hz): no mínimo 90 caracteres por segundo,
      // acelerando quando há muito texto à frente, para nunca ficar muito atrás do que já chegou.
      const elapsed = lastFrame.current === null ? 16 : Math.min(100, now - lastFrame.current);
      lastFrame.current = now;
      setCount((current) => {
        const remaining = target.length - current;
        const perSecond = Math.max(90, remaining / 0.6);
        return Math.min(target.length, current + Math.max(1, Math.round((perSecond * elapsed) / 1000)));
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [target, count, reduceMotion]);

  return target.slice(0, Math.min(count, target.length));
}

function TypingIndicator() {
  return (
    <motion.div className="msg ai" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <img className="msg-avatar" src="/nexo-logo.png" alt="" width={30} height={30} />
      <div className="typing" role="status">
        <span>Nexo está pensando</span>
        <span className="dots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="dot"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </span>
      </div>
    </motion.div>
  );
}

/** Resposta do assistente, formatada (títulos, listas, negrito, links e imagens). */
function AssistantBubble({ text, writing }: { text: string; writing?: boolean }) {
  return (
    <>
      <img className="msg-avatar" src="/nexo-logo.png" alt="" width={30} height={30} />
      <div className={`bubble ai${writing ? ' writing' : ''}`}>
        <Markdown
          text={text}
          streaming={writing}
          trailing={writing ? <span className="caret" aria-hidden="true" /> : null}
        />
      </div>
    </>
  );
}

/** Botão do topo com ícone e rótulo (em telas estreitas só o ícone; o nome continua na dica e no leitor de tela). */
function TopButton({ icon, label, onClick, primary }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <motion.button
      type="button"
      className={`top-btn${primary ? ' primary' : ''}`}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="top-btn-label">{label}</span>
    </motion.button>
  );
}

/** Assistente de IA: mesma conversa, histórico e regras de importante do app. */
export default function Chat() {
  const messages = useDataStore((s) => s.chatMessages);
  const conversations = useDataStore((s) => s.conversations);
  const activeConversationId = useDataStore((s) => s.activeConversationId);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const hasUser = useAuthStore((s) => !!s.user);

  const [input, setInput] = useState('');
  /** Pedido em andamento (rede e ações do app). */
  const [busy, setBusy] = useState(false);
  /** Texto sendo escrito na tela: o parcial durante o streaming e, ao terminar, a resposta completa. */
  const [writingText, setWritingText] = useState('');
  /** Resposta já salva que ainda está terminando de aparecer. */
  const [revealId, setRevealId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(getGreeting());
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const shownText = useTypewriter(writingText);
  const revealing = revealId !== null && shownText.length < writingText.length;
  const activeTitle = conversations.find((c) => c.id === activeConversationId)?.title;

  useEffect(() => {
    useDataStore.getState().pruneExpiredLocal();
    const id = window.setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Terminou de aparecer: a mensagem volta a ser exibida direto do histórico.
  useEffect(() => {
    if (revealId && shownText.length >= writingText.length) {
      setRevealId(null);
      setWritingText('');
    }
  }, [revealId, shownText.length, writingText.length]);

  // Abrir outra conversa encerra a animação da resposta anterior.
  useEffect(() => {
    if (busyRef.current) return;
    setRevealId(null);
    setWritingText('');
  }, [activeConversationId]);

  // Acompanha o fim da conversa enquanto a resposta cresce, se o usuário não tiver rolado para cima.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && stickToBottom.current) body.scrollTop = body.scrollHeight;
  }, [messages.length, shownText, busy]);

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    stickToBottom.current = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
  };

  // O campo cresce com o texto, até um limite (e se ajusta quando a largura da janela muda).
  const fitInput = () => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
  };
  useLayoutEffect(fitInput, [input]);
  useEffect(() => {
    window.addEventListener('resize', fitInput);
    const frame = window.requestAnimationFrame(fitInput);
    return () => {
      window.removeEventListener('resize', fitInput);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const canSend = input.trim().length > 0 && !busy;

  const deliver = async (text: string) => {
    const owner = useAuthStore.getState().user?.id;
    if (!owner) return;
    const clean = text.trim().slice(0, MAX_LENGTH);
    if (!clean) return;

    const store = useDataStore.getState();
    const previous = store.chatMessages;
    const userMessage = store.appendMessage('user', clean);
    if (!userMessage) return;
    setInput('');
    setRevealId(null);
    setWritingText('');
    setBusy(true);
    stickToBottom.current = true;

    try {
      const reply = await aiService.sendMessage([...previous, userMessage], {
        onText: (partial) => {
          if (useAuthStore.getState().user?.id === owner) setWritingText(partial);
        },
      });
      if (useAuthStore.getState().user?.id !== owner) return;
      // Salva na hora; a tela só termina de "digitar" o que falta.
      const saved = useDataStore.getState().appendMessage('assistant', reply);
      setWritingText(reply);
      setRevealId(saved?.id ?? null);
    } catch (error) {
      if (useAuthStore.getState().user?.id !== owner) return;
      const detail = error instanceof Error ? error.message : 'Tente novamente em instantes.';
      useDataStore.getState().appendMessage('assistant', `Não consegui responder agora. ${detail}`);
      setWritingText('');
    } finally {
      setBusy(false);
    }
  };

  /** Só envia com conta; se não houver, pede o login e envia depois. */
  const send = (raw: string) => {
    const text = raw.trim().slice(0, MAX_LENGTH);
    if (!text) return;
    if (busy) { notify(BUSY_MESSAGE, 'info'); return; }
    requireAuth(() => { void deliver(text); }, 'Entre na sua conta para conversar com o Nexo e salvar o histórico.');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra a linha. Não envia no meio da composição de acentos (IME).
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) send(input);
      else if (busy && input.trim()) notify(BUSY_MESSAGE, 'info');
    }
  };

  const focusInput = () => window.setTimeout(() => inputRef.current?.focus(), 0);

  /** Coloca o começo da mensagem no campo, com o cursor no fim, para o usuário completar os detalhes. */
  const fillInput = (text: string) => {
    setInput(text);
    window.setTimeout(() => {
      const field = inputRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(text.length, text.length);
    }, 0);
    notify('Escreva o nome da tarefa e, se quiser, o dia e o horário. Depois é só enviar.', 'info');
  };

  const newConversation = () => {
    if (!hasUser) {
      requireAuth(undefined, 'Entre na sua conta para iniciar conversas e guardar o histórico.');
      return;
    }
    if (busy) { notify(BUSY_MESSAGE, 'info'); return; }
    setHistoryOpen(false);
    if (!useDataStore.getState().chatMessages.length) {
      notify('Você já está em uma conversa nova. É só escrever.', 'info');
      focusInput();
      return;
    }
    useDataStore.getState().startNewConversation();
    setRevealId(null);
    setWritingText('');
    notify('Nova conversa iniciada.', 'success');
    focusInput();
  };

  const openHistory = () => {
    if (!hasUser) {
      requireAuth(undefined, 'Entre na sua conta para ver suas conversas anteriores.');
      return;
    }
    if (busy) { notify(BUSY_MESSAGE, 'info'); return; }
    useDataStore.getState().pruneExpiredLocal();
    setHistoryOpen(true);
  };

  const openConversation = async (conversation: Conversation) => {
    if (openingId) return;
    setOpeningId(conversation.id);
    const ok = await useDataStore.getState().openConversation(conversation.id);
    setOpeningId(null);
    if (ok) {
      setHistoryOpen(false);
      stickToBottom.current = true;
    }
  };

  const toggleImportant = async (conversation: Conversation) => {
    if (conversation.important) {
      await useDataStore.getState().setConversationImportant(conversation.id, false);
      return;
    }
    const existing = conversations.find((c) => c.important && c.id !== conversation.id);
    if (existing) {
      const ok = await confirmAction({
        title: 'Trocar conversa importante?',
        message: `“${existing.title}” deixará de ficar protegida. “${conversation.title}” será mantida sem expiração automática.`,
        confirmText: 'Trocar',
      });
      if (!ok) return;
    }
    await useDataStore.getState().setConversationImportant(conversation.id, true);
  };

  const removeConversation = async (conversation: Conversation) => {
    const ok = await confirmAction({
      title: 'Apagar conversa?',
      message: `A conversa “${conversation.title}” será removida da sua conta e dos dispositivos sincronizados.`,
      confirmText: 'Apagar',
      danger: true,
    });
    if (ok) {
      await useDataStore.getState().deleteConversation(conversation.id);
      notify('Conversa apagada.', 'success');
    }
  };

  const showConversation = messages.length > 0 || busy;

  return (
    <div className="chat-screen">
      <header className="chat-top">
        <MenuButton />
        <div className="chat-top-title">
          <span className="chat-top-name">Assistente</span>
          <span className="chat-top-sub">{hasUser ? (activeTitle ?? 'Nova conversa') : 'Entre para salvar suas conversas'}</span>
        </div>
        <div className="top-actions">
          <TopButton icon={<History size={18} />} label="Histórico" onClick={openHistory} />
          <TopButton icon={<SquarePen size={18} />} label="Nova conversa" onClick={newConversation} primary />
        </div>
      </header>

      {showConversation ? (
        <div className="chat-body" ref={bodyRef} onScroll={onScroll} role="log" aria-busy={busy || revealing}>
          <div className="chat-thread">
            <AnimatePresence initial={false}>
              {messages.map((message: ChatMessage) => {
                const isRevealing = message.id === revealId;
                return (
                  <motion.div
                    key={message.id}
                    className={`msg ${message.role === 'user' ? 'user' : 'ai'}`}
                    initial={isRevealing ? false : { opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  >
                    {message.role === 'user' ? (
                      <div className="bubble user">{linkify(message.content)}</div>
                    ) : (
                      <AssistantBubble writing={isRevealing && revealing} text={isRevealing ? shownText : message.content} />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {busy && shownText ? (
              <div className="msg ai">
                <AssistantBubble writing text={shownText} />
              </div>
            ) : null}
            <AnimatePresence>{busy && !shownText ? <TypingIndicator key="typing" /> : null}</AnimatePresence>
          </div>
        </div>
      ) : (
        <div className="chat-empty">
          <motion.div
            className="orb"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          >
            <motion.img
              src="/nexo-logo.png"
              alt="Logo Nexo"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
          <motion.p
            key={greeting}
            className="greeting"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {greeting}
          </motion.p>
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion, index) => (
              <motion.button
                key={suggestion.label}
                type="button"
                className="suggestion"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * index, duration: 0.3 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => (suggestion.fill ? fillInput(suggestion.text) : send(suggestion.text))}
                title={suggestion.fill ? 'Complete com o nome, o dia e o horário antes de enviar' : undefined}
              >
                {suggestion.label}
              </motion.button>
            ))}
          </div>
          {!hasUser ? (
            <p className="muted" style={{ fontSize: 13 }}>Entre na sua conta para conversar e salvar o histórico.</p>
          ) : null}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(event) => { event.preventDefault(); send(input); }}
      >
        <div className={`composer${busy ? ' busy' : ''}`}>
          <textarea
            ref={inputRef}
            className="composer-field"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={onKeyDown}
            placeholder={busy ? 'O Nexo está respondendo…' : 'Pergunte qualquer coisa ao Nexo...'}
            maxLength={MAX_LENGTH}
            aria-label="Mensagem para o Nexo"
          />
          <motion.button
            type="submit"
            className="send"
            whileTap={{ scale: 0.9 }}
            disabled={!canSend}
            aria-label="Enviar mensagem"
            title="Enviar (Enter)"
          >
            <ArrowUp size={19} />
          </motion.button>
        </div>
        <p className="composer-hint">
          {input.length > MAX_LENGTH - 200
            ? `${input.length}/${MAX_LENGTH} caracteres`
            : <><span className="hint-keys">Enter envia · Shift+Enter quebra a linha. </span>O Nexo pode errar; confira informações importantes.</>}
        </p>
      </form>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Conversas anteriores">
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Conversas sem acesso por 15 dias são apagadas automaticamente. Você pode manter uma conversa importante sem prazo.
        </p>
        {conversations.length ? (
          <div className="conv-list">
            {conversations.map((conversation) => (
              <div key={conversation.id} className={`conv-row${conversation.id === activeConversationId ? ' current' : ''}`}>
                <button
                  type="button"
                  className="conv-open"
                  onClick={() => { void openConversation(conversation); }}
                  disabled={openingId !== null}
                  aria-label={`Abrir conversa ${conversation.title}`}
                >
                  <div className="conv-name">{conversation.title}</div>
                  <div className="conv-meta">
                    {openingId === conversation.id
                      ? 'Carregando mensagens…'
                      : `${formatConversationDate(conversation.lastAccessedAt || conversation.updatedAt)} · ${conversation.messageCount} mensagens${conversation.important ? ' · Importante' : ''}`}
                  </div>
                </button>
                <motion.button
                  type="button"
                  className="icon-btn ghost sm"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => { void toggleImportant(conversation); }}
                  aria-label={conversation.important ? `Desmarcar ${conversation.title} como importante` : `Marcar ${conversation.title} como importante`}
                  title={conversation.important ? 'Desmarcar como importante' : 'Marcar como importante'}
                  style={conversation.important ? { color: 'var(--accent)' } : undefined}
                >
                  <Star size={17} fill={conversation.important ? 'var(--accent)' : 'none'} />
                </motion.button>
                <motion.button
                  type="button"
                  className="icon-btn ghost sm"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => { void removeConversation(conversation); }}
                  aria-label={`Apagar conversa ${conversation.title}`}
                  title="Apagar conversa"
                >
                  <Trash2 size={16} />
                </motion.button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-card">
            <strong>Nenhuma conversa salva</strong>
            <span>As conversas aparecem aqui depois da primeira mensagem.</span>
          </div>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={newConversation}>
          <SquarePen size={18} /> Nova conversa
        </button>
      </Modal>
    </div>
  );
}
