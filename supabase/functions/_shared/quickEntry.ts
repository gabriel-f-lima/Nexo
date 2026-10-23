// Leitura de frases curtas em português, como "gastei 45 no mercado ontem" ou "dentista terça às 15h".
// Sem dependências e sem fuso: recebe a data de hoje ('AAAA-MM-DD') e devolve datas no mesmo formato.
// Usado pelo site (registro rápido) e pela função do WhatsApp.

export type QuickCurrency = 'BRL' | 'USD' | 'EUR';

export interface QuickTransaction {
  kind: 'transaction';
  type: 'expense' | 'income';
  amountCents: number;
  currency: QuickCurrency;
  date: string;
  /** Texto que sobrou da frase, como "Mercado". Pode ser vazio. */
  description: string;
  /** Nomes de categoria prováveis, do mais para o menos provável (ex.: ["Alimentação"]). */
  categoryHints: string[];
  /** Pago no cartão de crédito. */
  card: boolean;
  /** Nome do cartão citado, se algum dos nomes conhecidos apareceu. */
  cardName: string | null;
  installments: number;
}

export interface QuickEvent {
  kind: 'event';
  title: string;
  date: string;
  /** 'HH:MM', ou null quando a frase não diz a hora. */
  time: string | null;
}

export type QuickEntry = QuickTransaction | QuickEvent | { kind: 'unknown' };

export interface QuickEntryOptions {
  today: string;
  /** Nomes dos cartões do usuário, para reconhecer "no nubank". */
  cardNames?: string[];
}

const MAX_CENTS = 100_000_000_000;

/* ---------- Texto ---------- */

/** Um caractere sem acento e minúsculo, com o mesmo tamanho (em unidades UTF-16) do original. */
const fold = (ch: string): string => {
  const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return base.length === ch.length ? base : ' '.repeat(ch.length);
};

/** Versão sem acentos e minúscula com o mesmo tamanho do original (as posições batem). */
const foldKeepingPositions = (text: string): string => Array.from(text).map(fold).join('');

/* ---------- Datas (só com chaves AAAA-MM-DD, em UTC) ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const keyToMs = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const addDays = (key: string, days: number) => toKey(keyToMs(key) + days * 86_400_000);
const weekdayOf = (key: string) => new Date(keyToMs(key)).getUTCDay();
const validDate = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  const date = new Date(ms);
  return date.getUTCMonth() === m - 1 ? toKey(ms) : null;
};

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

type Direction = 'past' | 'future';

/** Escolhe o ano/mês de uma data sem ano conforme a direção (gasto: passado; compromisso: futuro). */
const resolveDayMonth = (today: string, day: number, month: number, year: number | null, direction: Direction): string | null => {
  const [ty] = today.split('-').map(Number);
  if (year !== null) return validDate(year < 100 ? 2000 + year : year, month, day);
  const sameYear = validDate(ty, month, day);
  if (!sameYear) return null;
  if (direction === 'past' && sameYear > today) return validDate(ty - 1, month, day);
  if (direction === 'future' && sameYear < today) return validDate(ty + 1, month, day);
  return sameYear;
};

const resolveDayOnly = (today: string, day: number, direction: Direction): string | null => {
  const [ty, tm] = today.split('-').map(Number);
  const thisMonth = validDate(ty, tm, day);
  if (direction === 'past') {
    if (thisMonth && thisMonth <= today) return thisMonth;
    return validDate(tm === 1 ? ty - 1 : ty, tm === 1 ? 12 : tm - 1, day);
  }
  if (thisMonth && thisMonth >= today) return thisMonth;
  return validDate(tm === 12 ? ty + 1 : ty, tm === 12 ? 1 : tm + 1, day);
};

const resolveWeekday = (today: string, target: number, direction: Direction): string => {
  const current = weekdayOf(today);
  if (direction === 'past') {
    const back = (current - target + 7) % 7 || 7;
    return addDays(today, -back);
  }
  const ahead = (target - current + 7) % 7 || 7;
  return addDays(today, ahead);
};

/* ---------- Leitura ---------- */

interface Found { start: number; end: number }

class Scanner {
  readonly original: string;
  readonly folded: string;
  private used: boolean[];

  constructor(text: string) {
    this.original = Array.from(text.normalize('NFC').replace(/\s+/g, ' ').trim()).join('');
    this.folded = foldKeepingPositions(this.original);
    // Posições por unidade de código, iguais nas duas versões (ver fold).
    this.used = new Array(this.folded.length).fill(false);
  }

