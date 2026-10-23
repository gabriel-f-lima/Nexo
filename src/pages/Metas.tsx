import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, CircleCheck, Leaf, Lock, Pencil, PiggyBank, Plus, RotateCcw, Sparkles, Target, Trash2 } from 'lucide-react';
import { Header, Modal } from '../components/ui';
import GoalsSection from '../components/GoalsSection';
import ObjectiveWizard from '../components/goals/ObjectiveWizard';
import StreakGoals from '../components/goals/StreakGoals';
import { ProgressRing, SetupNote, WeekDots } from '../components/planning/ui';
import { useAuthStore } from '../store/auth';
import { useDataStore } from '../store/data';
import { useFinanceStore, type Goal } from '../store/finance';
import { useProgressStore, type Objective } from '../store/progress';
import { useTier } from '../lib/useTier';
import { LIMITS } from '../lib/billing';
import { objectiveProgress, OBJECTIVE_STATUS_LABEL } from '../lib/objectives';
import { addDaysToKey, formatShortDate, toISODate } from '../lib/dates';
import { centsToInput, formatMoney, parseAmountToCents } from '../lib/finance';
import { confirmAction } from '../lib/confirm';
import { canEditHabitDay } from '../lib/rules';
import { notify } from '../lib/toast';
import '../styles/planning.css';

/** Metas: objetivos que ligam dinheiro, agenda e rotina; metas de sequência; metas financeiras. */
export default function Metas() {
  const user = useAuthStore((s) => s.user);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const tier = useTier(user?.id);
  const financeAccess = tier !== 'loading' && LIMITS[tier].finance;
  const objectives = useProgressStore((s) => s.objectives);
  const ready = useProgressStore((s) => s.ready);
  const loaded = useProgressStore((s) => s.loaded);
  const [wizard, setWizard] = useState<Objective | 'new' | null>(null);
  const navigate = useNavigate();

  const active = objectives.filter((o) => !o.completedAt).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const done = objectives.filter((o) => o.completedAt);

  return (
    <div className="screen">
      <Header title="Metas" subtitle="Objetivos, sequências e dinheiro guardado" />
      <div className="screen-stack">
        <div className="section-head" style={{ marginTop: 0 }}>
          <div>
            <div className="section-title">Objetivos</div>
            <div className="section-hint">Uma meta que junta dinheiro, agenda e rotina</div>
          </div>
          {ready ? (
            <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} onClick={() => requireAuth(() => setWizard('new'), 'Entre na sua conta para criar objetivos.')} aria-label="Novo objetivo" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 0 }}>
              <Plus size={20} />
            </motion.button>
          ) : null}
        </div>

        {user && loaded && !ready ? <SetupNote>Os objetivos estão sendo ativados na sua conta. Tente de novo mais tarde.</SetupNote> : null}

        {active.length ? active.map((objective) => (
          <ObjectiveCard key={objective.id} objective={objective} onEdit={() => setWizard(objective)} />
        )) : ready || !user ? (
          <div className="empty-card">
            <Sparkles size={24} color="var(--accent)" />
            <strong>Transforme um sonho em plano</strong>
            <span>Ex.: “Viagem em julho”: juntar R$ 3.000, a viagem marcada na agenda e o hábito “não pedir delivery” para sobrar dinheiro. O Nexo mostra se você está no ritmo e o próximo passo.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => setWizard('new'), 'Entre na sua conta para criar objetivos.')}><Plus size={15} /> Criar objetivo</button>
          </div>
        ) : null}

        {done.length ? (
          <details className="card" style={{ padding: 14 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Concluídos ({done.length})</summary>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              {done.map((objective) => <ObjectiveCard key={objective.id} objective={objective} onEdit={() => setWizard(objective)} />)}
            </div>
          </details>
        ) : null}

        <StreakGoals />

        {financeAccess ? (
          <GoalsSection />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="section-head">
              <div>
                <div className="section-title">Metas financeiras</div>
                <div className="section-hint">Juntar dinheiro com prazo</div>
              </div>
            </div>
            <button type="button" className="tile" onClick={() => navigate('/app/financas')}>
              <span className="row gap-sm"><span className="tile-icon"><Lock size={16} /></span><strong>Disponível nos planos pagos</strong></span>
              <span className="tile-label">Crie metas como “Reserva de emergência” e acompanhe quanto falta e quanto guardar por semana.</span>
            </button>
          </div>
        )}
      </div>

      <ObjectiveWizard open={wizard !== null} onClose={() => setWizard(null)} editing={wizard === 'new' ? null : wizard} />
    </div>
  );
}

