-- ═══════════════════════════════════════════════════════════════════════════
-- RESET: Diárias e Candidaturas
-- Apaga todos os dados relacionados a diárias (candidaturas, mensagens, etc.)
-- Mantém: user_profiles, auth.users (contas de login intactas)
--
-- RODAR EM: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Mensagens (referencia diaria_id)
DELETE FROM mensagens;

-- 2. Avaliações de diarista (referencia diaria_id)
DELETE FROM avaliacoes_diarista;

-- 3. Avaliações genéricas (empregador → diarista, sem diaria_id)
DELETE FROM avaliacoes;

-- 4. Candidaturas (referencia diaria_id)
DELETE FROM candidaturas;

-- 5. Convites diretos (referencia empregador_id / diarista_id — pode ter diaria_id)
DELETE FROM convites;

-- 6. Diárias — tabela principal (agora sem filhos, delete funciona)
DELETE FROM diarias;

COMMIT;

-- Confirma o resultado
SELECT
  (SELECT COUNT(*) FROM diarias)       AS diarias_restantes,
  (SELECT COUNT(*) FROM candidaturas)  AS candidaturas_restantes,
  (SELECT COUNT(*) FROM convites)      AS convites_restantes,
  (SELECT COUNT(*) FROM mensagens)     AS mensagens_restantes,
  (SELECT COUNT(*) FROM avaliacoes_diarista) AS avaliacoes_restantes;
