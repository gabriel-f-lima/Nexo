import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Leaf, Lock, PiggyBank, Plus, Target, X } from 'lucide-react';
import { Modal } from '../ui';
import DatePickerField from '../DatePickerField';
import SelectField from '../SelectField';
import NoticeBox from '../NoticeBox';
import Paywall from '../Paywall';
import { useAuthStore } from '../../store/auth';
import { useDataStore } from '../../store/data';
import { useFinanceStore } from '../../store/finance';
import { MAX_OBJECTIVE_HABITS, useProgressStore, type Objective } from '../../store/progress';
import { useTier } from '../../lib/useTier';
import { currentTier, LIMITS } from '../../lib/billing';
import { CURRENCIES, formatMoney, parseAmountToCents, type Currency } from '../../lib/finance';
import { addDaysToKey, daysBetween, formatShortDate, toISODate } from '../../lib/dates';
import { eventLimitMessage, habitLimitMessage } from '../../lib/limits';
import { notify } from '../../lib/toast';

type MoneyMode = 'new' | 'existing' | 'none';
type EventMode = 'new' | 'existing' | 'none';

const TITLE_IDEAS = ['Viagem em julho', 'Reserva de emergência', 'Trocar de carro', 'Correr 10 km'];
const HABIT_IDEAS = ['Não pedir delivery', 'Cozinhar em casa', 'Guardar o troco', 'Treinar 30 min', 'Ler 10 páginas'];
const STEPS = ['Objetivo', 'Dinheiro', 'Agenda', 'Rotina', 'Resumo'];

/**
 * Cria (ou edita) um objetivo que liga as três áreas: uma meta financeira com prazo, um compromisso na agenda
 * e hábitos que ajudam a chegar lá. Cada parte é opcional; o que for novo é criado junto, na ordem certa.
 */
export default function ObjectiveWizard({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Objective | null }) {
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar objetivo' : 'Novo objetivo'}>
      {open ? <WizardBody editing={editing} onDone={onClose} /> : null}
    </Modal>
  );
}

