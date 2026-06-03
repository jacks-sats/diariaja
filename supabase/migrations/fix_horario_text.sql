-- ============================================================================
-- FIX: "invalid input syntax for type time: ''"
-- ============================================================================
-- Sintoma: ao criar um SERVIÇO (sem horário de término) ou em fluxos que gravam
-- horário vazio, o banco estourava `invalid input syntax for type time: ''`.
--
-- Causa raiz: diarias.horario_inicio/horario_fim eram do tipo TIME, mas:
--   • o app usa "" (string vazia) pra "sem término" (serviço);
--   • TODO o resto do código SQL já trata como texto: COALESCE(NULLIF(horario_fim,''), ...).
-- Inserir '' numa coluna TIME é inválido. A intenção (vista no resto do schema)
-- é que essas colunas sejam TEXTO. Esta migration alinha produção a isso.
--
-- Idempotente. Aplicar no Supabase Dashboard → SQL Editor.
-- ============================================================================

DO $$
DECLARE
  t_inicio text;
  t_fim    text;
BEGIN
  SELECT data_type INTO t_inicio FROM information_schema.columns
   WHERE table_schema='public' AND table_name='diarias' AND column_name='horario_inicio';
  SELECT data_type INTO t_fim FROM information_schema.columns
   WHERE table_schema='public' AND table_name='diarias' AND column_name='horario_fim';

  -- Converte pra TEXT só se ainda não for (evita erro em re-execução)
  IF t_inicio IS DISTINCT FROM 'text' THEN
    ALTER TABLE diarias ALTER COLUMN horario_inicio TYPE text USING horario_inicio::text;
  END IF;
  IF t_fim IS DISTINCT FROM 'text' THEN
    ALTER TABLE diarias ALTER COLUMN horario_fim TYPE text USING horario_fim::text;
  END IF;

  -- Serviço não tem término → a coluna precisa aceitar vazio/nulo.
  BEGIN ALTER TABLE diarias ALTER COLUMN horario_fim    DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER TABLE diarias ALTER COLUMN horario_inicio DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- Verificação:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='diarias' AND column_name IN ('horario_inicio','horario_fim');
--   -- deve mostrar data_type = text nas duas.
