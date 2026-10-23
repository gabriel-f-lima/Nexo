import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, ReceiptText, Trash2, Undo2 } from 'lucide-react';
import { Modal } from '../ui';
import { SetupNote } from '../planning/ui';
import { Switch } from '../NotificationSettings';
import SelectField from '../SelectField';
import DatePickerField from '../DatePickerField';
import NoticeBox from '../NoticeBox';
import { useAuthStore } from '../../store/auth';
import { useFinanceStore, type Bill, type BillInput } from '../../store/finance';
import { BILL_STATUS_LABEL, billsOfMonth, type BillOccurrence } from '../../lib/bills';
import { CURRENCIES, centsToInput, formatMoney, parseAmountToCents, type Currency } from '../../lib/finance';
import { addMonthsToMonth, dayInMonth, formatMonthName, formatMonthTitle, formatShortDate, monthOfKey, relativeDay, toISODate } from '../../lib/dates';
import { canEditFinanceDay, earliestFinanceDay } from '../../lib/rules';
import { confirmAction } from '../../lib/confirm';
import { notify } from '../../lib/toast';

const DAYS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Contas a pagar do mês: o que vence, o que já foi pago e o total. */
export default function BillsTab() {
  const bills = useFinanceStore((s) => s.bills);
  const transactions = useFinanceStore((s) => s.transactions);
  const planningReady = useFinanceStore((s) => s.planningReady);
  const loaded = useFinanceStore((s) => s.loaded);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const today = toISODate();
  const [month, setMonth] = useState(monthOfKey(today));
  const [formFor, setFormFor] = useState<Bill | 'new' | null>(null);
  const [paying, setPaying] = useState<BillOccurrence | null>(null);

  const list = useMemo(() => billsOfMonth(bills, transactions, month, today), [bills, transactions, month, today]);
  const totals = useMemo(() => {
    const byCurrency = new Map<Currency, { due: number; paid: number }>();
    for (const o of list) {
      const entry = byCurrency.get(o.bill.currency) ?? { due: 0, paid: 0 };
      if (o.status === 'paid') entry.paid += transactions.find((t) => t.billId === o.bill.id && t.billPeriod === o.period)?.amountCents ?? o.bill.amountCents;
      else entry.due += o.bill.amountCents;
      byCurrency.set(o.bill.currency, entry);
    }
    return Array.from(byCurrency.entries());
  }, [list, transactions]);
  const inactive = bills.filter((b) => !b.active);

  if (loaded && !planningReady) return <SetupNote>As contas a pagar estão sendo ativadas na sua conta. Tente de novo mais tarde.</SetupNote>;

  return (
    <div className="stack">
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="section-title">Contas a pagar</div>
          <div className="section-hint">Contas fixas e únicas, com aviso antes do vencimento</div>
        </div>
        <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} onClick={() => requireAuth(() => setFormFor('new'))} aria-label="Nova conta" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 0 }}>
          <Plus size={20} />
        </motion.button>
      </div>

      <div className="cal" style={{ padding: 12 }}>
        <div className="row between">
          <button type="button" className="icon-btn plain sm" onClick={() => setMonth(addMonthsToMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={17} /></button>
          <span className="cal-title" style={{ textTransform: 'none' }}>{formatMonthTitle(month)}</span>
          <button type="button" className="icon-btn plain sm" onClick={() => setMonth(addMonthsToMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={17} /></button>
        </div>
      </div>

      {totals.length ? (
        <div className="money-split">
          {totals.map(([currency, t]) => (
            <div key={currency}>
              <div className="k">{currency} · a pagar</div>
              <div className="v" style={{ color: t.due ? 'var(--warn)' : 'var(--accent)' }}>{formatMoney(t.due, currency)}</div>
              <div className="k" style={{ marginTop: 4 }}>pago {formatMoney(t.paid, currency)}</div>
            </div>
          ))}
        </div>
      ) : null}

      {list.length ? list.map((o) => (
        <BillRow key={`${o.bill.id}:${o.period}`} occurrence={o} today={today} onEdit={() => setFormFor(o.bill)} onPay={() => setPaying(o)} />
      )) : (
        <div className="empty-card">
          <ReceiptText size={24} color="var(--muted)" />
          <strong>{bills.length ? `Nenhuma conta em ${formatMonthName(month)}` : 'Nenhuma conta cadastrada'}</strong>
          <span>Cadastre aluguel, luz, internet e outras contas. O Nexo avisa antes de vencer e mostra quanto ainda falta pagar no mês.</span>
          {!bills.length ? <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => setFormFor('new'))}><Plus size={15} /> Cadastrar conta</button> : null}
        </div>
      )}

      {inactive.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="section-hint">Contas pausadas</span>
          {inactive.map((bill) => (
            <button key={bill.id} type="button" className="invoice-row" onClick={() => setFormFor(bill)}>
              <span className="grow"><span className="when">{bill.name}</span><span className="sub" style={{ display: 'block' }}>Pausada · {formatMoney(bill.amountCents, bill.currency)}</span></span>
              <Pencil size={15} className="muted" />
            </button>
          ))}
        </div>
      ) : null}

      <Modal open={formFor !== null} onClose={() => setFormFor(null)} title={formFor === 'new' ? 'Nova conta' : 'Editar conta'}>
        {formFor !== null ? <BillFormBody bill={formFor === 'new' ? null : formFor} onDone={() => setFormFor(null)} /> : null}
      </Modal>
      <Modal open={paying !== null} onClose={() => setPaying(null)} title={paying ? `Pagar ${paying.bill.name}` : undefined}>
        {paying ? <PayBillBody occurrence={paying} onDone={() => setPaying(null)} /> : null}
      </Modal>
    </div>
  );
}

