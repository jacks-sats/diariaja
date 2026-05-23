-- ── Analytics de Eventos do DiáriaJá ────────────────────────────────────────
-- Tabela para rastrear eventos chave de uso do app (sem PII sensível).
-- Executa: supabase db push  ou cole no SQL Editor do Supabase Dashboard.

create table if not exists public.analytics_eventos (
  id          uuid primary key default gen_random_uuid(),
  evento      text not null,
  user_id     uuid references auth.users(id) on delete set null,
  user_type   text,                          -- 'diarista' | 'empregador'
  propriedades jsonb default '{}',           -- dados extras (sem CPF, sem senha)
  created_at  timestamptz default now()
);

-- Índices para consultas comuns
create index if not exists analytics_eventos_evento_idx      on public.analytics_eventos (evento);
create index if not exists analytics_eventos_user_id_idx     on public.analytics_eventos (user_id);
create index if not exists analytics_eventos_created_at_idx  on public.analytics_eventos (created_at desc);

-- RLS: usuários podem inserir seus próprios eventos; admins lêem tudo
alter table public.analytics_eventos enable row level security;

create policy "Inserção de eventos próprios"
  on public.analytics_eventos for insert
  with check (user_id = auth.uid() or user_id is null);

create policy "Leitura restrita a admins"
  on public.analytics_eventos for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- ── Eventos rastreados pelo app ───────────────────────────────────────────────
-- login_sucesso         { user_type }
-- cadastro_concluido    { user_type }
-- diaria_criada         { funcao, valor, recorrente }
-- candidatura_enviada   { diaria_id, funcao }
-- candidatura_aceita    { diaria_id, funcao }
-- diaria_concluida      { diaria_id, valor }
-- avaliacao_enviada     { tipo: 'diarista'|'empregador', nota }
-- chat_mensagem_enviada { bloqueada: boolean }
-- perfil_editado        { user_type }
-- conta_excluida        { user_type }
