import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarPlus, CornerDownLeft, CreditCard, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import { parseQuickEntry, type QuickEntry as Parsed } from '../../../supabase/functions/_shared/quickEntry';
import { useAuthStore } from '../../store/auth';
import { useDataStore } from '../../store/data';
import { useFinanceStore, type TransactionInput } from '../../store/finance';
import { useTier } from '../../lib/useTier';
import { LIMITS } from '../../lib/billing';
import { canEditFinanceDay, isPastEvent } from '../../lib/rules';
import { formatMoney } from '../../lib/finance';
import { dayLabel, formatShortDate, monthOfKey, relativeDay, toISODate } from '../../lib/dates';
import { checkEventLimit, matchCategory, monthlyEntriesMessage } from '../../lib/limits';
import { notify } from '../../lib/toast';
import SelectField from '../SelectField';
import TransactionForm from '../TransactionForm';
import Paywall from '../Paywall';

const EXAMPLES = [
  'gastei 45 no mercado ontem',
  'dentista terça às 15h',
  'recebi 3000 de salário',
  'uber 23,50',
  'comprei um tênis de 300 no cartão em 3x',
  'reunião amanhã às 9:30',
];

/**
 * Registro rápido: uma frase vira lançamento ou compromisso. Mostra o que entendeu antes de salvar,
 * e deixa ajustar categoria, cartão e hora sem abrir o formulário completo.
 */
