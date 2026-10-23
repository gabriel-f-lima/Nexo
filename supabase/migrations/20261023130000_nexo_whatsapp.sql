-- Base da integração com WhatsApp (Cloud API da Meta): vínculo do número com a conta e registro das mensagens
-- recebidas, sem guardar o texto. A função whatsapp-webhook usa estas tabelas com a service role.
-- Tudo aqui é idempotente.

-- Um número por conta. O vínculo é feito com um código de 6 dígitos gerado no site (válido por 10 minutos)
-- e enviado pelo próprio WhatsApp: assim o número fica comprovado sem SMS.
create table if not exists public.nexo_whatsapp_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text unique check (phone is null or phone ~ '^[1-9][0-9]{7,14}$'),
  verified_at timestamptz,
  link_code_hash text check (link_code_hash is null or link_code_hash ~ '^[0-9a-f]{64}$'),
  link_code_expires_at timestamptz,
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 1 and 64),
  reminders_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nexo_whatsapp_links_code_idx on public.nexo_whatsapp_links (link_code_hash)
  where link_code_hash is not null;

-- Mensagens já processadas (idempotência: a Meta reenvia o mesmo evento quando não recebe 200 a tempo).
-- Só metadados: o conteúdo das conversas não fica no banco.
create table if not exists public.nexo_whatsapp_messages (
  id text primary key check (char_length(id) between 1 and 200),
  user_id uuid references auth.users(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null check (char_length(kind) between 1 and 40),
  status text not null default 'received' check (char_length(status) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists nexo_whatsapp_messages_user_idx on public.nexo_whatsapp_messages (user_id, created_at desc);

alter table public.nexo_whatsapp_links enable row level security;
alter table public.nexo_whatsapp_messages enable row level security;

-- O dono vê o próprio vínculo e pode desfazê-lo; criar e confirmar passam pelas funções abaixo.
revoke all on public.nexo_whatsapp_links from anon, authenticated;
grant select, delete on public.nexo_whatsapp_links to authenticated;
revoke all on public.nexo_whatsapp_messages from anon, authenticated;

drop policy if exists "nexo_whatsapp_links_owner_read" on public.nexo_whatsapp_links;
drop policy if exists "nexo_whatsapp_links_owner_delete" on public.nexo_whatsapp_links;
create policy "nexo_whatsapp_links_owner_read" on public.nexo_whatsapp_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "nexo_whatsapp_links_owner_delete" on public.nexo_whatsapp_links
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Gera um código novo para quem está logado. Devolve o código (só desta vez; no banco fica o hash).
-- No máximo um código novo a cada 30 segundos.
create or replace function public.nexo_whatsapp_start_link()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_last timestamptz;
begin
  if v_user is null then
    raise exception 'nexo_auth_required' using errcode = 'P0001';
  end if;
  select l.updated_at into v_last from public.nexo_whatsapp_links l
  where l.user_id = v_user and l.link_code_hash is not null;
  if v_last is not null and v_last > now() - interval '30 seconds' then
    raise exception 'nexo_whatsapp_wait' using errcode = 'P0001', hint = 'Aguarde alguns segundos para gerar outro código.';
  end if;

  -- 6 dígitos a partir de bytes aleatórios do gerador criptográfico do Postgres.
  v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.nexo_whatsapp_links as l (user_id, link_code_hash, link_code_expires_at, updated_at)
  values (v_user, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + interval '10 minutes', now())
  on conflict (user_id) do update set
    link_code_hash = excluded.link_code_hash,
    link_code_expires_at = excluded.link_code_expires_at,
    updated_at = now();
  return v_code;
end;
$$;
revoke execute on function public.nexo_whatsapp_start_link() from public, anon;
grant execute on function public.nexo_whatsapp_start_link() to authenticated;

-- Confirma o vínculo a partir do webhook (service role): código certo e no prazo liga o número à conta.
-- Devolve o usuário vinculado, ou null se o código não vale. Um número só fica ligado a uma conta.
create or replace function public.nexo_whatsapp_confirm_link(p_phone text, p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_phone is null or p_phone !~ '^[1-9][0-9]{7,14}$' or p_code is null or p_code !~ '^[0-9]{6}$' then
    return null;
  end if;
  select l.user_id into v_user
  from public.nexo_whatsapp_links l
  where l.link_code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
    and l.link_code_expires_at > now()
  for update;
  if v_user is null then
    return null;
  end if;
  -- O número sai de qualquer outra conta antes de entrar nesta.
  update public.nexo_whatsapp_links set phone = null, verified_at = null, updated_at = now()
  where phone = p_phone and user_id <> v_user;
  update public.nexo_whatsapp_links set
    phone = p_phone,
    verified_at = now(),
    link_code_hash = null,
    link_code_expires_at = null,
    updated_at = now()
  where user_id = v_user;
  return v_user;
end;
$$;
revoke execute on function public.nexo_whatsapp_confirm_link(text, text) from public, anon, authenticated;
grant execute on function public.nexo_whatsapp_confirm_link(text, text) to service_role;