function ObjectiveCard({ objective, onEdit }: { objective: Objective; onEdit: () => void }) {
  const goals = useFinanceStore((s) => s.goals);
  const events = useDataStore((s) => s.events);
  const habits = useDataStore((s) => s.habits);
  const toggleHabitForDate = useDataStore((s) => s.toggleHabitForDate);
  const setObjectiveDone = useProgressStore((s) => s.setObjectiveDone);
  const removeObjective = useProgressStore((s) => s.removeObjective);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [saving, setSaving] = useState<Goal | null>(null);
  const today = toISODate();
  const p = useMemo(() => objectiveProgress(objective, { goals, events, habits }, today), [objective, goals, events, habits, today]);
  const goal = objective.goalId ? goals.find((g) => g.id === objective.goalId) : undefined;
  const statusClass = p.status === 'done' || p.status === 'on_track' ? 'ok' : p.status === 'behind' ? 'warn' : 'danger';

  const remove = async () => {
    const ok = await confirmAction({
      title: 'Apagar objetivo?',
      message: 'A meta financeira, o compromisso e os hábitos ligados continuam existindo; só o objetivo sai.',
      confirmText: 'Apagar',
      danger: true,
    });
    if (ok) requireAuth(() => removeObjective(objective.id));
  };

  const last7 = (doneDates: string[]) => Array.from({ length: 7 }, (_, i) => doneDates.includes(addDaysToKey(today, i - 6)));

  return (
    <motion.div className={`objective${p.status === 'done' ? ' done' : ''}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="objective-head">
        <ProgressRing value={p.status === 'done' ? 1 : p.overall} size={64} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="objective-title">{objective.title}</div>
          <div className="objective-sub">
            {p.status === 'done' ? 'Concluído' : p.daysLeft >= 0 ? `${p.daysLeft} ${p.daysLeft === 1 ? 'dia' : 'dias'} até ${formatShortDate(objective.targetDate, today)}` : `Prazo era ${formatShortDate(objective.targetDate, today)}`}
          </div>
          <span className={`pill ${statusClass}`} style={{ marginTop: 6 }}>{OBJECTIVE_STATUS_LABEL[p.status]}</span>
        </div>
        <button type="button" className="icon-btn ghost sm" onClick={onEdit} aria-label="Editar objetivo"><Pencil size={15} /></button>
      </div>

      <div className="objective-parts">
        {p.money ? (
          <div className="obj-part">
            <span className="obj-part-icon money"><PiggyBank size={15} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="t">{formatMoney(p.money.savedCents, p.money.currency)} de {formatMoney(p.money.targetCents, p.money.currency)}</div>
              <div className="d">
                {p.money.remainingCents === 0 ? 'Valor completo!' : `${p.money.onTrack ? 'No ritmo' : 'Abaixo do ritmo'} · ${formatMoney(p.money.perWeekCents, p.money.currency)} por semana`}
              </div>
              <div className="track" style={{ height: 6, marginTop: 6 }}><div className="fill" style={{ width: `${Math.round(p.money.ratio * 100)}%` }} /></div>
            </div>
            {goal && p.money.remainingCents > 0 && p.status !== 'done' ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => setSaving(goal))}>Guardar</button>
            ) : null}
          </div>
        ) : null}
        {p.event ? (
          <div className="obj-part">
            <span className="obj-part-icon event"><CalendarDays size={15} /></span>
            <div className="grow">
              <div className="t">{p.event.title}</div>
              <div className="d">{formatShortDate(toISODate(new Date(p.event.start)), today)} na agenda</div>
            </div>
          </div>
        ) : null}
        {p.habits.map((h) => {
          const habit = habits.find((x) => x.id === h.id);
          return (
            <div key={h.id} className="obj-part">
              <span className="obj-part-icon habit"><Leaf size={15} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{h.name}</div>
                <div className="d" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <WeekDots days={last7(habit?.doneDates ?? [])} /> {h.doneLast7}/7 · {h.streak} {h.streak === 1 ? 'dia seguido' : 'dias seguidos'}
                </div>
              </div>
              {p.status !== 'done' && canEditHabitDay(today) ? (
                <button type="button" className={`icon-btn sm${h.doneToday ? '' : ' plain'}`} aria-pressed={h.doneToday}
                  onClick={() => requireAuth(() => toggleHabitForDate(h.id, today))} aria-label={h.doneToday ? `Desmarcar ${h.name} hoje` : `Marcar ${h.name} hoje`}>
                  <Check size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
        {!p.money && !p.event && !p.habits.length ? <p className="muted" style={{ fontSize: 12.5 }}>Nada ligado ainda. Edite para juntar dinheiro, agenda ou hábitos.</p> : null}
      </div>

      {p.nextSteps.length ? (
        <div className="obj-next">
          <span className="eyebrow">Próximo passo</span>
          {p.nextSteps.map((step) => <span key={step}>{step}</span>)}
        </div>
      ) : null}

      <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void remove(); }}><Trash2 size={14} /> Apagar</button>
        {p.status === 'done'
          ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => requireAuth(() => setObjectiveDone(objective.id, false))}><RotateCcw size={14} /> Reabrir</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => { setObjectiveDone(objective.id, true); notify(`Objetivo “${objective.title}” concluído. Parabéns!`, 'success'); })}><CircleCheck size={14} /> Concluir</button>}
      </div>

      <Modal open={saving !== null} onClose={() => setSaving(null)} title={saving ? `Guardar em “${saving.name}”` : undefined}>
        {saving ? <SaveToGoal goal={saving} onDone={() => setSaving(null)} /> : null}
      </Modal>
    </motion.div>
  );
}

function SaveToGoal({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const addGoalSaving = useFinanceStore((s) => s.addGoalSaving);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const remaining = Math.max(0, goal.targetCents - goal.savedCents);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const save = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) { setError('Informe um valor válido, como 150,00.'); return; }
    requireAuth(() => {
      addGoalSaving(goal.id, cents);
      notify(`${formatMoney(cents, goal.currency)} guardados em ${goal.name}.`, 'success');
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
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block"><Target size={16} /> Guardar valor</motion.button>
    </form>
  );
}