export default function QuickEntry({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const tier = useTier(user?.id);
  const categories = useFinanceStore((s) => s.categories);
  const cards = useFinanceStore((s) => s.cards);
  const transactions = useFinanceStore((s) => s.transactions);
  const planningReady = useFinanceStore((s) => s.planningReady);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const events = useDataStore((s) => s.events);
  const addEvent = useDataStore((s) => s.addEvent);

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [cardId, setCardId] = useState('');
  const [time, setTime] = useState('');
  const [formInitial, setFormInitial] = useState<Partial<TransactionInput> | null>(null);
  const [paywall, setPaywall] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const example = useMemo(() => EXAMPLES[Math.floor(Date.now() / 60_000) % EXAMPLES.length], []);
  const activeCards = cards.filter((c) => !c.archived);

  const read = (event?: FormEvent) => {
    event?.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    const result = parseQuickEntry(clean, { today: toISODate(), cardNames: activeCards.map((c) => c.name) });
    setParsed(result);
    if (result.kind === 'transaction') {
      setCategoryId(matchCategory(categories, result.type, result.description, result.categoryHints)?.id ?? '');
      const named = result.cardName ? activeCards.find((c) => c.name.trim().toLowerCase() === result.cardName?.toLowerCase()) : undefined;
      setCardId(result.card ? (named?.id ?? (activeCards.length === 1 ? activeCards[0].id : '')) : '');
    } else if (result.kind === 'event') {
      setTime(result.time ?? '');
    }
  };

  const clear = () => { setParsed(null); setText(''); };

  const toInput = (entry: Extract<Parsed, { kind: 'transaction' }>): TransactionInput => {
    const card = cardId ? activeCards.find((c) => c.id === cardId) : undefined;
    return {
      type: entry.type,
      amountCents: entry.amountCents,
      currency: card ? card.currency : entry.currency,
      categoryId: categoryId || null,
      occurredOn: entry.date,
      description: entry.description,
      cardId: entry.type === 'expense' && card ? card.id : null,
      installments: card ? entry.installments : 1,
    };
  };

  const saveTransaction = (entry: Extract<Parsed, { kind: 'transaction' }>) => requireAuth(() => {
    if (tier === 'loading') return;
    if (!LIMITS[tier].finance) { setPaywall('O controle financeiro faz parte dos planos pagos. Assine para registrar receitas e despesas.'); return; }
    if (!canEditFinanceDay(entry.date)) { notify('Você pode lançar hoje, ontem ou datas futuras. Dias anteriores ficam só para consulta.', 'error'); return; }
    if (entry.card && !cardId) { notify(activeCards.length ? 'Escolha em qual cartão foi a compra.' : 'Cadastre um cartão em Financeiro › Cartões, ou salve como à vista.', 'info'); return; }
    const monthCount = transactions.filter((t) => monthOfKey(t.occurredOn) === monthOfKey(entry.date)).length;
    const limit = monthlyEntriesMessage(tier, monthCount);
    if (limit) { setPaywall(limit); return; }
    const input = toInput(entry);
    if (!addTransaction(input)) { notify('Não foi possível registrar. Confira os dados e tente de novo.', 'error'); return; }
    const category = categories.find((c) => c.id === input.categoryId);
    const what = input.type === 'income' ? 'Receita' : 'Despesa';
    const parcel = input.installments && input.installments > 1 ? ` em ${input.installments}x` : '';
    notify(`${what} de ${formatMoney(input.amountCents, input.currency)}${parcel} registrada${category ? ` em ${category.name}` : ''}.`, 'success');
    clear();
  }, 'Entre na sua conta para registrar lançamentos.');

  const saveEvent = (entry: Extract<Parsed, { kind: 'event' }>) => requireAuth(() => {
    if (!user) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { notify('Escolha a hora do compromisso.', 'info'); return; }
    const start = new Date(`${entry.date}T${time}:00`);
    if (isPastEvent(start.toISOString())) { notify('Essa data já passou. Compromissos podem ser marcados de hoje em diante.', 'error'); return; }
    setBusy(true);
    checkEventLimit(user.id, events, entry.date)
      .then((message) => {
        if (message) { setPaywall(message); return; }
        if (!addEvent(entry.title, start.toISOString())) { notify('Não foi possível criar o compromisso.', 'error'); return; }
        notify(`${entry.title} marcado para ${dayLabel(entry.date)}, às ${time}.`, 'success');
        clear();
      })
      .catch(() => notify('Não foi possível verificar seu plano agora. Tente novamente.', 'error'))
      .finally(() => setBusy(false));
  }, 'Entre na sua conta para criar compromissos.');

  const category = categories.find((c) => c.id === categoryId);

  return (
    <div className="qe">
      <form className="qe-bar" onSubmit={read}>
        <Sparkles size={18} className="lead-icon" aria-hidden="true" />
        <input
          className="qe-input"
          value={text}
          onChange={(e) => { setText(e.target.value); if (parsed) setParsed(null); }}
          placeholder={`Ex.: ${example}`}
          aria-label="Registro rápido: escreva um gasto, uma receita ou um compromisso"
          maxLength={300}
          enterKeyHint="go"
        />
        <motion.button type="submit" className="icon-btn sm" whileTap={{ scale: 0.92 }} disabled={!text.trim()} aria-label="Ler frase">
          <CornerDownLeft size={16} />
        </motion.button>
      </form>
      {!compact && !parsed ? <p className="qe-hint">Escreva como falaria: “{example}”. Você confere antes de salvar.</p> : null}

      <AnimatePresence initial={false}>
        {parsed ? (
          <motion.div
            key="preview"
            className="qe-preview"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {parsed.kind === 'transaction' ? (
              <>
                <div className="qe-preview-head">
                  <span className={`qe-kind ${parsed.type}`}>{parsed.type === 'income' ? <TrendingUp size={17} /> : <TrendingDown size={17} />}</span>
                  <div className="grow">
                    <strong>{parsed.type === 'income' ? 'Receita' : 'Despesa'} de {formatMoney(parsed.amountCents, cardId ? activeCards.find((c) => c.id === cardId)?.currency ?? parsed.currency : parsed.currency)}</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>{parsed.description || 'Sem descrição'} · {relativeDay(parsed.date)} ({formatShortDate(parsed.date)})</div>
                  </div>
                  <button type="button" className="icon-btn ghost sm" onClick={clear} aria-label="Descartar"><X size={16} /></button>
                </div>
                <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 180 }}>
                    <SelectField
                      label="Categoria"
                      value={categoryId}
                      onChange={setCategoryId}
                      options={[{ value: '', label: 'Sem categoria' }, ...categories.filter((c) => c.kind === parsed.type).map((c) => ({ value: c.id, label: c.name }))]}
                    />
                  </div>
                  {parsed.type === 'expense' && planningReady && activeCards.length ? (
                    <div className="grow" style={{ minWidth: 180 }}>
                      <SelectField
                        label="Pagamento"
                        value={cardId}
                        onChange={setCardId}
                        options={[{ value: '', label: 'À vista (débito, Pix, dinheiro)' }, ...activeCards.map((c) => ({ value: c.id, label: `Cartão ${c.name}` }))]}
                      />
                    </div>
                  ) : null}
                </div>
                {cardId && parsed.installments > 1 ? (
                  <div className="qe-fields"><span className="qe-field"><CreditCard size={13} /> <strong>{parsed.installments}x</strong> de {formatMoney(Math.floor(parsed.amountCents / parsed.installments), parsed.currency)}</span></div>
                ) : null}
                {category ? null : <p className="muted" style={{ fontSize: 12 }}>Dica: com uma categoria, o Nexo acompanha seus gastos e orçamentos.</p>}
                <div className="row gap-sm">
                  <motion.button type="button" className="btn btn-primary grow" whileTap={{ scale: 0.98 }} onClick={() => saveTransaction(parsed)}>Salvar</motion.button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setFormInitial(toInput(parsed)); }}>Ajustar</button>
                </div>
              </>
            ) : parsed.kind === 'event' ? (
              <>
                <div className="qe-preview-head">
                  <span className="qe-kind event"><CalendarPlus size={17} /></span>
                  <div className="grow">
                    <strong>{parsed.title}</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>Compromisso · {dayLabel(parsed.date)}</div>
                  </div>
                  <button type="button" className="icon-btn ghost sm" onClick={clear} aria-label="Descartar"><X size={16} /></button>
                </div>
                <label className="row gap-sm" style={{ fontSize: 13 }}>
                  <span className="text-2">Hora</span>
                  <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 140, height: 40 }} aria-label="Hora do compromisso" />
                  {!parsed.time ? <span className="muted" style={{ fontSize: 12 }}>A frase não dizia a hora.</span> : null}
                </label>
                <motion.button type="button" className="btn btn-primary" whileTap={{ scale: 0.98 }} disabled={busy} onClick={() => saveEvent(parsed)}>Marcar na agenda</motion.button>
              </>
            ) : (
              <>
                <div className="qe-preview-head">
                  <span className="qe-kind"><Sparkles size={17} /></span>
                  <div className="grow">
                    <strong>Não consegui entender essa frase</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>Tente algo como “{example}”, ou peça ao assistente.</div>
                  </div>
                  <button type="button" className="icon-btn ghost sm" onClick={clear} aria-label="Descartar"><X size={16} /></button>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/app/chat', { state: { draft: text.trim() } })}>
                  Perguntar ao assistente <ArrowRight size={16} />
                </button>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <TransactionForm
        open={formInitial !== null}
        onClose={() => { setFormInitial(null); }}
        editing={null}
        initial={formInitial ?? undefined}
        onSaved={clear}
      />
      <Paywall open={paywall !== null} onClose={() => setPaywall(null)} title="Recurso dos planos" message={paywall ?? ''} />
    </div>
  );
}
