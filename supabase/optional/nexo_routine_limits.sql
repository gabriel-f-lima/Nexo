-- OPCIONAL: confere no banco os limites de metas de rotina e de compromissos por dia de cada plano.
-- Não fica em supabase/migrations porque as tabelas nexo_habits e nexo_events são do projeto mobile:
-- rode só depois de confirmar que o app mobile aplica os mesmos limites (gratuito: 3 hábitos e 2 compromissos
-- por dia; Básico: 10 e 5; Pro: sem limite). Caso contrário, quem usa o app pode receber erro ao sincronizar.
-- Requer a migration 20261021120000_nexo_billing_hardening.sql (funções nexo_tier_of e nexo_tier_limit).
-- O "dia" dos compromissos usa o fuso de São Paulo.

create or replace function public.nexo_enforce_habit_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if exists (select 1 from public.nexo_habits h where h.user_id = new.user_id and h.id = new.id) then
    return new;
  end if;
  v_limit := public.nexo_tier_limit(public.nexo_tier_of(new.user_id), 'habits');
  if v_limit is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('nexo_habits:' || new.user_id::text));
  select count(*) into v_count from public.nexo_habits h where h.user_id = new.user_id;
  if v_count >= v_limit then
    raise exception 'nexo_limit_habits' using errcode = 'P0001', hint = 'Limite de metas de rotina do plano atingido.';
  end if;
  return new;
end;
$$;
revoke execute on function public.nexo_enforce_habit_limit() from public, anon, authenticated;

drop trigger if exists nexo_habits_limit on public.nexo_habits;
create trigger nexo_habits_limit
  before insert on public.nexo_habits
  for each row execute function public.nexo_enforce_habit_limit();

create or replace function public.nexo_enforce_event_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_day date;
  v_count integer;
begin
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and (new.start_at at time zone 'America/Sao_Paulo')::date = (old.start_at at time zone 'America/Sao_Paulo')::date then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.nexo_events e where e.user_id = new.user_id and e.id = new.id
  ) then
    return new;
  end if;
  v_limit := public.nexo_tier_limit(public.nexo_tier_of(new.user_id), 'events_per_day');
  if v_limit is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('nexo_events:' || new.user_id::text));
  v_day := (new.start_at at time zone 'America/Sao_Paulo')::date;
  select count(*) into v_count
  from public.nexo_events e
  where e.user_id = new.user_id
    and e.id <> new.id
    and (e.start_at at time zone 'America/Sao_Paulo')::date = v_day;
  if v_count >= v_limit then
    raise exception 'nexo_limit_events_per_day' using errcode = 'P0001', hint = 'Limite de compromissos por dia do plano atingido.';
  end if;
  return new;
end;
$$;
revoke execute on function public.nexo_enforce_event_limit() from public, anon, authenticated;

drop trigger if exists nexo_events_limit on public.nexo_events;
create trigger nexo_events_limit
  before insert or update of start_at, user_id on public.nexo_events
  for each row execute function public.nexo_enforce_event_limit();
