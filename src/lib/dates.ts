const pad = (n: number) => n.toString().padStart(2, '0');

/** 'AAAA-MM-DD' no fuso local (evita o deslocamento do toISOString). */
export const toISODate = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** 'HH:mm' a partir de uma data ISO. */
export const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const parseDateKey = (key: string): Date => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const addDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

/** Semana começando na segunda-feira, como no aplicativo. */
export const weekStart = (date: Date): Date => addDays(date, -((date.getDay() + 6) % 7));

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Ex.: 'Quarta, 7 de outubro' */
export const formatLongDate = (date: Date = new Date()): string =>
  `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS[date.getMonth()]}`;

/** Ex.: '10/10/2026 · 19:05' */
export const formatConversationDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/* Saudações: mesmas falas e a mesma rotação do aplicativo. */

interface Weekday { name: string; possessive: 'seu' | 'sua' }
const WEEKDAY_GREETING: Weekday[] = [
  { name: 'domingo', possessive: 'seu' },
  { name: 'segunda-feira', possessive: 'sua' },
  { name: 'terça-feira', possessive: 'sua' },
  { name: 'quarta-feira', possessive: 'sua' },
  { name: 'quinta-feira', possessive: 'sua' },
  { name: 'sexta-feira', possessive: 'sua' },
  { name: 'sábado', possessive: 'seu' },
];

interface GreetingContext { period: string; weekday: Weekday }

const GREETING_OPTIONS: Array<(c: GreetingContext) => string> = [
  ({ period, weekday }) => `${period}! Como está sendo ${weekday.possessive} ${weekday.name}?`,
  ({ period }) => `${period}! O que você quer priorizar hoje?`,
  ({ period }) => `${period}! Quer organizar as próximas horas comigo?`,
  ({ period }) => `${period}! Qual tarefa faria diferença se você concluísse hoje?`,
  ({ period }) => `${period}! Tem algum compromisso que você quer preparar?`,
  ({ period }) => `${period}! Vamos transformar sua lista em um plano simples?`,
  ({ period }) => `${period}! Por onde você prefere começar?`,
  ({ period }) => `${period}! Quer revisar sua agenda?`,
  ({ period }) => `${period}! O que deixaria o restante do dia mais leve?`,
  ({ period }) => `${period}! Qual é o próximo passo da sua rotina?`,
  ({ period }) => `${period}! Quer separar um horário para algo importante?`,
  ({ period }) => `${period}! O que não pode ficar esquecido hoje?`,
  ({ period }) => `${period}! Posso ajudar com agenda, rotina ou tarefas. O que você precisa?`,
  ({ period }) => `${period}! Vamos escolher um objetivo realista para as próximas horas?`,
  ({ period }) => `${period}! Qual compromisso merece sua atenção agora?`,
  ({ period }) => `${period}! Quer dividir uma tarefa grande em passos menores?`,
  ({ period }) => `${period}! Que tal escolher um foco para este período?`,
  ({ period }) => `${period}! Como posso facilitar seu dia hoje?`,
  ({ period }) => `${period}! Tem algo que você gostaria de concluir antes de encerrar o dia?`,
  ({ period }) => `${period}! Vamos colocar suas ideias em ordem?`,
  ({ period }) => `${period}! Qual hábito você quer manter no foco hoje?`,
  ({ period }) => `${period}! Se quiser, podemos planejar o restante do dia juntos.`,
  ({ period }) => `${period}! Qual seria uma boa primeira tarefa agora?`,
  ({ period }) => `${period}! Quer conferir o que vem a seguir na sua agenda?`,
];

const periodOf = (hour: number): string => {
  if (hour < 6) return 'Boa madrugada';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
};

/** Muda a fala a cada janela de seis horas, sem depender de o app ter ficado aberto. */
export const getGreeting = (date: Date = new Date()): string => {
  const weekday = WEEKDAY_GREETING[date.getDay()];
  const period = periodOf(date.getHours());
  const dayOrdinal = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  const window = Math.floor(date.getHours() / 6);
  const rotation = dayOrdinal * 4 + window;
  const index = ((rotation % GREETING_OPTIONS.length) + GREETING_OPTIONS.length) % GREETING_OPTIONS.length;
  return GREETING_OPTIONS[index]({ period, weekday });
};
