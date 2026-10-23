-- Planejamento: preferências sincronizadas, cartões de crédito e faturas, contas a pagar, orçamentos por categoria,
-- objetivos que ligam dinheiro, agenda e rotina, metas de sequência e conquistas.
-- Requer 20261011100000_nexo_finance.sql e 20261021120000_nexo_billing_hardening.sql (nexo_my_tier).
-- Tudo aqui é idempotente: pode rodar de novo sem efeito colateral.

-- ---------------------------------------------------------------------------
-- 0. Teto de linhas por usuário (contra abuso; os limites de plano continuam em nexo_tier_limit).
-- ---------------------------------------------------------------------------
-- Uso: trigger before insert com o teto como argumento. A tabela precisa ter user_id e id.
-- Um upsert de linha que já existe é edição e não conta.
create or replace function public.nexo_enforce_row_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer := tg_argv[0]::integer;
  v_exists boolean;
  v_count integer;
begin
  execute format('select exists (select 1 from public.%I where user_id = $1 and id = $2)', tg_table_name)
    into v_exists using new.user_id, new.id;
  if v_exists then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.user_id::text));
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into v_count using new.user_id;
  if v_count >= v_cap then
    raise exception 'nexo_row_cap' using errcode = 'P0001', hint = format('Limite de %s itens atingido.', v_cap);
  end if;
  return new;
end;
$$;
revoke execute on function public.nexo_enforce_row_cap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Preferências de notificação: as mesmas em todos os aparelhos da conta.
-- ---------------------------------------------------------------------------
create table if not exists public.nexo_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_reminder text check (daily_reminder is null or daily_reminder ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  event_alert_minutes smallint not null default 0 check (event_alert_minutes in (0, 10, 30, 60)),
  bill_alerts boolean not null default true,
  coach_alerts boolean not null default true,
  weekly_summary boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Cartões de crédito. A fatura de cada compra é decidida pelo dia de fechamento e guardada no lançamento.
-- ---------------------------------------------------------------------------
create table if not exists public.nexo_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  currency text not null check (currency in ('BRL', 'USD', 'EUR')),
  limit_cents bigint check (limit_cents is null or (limit_cents > 0 and limit_cents <= 100000000000)),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Pagamentos de fatura (podem ser parciais). Não são despesas: as compras já foram contadas.
create table if not exists public.nexo_card_payments (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  card_id text not null,
  invoice_month text not null check (invoice_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, card_id) references public.nexo_cards(user_id, id) on delete cascade
);
create index if not exists nexo_card_payments_invoice_idx on public.nexo_card_payments (user_id, card_id, invoice_month);

-- ---------------------------------------------------------------------------
-- 3. Contas a pagar: mensais (dia de vencimento) ou únicas (data).
-- ---------------------------------------------------------------------------
create table if not exists public.nexo_bills (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 60),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency text not null check (currency in ('BRL', 'USD', 'EUR')),
  category_id text,
  recurrence text not null check (recurrence in ('monthly', 'once')),
  due_day smallint check (due_day between 1 and 31),
  due_date date,
  starts_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, category_id) references public.nexo_categories(user_id, id) on delete set null (category_id),
  check ((recurrence = 'monthly' and due_day is not null) or (recurrence = 'once' and due_date is not null))
);

-- ---------------------------------------------------------------------------
-- 4. Lançamentos: compra no cartão (com parcelas) e pagamento de conta.
-- ---------------------------------------------------------------------------
alter table public.nexo_transactions add column if not exists card_id text;
alter table public.nexo_transactions add column if not exists invoice_month text;
alter table public.nexo_transactions add column if not exists purchase_id text;
alter table public.nexo_transactions add column if not exists installment_number smallint;
alter table public.nexo_transactions add column if not exists installment_total smallint;
alter table public.nexo_transactions add column if not exists bill_id text;
alter table public.nexo_transactions add column if not exists bill_period text;

alter table public.nexo_transactions drop constraint if exists nexo_transactions_card_fk;
-- Cartão com lançamentos não pode ser apagado (o app oferece arquivar): o histórico das faturas continua certo.
-- "no action" (e não "restrict"): ao excluir a conta, os lançamentos e os cartões saem juntos no mesmo comando.
alter table public.nexo_transactions add constraint nexo_transactions_card_fk
  foreign key (user_id, card_id) references public.nexo_cards(user_id, id) on delete no action;
alter table public.nexo_transactions drop constraint if exists nexo_transactions_bill_fk;
alter table public.nexo_transactions add constraint nexo_transactions_bill_fk
  foreign key (user_id, bill_id) references public.nexo_bills(user_id, id) on delete set null (bill_id);

