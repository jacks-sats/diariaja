-- ============================================================================
-- Vaga de emprego (job board) — Passo 1: schema
-- ============================================================================
-- Libera o 3º tipo de anúncio 'emprego' e adiciona os campos próprios de vaga
-- de emprego. Reaproveita a tabela `diarias` (decisão: v1 rápido).
--
-- Idempotente. Aplicar no Supabase Dashboard → SQL Editor.
-- ============================================================================

-- 1) Permite tipo_oferta='emprego' (remove qualquer CHECK antigo e recria)
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'diarias'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%tipo_oferta%'
  LOOP
    EXECUTE 'ALTER TABLE diarias DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

ALTER TABLE diarias ADD CONSTRAINT diarias_tipo_oferta_check
  CHECK (tipo_oferta IN ('diaria', 'servico', 'emprego'));

-- 2) Campos próprios da vaga de emprego (nullable — só usados quando emprego)
ALTER TABLE diarias ADD COLUMN IF NOT EXISTS tipo_contrato TEXT;  -- CLT/PJ/Temporário/Estágio/Freelance
ALTER TABLE diarias ADD COLUMN IF NOT EXISTS regime        TEXT;  -- Presencial/Híbrido/Remoto
ALTER TABLE diarias ADD COLUMN IF NOT EXISTS salario_texto TEXT;  -- "R$ 1.800" ou "A combinar"

-- Verificação:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='diarias'::regclass AND conname='diarias_tipo_oferta_check';
