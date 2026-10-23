-- Endurecimento do pagamento: o plano só vem do servidor, os recursos pagos são conferidos no banco
-- e as funções de pagamento ganham rate limit, travas, idempotência do webhook e registro de eventos suspeitos.
-- Tudo aqui é idempotente: pode rodar de novo sem efeito colateral.

-- ---------------------------------------------------------------------------
-- 1. Assinaturas: só o servidor escreve.
-- ---------------------------------------------------------------------------
-- RLS já bloqueia escrita (não há política de insert/update/delete), mas os privilégios também saem,
-- para que um erro futuro de política não abra a tabela.
revoke insert, update, delete, truncate, references, trigger on public.nexo_subscriptions from anon, authenticated;
revoke all on public.nexo_subscriptions from anon;

alter table public.nexo_subscriptions add column if not exists synced_at timestamptz;
alter table public.nexo_subscriptions add column if not exists last_event_id text;
alter table public.nexo_subscriptions add column if not exists last_event_at timestamptz;

-- "not valid": vale para gravações novas sem travar a migration por causa de linhas antigas.
alter table public.nexo_subscriptions drop constraint if exists nexo_subscriptions_plan_check;
alter table public.nexo_subscriptions add constraint nexo_subscriptions_plan_check
  check (plan is null or plan in ('basico', 'pro')) not valid;
alter table public.nexo_subscriptions drop constraint if exists nexo_subscriptions_status_check;
alter table public.nexo_subscriptions add constraint nexo_subscriptions_status_check
  check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')) not valid;

-- ---------------------------------------------------------------------------
-- 2. Nível da conta calculado no banco (a mesma regra vale para RLS, gatilhos e telas).
-- ---------------------------------------------------------------------------
-- Pago = assinatura active/trialing com plano conhecido. A folga de 3 dias após o fim do período cobre
-- atrasos do webhook na renovação; depois disso, sem confirmação da Stripe, a conta volta ao gratuito.
create or replace function public.nexo_tier_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.plan
    from public.nexo_subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
      and s.plan in ('basico', 'pro')
      and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')
  ), 'free');
$$;
revoke execute on function public.nexo_tier_of(uuid) from public, anon, authenticated;
grant execute on function public.nexo_tier_of(uuid) to service_role;

-- Nível de quem está logado. É o que o site consulta (rpc) e o que as políticas usam.
create or replace function public.nexo_my_tier()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then 'free' else public.nexo_tier_of(auth.uid()) end;
$$;
revoke execute on function public.nexo_my_tier() from public, anon;
grant execute on function public.nexo_my_tier() to authenticated, service_role;

-- Limites por nível. Devem acompanhar LIMITS em src/lib/billing.ts (null = sem limite do plano).
create or replace function public.nexo_tier_limit(p_tier text, p_resource text)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- Metas no Pro: 30 é o teto que o próprio app já aplica (MAX_GOALS), só para conter abuso.
  select case p_resource
    when 'goals' then case p_tier when 'basico' then 10 when 'pro' then 30 else 0 end
    when 'monthly_entries' then case p_tier when 'basico' then 50 when 'pro' then null else 0 end
    when 'habits' then case p_tier when 'free' then 3 when 'basico' then 10 else null end
    when 'events_per_day' then case p_tier when 'free' then 2 when 'basico' then 5 else null end
    else 0
  end;
$$;
revoke execute on function public.nexo_tier_limit(text, text) from public, anon;
grant execute on function public.nexo_tier_limit(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Financeiro: leitura e exclusão continuam do dono; criar e alterar exigem plano pago.
-- ---------------------------------------------------------------------------
-- Categorias seguem livres: são só rótulos e o app cria as sugeridas no primeiro acesso.
drop policy if exists "nexo_transactions_owner_access" on public.nexo_transactions;
drop policy if exists "nexo_transactions_owner_read" on public.nexo_transactions;
drop policy if exists "nexo_transactions_owner_delete" on public.nexo_transactions;
drop policy if exists "nexo_transactions_paid_insert" on public.nexo_transactions;
drop policy if exists "nexo_transactions_paid_update" on public.nexo_transactions;
create policy "nexo_transactions_owner_read" on public.nexo_transactions
  for select to authenticated using (auth.uid() = user_id);
create policy "nexo_transactions_owner_delete" on public.nexo_transactions
  for delete to authenticated using (auth.uid() = user_id);
create policy "nexo_transactions_paid_insert" on public.nexo_transactions
  for insert to authenticated
  with check (auth.uid() = user_id and (select public.nexo_my_tier()) in ('basico', 'pro'));
create policy "nexo_transactions_paid_update" on public.nexo_transactions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (select public.nexo_my_tier()) in ('basico', 'pro'));