function BillRow({ occurrence, today, onEdit, onPay }: { occurrence: BillOccurrence; today: string; onEdit: () => void; onPay: () => void }) {
  const unpayBill = useFinanceStore((s) => s.unpayBill);
  const payment = useFinanceStore((s) => s.transactions.find((t) => t.billId === occurrence.bill.id && t.billPeriod === occurrence.period));
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const { bill, dueDate, status } = occurrence;
  const day = Number(dueDate.slice(8, 10));
  const weekday = WEEK[new Date(`${dueDate}T12:00:00`).getDay()];

  const undo = async () => {
    if (!payment) return;
    if (!canEditFinanceDay(payment.occurredOn)) { notify('Pagamentos de dias anteriores a ontem ficam só para consulta.', 'info'); return; }
    const ok = await confirmAction({ title: 'Desfazer pagamento?', message: `A despesa de ${formatMoney(payment.amountCents, payment.currency)} será apagada e a conta volta a ficar em aberto.`, confirmText: 'Desfazer', danger: true });
    if (ok) requireAuth(() => unpayBill(bill.id, occurrence.period));
  };

  return (
    <motion.div className={`bill-row ${status}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bill-main">
        <div className="bill-date"><strong>{day}</strong><span>{weekday}</span></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bill-name">{bill.name}</div>
          <div className="bill-sub">
            {status === 'paid'
              ? `Paga em ${formatShortDate(occurrence.paidOn ?? dueDate, today)}`
              : `${status === 'overdue' ? 'Venceu' : 'Vence'} ${relativeDay(dueDate, today)}${bill.recurrence === 'monthly' ? ' · todo mês' : ''}`}
          </div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
          <span className="bill-amount">{formatMoney(payment?.amountCents ?? bill.amountCents, bill.currency)}</span>
          <span className={`pill ${status}`}>{BILL_STATUS_LABEL[status]}</span>
        </div>
      </div>
      <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil size={14} /> Editar</button>
        {status === 'paid'
          ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void undo(); }}><Undo2 size={14} /> Desfazer</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={onPay}><Check size={14} /> Pagar</button>}
      </div>
    </motion.div>
  );
}

function PayBillBody({ occurrence, onDone }: { occurrence: BillOccurrence; onDone: () => void }) {
  const payBill = useFinanceStore((s) => s.payBill);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const today = toISODate();
  const [amount, setAmount] = useState(centsToInput(occurrence.bill.amountCents));
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState('');

  const save = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe o valor pago.'); return; }
    if (!canEditFinanceDay(paidOn)) { setError('O pagamento pode ser de hoje, de ontem ou de uma data futura.'); return; }
    requireAuth(() => {
      if (payBill(occurrence.bill.id, occurrence.period, cents, paidOn)) {
        notify(`${occurrence.bill.name} paga. A despesa foi registrada.`, 'success');
        onDone();
      } else {
        setError('Não foi possível registrar o pagamento. Talvez ele já exista.');
      }
    });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <p className="text-2" style={{ fontSize: 13.5 }}>Referente a {formatMonthName(occurrence.period)} · vence em {formatShortDate(occurrence.dueDate, today)}.</p>
      <div className="row gap-sm">
        <input className="input grow" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Valor pago" autoFocus />
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>{occurrence.bill.currency}</span>
      </div>
      <DatePickerField label="Data do pagamento" value={paidOn} onChange={setPaidOn} min={earliestFinanceDay()} />
      <NoticeBox>O pagamento vira uma despesa na categoria da conta e sai do seu saldo.</NoticeBox>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Confirmar pagamento</motion.button>
    </form>
  );
}

function BillFormBody({ bill, onDone }: { bill: Bill | null; onDone: () => void }) {
  const addBill = useFinanceStore((s) => s.addBill);
  const updateBill = useFinanceStore((s) => s.updateBill);
  const setBillActive = useFinanceStore((s) => s.setBillActive);
  const removeBill = useFinanceStore((s) => s.removeBill);
  const categories = useFinanceStore((s) => s.categories).filter((c) => c.kind === 'expense');
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const today = toISODate();
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState(bill ? centsToInput(bill.amountCents) : '');
  const [currency, setCurrency] = useState<Currency>(bill?.currency ?? 'BRL');
  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? '');
  const [recurrence, setRecurrence] = useState<'monthly' | 'once'>(bill?.recurrence ?? 'monthly');
  const [dueDay, setDueDay] = useState(String(bill?.dueDay ?? 10));
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? '');
  const [includeThisMonth, setIncludeThisMonth] = useState(false);
  const [error, setError] = useState('');

  // Conta nova cujo dia deste mês já passou: por padrão começa no mês que vem; dá para incluir a deste mês.
  const alreadyPassed = !bill && recurrence === 'monthly' && dayInMonth(monthOfKey(today), Number(dueDay)) < today;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError('Dê um nome à conta, como Aluguel ou Internet.'); return; }
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe o valor, como 99,90. Se varia, use o valor médio.'); return; }
    if (recurrence === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setError('Escolha a data de vencimento.'); return; }
    const startsOn = bill?.startsOn ?? (includeThisMonth ? `${monthOfKey(today)}-01` : today);
    const input: BillInput = {
      name, amountCents: cents, currency, categoryId: categoryId || null, recurrence,
      dueDay: recurrence === 'monthly' ? Number(dueDay) : null,
      dueDate: recurrence === 'once' ? dueDate : null,
      startsOn,
    };
    requireAuth(() => {
      if (bill) updateBill(bill.id, input);
      else addBill(input);
      onDone();
    });
  };

  const remove = async () => {
    if (!bill) return;
    const ok = await confirmAction({ title: 'Apagar conta?', message: `“${bill.name}” deixa de aparecer. Os pagamentos já registrados continuam como despesas.`, confirmText: 'Apagar', danger: true });
    if (ok) requireAuth(() => { removeBill(bill.id); onDone(); });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Aluguel)" maxLength={60} autoFocus aria-label="Nome da conta" />
      <div className="row gap-sm">
        <input className="input grow" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor" inputMode="decimal" aria-label="Valor" />
        <SelectField label="Moeda" width={118} value={currency} onChange={(next) => setCurrency(next as Currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      <div className="choice-row" role="radiogroup" aria-label="Repetição">
        <button type="button" className="choice" aria-pressed={recurrence === 'monthly'} onClick={() => setRecurrence('monthly')}><strong>Todo mês</strong>Aluguel, luz, internet…</button>
        <button type="button" className="choice" aria-pressed={recurrence === 'once'} onClick={() => setRecurrence('once')}><strong>Uma vez</strong>IPVA, boleto avulso…</button>
      </div>
      {recurrence === 'monthly'
        ? <SelectField label="Vence no" value={dueDay} onChange={setDueDay} options={DAYS} />
        : <DatePickerField label="Vencimento" value={dueDate} onChange={setDueDate} min={today} />}
      {alreadyPassed ? (
        <div className="row gap-sm" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          <Switch checked={includeThisMonth} onChange={setIncludeThisMonth} label="Incluir a conta deste mês" />
          <span>O dia {dueDay} deste mês já passou. Ligue se a conta deste mês ainda não foi paga.</span>
        </div>
      ) : null}
      <SelectField
        label="Categoria"
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: '', label: 'Sem categoria' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
      />
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">{bill ? 'Salvar conta' : 'Cadastrar conta'}</motion.button>
      {bill ? (
        <div className="row gap-sm">
          <button type="button" className="btn btn-ghost grow" onClick={() => requireAuth(() => { setBillActive(bill.id, !bill.active); onDone(); })}>
            {bill.active ? 'Pausar' : 'Reativar'}
          </button>
          <button type="button" className="btn btn-danger grow" onClick={() => { void remove(); }}><Trash2 size={16} /> Apagar</button>
        </div>
      ) : null}
    </form>
  );
}
