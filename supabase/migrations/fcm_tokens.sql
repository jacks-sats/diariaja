-- ── FCM Tokens — Push nativo (app Android via Firebase Cloud Messaging) ─────
-- Segundo canal de push, complementar ao Web Push (push_subscriptions / VAPID).
-- O app instalado (Capacitor) registra um token FCM por dispositivo; o
-- navegador/PWA continua usando push_subscriptions. O send-push consulta as
-- DUAS tabelas e roteia: app → FCM, navegador → VAPID.
--
-- Por que tabela separada (e não estender push_subscriptions):
--   o token FCM é uma string opaca única, com shape e ciclo de vida diferentes
--   da subscription Web Push (endpoint + p256dh + auth_key). Misturar forçaria
--   colunas nullable + discriminador e poluiria a query VAPID existente.
--
-- Execute no Supabase Dashboard → SQL Editor (idempotente — pode reexecutar).

create table if not exists public.fcm_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token         text not null unique,                 -- registration token do FCM
  platform      text not null default 'android',      -- android | ios (futuro)
  user_agent    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists fcm_tokens_user_id_idx on public.fcm_tokens (user_id);

-- RLS — espelha push_subscriptions: cada usuário gerencia só os próprios tokens.
-- O send-push (service_role) ignora RLS e consulta tokens de qualquer user.
alter table public.fcm_tokens enable row level security;

drop policy if exists "Usuário gerencia seus próprios tokens FCM" on public.fcm_tokens;
create policy "Usuário gerencia seus próprios tokens FCM"
  on public.fcm_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