function WizardBody({ editing, onDone }: { editing: Objective | null; onDone: () => void }) {
  const user = useAuthStore((s) => s.user);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const tier = useTier(user?.id);
  const financeAccess = tier !== 'loading' && LIMITS[tier].finance;
  const goals = useFinanceStore((s) => s.goals);
  const addGoal = useFinanceStore((s) => s.addGoal);
  const events = useDataStore((s) => s.events);
  const habits = useDataStore((s) => s.habits);
  const addEvent = useDataStore((s) => s.addEvent);
  const addHabit = useDataStore((s) => s.addHabit);
  const addObjective = useProgressStore((s) => s.addObjective);
  const updateObjective = useProgressStore((s) => s.updateObjective);
  const today = toISODate();

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? addDaysToKey(today, 90));
  const [moneyMode, setMoneyMode] = useState<MoneyMode>(editing ? (editing.goalId ? 'existing' : 'none') : 'new');
  const [goalId, setGoalId] = useState(editing?.goalId ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('BRL');
  const [eventMode, setEventMode] = useState<EventMode>(editing ? (editing.eventId ? 'existing' : 'none') : 'new');
  const [eventId, setEventId] = useState(editing?.eventId ?? '');
  const [eventTime, setEventTime] = useState('09:00');
  const [habitIds, setHabitIds] = useState<string[]>(editing?.habitIds.filter((id) => habits.some((h) => h.id === id)) ?? []);
  const [newHabits, setNewHabits] = useState<string[]>([]);
  const [habitDraft, setHabitDraft] = useState('');
  const [error, setError] = useState('');
  const [paywall, setPaywall] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveMoney: MoneyMode = financeAccess ? moneyMode : (moneyMode === 'existing' && goalId ? 'existing' : 'none');
  const futureEvents = useMemo(() => events
    .filter((e) => Date.parse(e.start) >= Date.now() || e.id === editing?.eventId)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [events, editing]);
  const weeks = Math.max(1, Math.ceil(Math.max(0, daysBetween(today, targetDate)) / 7));
  const amountCents = parseAmountToCents(amount);
  const selectedGoal = goals.find((g) => g.id === goalId);
  const habitCount = habitIds.length + newHabits.length;

  const validate = (index: number): string => {
    if (index === 0) {
      if (!title.trim()) return 'Dê um nome ao objetivo, como “Viagem em julho”.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate <= today) return 'Escolha uma data a partir de amanhã.';
    }
    if (index === 1) {
      if (effectiveMoney === 'new' && amountCents === null) return 'Informe quanto quer juntar, como 3.000,00.';
      if (effectiveMoney === 'existing' && !goalId) return 'Escolha a meta financeira.';
    }
    if (index === 2) {
      if (eventMode === 'existing' && !eventId) return 'Escolha o compromisso.';
      if (eventMode === 'new' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) return 'Escolha a hora do compromisso.';
    }
    return '';
  };

  const next = () => {
    const message = validate(step);
    setError(message);
    if (!message) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const toggleHabit = (id: string) => {
    setHabitIds((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id);
      if (list.length + newHabits.length >= MAX_OBJECTIVE_HABITS) { notify(`Até ${MAX_OBJECTIVE_HABITS} hábitos por objetivo.`, 'info'); return list; }
      return [...list, id];
    });
  };

  const addHabitDraft = (name: string) => {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    if (habitCount >= MAX_OBJECTIVE_HABITS) { notify(`Até ${MAX_OBJECTIVE_HABITS} hábitos por objetivo.`, 'info'); return; }
    const existing = habits.find((h) => h.name.trim().toLowerCase() === clean.toLowerCase());
    if (existing) { if (!habitIds.includes(existing.id)) setHabitIds((l) => [...l, existing.id]); setHabitDraft(''); return; }
    if (!newHabits.some((h) => h.toLowerCase() === clean.toLowerCase())) setNewHabits((l) => [...l, clean]);
    setHabitDraft('');
  };

  const create = () => requireAuth(() => {
    if (!user || saving) return;
    for (let i = 0; i < STEPS.length - 1; i += 1) {
      const message = validate(i);
      if (message) { setStep(i); setError(message); return; }
    }
    setSaving(true);
    currentTier(user.id)
      .then((serverTier) => {
        // Limites do plano antes de criar qualquer coisa: nada fica pela metade.
        const habitMessage = newHabits.length ? habitLimitMessage(serverTier, habits.length + newHabits.length - 1) : null;
        if (habitMessage) { setPaywall(habitMessage); return; }
        const eventMessage = eventMode === 'new' ? eventLimitMessage(serverTier, events, targetDate) : null;
        if (eventMessage) { setPaywall(eventMessage); return; }
        if (effectiveMoney === 'new' && !LIMITS[serverTier].finance) { setPaywall('Metas financeiras fazem parte dos planos pagos.'); return; }
        const goalLimit = LIMITS[serverTier].goals;
        if (effectiveMoney === 'new' && goalLimit !== null && goals.length >= goalLimit) {
          setPaywall(`Você já tem ${goalLimit} metas financeiras, o limite do seu plano.`);
          return;
        }

        let linkedGoal: string | null = effectiveMoney === 'existing' ? goalId : null;
        if (effectiveMoney === 'new' && amountCents !== null) linkedGoal = addGoal(title, currency, amountCents, targetDate);
        let linkedEvent: string | null = eventMode === 'existing' ? eventId : null;
        if (eventMode === 'new') linkedEvent = addEvent(title, new Date(`${targetDate}T${eventTime}:00`).toISOString());
        const createdHabits = newHabits.map((name) => addHabit(name)).filter((id): id is string => !!id);

        const input = { title, targetDate, goalId: linkedGoal, eventId: linkedEvent, habitIds: [...habitIds, ...createdHabits] };
        if (editing) {
          updateObjective(editing.id, input);
          notify('Objetivo atualizado.', 'success');
        } else if (addObjective(input)) {
          notify(`Objetivo “${title.trim()}” criado. Acompanhe em Metas e no Meu dia.`, 'success');
        } else {
          notify('Não foi possível criar o objetivo agora. Tente de novo.', 'error');
          return;
        }
        onDone();
      })
      .catch(() => notify('Não foi possível verificar seu plano agora. Tente novamente.', 'error'))
      .finally(() => setSaving(false));
  }, 'Entre na sua conta para criar objetivos.');

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="steps-dots" aria-label={`Etapa ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}>
        {STEPS.map((name, i) => <i key={name} className={i <= step ? 'on' : ''} />)}
      </div>
      <span className="eyebrow">{step + 1}. {STEPS[step]}</span>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} style={{ display: 'grid', gap: 12 }}>
          {step === 0 ? (
            <>
              <p className="text-2" style={{ fontSize: 13.5 }}>Algo que você quer conquistar até uma data. O Nexo junta dinheiro, agenda e rotina para chegar lá.</p>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Viagem em julho" maxLength={60} autoFocus aria-label="Nome do objetivo" />
              {!editing ? (
                <div className="chips-wrap">
                  {TITLE_IDEAS.map((idea) => <button key={idea} type="button" className="chip" onClick={() => setTitle(idea)}>{idea}</button>)}
                </div>
              ) : null}
              <DatePickerField label="Até quando?" value={targetDate} onChange={setTargetDate} min={addDaysToKey(today, 1)} />
              {targetDate > today ? <p className="info">Faltam {daysBetween(today, targetDate)} dias ({weeks} {weeks === 1 ? 'semana' : 'semanas'}).</p> : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="text-2" style={{ fontSize: 13.5 }}>Precisa juntar dinheiro para isso?</p>
              {!financeAccess ? (
                <NoticeBox><Lock size={13} style={{ verticalAlign: -2 }} /> Metas financeiras fazem parte dos planos pagos. Você pode seguir sem a parte do dinheiro.</NoticeBox>
              ) : null}
              <div className="option-list" role="radiogroup" aria-label="Dinheiro">
                <button type="button" className="option" aria-checked={effectiveMoney === 'new'} role="radio" disabled={!financeAccess} onClick={() => setMoneyMode('new')}><PiggyBank size={17} /> Juntar um valor até a data</button>
                <button type="button" className="option" aria-checked={effectiveMoney === 'existing'} role="radio" disabled={!goals.length} onClick={() => setMoneyMode('existing')}><Target size={17} /> Usar uma meta financeira que já existe</button>
                <button type="button" className="option" aria-checked={effectiveMoney === 'none'} role="radio" onClick={() => setMoneyMode('none')}><X size={17} /> Sem dinheiro envolvido</button>
              </div>
              {effectiveMoney === 'new' ? (
                <>
                  <div className="row gap-sm">
                    <input className="input grow" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Quanto quer juntar?" inputMode="decimal" aria-label="Valor da meta" />
                    <SelectField label="Moeda" width={118} value={currency} onChange={(n) => setCurrency(n as Currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
                  </div>
                  {amountCents !== null ? <p className="info">Guardando {formatMoney(Math.ceil(amountCents / weeks / 100) * 100, currency)} por semana, você chega lá em {formatShortDate(targetDate, today)}.</p> : null}
                </>
              ) : null}
              {effectiveMoney === 'existing' ? (
                <SelectField label="Meta financeira" value={goalId} onChange={setGoalId}
                  options={[{ value: '', label: 'Escolha a meta' }, ...goals.map((g) => ({ value: g.id, label: `${g.name} · ${formatMoney(g.targetCents, g.currency)}` }))]} />
              ) : null}
              {selectedGoal && effectiveMoney === 'existing' && selectedGoal.deadline && selectedGoal.deadline !== targetDate
                ? <p className="muted" style={{ fontSize: 12 }}>Essa meta tem prazo em {formatShortDate(selectedGoal.deadline, today)}; o objetivo usa {formatShortDate(targetDate, today)}.</p> : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-2" style={{ fontSize: 13.5 }}>Quer um compromisso na agenda para a data (a viagem, a prova, a compra)?</p>
              <div className="option-list" role="radiogroup" aria-label="Agenda">
                <button type="button" className="option" role="radio" aria-checked={eventMode === 'new'} onClick={() => setEventMode('new')}><CalendarDays size={17} /> Marcar “{title.trim() || 'objetivo'}” em {formatShortDate(targetDate, today)}</button>
                <button type="button" className="option" role="radio" aria-checked={eventMode === 'existing'} disabled={!futureEvents.length} onClick={() => setEventMode('existing')}><CalendarDays size={17} /> Usar um compromisso que já existe</button>
                <button type="button" className="option" role="radio" aria-checked={eventMode === 'none'} onClick={() => setEventMode('none')}><X size={17} /> Sem compromisso</button>
              </div>
              {eventMode === 'new' ? (
                <label className="row gap-sm" style={{ fontSize: 13 }}>
                  <span className="text-2">Hora</span>
                  <input className="input" type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} style={{ maxWidth: 140, height: 40 }} aria-label="Hora do compromisso" />
                </label>
              ) : null}
              {eventMode === 'existing' ? (
                <SelectField label="Compromisso" value={eventId} onChange={setEventId}
                  options={[{ value: '', label: 'Escolha o compromisso' }, ...futureEvents.map((e) => ({ value: e.id, label: `${e.title} · ${formatShortDate(toISODate(new Date(e.start)), today)}` }))]} />
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-2" style={{ fontSize: 13.5 }}>Que hábitos ajudam a chegar lá? Escolha até {MAX_OBJECTIVE_HABITS}.</p>
              {habits.length ? (
                <div className="option-list" role="group" aria-label="Hábitos existentes">
                  {habits.map((h) => (
                    <button key={h.id} type="button" className="option" aria-pressed={habitIds.includes(h.id)} onClick={() => toggleHabit(h.id)}>
                      {habitIds.includes(h.id) ? <Check size={17} color="var(--accent)" /> : <Leaf size={17} />} {h.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <form className="row gap-sm" onSubmit={(e) => { e.preventDefault(); addHabitDraft(habitDraft); }}>
                <input className="input grow" value={habitDraft} onChange={(e) => setHabitDraft(e.target.value)} placeholder="Novo hábito (ex.: Não pedir delivery)" maxLength={60} aria-label="Novo hábito" />
                <button type="submit" className="icon-btn" aria-label="Adicionar hábito" disabled={!habitDraft.trim()}><Plus size={18} /></button>
              </form>
              <div className="chips-wrap">
                {HABIT_IDEAS.filter((idea) => !newHabits.includes(idea) && !habits.some((h) => h.name === idea)).map((idea) => (
                  <button key={idea} type="button" className="chip" onClick={() => addHabitDraft(idea)}>+ {idea}</button>
                ))}
              </div>
              {newHabits.length ? (
                <div className="chips-wrap">
                  {newHabits.map((name) => (
                    <button key={name} type="button" className="chip" aria-pressed="true" onClick={() => setNewHabits((l) => l.filter((x) => x !== name))}>{name} <X size={12} style={{ verticalAlign: -2 }} /></button>
                  ))}
                </div>
              ) : null}
              <p className="muted" style={{ fontSize: 12 }}>{habitCount} de {MAX_OBJECTIVE_HABITS} hábitos. Os novos entram na sua Rotina.</p>
            </>
          ) : null}

          {step === 4 ? (
            <div className="objective-parts">
              <div className="obj-part"><span className="obj-part-icon money"><Target size={15} /></span><div className="grow"><div className="t">{title.trim()}</div><div className="d">Até {formatShortDate(targetDate, today)} · {daysBetween(today, targetDate)} dias</div></div></div>
              <div className="obj-part"><span className="obj-part-icon money"><PiggyBank size={15} /></span><div className="grow">
                <div className="t">{effectiveMoney === 'new' && amountCents !== null ? `Juntar ${formatMoney(amountCents, currency)}` : effectiveMoney === 'existing' && selectedGoal ? `Meta ${selectedGoal.name}` : 'Sem dinheiro envolvido'}</div>
                {effectiveMoney === 'new' && amountCents !== null ? <div className="d">{formatMoney(Math.ceil(amountCents / weeks / 100) * 100, currency)} por semana</div> : null}
              </div></div>
              <div className="obj-part"><span className="obj-part-icon event"><CalendarDays size={15} /></span><div className="grow">
                <div className="t">{eventMode === 'new' ? `Compromisso em ${formatShortDate(targetDate, today)} às ${eventTime}` : eventMode === 'existing' ? events.find((e) => e.id === eventId)?.title ?? 'Compromisso' : 'Sem compromisso'}</div>
              </div></div>
              <div className="obj-part"><span className="obj-part-icon habit"><Leaf size={15} /></span><div className="grow">
                <div className="t">{habitCount ? `${habitCount} ${habitCount === 1 ? 'hábito' : 'hábitos'} de apoio` : 'Sem hábitos de apoio'}</div>
                {habitCount ? <div className="d">{[...habitIds.map((id) => habits.find((h) => h.id === id)?.name ?? ''), ...newHabits].filter(Boolean).join(', ')}</div> : null}
              </div></div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {error ? <p className="error">{error}</p> : null}

      <div className="row gap-sm">
        {step > 0 ? <button type="button" className="btn btn-ghost" onClick={() => { setError(''); setStep((s) => s - 1); }}><ArrowLeft size={16} /> Voltar</button> : null}
        {step < STEPS.length - 1
          ? <motion.button type="button" className="btn btn-primary grow" whileTap={{ scale: 0.98 }} onClick={next}>Continuar <ArrowRight size={16} /></motion.button>
          : <motion.button type="button" className="btn btn-primary grow" whileTap={{ scale: 0.98 }} onClick={create} disabled={saving}>{editing ? 'Salvar objetivo' : 'Criar objetivo'}</motion.button>}
      </div>
      <Paywall open={paywall !== null} onClose={() => setPaywall(null)} title="Limite do plano" message={paywall ?? ''} />
    </div>
  );
}
