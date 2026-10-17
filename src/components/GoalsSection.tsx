import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Target, Plus, Trash2, PiggyBank } from 'lucide-react';
import { Modal } from './ui';
import { useAuthStore } from '../store/auth';
import { useFinanceStore, type Goal } from '../store/finance';
import { CURRENCIES, centsToInput, formatMoney, parseAmountToCents, type Currency } from '../lib/finance';
import { confirmAction } from '../lib/confirm';
import { toISODate } from '../lib/dates';
import { currentTier, LIMITS } from '../lib/billing';
import Paywall from './Paywall';
import DatePickerField from './DatePickerField';
import NoticeBox from './NoticeBox';

/** Lista de metas com progresso. Adicionar valor e apagar exigem conta. */
export default function GoalsSection() {
  const goals = useFinanceStore((s) => s.goals);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const removeGoal = useFinanceStore((s) => s.removeGoal);
  const [formOpen, setFormOpen] = useState(false);
  const [savingFor, setSavingFor] = useState<Goal | null>(null);
  const userId = useAuthStore((s) => s.user?.id);
  const [paywall, setPaywall] = useState<string | null>(null);

  /** Quantas metas o nível permite. Ao atingir o limite, mostra o aviso com os planos. */
  const newGoal = () => requireAuth(() => {
    if (!userId) return;
    currentTier(userId)
      .then((tier) => {
        const max = LIMITS[tier].goals;
        if (max === null || goals.length < max) {
          setFormOpen(true);
          return;
        }
        setPaywall(tier === 'free'
          ? `Você já tem ${max} metas, o limite do plano gratuito. Exclua uma para criar outra, ou assine para ter mais.`
          : `Você já tem ${max} metas, o limite do seu plano. Assine o Pro para metas ilimitadas.`);
      })
      .catch(() => setPaywall('Não foi possível verificar seu plano agora. Tente novamente.'));
  });

  const remove = async (goal: Goal) => {
    const ok = await confirmAction({
      title: 'Apagar meta?',
      message: `“${goal.name}” será removida. O valor guardado não é movimentado.`,
      confirmText: 'Apagar',
      danger: true,
    });
    if (ok) requireAuth(() => removeGoal(goal.id));
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="section-head">
        <div>
          <div className="section-title">Metas</div>
          <div className="section-hint">Acompanhe o que você quer juntar</div>
        </div>
        <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} onClick={newGoal} aria-label="Nova meta" style={{ background: 'var(--accent)', color: 'var(--bg)', border: 0 }}>
          <Plus size={20} />
        </motion.button>
      </div>

      {goals.length ? goals.map((goal) => {
        const percent = Math.min(100, Math.round((goal.savedCents / goal.targetCents) * 100));
        const done = goal.savedCents >= goal.targetCents;
        const overdue = !done && !!goal.deadline && goal.deadline < toISODate();
        return (
          <motion.div key={goal.id} className="card" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row gap-sm"><Target size={16} color="var(--accent)" /><strong style={{ fontSize: 15 }}>{goal.name}</strong></div>
                <div className="text-2" style={{ fontSize: 12, marginTop: 4 }}>
                  {formatMoney(goal.savedCents, goal.currency)} de {formatMoney(goal.targetCents, goal.currency)}
                </div>
              </div>
              <span style={{ fontWeight: 800, color: done ? 'var(--accent)' : 'var(--text-2)' }}>{percent}%</span>
            </div>
            <div className="track" style={{ marginTop: 12 }}>
              <motion.div className="fill" initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <div className="row between" style={{ marginTop: 12, gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {done ? 'Meta concluída' : overdue ? 'Prazo vencido' : goal.deadline ? `Prazo: ${goal.deadline.split('-').reverse().join('/')}` : 'Sem prazo'}
              </span>
              <div className="row gap-sm">
                {!done ? (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => requireAuth(() => setSavingFor(goal))}>
                    <PiggyBank size={15} /> Guardar
                  </button>
                ) : null}
                <button type="button" className="icon-btn ghost sm" onClick={() => { void remove(goal); }} aria-label={`Apagar meta ${goal.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        );
      }) : (
        <div className="empty-card">
          <Target size={24} color="var(--muted)" />
          <strong>Nenhuma meta ainda</strong>
          <span>Crie uma meta, como uma viagem ou uma reserva de emergência.</span>
        </div>
      )}

      <GoalForm open={formOpen} onClose={() => setFormOpen(false)} />
      <SavingForm goal={savingFor} onClose={() => setSavingFor(null)} />

      <Paywall open={paywall !== null} onClose={() => setPaywall(null)} title="Limite de metas" message={paywall ?? ''} />
    </div>
  );
}

function GoalForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Nova meta">
      {open ? <GoalFormBody onDone={onClose} /> : null}
    </Modal>
  );
}

function GoalFormBody({ onDone }: { onDone: () => void }) {
  const addGoal = useFinanceStore((s) => s.addGoal);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('BRL');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError('Dê um nome para a meta.'); return; }
    const cents = parseAmountToCents(target);
    if (cents === null) { setError('Informe o valor objetivo, como 5.000,00.'); return; }
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) { setError('Prazo inválido.'); return; }
    requireAuth(() => {
      addGoal(name, currency, cents, deadline || null);
      onDone();
    });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da meta" maxLength={60} autoFocus />
      <div className="row gap-sm">
        <input className="input grow" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Valor objetivo" inputMode="decimal" aria-label="Valor objetivo" />
        <select className="input" style={{ width: 118 }} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} aria-label="Moeda">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <DatePickerField label="Prazo (opcional)" value={deadline} onChange={setDeadline} min={toISODate()} clearable />
      <NoticeBox>Opcional. Escolha até quando quer juntar o valor da meta, a partir de hoje.</NoticeBox>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Criar meta</motion.button>
    </form>
  );
}

function SavingForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  return (
    <Modal open={goal !== null} onClose={onClose} title={goal ? `Guardar em “${goal.name}”` : undefined}>
      {goal ? <SavingFormBody goal={goal} onDone={onClose} /> : null}
    </Modal>
  );
}

function SavingFormBody({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const addGoalSaving = useFinanceStore((s) => s.addGoalSaving);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const remaining = Math.max(0, goal.targetCents - goal.savedCents);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe um valor válido, como 150,00.'); return; }
    requireAuth(() => {
      addGoalSaving(goal.id, cents);
      onDone();
    });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <p className="text-2" style={{ fontSize: 13 }}>Faltam {formatMoney(remaining, goal.currency)} para concluir.</p>
      <div className="row gap-sm">
        <input className="input grow" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={centsToInput(Math.min(remaining, 10000))} inputMode="decimal" aria-label="Valor a guardar" autoFocus />
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>{goal.currency}</span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">Guardar valor</motion.button>
    </form>
  );
}
