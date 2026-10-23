import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui';
import { useAuthStore } from '../store/auth';
import { useFinanceStore, type Card, type Category, type Transaction, type TransactionInput } from '../store/finance';
import { CURRENCIES, CURRENCY_LABEL, centsToInput, formatMoney, parseAmountToCents, type Currency, type TransactionType } from '../lib/finance';
import { confirmAction } from '../lib/confirm';
import { formatMonthName, toISODate } from '../lib/dates';
import { canEditFinanceDay, earliestFinanceDay } from '../lib/rules';
import { invoiceMonthFor, splitInstallments } from '../lib/cards';
import { notify } from '../lib/toast';
import DatePickerField from './DatePickerField';
import SelectField from './SelectField';
import NoticeBox from './NoticeBox';

interface Props {
  open: boolean;
  onClose: () => void;
  editing: Transaction | null;
  /** Valores iniciais de um lançamento novo (ex.: vindos do registro rápido). */
  initial?: Partial<TransactionInput>;
  onSaved?: () => void;
}

const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24];

/** Criar, editar ou apagar um lançamento. O formulário é recriado a cada abertura. */
export default function TransactionForm({ open, onClose, editing, initial, onSaved }: Props) {
  const categories = useFinanceStore((s) => s.categories);
  const cards = useFinanceStore((s) => s.cards);
  const planningReady = useFinanceStore((s) => s.planningReady);
  const title = editing ? (editing.purchaseId ? 'Compra parcelada' : 'Editar lançamento') : 'Novo lançamento';
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open ? (
        <TransactionFormBody
          editing={editing}
          initial={initial}
          categories={categories}
          cards={planningReady ? cards : []}
          onDone={() => { onSaved?.(); onClose(); }}
          onCancel={onClose}
        />
      ) : null}
    </Modal>
  );
}

