-- ── Push Subscriptions — Web Push via VAPID ─────────────────────────────────
-- Armazena assinaturas de push de cada usuário (um por dispositivo/navegador).
-- Execute no Supabase Dashboard → SQL Editor.

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,                 -- URL do endpoint do browser
  p256dh        text not null,                        -- Chave pública do cliente
  auth_key      text not null,                        -- Token de autenticação
  user_agent    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- RLS
alter table public.push_subscriptions enable row level security;

create policy "Usuário gerencia suas próprias assinaturas"
  on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