  /** Procura o padrão em trechos ainda não usados, sem marcar. */
  find(pattern: RegExp): (RegExpExecArray & Found) | null {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.folded)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].length === 0) { re.lastIndex += 1; continue; }
      if (this.used.slice(start, end).some(Boolean)) { re.lastIndex = start + 1; continue; }
      return Object.assign(match, { start, end });
    }
    return null;
  }

  mark(found: Found): void {
    for (let i = found.start; i < found.end; i += 1) this.used[i] = true;
  }

  /** Procura o padrão em trechos ainda não usados e marca o trecho como usado. */
  take(pattern: RegExp): (RegExpExecArray & Found) | null {
    const found = this.find(pattern);
    if (found) this.mark(found);
    return found;
  }

  has(pattern: RegExp): boolean {
    const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
    return re.test(this.folded);
  }

  /** Texto original que não foi usado, com os espaços arrumados. */
  rest(): string {
    let out = '';
    for (let i = 0; i < this.original.length; i += 1) out += this.used[i] ? ' ' : this.original[i];
    return out.replace(/\s+/g, ' ').trim();
  }
}

// Fronteiras de palavra que funcionam sem acentos (o texto já está sem acentos).
const B = '(?<![a-z0-9])';
const E = '(?![a-z0-9])';

const NUMBER = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?|\\d+\\.\\d{1,2})';

const toCents = (raw: string): number | null => {
  let text = raw;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
};

const EXPENSE_WORDS = ['gastei', 'gastamos', 'gasto', 'gastou', 'paguei', 'pagamos', 'pago', 'comprei', 'compramos', 'torrei', 'saiu', 'saida', 'despesa', 'debitaram', 'perdi'];
const INCOME_WORDS = ['recebi', 'recebemos', 'recebido', 'ganhei', 'ganhamos', 'entrou', 'entrada', 'caiu', 'receita', 'vendi', 'depositaram', 'reembolsaram'];
const INCOME_HINTS = ['salario', 'freela', 'freelance', 'reembolso', 'rendimento', 'dividendos', 'bonus', 'pix recebido'];
const EVENT_WORDS = [
  'reuniao', 'consulta', 'dentista', 'medico', 'medica', 'exame', 'aniversario', 'entrevista', 'aula', 'prova', 'viagem', 'voo',
  'encontro', 'compromisso', 'call', 'palestra', 'evento', 'festa', 'casamento', 'cabeleireiro', 'barbeiro', 'manicure', 'terapia',
  'psicologo', 'psicologa', 'fisioterapia', 'treino', 'academia', 'show', 'jogo', 'cinema', 'visita', 'audiencia', 'vacina',
];
const LEADING_EVENT_VERBS = /^(?:(?:me\s+)?lembr[ae]r?\s+(?:de\s+|que\s+)?|marcar?\s+|marquei\s+|agendar?\s+|agendei\s+|tenho\s+|vou\s+ter\s+|vou\s+|teremos\s+|temos\s+)/i;

const FILLERS = new Set([
  'no', 'na', 'nos', 'nas', 'num', 'numa', 'em', 'de', 'do', 'da', 'dos', 'das', 'com', 'pro', 'pra', 'para', 'pelo', 'pela',
  'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'por', 'que', 'reais', 'real', 'hoje', 'ate', 'até', 'à', 'ao', 'às',
]);

const stripFillers = (text: string): string => {
  const words = text.replace(/[,.;:!?]+$/g, '').replace(/^[,.;:!?-]+/g, '').split(' ').filter(Boolean);
  const isFiller = (word: string) => FILLERS.has(foldKeepingPositions(word.replace(/[,.;:!?]/g, '')));
  while (words.length && isFiller(words[0])) words.shift();
  while (words.length && isFiller(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[,;:]+$/g, '').trim();
};

const capitalize = (text: string) => (text ? text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1) : text);

/* ---------- Categorias ---------- */

