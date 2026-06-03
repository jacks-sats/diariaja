-- ============================================================================
-- FIX: "invalid input syntax for type time: ''"
-- ============================================================================
-- Sintoma: ao criar um SERVIÇO (sem horário de término) ou em fluxos que gravam
-- horário vazio, o banco estourava `invalid input syntax for type time: ''`.
--
-- Causa raiz: diarias.horario_inicio/horario_fim eram TIME, mas o app usa "" pra
-- "sem término" (serviço) e TODO o resto do SQL trata como texto
-- (COALESCE(NULLIF(horario_fim,''), ...)). Inserir '' num TIME é inválido.
--
-- Obstáculo: a VIEW "anuncios" (rebrand jurídico fase 1) lê essas colunas, e o
-- Postgres não deixa ALTER TYPE enquanto a view existe. Então: dropamos a view,
-- alteramos as colunas pra TEXT, e RECRIAMOS a view idêntica.
--
-- Idempotente. Aplicar no Supabase Dashboard → SQL Editor.
-- ============================================================================

-- 1) Dropar a view dependente + converter as colunas pra TEXT
DO $$
DECLARE
  t_inicio text;
  t_fim    text;
BEGIN
  DROP VIEW IF EXISTS anuncios;

  SELECT data_type INTO t_inicio FROM information_schema.columns
   WHERE table_schema='public' AND table_name='diarias' AND column_name='horario_inicio';
  SELECT data_type INTO t_fim FROM information_schema.columns
   WHERE table_schema='public' AND table_name='diarias' AND column_name='horario_fim';

  IF t_inicio IS DISTINCT FROM 'text' THEN
    ALTER TABLE diarias ALTER COLUMN horario_inicio TYPE text USING horario_inicio::text;
  END IF;
  IF t_fim IS DISTINCT FROM 'text' THEN
    ALTER TABLE diarias ALTER COLUMN horario_fim TYPE text USING horario_fim::text;
  END IF;

  BEGIN ALTER TABLE diarias ALTER COLUMN horario_fim    DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER TABLE diarias ALTER COLUMN horario_inicio DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- 2) Recriar a view "anuncios" exatamente como na rebrand fase 1
CREATE OR REPLACE VIEW anuncios AS
SELECT
  id,
  empregador_id      AS anunciante_id,
  nome_negocio,
  segmento,
  funcao,
  descricao,
  data,
  horario_inicio,
  horario_fim,
  valor,
  status,
  diarista_aceite_id AS prestador_aceite_id,
  created_at,
  motivo_cancelamento,
  endereco,
  lat,
  lng,
  valor_encostada,
  valor_por_entrega,
  ganho_estimado_dia,
  pagamento_status,
  pagamento_mp_id,
  taxa_plataforma,
  valor_diarista     AS valor_prestador,
  bairro
FROM diarias;

COMMENT ON VIEW anuncios IS 'View com nomenclatura jurídica nova. Lê de "diarias". Rebrand fase 1.';
ALTER VIEW anuncios SET (security_invoker = true);  -- mantém o A-7 fix

-- Verificação:
--   SELECT data_type FROM information_schema.columns
--    WHERE table_name='diarias' AND column_name IN ('horario_inicio','horario_fim');
--   -- deve mostrar text nas duas.