drop policy if exists "nexo_goals_owner_access" on public.nexo_goals;
drop policy if exists "nexo_goals_owner_read" on public.nexo_goals;
drop policy if exists "nexo_goals_owner_delete" on public.nexo_goals;
drop policy if exists "nexo_goals_paid_insert" on public.nexo_goals;
drop policy if exists "nexo_goals_paid_update" on public.nexo_goals;
create policy "nexo_goals_owner_read" on public.nexo_goals
  for select to authenticated using (auth.uid() = user_id);
create policy "nexo_goals_owner_delete" on public.nexo_goals
  for delete to authenticated using (auth.uid() = user_id);
create policy "nexo_goals_paid_insert" on public.nexo_goals
  for insert to authenticated
  with check (auth.uid() = user_id and (select public.nexo_my_tier()) in ('basico', 'pro'));
create policy "nexo_goals_paid_update" on public.nexo_goals
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (select public.nexo_my_tier()) in ('basico', 'pro'));

-- Lançamentos por mês: conferido no banco, com trava por usuário para que pedidos simultâneos não passem do limite.
-- Vale para qualquer origem (site, app ou service role). O upsert de uma linha que já existe conta como edição.
create or replace function public.nexo_enforce_transaction_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_limit integer;
  v_month date;
  v_count integer;
begin
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and date_trunc('month', new.occurred_on) = date_trunc('month', old.occurred_on) then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.nexo_transactions t where t.user_id = new.user_id and t.id = new.id
  ) then
    return new;
  end if;

  v_tier := public.nexo_tier_of(new.user_id);
  if v_tier not in ('basico', 'pro') then
    raise exception 'nexo_plan_required' using errcode = 'P0001', hint = 'O controle financeiro faz parte dos planos pagos.';
  end if;
  v_limit := public.nexo_tier_limit(v_tier, 'monthly_entries');
  if v_limit is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('nexo_transactions:' || new.user_id::text));
  v_month := date_trunc('month', new.occurred_on)::date;
  select count(*) into v_count
  from public.nexo_transactions t
  where t.user_id = new.user_id
    and t.occurred_on >= v_month
    and t.occurred_on < (v_month + interval '1 month')::date
    and t.id <> new.id;
  if v_count >= v_limit then
    raise exception 'nexo_limit_monthly_entries' using errcode = 'P0001', hint = 'Limite de lançamentos do plano atingido neste mês.';
  end if;
  return new;
end;
$$;
revoke execute on function public.nexo_enforce_transaction_limit() from public, anon, authenticated;

drop trigger if exists nexo_transactions_limit on public.nexo_transactions;
create trigger nexo_transactions_limit
  before insert or update of occurred_on, user_id on public.nexo_transactions
  for each row execute function public.nexo_enforce_transaction_limit();

create or replace function public.nexo_enforce_goal_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_limit integer;
  v_count integer;
begin
  if exists (select 1 from public.nexo_goals g where g.user_id = new.user_id and g.id = new.id) then
    return new;
  end if;

  v_tier := public.nexo_tier_of(new.user_id);
  if v_tier not in ('basico', 'pro') then
    raise exception 'nexo_plan_required' using errcode = 'P0001', hint = 'As metas financeiras fazem parte dos planos pagos.';
  end if;
  v_limit := public.nexo_tier_limit(v_tier, 'goals');
  if v_limit is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('nexo_goals:' || new.user_id::text));
  select count(*) into v_count from public.nexo_goals g where g.user_id = new.user_id;
  if v_count >= v_limit then
    raise exception 'nexo_limit_goals' using errcode = 'P0001', hint = 'Limite de metas do plano atingido.';
  end if;
  return new;
end;
$$;
revoke execute on function public.nexo_enforce_goal_limit() from public, anon, authenticated;

drop trigger if exists nexo_goals_limit on public.nexo_goals;
create trigger nexo_goals_limit
  before insert on public.nexo_goals
  for each row execute function public.nexo_enforce_goal_limit();