/** Palavras-chave → nomes de categoria prováveis, na ordem de preferência. */
/** Palavras-chave (sem acento; "s?" aceita o plural) → nomes de categoria prováveis, na ordem de preferência. */
const CATEGORY_KEYWORDS: Array<[RegExp, string[]]> = [
  [/ifood|delivery|rappi|ze delivery|uber ?eats|aiqfome/, ['Delivery', 'Alimentação']],
  [/mercado|supermercado|feira|padaria|acougue|hortifruti|sacolao|atacad[a-z]*|compras? do mes/, ['Mercado', 'Alimentação']],
  [/restaurantes?|lanches?|lanchonete|almoco|almocei|jantar|jantei|lanchei|pizzas?|hamburguer|cafe|comida|marmitas?|sorvetes?|padoca/, ['Alimentação']],
  [/uber|99|taxi|onibus|metro|trem|gasolina|combustivel|etanol|estacionamento|pedagio|passagem|bilhete unico|transporte|corrida/, ['Transporte']],
  [/aluguel|condominio|luz|energia|agua|internet|gas|iptu|moradia|conta de casa/, ['Moradia', 'Contas']],
  [/farmacia|remedios?|medicos?|dentista|consultas?|exames?|plano de saude|hospital|terapia|psicolog[a-z]*/, ['Saúde']],
  [/academia|crossfit|pilates|natacao/, ['Saúde', 'Lazer']],
  [/cursos?|faculdade|escola|livros?|mensalidade|material escolar|educacao/, ['Educação']],
  [/cinema|shows?|balada|bar|cervejas?|netflix|spotify|streaming|jogos?|viagem|hotel|passeios?|ingressos?|lazer/, ['Lazer']],
  [/roupas?|sapatos?|tenis|shopping|loja|presentes?|camisetas?|calcas?/, ['Compras', 'Lazer']],
  [/salario|holerite|pagamento do mes/, ['Salário']],
  [/freela|freelance|bico|servico extra/, ['Freelance', 'Salário']],
];

const categoryHintsFor = (foldedText: string): string[] => {
  const hints: string[] = [];
  for (const [pattern, names] of CATEGORY_KEYWORDS) {
    if (new RegExp(`${B}(?:${pattern.source})${E}`).test(foldedText)) {
      for (const name of names) if (!hints.includes(name)) hints.push(name);
    }
  }
  return hints;
};

/* ---------- Principal ---------- */

const MONTH_ALT = MONTHS.join('|');
const WEEKDAY_ALT = 'segunda|terca|quarta|quinta|sexta|sabado|domingo';

