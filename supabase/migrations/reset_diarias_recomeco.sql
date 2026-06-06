-- ═══════════════════════════════════════════════════════════════════════════
-- RECOMEÇO: apaga TODAS as diárias de teste + suas dependências
-- ═══════════════════════════════════════════════════════════════════════════
-- Escopo: zera diárias e tudo que depende delas (candidaturas, mensagens do
-- chat, convites, avaliações, "não interesse", contratações, e denúncias que
-- miram diárias). MANTÉM intactas: contas (auth.users / user_profiles),
-- assinaturas, push_subscriptions, analytics e comunidade.
--
-- ⚠️  IRREVERSÍVEL. Roda numa transação (tudo ou nada). Confirme que TODAS as
--     diárias são mesmo de teste antes de executar.
--
-- RODAR EM: Supabase Dashboard → SQL Editor → New Query → Run.
-- Idempotente: pode rodar de novo (não falha se a tabela não existir).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  -- Tabelas 100% filhas de diárias: como todas as diárias são de teste, todas
  -- as linhas aqui também são — apaga tudo. Pula a tabela que não existir.
  FOREACH t IN ARRAY ARRAY[
    'mensagens',            -- chat por diaria_id
    'candidaturas',         -- candidaturas dos diaristas
    'nao_interesse',        -- vagas ocultadas pelo diarista
    'diaria_contratacoes',  -- multi-vagas (só existe após a migration nova)
    'avaliacoes_diarista',  -- avaliações ligadas à diária
    'avaliacoes_empregador',-- avaliações ligadas à diária
    'avaliacoes',           -- avaliações genéricas (legado)
    'convites'              -- convites diretos empregador → diarista
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I', t);
    END IF;
  END LOOP;

  -- Denúncias: alvo_id é TEXT (id de diária OU de perfil). Apaga só as que
  -- miram diárias; mantém denúncias de perfis (não são dependência de diária).
  -- Roda ANTES do DELETE de diarias (precisa dos ids ainda existindo).
  IF to_regclass('public.denuncias') IS NOT NULL THEN
    EXECUTE 'DELETE FROM denuncias WHERE alvo_id IN (SELECT id::text FROM diarias)';
  END IF;
END $$;

-- Diárias por último (já sem filhos).
DELETE FROM diarias;

COMMIT;

-- Confirmação (deve dar tudo 0).
SELECT
  (SELECT COUNT(*) FROM diarias)      AS diarias_restantes,
  (SELECT COUNT(*) FROM candidaturas) AS candidaturas_restantes,
  (SELECT COUNT(*) FROM mensagens)    AS mensagens_restantes,
  (SELECT COUNT(*) FROM convites)     AS convites_restantes;
