-- ============================================================================
-- TIPO_OFERTA — diferencia DIÁRIA (jornada de várias horas) vs SERVIÇO (tarefa
-- pontual "vem, faz, vai")
-- ============================================================================
-- Spec completa: docs/spec-tipo-oferta-diaria-vs-servico.md
--
-- DIÁRIA  → modelo atual. Horário fim definido, valor por dia. Faxina, evento.
-- SERVIÇO → tarefa pontual. Tempo estimado em minutos, valor por escopo
--           (fixo / a combinar / a partir de). TI, beleza, reparos, pet.
--
-- POSIÇÃO JURÍDICA: "serviço" é prestação pontual regida pelo Código Civil
-- (mais defensável anti-CLT do que "diária", que tem proximidade com LC 150/2015).
--
-- Idempotente — pode rodar várias vezes. Defaultmente todos existentes viram
-- 'diaria' (preserva comportamento atual).
-- ============================================================================

-- 1) Coluna tipo_oferta com default 'diaria'
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS tipo_oferta TEXT
  DEFAULT 'diaria'
  CHECK (tipo_oferta IN ('diaria', 'servico'));

-- 2) Marca antigos como 'diaria' (default já cuida, mas explícito por garantia)
UPDATE diarias SET tipo_oferta = 'diaria' WHERE tipo_oferta IS NULL;

-- 3) NOT NULL após populate
ALTER TABLE diarias
  ALTER COLUMN tipo_oferta SET NOT NULL;

-- 4) Campos específicos de SERVIÇO (nullable — só populam se for servico)
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS tempo_estimado_min INT;

ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS tipo_preco TEXT
  CHECK (tipo_preco IS NULL OR tipo_preco IN ('fixo', 'a_combinar', 'a_partir_de'));

-- 5) Constraint de coerência: se SERVIÇO, exige tempo_estimado + tipo_preco
--    Aplicada como NOT VALID primeiro pra não bloquear linhas legadas que possam
--    ter ficado num estado inconsistente (improvável, mas defensivo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_servico_campos_obrigatorios'
  ) THEN
    ALTER TABLE diarias
      ADD CONSTRAINT chk_servico_campos_obrigatorios CHECK (
        tipo_oferta = 'diaria'
        OR (tipo_oferta = 'servico' AND tempo_estimado_min IS NOT NULL AND tipo_preco IS NOT NULL)
      ) NOT VALID;
    -- Tenta validar — se houver linha violando, vira erro mas a constraint fica
    -- registrada como NOT VALID e a aplicação continua. Pode VALIDATE depois.
    BEGIN
      ALTER TABLE diarias VALIDATE CONSTRAINT chk_servico_campos_obrigatorios;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Constraint chk_servico_campos_obrigatorios criada como NOT VALID — há linhas inconsistentes. Rode VALIDATE manualmente após corrigi-las.';
    END;
  END IF;
END$$;

-- 6) Index pra filtro por tipo no feed
CREATE INDEX IF NOT EXISTS idx_diarias_tipo_oferta
  ON diarias(tipo_oferta, status, data DESC);

-- ── VALIDAÇÃO ──────────────────────────────────────────────────────────────
-- Conta por tipo (deve mostrar todos como 'diaria' na 1ª execução):
-- SELECT tipo_oferta, count(*) FROM diarias GROUP BY tipo_oferta;
--
-- Confirma constraints:
-- SELECT conname, convalidated FROM pg_constraint
-- WHERE conrelid = 'diarias'::regclass AND conname LIKE '%servico%';
