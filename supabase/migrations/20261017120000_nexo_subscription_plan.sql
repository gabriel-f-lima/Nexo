-- Plano assinado (basico | pro). Preenchido pelo webhook a partir do preço da Stripe.
alter table public.nexo_subscriptions add column if not exists plan text;
