-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de emprego: coluna de BENEFÍCIOS (chips + "Outros")
-- ═══════════════════════════════════════════════════════════════════════════
-- Guarda os benefícios da vaga como um array de texto (ex.: {Vale-transporte,
-- "Plano de saúde", "Gympass"}). O app marca chips de uma lista pronta
-- (BENEFICIOS_VAGA) + um campo "Outros" livre, e tudo entra neste array.
--
-- ADITIVA E SEGURA: só adiciona uma coluna nullable com default '{}'. Não altera
-- dados existentes, não quebra cliente antigo (que simplesmente ignora a coluna).
-- Idempotente (IF NOT EXISTS).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE diarias ADD COLUMN IF NOT EXISTS beneficios text[] DEFAULT '{}';

SELECT 'Coluna diarias.beneficios criada (array de texto).' AS resultado;
