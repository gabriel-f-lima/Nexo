import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Flame, Pencil, Plus, Trophy } from 'lucide-react';
import { Modal } from '../ui';
import { ProgressRing } from '../planning/ui';
import SelectField from '../SelectField';
import { useAuthStore } from '../../store/auth';
import { useDataStore } from '../../store/data';
import { useProgressStore, type StreakGoal } from '../../store/progress';
import { STREAK_TARGETS, currentStreak, longestStreak, streakGoalProgress } from '../../lib/streaks';
import { formatShortDate, toISODate } from '../../lib/dates';
import { confirmAction } from '../../lib/confirm';
import { notify } from '../../lib/toast';

/** Metas de sequência: "beber água 30 dias seguidos". Mostra o progresso e avisa quando a sequência está em risco. */
export default function StreakGoals() {
  const habits = useDataStore((s) => s.habits);
  const goals = useProgressStore((s) => s.streakGoals);
  const ready = useProgressStore((s) => s.ready);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [editing, setEditing] = useState<StreakGoal | 'new' | null>(null);
  const today = toISODate();
  const visible = goals.filter((g) => habits.some((h) => h.id === g.habitId));
  const free = habits.filter((h) => !goals.some((g) => g.habitId === h.id));

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-head">
        <div>
          <div className="section-title">Metas de sequência</div>
          <div className="section-hint">Dias seguidos de um hábito, como um desafio</div>
        </div>
        {free.length && ready ? (
          <motion.button type="button" className="icon-btn" whileTap={{ scale: 0.9 }} onClick={() => requireAuth(() => setEditing('new'))} aria-label="Nova meta de sequência" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 0 }}>
            <Plus size={20} />
          </motion.button>
        ) : null}
      </div>

      {visible.length ? visible.map((goal) => {
        const habit = habits.find((h) => h.id === goal.habitId);
        const p = streakGoalProgress(goal, habit, today);
        return (
          <motion.div key={goal.habitId} className={`streak-goal${p.achieved ? ' achieved' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <ProgressRing value={p.ratio} size={56} stroke={6} label={p.achieved ? '✓' : `${p.current}`} />
            <div className="grow" style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{habit?.name}</strong>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {p.achieved
                  ? `Cumprida${goal.achievedOn ? ` em ${formatShortDate(goal.achievedOn, today)}` : ''}: ${goal.targetDays} dias seguidos`
                  : `${p.current} de ${goal.targetDays} dias seguidos · faltam ${p.remaining}`}
              </span>
              {p.atRisk ? <span style={{ display: 'block', fontSize: 12.5, color: 'var(--warn)', marginTop: 2 }}><Flame size={12} style={{ verticalAlign: -1 }} /> Marque hoje para não perder a sequência.</span> : null}
              {!p.achieved && p.current === 0 && habit && longestStreak(habit.doneDates) > 0
                ? <span className="muted" style={{ display: 'block', fontSize: 12 }}>Seu recorde neste hábito: {longestStreak(habit.doneDates)} dias.</span> : null}
            </div>
            {p.achieved ? <Trophy size={20} color="var(--accent)" /> : null}
            <button type="button" className="icon-btn ghost sm" onClick={() => setEditing(goal)} aria-label={`Editar meta de ${habit?.name}`}><Pencil size={15} /></button>
          </motion.div>
        );
      }) : (
        <div className="empty-card">
          <Flame size={22} color="var(--warn)" />
          <strong>Nenhuma meta de sequência</strong>
          <span>{habits.length ? 'Escolha um hábito e um número de dias seguidos. O Nexo acompanha e avisa quando a sequência estiver em risco.' : 'Crie um hábito em Rotina para definir uma meta de sequência.'}</span>
          {free.length && ready ? <button type="button" className="btn btn-primary btn-sm" onClick={() => requireAuth(() => setEditing('new'))}><Plus size={15} /> Criar meta de sequência</button> : null}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nova meta de sequência' : 'Meta de sequência'}>
        {editing !== null ? <StreakGoalForm goal={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Modal>
    </div>
  );
}

export function StreakGoalForm({ goal, habitId: presetHabit, onDone }: { goal: StreakGoal | null; habitId?: string; onDone: () => void }) {
  const habits = useDataStore((s) => s.habits);
  const goals = useProgressStore((s) => s.streakGoals);
  const setStreakGoal = useProgressStore((s) => s.setStreakGoal);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const options = habits.filter((h) => h.id === goal?.habitId || h.id === presetHabit || !goals.some((g) => g.habitId === h.id));
  const existing = goal ?? goals.find((g) => g.habitId === presetHabit) ?? null;
  const [habitId, setHabitId] = useState(existing?.habitId ?? presetHabit ?? options[0]?.id ?? '');
  const [target, setTarget] = useState(String(existing?.targetDays ?? 30));
  const [error, setError] = useState('');
  const selected = habits.find((h) => h.id === habitId);
  const streakNow = selected ? currentStreak(selected.doneDates, toISODate()) : 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    const days = Number(target);
    if (!habitId) { setError('Escolha o hábito.'); return; }
    if (!Number.isInteger(days) || days < 2 || days > 365) { setError('Escolha entre 2 e 365 dias.'); return; }
    requireAuth(() => {
      setStreakGoal(habitId, days);
      notify(`Meta de ${days} dias seguidos definida. Bora!`, 'success');
      onDone();
    });
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirmAction({ title: 'Remover meta de sequência?', message: 'O hábito e o histórico continuam; só o desafio sai.', confirmText: 'Remover', danger: true });
    if (ok) requireAuth(() => { setStreakGoal(existing.habitId, null); onDone(); });
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      {!existing && !presetHabit ? (
        <SelectField label="Hábito" value={habitId} onChange={setHabitId} options={options.map((h) => ({ value: h.id, label: h.name }))} />
      ) : (
        <p className="text-2" style={{ fontSize: 14 }}>{habits.find((h) => h.id === habitId)?.name}</p>
      )}
      <span className="text-2" style={{ fontSize: 13 }}>Quantos dias seguidos?</span>
      <div className="chips-wrap" role="radiogroup" aria-label="Dias seguidos">
        {STREAK_TARGETS.map((n) => (
          <button key={n} type="button" className="chip" role="radio" aria-checked={Number(target) === n} aria-pressed={Number(target) === n} onClick={() => setTarget(String(n))}>{n} dias</button>
        ))}
      </div>
      <input className="input" type="number" min={2} max={365} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Outro número de dias" />
      <p className="muted" style={{ fontSize: 12 }}>
        A sequência atual conta: hoje você está em {streakNow} {streakNow === 1 ? 'dia' : 'dias'}
        {Number(target) > streakNow ? `, faltam ${Number(target) - streakNow}.` : '. Escolha um número maior para um novo desafio.'}
      </p>
      {error ? <p className="error">{error}</p> : null}
      <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn btn-primary btn-block">{existing ? 'Salvar meta' : 'Começar desafio'}</motion.button>
      {existing ? <button type="button" className="btn btn-danger btn-block" onClick={() => { void remove(); }}>Remover meta</button> : null}
    </form>
  );
}
