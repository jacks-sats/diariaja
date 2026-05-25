-- Migração: Consolida a constraint de status em `assinaturas`
-- planos.sql criou com  ('ativo','cancelado','expirado')
-- mercadopago_tables.sql criou com  ('pendente','ativo','pausado','cancelado')
-- O que vence depende da ordem de execução; este script normaliza.
-- Rodar em: Supabase Dashboard → SQL Editor → New Query.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Garante a coluna mp_subscription_id (mercadopago_tables.sql já adiciona,
--    mas planos.sql não — defensivo)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE assinaturas
  ADD COLUMN IF NOT EXISTS mp_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UNIQUE por user_id (mercadopago_tables.sql declara; planos.sql não)
-- ─────────────────────────────────────────────────────────────────────────────
-- Remove duplicatas mantendo o registro mais recente, caso existam
DELETE FROM assinaturas a
USING assinaturas b
WHERE a.user_id = b.user_id
  AND a.created_at < b.created_at;

ALTER TABLE assinaturas
  DROP CONSTRAINT IF EXISTS assinaturas_user_id_key;
ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_user_id_key UNIQUE (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Constraint de status — canônica: pendente | ativo | pausado | cancelado
-- ─────────────────────────────────────────────────────────────────────────────
-- Migra valores legados ('expirado' → 'cancelado')
UPDATE assinaturas SET status = 'cancelado' WHERE status = 'expirado';

ALTER TABLE assinaturas
  DROP CONSTRAINT IF EXISTS assinaturas_status_check;
ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_status_check
    CHECK (status IN ('pendente','ativo','pausado','cancelado'));

SELECT 'Constraint de status em assinaturas consolidada.' AS resultado;