function TransactionFormBody({ editing, initial, categories, cards, onDone, onCancel }: {
  editing: Transaction | null;
  initial?: Partial<TransactionInput>;
  categories: Category[];
  cards: Card[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const updatePurchaseDetails = useFinanceStore((s) => s.updatePurchaseDetails);
  const removeTransaction = useFinanceStore((s) => s.removeTransaction);
  const allTransactions = useFinanceStore((s) => s.transactions);

  const parceled = !!editing?.purchaseId;
  const [type, setType] = useState<TransactionType>(editing?.type ?? initial?.type ?? 'expense');
  const [amount, setAmount] = useState(() => {
    if (editing) {
      const total = parceled ? allTransactions.filter((t) => t.purchaseId === editing.purchaseId).reduce((s, t) => s + t.amountCents, 0) : editing.amountCents;
      return centsToInput(total);
    }
    return initial?.amountCents ? centsToInput(initial.amountCents) : '';
  });
  const [currency, setCurrency] = useState<Currency>(editing?.currency ?? initial?.currency ?? 'BRL');
  const [categoryId, setCategoryId] = useState<string>(editing?.categoryId ?? initial?.categoryId ?? '');
  const [date, setDate] = useState(editing?.occurredOn ?? initial?.occurredOn ?? toISODate());
  const [description, setDescription] = useState(editing?.description ?? initial?.description ?? '');
  const activeCards = cards.filter((c) => !c.archived || c.id === editing?.cardId);
  const [cardId, setCardId] = useState<string>(editing?.cardId ?? initial?.cardId ?? '');
  const [installments, setInstallments] = useState<number>(editing?.installmentTotal ?? initial?.installments ?? 1);
  const [error, setError] = useState('');

  const options = categories.filter((c) => c.kind === type);
  const card = type === 'expense' ? activeCards.find((c) => c.id === cardId) : undefined;
  const isBillPayment = !!editing?.billId;

  const changeType = (next: TransactionType) => {
    setType(next);
    if (!categories.some((c) => c.id === categoryId && c.kind === next)) setCategoryId('');
    if (next === 'income') { setCardId(''); setInstallments(1); }
  };

  const preview = useMemo(() => {
    const cents = parseAmountToCents(amount);
    if (!card || cents === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const first = invoiceMonthFor(date, card);
    const parts = splitInstallments(cents, installments);
    return installments > 1
      ? `${installments}x de ${formatMoney(parts[1], card.currency)}, a partir da fatura de ${formatMonthName(first)}.`
      : `Entra na fatura de ${formatMonthName(first)}.`;
  }, [amount, card, date, installments]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (parceled && editing?.purchaseId) {
      const purchaseId = editing.purchaseId;
      requireAuth(() => {
        updatePurchaseDetails(purchaseId, description, categoryId && options.some((c) => c.id === categoryId) ? categoryId : null);
        onDone();
      });
      return;
    }
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe um valor válido, como 25,90.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Escolha uma data válida.'); return; }
    if (!canEditFinanceDay(date)) { setError('Você pode lançar hoje, ontem ou uma data futura.'); return; }
    if (card && installments > 1 && cents < installments) { setError('O valor é pequeno demais para tantas parcelas.'); return; }

    const input: TransactionInput = {
      type,
      amountCents: cents,
      currency: card ? card.currency : currency,
      categoryId: categoryId && options.some((c) => c.id === categoryId) ? categoryId : null,
      occurredOn: date,
      description,
      cardId: card ? card.id : null,
      installments: card ? installments : 1,
    };
    requireAuth(() => {
      if (editing) {
        updateTransaction(editing.id, input);
      } else if (!addTransaction(input)) {
        notify('Não foi possível registrar. Confira os dados e tente de novo.', 'error');
        return;
      }
      onDone();
    });
  };

  const remove = async () => {
    if (!editing) return;
    const siblings = parceled ? allTransactions.filter((t) => t.purchaseId === editing.purchaseId) : [editing];
    const editable = siblings.filter((t) => canEditFinanceDay(t.occurredOn)).length;
    const ok = await confirmAction({
      title: parceled ? 'Apagar compra parcelada?' : 'Apagar lançamento?',
      message: parceled
        ? editable === siblings.length
          ? `As ${siblings.length} parcelas serão apagadas. Esta ação não pode ser desfeita.`
          : `${editable} de ${siblings.length} parcelas serão apagadas. As de meses anteriores ficam no histórico.`
        : isBillPayment
          ? 'O pagamento será desfeito e a conta volta a aparecer como em aberto.'
          : 'Esta ação não pode ser desfeita.',
      confirmText: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    requireAuth(() => {
      removeTransaction(editing.id);
      onDone();
    });
  };

  if (parceled && editing) {
    const siblings = allTransactions.filter((t) => t.purchaseId === editing.purchaseId);
    const purchaseCard = cards.find((c) => c.id === editing.cardId);
    return (
      <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <NoticeBox>
          {formatMoney(siblings.reduce((s, t) => s + t.amountCents, 0), editing.currency)} em {editing.installmentTotal}x
          {purchaseCard ? ` no cartão ${purchaseCard.name}` : ''}. Esta é a parcela {editing.installmentNumber} de {editing.installmentTotal}.
          Para mudar valor, data ou parcelas, apague a compra e lance de novo.
        </NoticeBox>
        <SelectField
          label="Categoria"
          value={categoryId}
          onChange={setCategoryId}
          options={[{ value: '', label: 'Sem categoria' }, ...options.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição (opcional)" maxLength={120} aria-label="Descrição" />
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Categoria e descrição mudam em todas as parcelas.</p>
        <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Salvar alterações</motion.button>
        <button type="button" className="btn btn-danger btn-block" onClick={remove}><Trash2 size={17} /> Apagar compra</button>
      </form>
    );
  }

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <div className="row gap-sm">
        {(['expense', 'income'] as const).map((value) => {
          const selected = type === value;
          return (
            <motion.button
              key={value}
              type="button"
              whileTap={{ scale: 0.97 }}
              className="grow"
              aria-pressed={selected}
              onClick={() => changeType(value)}
              disabled={isBillPayment}
              style={{
                minHeight: 44, borderRadius: 12, fontWeight: 700,
                background: selected ? (value === 'income' ? 'var(--accent)' : 'var(--danger)') : 'var(--bg)',
                color: selected ? 'var(--bg)' : 'var(--text-2)',
                border: `1px solid ${selected ? 'transparent' : 'var(--border)'}`,
              }}
            >
              {value === 'income' ? 'Receita' : 'Despesa'}
            </motion.button>
          );
        })}
      </div>

      <div className="row gap-sm">
        <input
          className="input grow"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          aria-label="Valor"
          autoFocus={!editing && !initial?.amountCents}
        />
        {card ? (
          <span className="muted" style={{ alignSelf: 'center', fontSize: 13, minWidth: 40 }}>{card.currency}</span>
        ) : (
          <SelectField
            label="Moeda"
            width={118}
            value={currency}
            onChange={(next) => setCurrency(next as Currency)}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>{CURRENCY_LABEL[card ? card.currency : currency]}</p>

      {type === 'expense' && activeCards.length && !isBillPayment ? (
        <div className="row gap-sm">
          <div className="grow">
            <SelectField
              label="Pagamento"
              value={cardId}
              onChange={(next) => { setCardId(next); if (!next) setInstallments(1); }}
              options={[{ value: '', label: 'À vista (débito, Pix, dinheiro)' }, ...activeCards.map((c) => ({ value: c.id, label: `Cartão ${c.name}` }))]}
            />
          </div>
          {card && !editing ? (
            <SelectField
              label="Parcelas"
              width={110}
              value={String(installments)}
              onChange={(next) => setInstallments(Number(next))}
              options={INSTALLMENT_OPTIONS.map((n) => ({ value: String(n), label: n === 1 ? 'À vista' : `${n}x` }))}
            />
          ) : null}
        </div>
      ) : null}
      {preview ? <p className="info" style={{ marginTop: -4 }}>{preview}</p> : null}

      <SelectField
        label="Categoria"
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: '', label: 'Sem categoria' }, ...options.map((c) => ({ value: c.id, label: c.name }))]}
      />

      <DatePickerField label={card ? 'Data da compra' : 'Data'} value={date} onChange={setDate} min={earliestFinanceDay()} />
      <NoticeBox>Você pode lançar hoje, ontem ou datas futuras. Dias anteriores a ontem ficam só para consulta.</NoticeBox>
      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição (opcional)" maxLength={120} aria-label="Descrição" />

      {error ? <p className="error">{error}</p> : null}

      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">
        {editing ? 'Salvar alterações' : 'Adicionar lançamento'}
      </motion.button>

      {editing ? (
        <button type="button" className="btn btn-danger btn-block" onClick={remove}>
          <Trash2 size={17} /> {isBillPayment ? 'Desfazer pagamento' : 'Apagar lançamento'}
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>Cancelar</button>
      )}
    </form>
  );
}
