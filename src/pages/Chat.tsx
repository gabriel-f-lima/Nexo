import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { History, Plus, Send, Star, Trash2, X } from 'lucide-react';
import { MenuButton, Modal } from '../components/ui';
import { useAuthStore } from '../store/auth';
import { useDataStore, type ChatMessage, type Conversation } from '../store/data';
import { aiService } from '../lib/assistant';
import { confirmAction } from '../lib/confirm';
import { notify } from '../lib/toast';
import { formatConversationDate, getGreeting } from '../lib/dates';

const SUGGESTIONS = [
  'O que tenho na agenda hoje?',
  'Adiciona uma tarefa para mim',
  'Como está minha rotina?',
  'Quais são as principais notícias de hoje?',
];
const MAX_LENGTH = 2000;

/** Transforma links em texto em âncoras clicáveis. */
const linkify = (content: string) =>
  content.split(/(https?:\/\/[^\s<>"')\]]+)/g).map((part, index) =>
    /^https?:\/\//i.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
      : <Fragment key={index}>{part}</Fragment>,
  );

function TypingIndicator() {
  return (
    <motion.div className="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <span>Nuvora está escrevendo</span>
      <span className="dots">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="dot"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </span>
    </motion.div>
  );
}

/** Assistente de IA: mesma conversa, histórico e regras de importante do app. */
export default function Chat() {
  const messages = useDataStore((s) => s.chatMessages);
  const conversations = useDataStore((s) => s.conversations);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const hasUser = useAuthStore((s) => !!s.user);

  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(getGreeting());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useDataStore.getState().pruneExpiredLocal();
    const id = window.setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, typing]);

  const canSend = input.trim().length > 0 && !typing;

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
    setTyping(true);

    try {
      const reply = await aiService.sendMessage([...previous, userMessage]);
      if (useAuthStore.getState().user?.id !== owner) return;
      useDataStore.getState().appendMessage('assistant', reply);
    } catch (error) {
      if (useAuthStore.getState().user?.id !== owner) return;
      const detail = error instanceof Error ? error.message : 'Tente novamente em instantes.';
      useDataStore.getState().appendMessage('assistant', `Não consegui responder agora. ${detail}`);
    } finally {
      setTyping(false);
    }
  };

  /** Só envia com conta; se não houver, pede o login e envia depois. */
  const send = (raw: string) => {
    const text = raw.trim().slice(0, MAX_LENGTH);
    if (!text || typing) return;
    requireAuth(() => { void deliver(text); });
  };

  const newConversation = () => {
    useDataStore.getState().startNewConversation();
    setHistoryOpen(false);
  };

  const openConversation = async (conversation: Conversation) => {
    if (openingId) return;
    setOpeningId(conversation.id);
    const ok = await useDataStore.getState().openConversation(conversation.id);
    setOpeningId(null);
    if (ok) setHistoryOpen(false);
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

  return (
    <div className="chat-screen">
      <div className="chat-top">
        <MenuButton />
        <div className="row gap-sm">
          <motion.button
            type="button"
            className="icon-btn blue"
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              useDataStore.getState().pruneExpiredLocal();
              setHistoryOpen(true);
            }}
            disabled={typing}
            aria-label="Ver conversas anteriores"
          >
            <History size={19} />
          </motion.button>
          <motion.button
            type="button"
            className="icon-btn"
            whileTap={{ scale: 0.92 }}
            onClick={newConversation}
            disabled={typing}
            aria-label="Nova conversa"
          >
            <Plus size={20} />
          </motion.button>
        </div>
      </div>

      {messages.length > 0 ? (
        <div className="chat-body">
          <AnimatePresence initial={false}>
            {messages.map((message: ChatMessage) => (
              <motion.div
                key={message.id}
                className={`bubble ${message.role === 'user' ? 'user' : 'ai'}`}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                {linkify(message.content)}
              </motion.div>
            ))}
          </AnimatePresence>
          <AnimatePresence>{typing ? <TypingIndicator key="typing" /> : null}</AnimatePresence>
          <div ref={endRef} />
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
              alt="Logo Nuvora"
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
          <div className="inline-gap" style={{ justifyContent: 'center', marginTop: 8 }}>
            {SUGGESTIONS.map((suggestion, index) => (
              <motion.button
                key={suggestion}
                type="button"
                className="chip"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * index, duration: 0.3 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </motion.button>
            ))}
          </div>
          {!hasUser ? (
            <p className="muted" style={{ fontSize: 12 }}>Entre na sua conta para conversar e salvar o histórico.</p>
          ) : null}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(event) => { event.preventDefault(); send(input); }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte qualquer coisa..."
          maxLength={MAX_LENGTH}
          aria-label="Mensagem para o Nuvora"
        />
        <motion.button
          type="submit"
          className="send"
          whileTap={{ scale: 0.9 }}
          disabled={!canSend}
          aria-label="Enviar mensagem"
        >
          <Send size={18} />
        </motion.button>
      </form>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Conversas anteriores">
        <div className="row between">
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Conversas sem acesso por 15 dias são apagadas automaticamente. Você pode manter uma conversa importante sem prazo.
          </p>
        </div>
        {conversations.length ? (
          <div className="conv-list">
            {conversations.map((conversation) => (
              <div key={conversation.id} className="conv-row">
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
                  className={`icon-btn ghost sm`}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => { void toggleImportant(conversation); }}
                  aria-label={conversation.important ? `Desmarcar ${conversation.title} como importante` : `Marcar ${conversation.title} como importante`}
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
          <Plus size={18} /> Nova conversa
        </button>
      </Modal>
    </div>
  );
}
