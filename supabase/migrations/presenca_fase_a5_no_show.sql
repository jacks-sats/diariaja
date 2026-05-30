-- ═══════════════════════════════════════════════════════════════════════════
-- Migração: Presença — FASE A.5 (feedback de no-show)
-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicar manualmente: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- Depende da Fase A (checkin_em + expiração de no-show).
--
-- Amplia os motivos aceitos em `feedback_vaga_expirada.motivo_categoria` para
-- cobrir o caso em que a diária TINHA um profissional confirmado mas expirou
-- SEM check-in (no-show). O mesmo modal obrigatório de feedback passa a coletar
-- "o que aconteceu" também nesse caso.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE feedback_vaga_expirada
  DROP CONSTRAINT IF EXISTS feedback_vaga_expirada_motivo_categoria_check;

ALTER TABLE feedback_vaga_expirada
  ADD CONSTRAINT feedback_vaga_expirada_motivo_categoria_check
  CHECK (motivo_categoria IN (
    -- Vaga expirou sem ninguém aceitar (já existentes)
    'sem_candidatos',
    'valor_baixo',
    'data_passou',
    'desisti',
    'contratei_fora',
    'outro',
    -- No-show: profissional confirmado mas sem check-in (Fase A.5)
    'diarista_nao_compareceu',
    'diarista_cancelou',
    'compareceu_sem_registro'
  ));

SELECT 'Fase A.5 (feedback de no-show) instalada.' AS resultado;
