import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, ArchiveRestore, CreditCard, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Modal } from '../ui';
import { SetupNote } from '../planning/ui';
import SelectField from '../SelectField';
import DatePickerField from '../DatePickerField';
import NoticeBox from '../NoticeBox';
import { useAuthStore } from '../../store/auth';
import { useFinanceStore, type Card, type CardInput } from '../../store/finance';
import {
  INVOICE_STATUS_LABEL, cardInvoices, cardUsage, invoiceMonthFor, type InvoiceSummary,
} from '../../lib/cards';
import { CURRENCIES, centsToInput, formatMoney, parseAmountToCents, type Currency } from '../../lib/finance';
import { formatMonthName, formatMonthTitle, formatShortDate, relativeDay, toISODate } from '../../lib/dates';
import { earliestFinanceDay, canEditFinanceDay } from '../../lib/rules';
import { confirmAction } from '../../lib/confirm';
import { notify } from '../../lib/toast';

const CARD_COLORS = ['#8A05BE', '#FF7A00', '#EC0000', '#005CA9', '#1F7A4D', '#2B2B2B', '#B8860B', '#D6336C'];
const DAYS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));

const cardBackground = (color: string) => `linear-gradient(135deg, ${color} 0%, ${color}cc 55%, #0b0f0d 160%)`;

/** Cartões de crédito: fatura atual, limite, próximas faturas e pagamentos. */
export default function CardsTab() {
  const cards = useFinanceStore((s) => s.cards);
  const transactions = useFinanceStore((s) => s.transactions);
  const payments = useFinanceStore((s) => s.cardPayments);
  const planningReady = useFinanceStore((s) => s.planningReady);
  const loaded = useFinanceStore((s) => s.loaded);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [formFor, setFormFor] = useState<Card | 'new' | null>(null);
  const [invoice, setInvoice] = useState<{ card: Card; month: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const today = toISODate();

  const active = cards.filter((c) => !c.archived);
  const archived = cards.filter((c) => c.archived);

  if (loaded && !planningReady) return <SetupNote>Os cartões de crédito estão sendo ativados na sua conta. Tente de novo mais tarde.</SetupNote>;

  return (
    <div className="stack">
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="section-title">Cartões de crédito</div>
          <div className="section-hint">Compras entram na fatura certa pelo dia de fechamento</div>
        </div>
        <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} onClick={() => requireAuth(() => setFormFor('new'))} aria-label="Novo cartão" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 0 }}>
          <Plus size={20} />
        </motion.button>
      </div>

      {active.length ? active.map((card) => (
        <CardBlock key={card.id} card={card} today={today} onEdit={() => setFormFor(card)} onOpenInvoice={(month) => setInvoice({ card, month })}
          transactions={transactions} payments={payments} />
      )) : (
        <div className="empty-card">
          <CreditCard size={24} color="var(--muted)" />
          <strong>Nenhum cartão cadastrado</strong>
          <span>Cadastre seu cartão com o dia de fechamento e de vencimento. O Nexo separa cada compra na fatura certa, inclusive as parceladas.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => setFormFor('new'))}><Plus size={15} /> Cadastrar cartão</button>
        </div>
      )}

      {archived.length ? (
        <>
          <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Esconder' : 'Mostrar'} cartões arquivados ({archived.length})
          </button>
          {showArchived ? archived.map((card) => (
            <CardBlock key={card.id} card={card} today={today} onEdit={() => setFormFor(card)} onOpenInvoice={(month) => setInvoice({ card, month })}
              transactions={transactions} payments={payments} />
          )) : null}
        </>
      ) : null}

      <Modal open={formFor !== null} onClose={() => setFormFor(null)} title={formFor === 'new' ? 'Novo cartão' : 'Editar cartão'}>
        {formFor !== null ? <CardFormBody card={formFor === 'new' ? null : formFor} onDone={() => setFormFor(null)} /> : null}
      </Modal>
      <Modal open={invoice !== null} onClose={() => setInvoice(null)} title={invoice ? `Fatura de ${formatMonthName(invoice.month)}` : undefined}>
        {invoice ? <InvoiceBody card={invoice.card} month={invoice.month} onDone={() => setInvoice(null)} /> : null}
      </Modal>
    </div>
  );
}