export const parseQuickEntry = (text: string, options: QuickEntryOptions): QuickEntry => {
  const { today } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || typeof text !== 'string' || !text.trim() || text.length > 300) return { kind: 'unknown' };
  const s = new Scanner(text);

  // Tipo de lançamento (verbos). Decide também a direção das datas: gasto olha para trás, compromisso para frente.
  const expenseVerb = s.take(new RegExp(`${B}(?:${EXPENSE_WORDS.join('|')})${E}`));
  const incomeVerb = expenseVerb ? null : s.take(new RegExp(`${B}(?:${INCOME_WORDS.join('|')})${E}`));
  const incomeHint = !expenseVerb && !incomeVerb && s.has(new RegExp(`${B}(?:${INCOME_HINTS.join('|')})${E}`));
  const financeIntent = !!expenseVerb || !!incomeVerb;

  // Parcelas e forma de pagamento (antes dos números, para "3x" não virar valor).
  let installments = 1;
  const parcel = s.take(new RegExp(`${B}(?:parcelad[oa]\\s+)?em\\s+(\\d{1,2})\\s*(?:x|vezes|parcelas)${E}`))
    ?? s.take(new RegExp(`${B}(\\d{1,2})\\s*x${E}`));
  if (parcel) installments = Math.min(48, Math.max(1, Number(parcel[1])));
  s.take(new RegExp(`${B}(?:a|à)\\s+vista${E}`));

  let card = installments > 1;
  let cardName: string | null = null;
  const cardMatch = s.take(new RegExp(`${B}(?:(?:no|pelo|com o|com|via|usando o)\\s+)?(?:cartao(?:\\s+de\\s+credito)?|credito)${E}`));
  if (cardMatch) card = true;
  for (const name of options.cardNames ?? []) {
    const folded = foldKeepingPositions(name.trim());
    if (!folded) continue;
    const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = s.take(new RegExp(`${B}(?:(?:no|do|da|pelo|pela|com o|com a)\\s+)?${escaped}${E}`));
    if (found) { card = true; cardName = name.trim(); break; }
  }
  const cashMatch = s.take(new RegExp(`${B}(?:(?:no|pelo|via|em|com)\\s+)?(?:debito|pix|dinheiro|boleto)${E}`));
  if (cashMatch && !cardName && !cardMatch) card = installments > 1;

  // Hora.
  let time: string | null = null;
  const period = (word: string | undefined, hour: number) => {
    if (!word) return hour;
    if ((word === 'tarde' || word === 'noite') && hour < 12) return hour + 12;
    if ((word === 'manha' || word === 'madrugada') && hour === 12) return 0;
    return hour;
  };
  const setTime = (hour: number, minute: number) => {
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) time = `${pad(hour)}:${pad(minute)}`;
  };
  const noon = s.take(new RegExp(`${B}(?:ao\\s+)?meio[- ]dia(?:\\s+e\\s+meia)?${E}`));
  if (noon) setTime(12, /meia$/.test(noon[0]) ? 30 : 0);
  const midnight = !time && s.take(new RegExp(`${B}(?:a\\s+)?meia[- ]noite${E}`));
  if (midnight) setTime(0, 0);
  if (!time) {
    const withPrefix = s.take(new RegExp(`${B}(?:as|a partir das|ate as|la pelas|pelas)\\s+(\\d{1,2})(?:(?::|h)(\\d{2}))?\\s*(?:h|hs|hrs|horas)?(?:\\s+e\\s+meia)?(?:\\s+da\\s+(manha|tarde|noite|madrugada))?${E}`));
    const withSuffix = withPrefix ? null : s.take(new RegExp(`${B}(\\d{1,2})(?::(\\d{2})|h(\\d{2})?|\\s*(?:hs|hrs|horas))(?:\\s+e\\s+meia)?(?:\\s+da\\s+(manha|tarde|noite|madrugada))?${E}`));
    const withPeriod = withPrefix || withSuffix ? null : s.take(new RegExp(`${B}(\\d{1,2})\\s+da\\s+(manha|tarde|noite|madrugada)${E}`));
    if (withPrefix) {
      let hour = period(withPrefix[3], Number(withPrefix[1]));
      // "às 3" sem período: em compromisso, o mais comum é à tarde.
      if (!withPrefix[3] && !withPrefix[2] && hour >= 1 && hour <= 5) hour += 12;
      setTime(hour, withPrefix[2] ? Number(withPrefix[2]) : /e meia/.test(withPrefix[0]) ? 30 : 0);
    } else if (withSuffix) {
      const minute = withSuffix[2] ?? withSuffix[3];
      setTime(period(withSuffix[4], Number(withSuffix[1])), minute ? Number(minute) : /e meia/.test(withSuffix[0]) ? 30 : 0);
    } else if (withPeriod) {
      setTime(period(withPeriod[2], Number(withPeriod[1])), 0);
    }
  }

  // Data. Gasto e receita: datas sem ano olham para trás; compromisso: para frente.
  const direction: Direction = financeIntent || incomeHint ? 'past' : 'future';
  let date: string | null = null;
  let dateFound = false;
  const relative: Array<[RegExp, number]> = [
    [new RegExp(`${B}depois\\s+de\\s+amanha${E}`), 2],
    [new RegExp(`${B}anteontem${E}`), -2],
    [new RegExp(`${B}amanha${E}`), 1],
    [new RegExp(`${B}ontem${E}`), -1],
    [new RegExp(`${B}hoje${E}`), 0],
  ];
  for (const [pattern, offset] of relative) {
    if (s.take(pattern)) { date = addDays(today, offset); dateFound = true; break; }
  }
  if (!date) {
    const explicit = s.take(new RegExp(`${B}(?:(?:dia|em|no dia)\\s+)?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2}|\\d{4}))?${E}`));
    if (explicit) {
      date = resolveDayMonth(today, Number(explicit[1]), Number(explicit[2]), explicit[3] ? Number(explicit[3]) : null, direction);
      dateFound = true;
    }
  }
  if (!date) {
    const named = s.take(new RegExp(`${B}(?:(?:dia|em|no dia)\\s+)?(\\d{1,2})\\s+de\\s+(${MONTH_ALT})(?:\\s+de\\s+(\\d{4}))?${E}`));
    if (named) {
      date = resolveDayMonth(today, Number(named[1]), MONTHS.indexOf(named[2]) + 1, named[3] ? Number(named[3]) : null, direction);
      dateFound = true;
    }
  }
  if (!date) {
    const weekday = s.take(new RegExp(`${B}(?:(?:na|no|nesta|neste|esta|este|essa|esse|proxima|proximo|na proxima|no proximo|ultima|ultimo|na ultima|no ultimo)\\s+)?(${WEEKDAY_ALT})(?:[- ]feira)?(?:\\s+(que vem|passada|passado))?${E}`));
    if (weekday) {
      const prefix = weekday[0];
      const dir: Direction = /passad|ultim/.test(prefix) ? 'past' : /que vem|proxim/.test(prefix) ? 'future' : direction;
      date = resolveWeekday(today, WEEKDAYS[weekday[1]], dir);
      dateFound = true;
    }
  }
  if (!date) {
    const dayOnly = s.take(new RegExp(`${B}(?:no\\s+)?dia\\s+(\\d{1,2})${E}`));
    if (dayOnly) { date = resolveDayOnly(today, Number(dayOnly[1]), direction); dateFound = true; }
  }
  if (dateFound && !date) return { kind: 'unknown' };

  // Valor, com moeda quando dita.
  let amountCents: number | null = null;
  let currency: QuickCurrency = 'BRL';
  const money: Array<[RegExp, QuickCurrency, number]> = [
    [new RegExp(`(?:us\\$|usd)\\s*${NUMBER}${E}`), 'USD', 1],
    [new RegExp(`${B}${NUMBER}\\s*(?:dolares|dolar|usd)${E}`), 'USD', 1],
    [new RegExp(`(?:€|eur)\\s*${NUMBER}${E}`), 'EUR', 1],
    [new RegExp(`${B}${NUMBER}\\s*(?:euros|euro|eur)${E}`), 'EUR', 1],
    [new RegExp(`r\\$\\s*${NUMBER}(?:\\s*mil${E})?`), 'BRL', 1],
    [new RegExp(`${B}${NUMBER}\\s*mil(?:\\s+reais)?${E}`), 'BRL', 1000],
    [new RegExp(`${B}${NUMBER}\\s*(?:reais|real|conto|contos|pila|pilas|brl)${E}`), 'BRL', 1],
  ];
  let explicitMoney = false;
  for (const [pattern, cur, multiplier] of money) {
    const found = s.take(pattern);
    if (!found) continue;
    const cents = toCents(found[1]);
    const factor = multiplier === 1 && /mil$/.test(found[0].trim()) ? 1000 : multiplier;
    if (cents !== null && cents * factor <= MAX_CENTS) { amountCents = cents * factor; currency = cur; explicitMoney = true; }
    break;
  }
  // Número solto: é valor se a frase fala de dinheiro ou não tem hora (num compromisso, "sala 3" é do título).
  const bare = amountCents === null ? s.find(new RegExp(`${B}${NUMBER}${E}`)) : null;
  const bareCents = bare ? toCents(bare[1]) : null;
  const isTransaction = (amountCents !== null || bareCents !== null) && (explicitMoney || financeIntent || card || incomeHint || !time);
  if (isTransaction && bare && bareCents !== null) {
    s.mark(bare);
    amountCents = bareCents;
  }

  const rest = s.rest();
  const foldedRest = foldKeepingPositions(rest);
  const eventWord = new RegExp(`${B}(?:${EVENT_WORDS.join('|')})${E}`).test(foldedRest);

  if (isTransaction && amountCents !== null) {
    const description = capitalize(stripFillers(rest)).slice(0, 120);
    const type: 'expense' | 'income' = incomeVerb || (incomeHint && !expenseVerb) ? 'income' : 'expense';
    return {
      kind: 'transaction',
      type,
      amountCents,
      currency,
      date: date ?? today,
      description,
      categoryHints: categoryHintsFor(foldKeepingPositions(description)),
      card: type === 'expense' && card,
      cardName: type === 'expense' ? cardName : null,
      installments: type === 'expense' && card ? installments : 1,
    };
  }

  if (time || (dateFound && eventWord) || (eventWord && !financeIntent)) {
    const title = capitalize(stripFillers(rest.replace(LEADING_EVENT_VERBS, ''))).slice(0, 80);
    if (!title) return { kind: 'unknown' };
    return { kind: 'event', title, date: date ?? today, time };
  }

  return { kind: 'unknown' };
};

/** Normaliza para comparar nomes (sem acentos, minúsculo, sem espaços extras). */
export const foldName = (text: string): string => foldKeepingPositions(text.trim()).replace(/\s+/g, ' ');

/** Nomes de categoria prováveis para um texto livre (ex.: "ifood" → ["Delivery", "Alimentação"]). */
export const guessCategories = (text: string): string[] => categoryHintsFor(foldName(text));
