-- Módulo financeiro: categorias, lançamentos e metas.
-- Valores são guardados em centavos (inteiros) para evitar erros de arredondamento.

alter table public.nexo_user_state
  add column if not exists finance_seeded boolean not null default false;

create table if not exists public.nexo_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind text not null check (kind in ('income', 'expense')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.nexo_transactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  type text not null check (type in ('income', 'expense')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency text not null check (currency in ('BRL', 'USD', 'EUR')),
  category_id text,
  occurred_on date not null,
  description text not null default '' check (char_length(description) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, category_id) references public.nexo_categories(user_id, id) on delete set null (category_id)
);

create table if not exists public.nexo_goals (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 1 and 60),
  currency text not null check (currency in ('BRL', 'USD', 'EUR')),
  target_cents bigint not null check (target_cents > 0 and target_cents <= 100000000000),
  saved_cents bigint not null default 0 check (saved_cents >= 0),
  deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists nexo_transactions_user_date_idx on public.nexo_transactions (user_id, occurred_on);

alter table public.nexo_categories enable row level security;
alter table public.nexo_transactions enable row level security;
alter table public.nexo_goals enable row level security;

drop policy if exists "nexo_categories_owner_access" on public.nexo_categories;
create policy "nexo_categories_owner_access" on public.nexo_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "nexo_transactions_owner_access" on public.nexo_transactions;
create policy "nexo_transactions_owner_access" on public.nexo_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "nexo_goals_owner_access" on public.nexo_goals;
create policy "nexo_goals_owner_access" on public.nexo_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