function CardBlock({ card, today, onEdit, onOpenInvoice, transactions, payments }: {
  card: Card;
  today: string;
  onEdit: () => void;
  onOpenInvoice: (month: string) => void;
  transactions: ReturnType<typeof useFinanceStore.getState>['transactions'];
  payments: ReturnType<typeof useFinanceStore.getState>['cardPayments'];
}) {
  const invoices = useMemo(() => cardInvoices(card, transactions, payments, today), [card, transactions, payments, today]);
  const usage = useMemo(() => cardUsage(card, transactions, payments, today), [card, transactions, payments, today]);
  const current = invoices.find((i) => i.status === 'open');
  const pending = invoices.filter((i) => i.status === 'closed' || i.status === 'overdue');
  const upcoming = invoices.filter((i) => i.status === 'future').slice(0, 3);
  const paid = invoices.filter((i) => i.status === 'paid').slice(-2).reverse();
  const money = (c: number) => formatMoney(c, card.currency);

  return (
    <motion.div className="stack" style={{ gap: 10 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className={`ccard${card.archived ? ' archived' : ''}`} style={{ background: cardBackground(card.color) }}>
        <div className="ccard-head">
          <div>
            <div className="ccard-name">{card.name}</div>
            <div className="ccard-meta">Fecha dia {card.closingDay} · vence dia {card.dueDay} · {card.currency}</div>
          </div>
          <button type="button" className="icon-btn sm" onClick={onEdit} aria-label={`Editar cartão ${card.name}`}><Pencil size={15} /></button>
        </div>
        <div>
          <div className="ccard-meta">Fatura atual{current ? ` · fecha ${relativeDay(current.closing, today)}` : ''}</div>
          <div className="ccard-amount">{money(current?.totalCents ?? 0)}</div>
        </div>
        {usage.ratio !== null ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="ccard-track"><div style={{ width: `${Math.min(100, Math.round(usage.ratio * 100))}%` }} /></div>
            <div className="ccard-meta">Limite usado {money(usage.usedCents)} de {money(card.limitCents ?? 0)} · disponível {money(Math.max(0, usage.availableCents ?? 0))}</div>
          </div>
        ) : (
          <div className="ccard-meta">Em aberto no cartão: {money(usage.usedCents)}</div>
        )}
      </div>

      <div className="invoice-list">
        {[...pending, ...(current ? [current] : []), ...upcoming, ...paid].map((inv) => (
          <InvoiceRow key={inv.month} invoice={inv} currency={card.currency} today={today} onOpen={() => onOpenInvoice(inv.month)} />
        ))}
      </div>
    </motion.div>
  );
}

function InvoiceRow({ invoice, currency, today, onOpen }: { invoice: InvoiceSummary; currency: Currency; today: string; onOpen: () => void }) {
  const sub = invoice.status === 'open'
    ? `Fecha ${formatShortDate(invoice.closing, today)} · vence ${formatShortDate(invoice.due, today)}`
    : invoice.status === 'paid'
      ? `Paga · ${invoice.due < today ? 'venceu' : 'vence'} ${formatShortDate(invoice.due, today)}`
      : invoice.status === 'future'
        ? `Parcelas lançadas · vence ${formatShortDate(invoice.due, today)}`
        : `Vence ${relativeDay(invoice.due, today)} (${formatShortDate(invoice.due, today)})`;
  const amount = invoice.status === 'closed' || invoice.status === 'overdue' ? invoice.remainingCents : invoice.totalCents;
  return (
    <button type="button" className="invoice-row" onClick={onOpen}>
      <div className="grow">
        <div className="when">{formatMonthTitle(invoice.month)}</div>
        <div className="sub">{sub}{invoice.itemCount ? ` · ${invoice.itemCount} ${invoice.itemCount === 1 ? 'compra' : 'compras'}` : ''}</div>
      </div>
      <span className={`pill ${invoice.status}`}>{INVOICE_STATUS_LABEL[invoice.status]}</span>
      <span className="amount">{formatMoney(amount, currency)}</span>
    </button>
  );
}

function InvoiceBody({ card, month, onDone }: { card: Card; month: string; onDone: () => void }) {
  const transactions = useFinanceStore((s) => s.transactions);
  const payments = useFinanceStore((s) => s.cardPayments);
  const categories = useFinanceStore((s) => s.categories);
  const payInvoice = useFinanceStore((s) => s.payInvoice);
  const removeCardPayment = useFinanceStore((s) => s.removeCardPayment);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const today = toISODate();
  const invoice = cardInvoices(card, transactions, payments, today).find((i) => i.month === month);
  const items = transactions.filter((t) => t.cardId === card.id && t.invoiceMonth === month).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const invoicePayments = payments.filter((p) => p.cardId === card.id && p.invoiceMonth === month);
  const [amount, setAmount] = useState(invoice && invoice.remainingCents ? centsToInput(invoice.remainingCents) : '');
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState('');
  const money = (c: number) => formatMoney(c, card.currency);
  if (!invoice) return <p className="muted">Fatura não encontrada.</p>;

  const pay = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe o valor pago, como 1.250,00.'); return; }
    if (!canEditFinanceDay(paidOn)) { setError('O pagamento pode ser de hoje, de ontem ou de uma data futura.'); return; }
    requireAuth(() => {
      payInvoice(card.id, month, cents, paidOn);
      notify(cents >= invoice.remainingCents ? 'Fatura paga. O valor saiu do seu saldo.' : `Pagamento parcial de ${money(cents)} registrado.`, 'success');
      onDone();
    });
  };

  const undo = async (id: string, cents: number) => {
    const ok = await confirmAction({ title: 'Desfazer pagamento?', message: `O pagamento de ${money(cents)} será removido e a fatura volta a ficar em aberto.`, confirmText: 'Desfazer', danger: true });
    if (ok) requireAuth(() => removeCardPayment(id));
  };

  return (
    <div className="stack">
      <div className="money-split">
        <div><div className="k">Total</div><div className="v">{money(invoice.totalCents)}</div></div>
        <div><div className="k">Pago</div><div className="v">{money(invoice.paidCents)}</div></div>
        <div><div className="k">Falta</div><div className="v" style={{ color: invoice.remainingCents ? 'var(--warn)' : 'var(--accent)' }}>{money(invoice.remainingCents)}</div></div>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Fecha em {formatShortDate(invoice.closing, today)} e vence em {formatShortDate(invoice.due, today)}. <span className={`pill ${invoice.status}`}>{INVOICE_STATUS_LABEL[invoice.status]}</span>
      </p>

      <div style={{ display: 'grid', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {items.length ? items.map((t) => (
          <div key={t.id} className="row gap-sm" style={{ fontSize: 13.5, padding: '6px 2px', borderBottom: '1px solid var(--border)' }}>
            <span className="muted" style={{ width: 44, fontVariantNumeric: 'tabular-nums' }}>{formatShortDate(t.occurredOn, today)}</span>
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.description || categories.find((c) => c.id === t.categoryId)?.name || 'Compra'}
              {t.installmentTotal ? <span className="muted"> · {t.installmentNumber}/{t.installmentTotal}</span> : null}
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(t.amountCents)}</strong>
          </div>
        )) : <p className="muted center" style={{ fontSize: 13, padding: '10px 0' }}>Nenhuma compra nesta fatura.</p>}
      </div>

      {invoicePayments.length ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="text-2" style={{ fontSize: 13, fontWeight: 650 }}>Pagamentos</span>
          {invoicePayments.map((p) => (
            <div key={p.id} className="row gap-sm" style={{ fontSize: 13.5 }}>
              <span className="grow">{formatShortDate(p.paidOn, today)} · {money(p.amountCents)}</span>
              <button type="button" className="icon-btn ghost sm" onClick={() => { void undo(p.id, p.amountCents); }} aria-label="Desfazer pagamento"><Undo2 size={15} /></button>
            </div>
          ))}
        </div>
      ) : null}

      {invoice.remainingCents > 0 && invoice.status !== 'future' ? (
        <form onSubmit={pay} style={{ display: 'grid', gap: 10 }}>
          <div className="row gap-sm">
            <input className="input grow" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Valor pago" placeholder="Valor pago" />
            <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>{card.currency}</span>
          </div>
          <DatePickerField label="Data do pagamento" value={paidOn} onChange={setPaidOn} min={earliestFinanceDay()} />
          <NoticeBox>O pagamento sai do seu saldo. As compras já contam como gasto nas datas delas, então não viram despesa de novo.</NoticeBox>
          {error ? <p className="error">{error}</p> : null}
          <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Registrar pagamento</motion.button>
        </form>
      ) : null}
    </div>
  );
}