-- ---------------------------------------------------------------------------
-- 4. Tabelas internas do pagamento (só service role; o site não lê nem escreve).
-- ---------------------------------------------------------------------------
-- Eventos da Stripe já recebidos: garante que cada event.id seja processado uma vez.
create table if not exists public.nexo_stripe_events (
  id text primary key,
  type text not null,
  stripe_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 1
);

-- Sessão de checkout aberta por usuário: evita várias sessões simultâneas e reaproveita a que ainda vale.
create table if not exists public.nexo_billing_checkouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id text not null unique,
  price_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Travas curtas (com validade) para operações que não podem rodar em paralelo, como criar checkout ou fazer upgrade.
create table if not exists public.nexo_billing_locks (
  key text primary key,
  locked_until timestamptz not null
);

-- Contadores de rate limit por janela fixa, e bloqueios temporários com tempo crescente para quem insiste.
create table if not exists public.nexo_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create table if not exists public.nexo_rate_blocks (
  bucket text primary key,
  blocked_until timestamptz not null,
  strikes integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Registro de tentativas suspeitas (rate limit, captcha, assinatura inválida, fraude, divergências com a Stripe).
create table if not exists public.nexo_security_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  ip text,
  source text not null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists nexo_security_events_created_idx on public.nexo_security_events (created_at desc);
create index if not exists nexo_security_events_user_idx on public.nexo_security_events (user_id, created_at desc);

alter table public.nexo_stripe_events enable row level security;
alter table public.nexo_billing_checkouts enable row level security;
alter table public.nexo_billing_locks enable row level security;
alter table public.nexo_rate_limits enable row level security;
alter table public.nexo_rate_blocks enable row level security;
alter table public.nexo_security_events enable row level security;

revoke all on public.nexo_stripe_events from anon, authenticated;
revoke all on public.nexo_billing_checkouts from anon, authenticated;
revoke all on public.nexo_billing_locks from anon, authenticated;
revoke all on public.nexo_rate_limits from anon, authenticated;
revoke all on public.nexo_rate_blocks from anon, authenticated;
revoke all on public.nexo_security_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Funções internas chamadas pelas Edge Functions (execução só com service role).
-- ---------------------------------------------------------------------------

-- Limpeza do que já não serve: janelas antigas, bloqueios vencidos, eventos com mais de 90 dias.
create or replace function public.nexo_security_cleanup()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.nexo_rate_limits where window_start < now() - interval '1 day';
  delete from public.nexo_rate_blocks where blocked_until < now() - interval '7 days';
  delete from public.nexo_billing_locks where locked_until < now() - interval '1 hour';
  delete from public.nexo_billing_checkouts where expires_at < now() - interval '1 day';
  delete from public.nexo_stripe_events where received_at < now() - interval '90 days';
  delete from public.nexo_security_events where created_at < now() - interval '90 days';
$$;
revoke execute on function public.nexo_security_cleanup() from public, anon, authenticated;
grant execute on function public.nexo_security_cleanup() to service_role;

-- Conta um acesso no balde e diz se pode seguir. Ao passar do limite, bloqueia por p_block_seconds,
-- dobrando a cada reincidência nas últimas 24 h (até 16x).
create or replace function public.nexo_rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after integer, blocked_now boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
  v_window timestamptz;
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) = 0 or length(p_bucket) > 200
     or p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'nexo_rate_limit_invalid_args';
  end if;

  select b.blocked_until into v_until from public.nexo_rate_blocks b where b.bucket = p_bucket;
  if v_until is not null and v_until > now() then
    return query select false, greatest(1, ceil(extract(epoch from v_until - now()))::integer), false;
    return;
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.nexo_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  if random() < 0.01 then
    perform public.nexo_security_cleanup();
  end if;

  if v_hits <= p_limit then
    return query select true, 0, false;
    return;
  end if;

  insert into public.nexo_rate_blocks as b (bucket, blocked_until, strikes, updated_at)
  values (p_bucket, now() + make_interval(secs => p_block_seconds), 1, now())
  on conflict (bucket) do update set
    strikes = case when b.updated_at > now() - interval '24 hours' then b.strikes + 1 else 1 end,
    blocked_until = now() + make_interval(secs => p_block_seconds * least(
      power(2, case when b.updated_at > now() - interval '24 hours' then b.strikes else 0 end)::integer, 16)),
    updated_at = now()
  returning b.blocked_until into v_until;

  return query select false, greatest(1, ceil(extract(epoch from v_until - now()))::integer), true;