alter table public.nexo_transactions drop constraint if exists nexo_transactions_card_check;
-- Os "is not null" explícitos importam: numa restrição, uma comparação com nulo não reprova a linha.
alter table public.nexo_transactions add constraint nexo_transactions_card_check check (
  (card_id is null and invoice_month is null)
  or (card_id is not null and invoice_month is not null and type = 'expense'
      and invoice_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
alter table public.nexo_transactions drop constraint if exists nexo_transactions_installment_check;
alter table public.nexo_transactions add constraint nexo_transactions_installment_check check (
  (installment_total is null and installment_number is null)
  or (purchase_id is not null and installment_total is not null and installment_number is not null
      and installment_total between 2 and 48 and installment_number between 1 and installment_total)
);
alter table public.nexo_transactions drop constraint if exists nexo_transactions_purchase_check;
alter table public.nexo_transactions add constraint nexo_transactions_purchase_check
  check (purchase_id is null or char_length(purchase_id) between 1 and 64);
alter table public.nexo_transactions drop constraint if exists nexo_transactions_bill_check;
-- Ao apagar a conta, o lançamento fica com o mês que pagou (bill_period) e sem o vínculo (bill_id).
alter table public.nexo_transactions add constraint nexo_transactions_bill_check check (
  (bill_period is null or bill_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  and (bill_id is null or (bill_period is not null and card_id is null))
);

-- Uma conta é paga uma vez por mês.
create unique index if not exists nexo_transactions_bill_period_idx
  on public.nexo_transactions (user_id, bill_id, bill_period) where bill_id is not null;
create index if not exists nexo_transactions_card_invoice_idx
  on public.nexo_transactions (user_id, card_id, invoice_month) where card_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Orçamento mensal por categoria de despesa.
-- ---------------------------------------------------------------------------
create table if not exists public.nexo_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id text not null,
  currency text not null check (currency in ('BRL', 'USD', 'EUR')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, category_id),
  foreign key (user_id, category_id) references public.nexo_categories(user_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 6. Objetivos: ligam uma meta financeira, um compromisso e hábitos de apoio (ex.: "Viagem em julho").
-- ---------------------------------------------------------------------------
create table if not exists public.nexo_objectives (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  title text not null check (char_length(title) between 1 and 60),
  target_date date not null,
  goal_id text,
  event_id text,
  habit_ids text[] not null default '{}' check (cardinality(habit_ids) <= 5),
  started_on date not null default current_date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, goal_id) references public.nexo_goals(user_id, id) on delete set null (goal_id),
  foreign key (user_id, event_id) references public.nexo_events(user_id, id) on delete set null (event_id)
);

-- ---------------------------------------------------------------------------
-- 7. Metas de sequência (ex.: 30 dias seguidos de um hábito) e conquistas desbloqueadas.
-- ---------------------------------------------------------------------------
create table if not exists public.nexo_streak_goals (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  target_days smallint not null check (target_days between 2 and 365),
  started_on date not null default current_date,
  achieved_on date,
  updated_at timestamptz not null default now(),
  primary key (user_id, habit_id),
  foreign key (user_id, habit_id) references public.nexo_habits(user_id, id) on delete cascade
);

create table if not exists public.nexo_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9_]{1,40}$'),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- 8. Segurança: cada usuário só vê e altera o que é seu. Recursos do financeiro exigem plano pago para gravar.
-- ---------------------------------------------------------------------------
alter table public.nexo_preferences enable row level security;
alter table public.nexo_cards enable row level security;
alter table public.nexo_card_payments enable row level security;
alter table public.nexo_bills enable row level security;
alter table public.nexo_budgets enable row level security;
alter table public.nexo_objectives enable row level security;
alter table public.nexo_streak_goals enable row level security;
alter table public.nexo_achievements enable row level security;

revoke all on public.nexo_preferences, public.nexo_cards, public.nexo_card_payments, public.nexo_bills,
  public.nexo_budgets, public.nexo_objectives, public.nexo_streak_goals, public.nexo_achievements from anon;
grant select, insert, update, delete on public.nexo_preferences, public.nexo_cards, public.nexo_card_payments,
  public.nexo_bills, public.nexo_budgets, public.nexo_objectives, public.nexo_streak_goals to authenticated;
-- Conquista desbloqueada não é editada: só registrada (e apagada junto com a conta).
grant select, insert on public.nexo_achievements to authenticated;
revoke update, delete on public.nexo_achievements from authenticated;

do $$
declare
  t text;
begin
  -- Livres para todos os níveis: preferências, objetivos, metas de sequência.
  foreach t in array array['nexo_preferences', 'nexo_objectives', 'nexo_streak_goals'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_access', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_owner_access', t);
  end loop;

  -- Financeiro: ler e apagar é do dono; criar e alterar exigem plano pago (mesma regra dos lançamentos).
  foreach t in array array['nexo_cards', 'nexo_card_payments', 'nexo_bills', 'nexo_budgets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_paid_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_paid_update', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_owner_read', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_owner_delete', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id and (select public.nexo_my_tier()) in (''basico'', ''pro''))',
      t || '_paid_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and (select public.nexo_my_tier()) in (''basico'', ''pro''))',
      t || '_paid_update', t);
  end loop;
end;
$$;

drop policy if exists "nexo_achievements_owner_read" on public.nexo_achievements;
drop policy if exists "nexo_achievements_owner_insert" on public.nexo_achievements;
create policy "nexo_achievements_owner_read" on public.nexo_achievements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "nexo_achievements_owner_insert" on public.nexo_achievements
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Tetos por usuário (os planos não limitam estes itens; isto só contém abuso).
drop trigger if exists nexo_cards_cap on public.nexo_cards;
create trigger nexo_cards_cap before insert on public.nexo_cards
  for each row execute function public.nexo_enforce_row_cap('20');
drop trigger if exists nexo_bills_cap on public.nexo_bills;
create trigger nexo_bills_cap before insert on public.nexo_bills
  for each row execute function public.nexo_enforce_row_cap('100');
drop trigger if exists nexo_card_payments_cap on public.nexo_card_payments;
create trigger nexo_card_payments_cap before insert on public.nexo_card_payments
  for each row execute function public.nexo_enforce_row_cap('5000');
drop trigger if exists nexo_objectives_cap on public.nexo_objectives;
create trigger nexo_objectives_cap before insert on public.nexo_objectives
  for each row execute function public.nexo_enforce_row_cap('30');
drop trigger if exists nexo_achievements_cap on public.nexo_achievements;
create trigger nexo_achievements_cap before insert on public.nexo_achievements
  for each row execute function public.nexo_enforce_row_cap('200');
