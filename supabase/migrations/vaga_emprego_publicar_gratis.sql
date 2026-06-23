-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de emprego: PUBLICAR vira grátis e ilimitado (mata o R$ 1/publicação)
-- ═══════════════════════════════════════════════════════════════════════════
-- Decisão de produto: publicar vaga de emprego passa a ser GRÁTIS e ILIMITADO,
-- igual a diária/serviço. O antigo modelo de "3 grátis/mês → R$ 1 por publicação
-- avulsa" (trigger enforce_limite_vaga_emprego + RPC pode_postar_vaga_emprego)
-- é REMOVIDO. A monetização da vaga passou para o CONTATO (selecionar candidato
-- de vaga exige plano Essencial — ver vaga_emprego_contato_exige_plano.sql).
--
-- SEGURA: só REMOVE uma trava de inserção. Depois disto, inserir diária com
-- tipo_oferta='emprego' não é mais barrado por cota. Idempotente (IF EXISTS).
-- A Edge Function create-vaga-payment deixa de ser chamada (fica dormente).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Remove a trava de publicação (a autoridade do antigo R$ 1).
DROP TRIGGER IF EXISTS trg_enforce_limite_vaga_emprego ON diarias;
DROP FUNCTION IF EXISTS enforce_limite_vaga_emprego();

-- 2) Remove a RPC consultiva de cota de publicação (o app não chama mais).
DROP FUNCTION IF EXISTS pode_postar_vaga_emprego();

SELECT 'Publicação de vaga de emprego liberada (grátis/ilimitada). R$ 1/publicação removido.' AS resultado;