end;
$$;
revoke execute on function public.nexo_rate_limit_hit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.nexo_rate_limit_hit(text, integer, integer, integer) to service_role;

-- Trava com validade: devolve true se conseguiu (ninguém segura a chave ou a trava anterior venceu).
create or replace function public.nexo_lock_acquire(p_key text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  insert into public.nexo_billing_locks as l (key, locked_until)
  values (p_key, now() + make_interval(secs => greatest(1, least(p_ttl_seconds, 300))))
  on conflict (key) do update set locked_until = excluded.locked_until
    where l.locked_until < now()
  returning l.key into v_key;
  return v_key is not null;
end;
$$;
revoke execute on function public.nexo_lock_acquire(text, integer) from public, anon, authenticated;
grant execute on function public.nexo_lock_acquire(text, integer) to service_role;

-- Marca o início do processamento de um evento da Stripe:
-- 'new' processa; 'duplicate' já foi processado; 'in_progress' outra entrega do mesmo evento está em andamento.
create or replace function public.nexo_stripe_event_begin(p_id text, p_type text, p_created_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed timestamptz;
  v_received timestamptz;
begin
  insert into public.nexo_stripe_events (id, type, stripe_created_at)
  values (p_id, p_type, p_created_at)
  on conflict (id) do nothing;
  if found then
    return 'new';
  end if;

  select e.processed_at, e.received_at into v_processed, v_received
  from public.nexo_stripe_events e where e.id = p_id for update;
  if v_processed is not null then
    return 'duplicate';
  end if;
  if v_received > now() - interval '2 minutes' then
    return 'in_progress';
  end if;
  -- Tentativa anterior travou ou falhou: assume de novo.
  update public.nexo_stripe_events set received_at = now(), attempts = attempts + 1 where id = p_id;
  return 'new';
end;
$$;
revoke execute on function public.nexo_stripe_event_begin(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.nexo_stripe_event_begin(text, text, timestamptz) to service_role;

-- Vincula o cliente da Stripe ao usuário. Se já houver outro cliente vinculado, mantém o existente e o devolve.
create or replace function public.nexo_link_customer(p_user_id uuid, p_customer_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  insert into public.nexo_subscriptions as s (user_id, stripe_customer_id, status, updated_at)
  values (p_user_id, p_customer_id, 'none', now())
  on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()
    where s.stripe_customer_id is null;
  select s.stripe_customer_id into v_current from public.nexo_subscriptions s where s.user_id = p_user_id;
  return v_current;
end;
$$;
revoke execute on function public.nexo_link_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.nexo_link_customer(uuid, text) to service_role;

-- Grava o estado lido da Stripe. Ignora leituras mais antigas que a última gravada (eventos fora de ordem,
-- webhook e sincronização ao mesmo tempo). Devolve true se gravou.
create or replace function public.nexo_apply_subscription(
  p_user_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_price_id text,
  p_plan text,
  p_interval text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_synced_at timestamptz,
  p_event_id text default null,
  p_event_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_plan is not null and p_plan not in ('basico', 'pro') then
    raise exception 'nexo_invalid_plan';
  end if;

  insert into public.nexo_subscriptions as s (
    user_id, stripe_customer_id, stripe_subscription_id, status, price_id, plan, interval,
    current_period_end, cancel_at_period_end, synced_at, last_event_id, last_event_at, updated_at
  ) values (
    p_user_id, p_customer_id, p_subscription_id, coalesce(p_status, 'none'), p_price_id, p_plan, p_interval,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), p_synced_at, p_event_id, p_event_at, now()
  )
  on conflict (user_id) do update set
    stripe_customer_id = coalesce(s.stripe_customer_id, excluded.stripe_customer_id),
    stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status,
    price_id = excluded.price_id,
    plan = excluded.plan,
    interval = excluded.interval,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    synced_at = excluded.synced_at,
    last_event_id = coalesce(excluded.last_event_id, s.last_event_id),
    last_event_at = coalesce(excluded.last_event_at, s.last_event_at),
    updated_at = now()
  where (s.synced_at is null or s.synced_at <= excluded.synced_at)
    and (s.stripe_customer_id is null or s.stripe_customer_id = excluded.stripe_customer_id);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke execute on function public.nexo_apply_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.nexo_apply_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, timestamptz) to service_role;
