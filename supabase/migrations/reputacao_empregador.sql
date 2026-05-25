-- Migração: Reputação pública do empregador
-- O diarista precisa decidir se aceita uma vaga sabendo quem é o contratante.
-- Esta migration enriquece a avaliação que o diarista já faz e cria uma view
-- agregada para o feed.
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query.
-- Pode ser re-executada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Adiciona dimensões na avaliação que o diarista faz do empregador
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE avaliacoes_empregador
  ADD COLUMN IF NOT EXISTS pagou_combinado   BOOLEAN,
  ADD COLUMN IF NOT EXISTS cumpriu_combinado BOOLEAN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Garante 1 avaliação por (diarista, diária) — evita duplicata
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE avaliacoes_empregador
  DROP CONSTRAINT IF EXISTS avaliacoes_empregador_diarista_diaria_key;
ALTER TABLE avaliacoes_empregador
  ADD CONSTRAINT avaliacoes_empregador_diarista_diaria_key
    UNIQUE (diarista_id, diaria_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. View pública: reputação agregada de cada empregador
-- ─────────────────────────────────────────────────────────────────────────────
-- Qualquer autenticado pode consultar. Não expõe nada PII — só números.
CREATE OR REPLACE VIEW reputacao_empregadores AS
  SELECT
    empregador_id,
    COUNT(*)::int                                                            AS total_avaliacoes,
    ROUND(AVG(nota)::numeric, 1)                                             AS nota_media,
    -- % de "sim" descartando NULL (avaliações antigas sem o campo)
    COALESCE(
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE pagou_combinado IS TRUE)
        / NULLIF(COUNT(*) FILTER (WHERE pagou_combinado IS NOT NULL), 0)
      , 0)::int
    , NULL) AS pct_pagou_combinado,
    COALESCE(
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE cumpriu_combinado IS TRUE)
        / NULLIF(COUNT(*) FILTER (WHERE cumpriu_combinado IS NOT NULL), 0)
      , 0)::int
    , NULL) AS pct_cumpriu_combinado
  FROM avaliacoes_empregador
  GROUP BY empregador_id;

GRANT SELECT ON reputacao_empregadores TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Índice para performance da view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_aval_empregador_id
  ON avaliacoes_empregador (empregador_id);

SELECT 'Reputação pública do empregador instalada.' AS resultado;
