-- Migração: Sistema de Planos / Assinaturas
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS assinaturas (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  plano                TEXT NOT NULL,        -- 'gratis' | 'essencial' | 'pro' | 'destaque'
  user_type            TEXT NOT NULL,        -- 'empregador' | 'diarista'
  status               TEXT DEFAULT 'ativo', -- 'ativo' | 'cancelado' | 'expirado'
  mp_subscription_id   TEXT,                 -- ID da assinatura no Mercado Pago
  valor                NUMERIC DEFAULT 0,
  inicio               TIMESTAMPTZ DEFAULT NOW(),
  proximo_pagamento    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Cada usuário tem no máximo 1 assinatura ativa por tipo
CREATE UNIQUE INDEX IF NOT EXISTS idx_assinaturas_user_ativo
  ON assinaturas(user_id) WHERE status = 'ativo';

-- RLS
ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usuario_le_propria_assinatura" ON assinaturas
  FOR SELECT USING (auth.uid() = user_id);

-- Campo plano_ativo no perfil do diarista (para ordenação no feed)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS plano_ativo TEXT DEFAULT 'gratis';

-- Verificar
SELECT 'Tabela assinaturas + plano_ativo criados com sucesso!' as resultado;
