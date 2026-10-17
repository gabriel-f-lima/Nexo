import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui';
import { useAuthStore } from '../store/auth';
import { useFinanceStore, type Category, type Transaction, type TransactionInput } from '../store/finance';
import { CURRENCIES, CURRENCY_LABEL, centsToInput, parseAmountToCents, type Currency, type TransactionType } from '../lib/finance';
import { confirmAction } from '../lib/confirm';
import { toISODate } from '../lib/dates';
import { canEditFinanceDay, earliestFinanceDay } from '../lib/rules';
import DatePickerField from './DatePickerField';
import SelectField from './SelectField';
import NoticeBox from './NoticeBox';

interface Props {
  open: boolean;
  onClose: () => void;
  editing: Transaction | null;
}

/** Criar, editar ou apagar um lançamento. O formulário é recriado a cada abertura. */
export default function TransactionForm({ open, onClose, editing }: Props) {
  const categories = useFinanceStore((s) => s.categories);
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar lançamento' : 'Novo lançamento'}>
      {open ? <TransactionFormBody editing={editing} categories={categories} onDone={onClose} /> : null}
    </Modal>
  );
}

function TransactionFormBody({ editing, categories, onDone }: { editing: Transaction | null; categories: Category[]; onDone: () => void }) {
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const removeTransaction = useFinanceStore((s) => s.removeTransaction);

  const [type, setType] = useState<TransactionType>(editing?.type ?? 'expense');
  const [amount, setAmount] = useState(editing ? centsToInput(editing.amountCents) : '');
  const [currency, setCurrency] = useState<Currency>(editing?.currency ?? 'BRL');
  const [categoryId, setCategoryId] = useState<string>(editing?.categoryId ?? '');
  const [date, setDate] = useState(editing?.occurredOn ?? toISODate());
  const [description, setDescription] = useState(editing?.description ?? '');
  const [error, setError] = useState('');

  const options = categories.filter((c) => c.kind === type);

  const changeType = (next: TransactionType) => {
    setType(next);
    if (!categories.some((c) => c.id === categoryId && c.kind === next)) setCategoryId('');
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe um valor válido, como 25,90.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Escolha uma data válida.'); return; }
    if (!canEditFinanceDay(date)) { setError('Você pode lançar hoje, ontem ou uma data futura.'); return; }

    const input: TransactionInput = {
      type,
      amountCents: cents,
      currency,
      categoryId: categoryId && options.some((c) => c.id === categoryId) ? categoryId : null,
      occurredOn: date,
      description,
    };
    requireAuth(() => {
      if (editing) updateTransaction(editing.id, input);
      else addTransaction(input);
      onDone();
    });
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirmAction({
      title: 'Apagar lançamento?',
      message: 'Esta ação não pode ser desfeita.',
      confirmText: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    requireAuth(() => {
      removeTransaction(editing.id);
      onDone();
    });
  };

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
          autoFocus={!editing}
        />
        <select className="input" style={{ width: 118 }} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} aria-label="Moeda">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>{CURRENCY_LABEL[currency]}</p>

      <SelectField
        label="Categoria"
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: '', label: 'Sem categoria' }, ...options.map((c) => ({ value: c.id, label: c.name }))]}
      />

      <DatePickerField label="Data" value={date} onChange={setDate} min={earliestFinanceDay()} />
      <NoticeBox>Você pode lançar hoje, ontem ou datas futuras. Dias anteriores a ontem ficam só para consulta.</NoticeBox>
      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição (opcional)" maxLength={120} />

      {error ? <p className="error">{error}</p> : null}

      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">
        {editing ? 'Salvar alterações' : 'Adicionar lançamento'}
      </motion.button>

      {editing ? (
        <button type="button" className="btn btn-danger btn-block" onClick={remove}>
          <Trash2 size={17} /> Apagar lançamento
        </button>
      ) : null}
    </form>
  );
}
