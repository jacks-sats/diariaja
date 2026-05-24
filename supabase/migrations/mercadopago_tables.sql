-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO: Mercado Pago — colunas e tabelas necessárias
-- Rodar em: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. user_profiles: colunas MP do diarista
-- ─────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS mp_access_token TEXT,
  ADD COLUMN IF NOT EXISTS mp_user_id      TEXT,
  ADD COLUMN IF NOT EXISTS plano_ativo     TEXT NOT NULL DEFAULT 'gratis';

-- ─────────────────────────────────────────────
-- 2. diarias: colunas de pagamento
-- ─────────────────────────────────────────────
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS pagamento_mp_id   TEXT,
  ADD COLUMN IF NOT EXISTS pagamento_status  TEXT NOT NULL DEFAULT 'pendente'
    CHECK (pagamento_status IN ('pendente','aguardando','pago','falhou','cancelado','reembolsado')),
  ADD COLUMN IF NOT EXISTS taxa_plataforma   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS valor_diarista    NUMERIC(10,2);

-- ─────────────────────────────────────────────
-- 3. Tabela assinaturas
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assinaturas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plano               TEXT NOT NULL,                       -- 'essencial' | 'pro' | 'destaque'
  user_type           TEXT NOT NULL,                       -- 'empregador' | 'diarista'
  status              TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','ativo','pausado','cancelado')),
  mp_subscription_id  TEXT,                                -- ID do Preapproval no MP
  valor               NUMERIC(10,2) NOT NULL,
  inicio              TIMESTAMPTZ NOT NULL DEFAULT now(),
  proximo_pagamento   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)                                         -- 1 assinatura por usuário
);

-- RLS na tabela assinaturas
ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario_ve_propria_assinatura" ON assinaturas
  FOR SELECT USING (auth.uid() = user_id);

-- Service role pode gerenciar tudo (webhook usa service role key)
CREATE POLICY "service_role_assinaturas" ON assinaturas
  FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 4. Índices para performance
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_diarias_pagamento_mp_id ON diarias(pagamento_mp_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_mp_id ON assinaturas(mp_subscription_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_user_id ON assinaturas(user_id);

-- ─────────────────────────────────────────────
-- 5. Confirma resultado
-- ─────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='mp_access_token') AS col_mp_access_token,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='diarias'        AND column_name='pagamento_status') AS col_pagamento_status,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name='assinaturas')   AS tabela_assinaturas;
-- Resultado esperado: 1 | 1 | 1