function CardFormBody({ card, onDone }: { card: Card | null; onDone: () => void }) {
  const addCard = useFinanceStore((s) => s.addCard);
  const updateCard = useFinanceStore((s) => s.updateCard);
  const setCardArchived = useFinanceStore((s) => s.setCardArchived);
  const removeCard = useFinanceStore((s) => s.removeCard);
  const hasPurchases = useFinanceStore((s) => !!card && s.transactions.some((t) => t.cardId === card.id));
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [name, setName] = useState(card?.name ?? '');
  const [color, setColor] = useState(card?.color ?? CARD_COLORS[0]);
  const [currency, setCurrency] = useState<Currency>(card?.currency ?? 'BRL');
  const [limit, setLimit] = useState(card?.limitCents ? centsToInput(card.limitCents) : '');
  const [closingDay, setClosingDay] = useState(String(card?.closingDay ?? 5));
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? 12));
  const [error, setError] = useState('');

  const example = useMemo(() => {
    const cycle = { closingDay: Number(closingDay), dueDay: Number(dueDay) };
    return `Uma compra hoje entra na fatura de ${formatMonthName(invoiceMonthFor(toISODate(), cycle))}.`;
  }, [closingDay, dueDay]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError('Dê um nome ao cartão, como Nubank ou Inter.'); return; }
    const limitCents = limit.trim() ? parseAmountToCents(limit) : null;
    if (limit.trim() && limitCents === null) { setError('Limite inválido. Use, por exemplo, 3.000,00, ou deixe em branco.'); return; }
    const input: CardInput = { name, color, currency, limitCents, closingDay: Number(closingDay), dueDay: Number(dueDay) };
    requireAuth(() => {
      if (card) updateCard(card.id, input);
      else addCard(input);
      onDone();
    });
  };

  const remove = async () => {
    if (!card) return;
    if (hasPurchases) {
      const ok = await confirmAction({
        title: card.archived ? 'Reativar cartão?' : 'Arquivar cartão?',
        message: card.archived
          ? 'O cartão volta a aparecer nos lançamentos.'
          : 'O cartão tem compras registradas, então fica arquivado: some das opções de pagamento, mas as faturas continuam no histórico.',
        confirmText: card.archived ? 'Reativar' : 'Arquivar',
      });
      if (ok) requireAuth(() => { setCardArchived(card.id, !card.archived); onDone(); });
      return;
    }
    const ok = await confirmAction({ title: 'Apagar cartão?', message: `“${card.name}” será removido.`, confirmText: 'Apagar', danger: true });
    if (ok) requireAuth(() => { removeCard(card.id); onDone(); });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cartão (ex.: Nubank)" maxLength={40} autoFocus aria-label="Nome do cartão" />
      <div className="row gap-sm" role="radiogroup" aria-label="Cor do cartão" style={{ flexWrap: 'wrap' }}>
        {CARD_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${c}`} onClick={() => setColor(c)}
            style={{ width: 30, height: 30, borderRadius: 9, background: c, border: color === c ? '2px solid var(--text)' : '2px solid transparent', boxShadow: color === c ? 'var(--ring)' : 'none' }} />
        ))}
      </div>
      <div className="row gap-sm">
        <div className="grow"><SelectField label="Fecha no" value={closingDay} onChange={setClosingDay} options={DAYS} /></div>
        <div className="grow"><SelectField label="Vence no" value={dueDay} onChange={setDueDay} options={DAYS} /></div>
      </div>
      <p className="info" style={{ marginTop: -4 }}>{example}</p>
      <div className="row gap-sm">
        <input className="input grow" value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="Limite (opcional)" aria-label="Limite do cartão" />
        {hasPurchases ? (
          <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>{currency}</span>
        ) : (
          <SelectField label="Moeda" width={118} value={currency} onChange={(next) => setCurrency(next as Currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        )}
      </div>
      <NoticeBox>Compras a partir do dia do fechamento vão para a fatura seguinte. Mudar os dias vale para as próximas compras; as já lançadas ficam onde estão.</NoticeBox>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">{card ? 'Salvar cartão' : 'Cadastrar cartão'}</motion.button>
      <AnimatePresence>
        {card ? (
          <button type="button" className={`btn btn-block ${hasPurchases ? 'btn-ghost' : 'btn-danger'}`} onClick={() => { void remove(); }}>
            {hasPurchases ? (card.archived ? <><ArchiveRestore size={17} /> Reativar cartão</> : <><Archive size={17} /> Arquivar cartão</>) : <><Trash2 size={17} /> Apagar cartão</>}
          </button>
        ) : null}
      </AnimatePresence>
    </form>
  );
}
