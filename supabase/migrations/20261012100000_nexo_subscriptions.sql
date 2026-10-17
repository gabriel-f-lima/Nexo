-- Assinaturas (espelho do estado da Stripe). Só o servidor escreve; o usuário apenas lê o próprio status.
create table if not exists public.nexo_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'none',
  price_id text,
  interval text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.nexo_subscriptions enable row level security;

drop policy if exists "nexo_subscriptions_owner_read" on public.nexo_subscriptions;
create policy "nexo_subscriptions_owner_read" on public.nexo_subscriptions
  for select using (auth.uid() = user_id);
