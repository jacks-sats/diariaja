-- ============================================================================
-- convites: coluna estruturada carga_horaria (item 9 da auditoria 02/07/2026)
-- ============================================================================
-- A carga escolhida pelo anunciante era gravada SÓ como texto dentro de
-- horario_servico ("08:00 (10h de trabalho)") — impossível de consultar,
-- validar ou exibir junto do valor. O front agora grava também a coluna
-- numérica e exibe "R$ X pela diária de Yh" (helpers.cargaHorariaConvite
-- cobre convites antigos extraindo do texto).
--
-- ⚠️ ORDEM: rodar ESTA migration ANTES do merge do PR do item 9 — o insert
-- novo referencia a coluna; sem ela, criar convite passa a falhar.
--
-- Idempotente (IF NOT EXISTS / WHERE carga_horaria IS NULL).
-- Aplicar no Supabase Dashboard → SQL Editor.
-- ============================================================================

ALTER TABLE convites
  ADD COLUMN IF NOT EXISTS carga_horaria NUMERIC
  CHECK (carga_horaria IS NULL OR (carga_horaria > 0 AND carga_horaria <= 24));

-- Backfill dos convites existentes a partir do texto legado "(Nh de trabalho)".
UPDATE convites
   SET carga_horaria = replace(
         (regexp_match(horario_servico, '\((\d+(?:[.,]\d+)?)\s*h de trabalho\)'))[1],
         ',', '.'
       )::numeric
 WHERE carga_horaria IS NULL
   AND horario_servico ~ '\(\d+([.,]\d+)?\s*h de trabalho\)';
