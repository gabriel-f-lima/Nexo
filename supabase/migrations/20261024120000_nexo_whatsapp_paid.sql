-- WhatsApp só nos planos pagos (Básico e Pro): gerar o código e confirmar o vínculo exigem plano pago.
-- A função whatsapp-webhook também confere o plano a cada mensagem, para quem cancelar depois de vincular.
-- Requer 20261023130000_nexo_whatsapp.sql e 20261021120000_nexo_billing_hardening.sql (nexo_tier_of).
-- Idempotente.

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
  if public.nexo_tier_of(v_user) not in ('basico', 'pro') then
    raise exception 'nexo_plan_required' using errcode = 'P0001', hint = 'O WhatsApp faz parte dos planos pagos.';
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

-- Confirma o vínculo (service role). Código errado, vencido ou conta sem plano pago: devolve null e não vincula.
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
  if public.nexo_tier_of(v_user) not in ('basico', 'pro') then
    -- Cancelou o plano depois de gerar o código: o código deixa de valer.
    update public.nexo_whatsapp_links set link_code_hash = null, link_code_expires_at = null, updated_at = now()
    where user_id = v_user;
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
