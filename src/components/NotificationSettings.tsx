import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BellOff, BellRing, CalendarClock, Info, ShieldAlert, Sun } from 'lucide-react';
import { notify } from '../lib/toast';
import { useAuthStore } from '../store/auth';
import {
  EVENT_ALERT_OPTIONS, describeNotificationError, disableReminder, enableReminder,
  setEventAlertMinutes, useNotificationSettings,
} from '../lib/reminder';

const PRESETS = [
  { label: 'Manhã', value: '08:00' },
  { label: 'Meio do dia', value: '13:00' },
  { label: 'Noite', value: '20:00' },
];

const formatHM = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const parseHM = (value: string): [number, number] | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/** Interruptor acessível (role="switch"). */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <motion.span className="switch-knob" layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} />
    </button>
  );
}

/** Configuração das notificações do navegador: permissão, lembrete diário e avisos de compromissos. */
export default function NotificationSettings() {
  const { permission, reminder, eventAlertMinutes } = useNotificationSettings();
  const hasUser = useAuthStore((s) => !!s.user);
  const [time, setTime] = useState(reminder ? formatHM(reminder.hour, reminder.minute) : '08:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Mantém o horário exibido igual ao salvo (por exemplo, se foi mudado em outra aba).
  const savedTime = reminder ? formatHM(reminder.hour, reminder.minute) : null;
  useEffect(() => {
    if (savedTime) setTime(savedTime);
  }, [savedTime]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(describeNotificationError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveReminder = (value: string) => run(async () => {
    const parsed = parseHM(value);
    if (!parsed) throw new Error('INVALID_TIME');
    await enableReminder(parsed[0], parsed[1]);
    notify(`Lembrete diário às ${value}.`, 'success', 'reminder');
  });

  const toggleReminder = (next: boolean) => {
    if (next) {
      void saveReminder(time);
      return;
    }
    disableReminder();
    setError('');
    notify('Lembrete diário desativado.', 'info', 'reminder');
  };

  /** Com o lembrete ligado, um novo horário é salvo na hora. */
  const chooseTime = (value: string) => {
    if (!parseHM(value)) return;
    setTime(value);
    if (savedTime && value !== savedTime) void saveReminder(value);
  };

  const chooseEventAlert = (minutes: number) => {
    if (minutes === eventAlertMinutes) return;
    void run(async () => {
      await setEventAlertMinutes(minutes);
      notify(minutes ? `Avisos ${EVENT_ALERT_OPTIONS.find((o) => o.value === minutes)?.label} antes dos compromissos.` : 'Avisos de compromissos desativados.', minutes ? 'success' : 'info', 'event-alert');
    });
  };

  const unsupported = permission === 'unsupported';

  return (
    <div className="notif">
      <div className={`notif-status ${permission}`} role="status">
        {permission === 'granted' ? <BellRing size={18} /> : permission === 'default' ? <Info size={18} /> : unsupported ? <BellOff size={18} /> : <ShieldAlert size={18} />}
        <p>
          {permission === 'granted' && 'Notificações permitidas neste navegador.'}
          {permission === 'default' && 'O navegador vai pedir sua permissão quando você ativar um aviso.'}
          {permission === 'denied' && 'As notificações estão bloqueadas para este site. Clique no cadeado ao lado do endereço e permita as notificações.'}
          {unsupported && 'Este navegador não oferece notificações do sistema.'}
        </p>
      </div>

      <section className="notif-block">
        <div className="notif-row">
          <div className="notif-icon"><Sun size={18} /></div>
          <div className="grow">
            <div className="notif-title">Lembrete diário</div>
            <div className="notif-desc">
              {reminder ? `Todos os dias às ${formatHM(reminder.hour, reminder.minute)}, com o que falta fazer hoje.` : 'Um aviso por dia para revisar compromissos, tarefas e rotina.'}
            </div>
          </div>
          <Switch checked={!!reminder} onChange={toggleReminder} label="Lembrete diário" disabled={busy || unsupported} />
        </div>

        <div className="time-options" role="radiogroup" aria-label="Horário do lembrete">
          {PRESETS.map((preset) => {
            const selected = time === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`time-option${selected ? ' selected' : ''}`}
                onClick={() => chooseTime(preset.value)}
                disabled={busy || unsupported}
              >
                <span>{preset.label}</span>
                <strong>{preset.value}</strong>
              </button>
            );
          })}
          <label className={`time-option custom${PRESETS.some((p) => p.value === time) ? '' : ' selected'}`}>
            <span>Outro horário</span>
            {/* Salva ao sair do campo, para não gravar a cada dígito digitado. */}
            <input
              type="time"
              value={time}
              onChange={(e) => { if (parseHM(e.target.value)) setTime(e.target.value); }}
              onBlur={(e) => chooseTime(e.target.value)}
              disabled={busy || unsupported}
              aria-label="Escolher outro horário"
            />
          </label>
        </div>
      </section>

      <section className="notif-block">
        <div className="notif-row">
          <div className="notif-icon"><CalendarClock size={18} /></div>
          <div className="grow">
            <div className="notif-title">Avisos de compromissos</div>
            <div className="notif-desc">Receba um aviso antes de cada compromisso da sua agenda.</div>
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Antecedência dos avisos de compromissos">
          {EVENT_ALERT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={eventAlertMinutes === option.value}
              className={eventAlertMinutes === option.value ? 'selected' : ''}
              onClick={() => chooseEventAlert(option.value)}
              disabled={busy || (unsupported && option.value > 0)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!hasUser && eventAlertMinutes > 0 ? <p className="notif-desc">Entre na sua conta para receber os avisos da sua agenda.</p> : null}
      </section>

      {error ? <div className="warn-block" role="alert"><span className="error">{error}</span></div> : null}

      <p className="footnote notif-foot">
        Na versão web, os avisos aparecem enquanto o Nexo estiver aberto em uma aba do navegador, mesmo minimizada.
        Com o navegador fechado, eles não chegam. As preferências valem só para este navegador.
      </p>
    </div>
  );
}
