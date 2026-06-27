-- ═══════════════════════════════════════════════════════════════════════════
-- Candidaturas: 1 por (vaga, diarista) — deduplica + constraint única
-- ═══════════════════════════════════════════════════════════════════════════
-- Bug: o modal de candidatar não reconhecia "já candidatado", então re-clicar a
-- vaga reabria o formulário e criava candidaturas DUPLICADAS (a 2ª com carta
-- vazia, porque o form era resetado). O anunciante via a duplicata sem carta.
--
-- 1) Deduplica as candidaturas existentes, mantendo a MELHOR linha por par
--    (status mais avançado → com carta/currículo → mais antiga).
-- 2) Cria a constraint única (diaria_id, diarista_id) — garante no servidor que
--    não duplica mais. O cliente trata o conflito (23505) como "já candidatou".
--
-- Idempotente: a dedup não apaga nada se já não houver duplicata; a constraint
-- é criada só se ainda não existir.
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Deduplica (mantém rn = 1 por par) ────────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY diaria_id, diarista_id
           ORDER BY
             -- status mais avançado primeiro (não perde uma seleção/confirmação)
             (CASE status
                WHEN 'confirmado'  THEN 0
                WHEN 'selecionado' THEN 1
                WHEN 'pendente'    THEN 2
                WHEN 'rejeitado'   THEN 3
                ELSE 4 END) ASC,
             -- depois, a que tem carta/currículo (conteúdo de verdade)
             (CASE WHEN (diarista_info ? 'carta') OR (diarista_info ? 'curriculo_path')
                   THEN 0 ELSE 1 END) ASC,
             -- por fim, a mais antiga
             created_at ASC
         ) AS rn
  FROM candidaturas
)
DELETE FROM candidaturas
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Constraint única (guarda anti-duplicata) ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidaturas_diaria_diarista_uniq'
  ) THEN
    ALTER TABLE candidaturas
      ADD CONSTRAINT candidaturas_diaria_diarista_uniq UNIQUE (diaria_id, diarista_id);
  END IF;
END $$;

SELECT 'Candidaturas: deduplicadas + constraint única (diaria_id, diarista_id) instalada.' AS resultado;
