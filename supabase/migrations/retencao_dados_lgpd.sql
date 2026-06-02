-- ============================================================================
-- Retenção de dados (LGPD Art. 15/16) — purga periódica de dados antigos
-- ============================================================================
-- A LGPD pede que dados pessoais não sejam mantidos além do necessário. Hoje
-- diárias/mensagens/analytics ficam indefinidamente. Esta migration cria uma
-- função de purga + agenda diária (pg_cron).
--
-- PERÍODOS PADRÃO (ajuste conforme decisão de negócio/jurídico — são SUA escolha):
--   • analytics_eventos: 180 dias   • mensagens (chat): 12 meses
--   • diárias terminais: 12 meses (BLOCO OPCIONAL — ver aviso abaixo)
--
-- Idempotente. Aplicar no Supabase Dashboard → SQL Editor.
-- Seguro: por padrão só apaga tabelas "folha" (sem dependentes). A purga de
-- diárias é um bloco SEPARADO e comentado, pra você habilitar só depois de
-- confirmar o ON DELETE CASCADE das FKs (candidaturas/mensagens/avaliações).
-- ============================================================================

-- Períodos configuráveis via GUC (opcional). Se não setar, usa os defaults.
--   ALTER DATABASE postgres SET app.retencao_analytics_dias = '180';
--   ALTER DATABASE postgres SET app.retencao_chat_meses     = '12';

CREATE OR REPLACE FUNCTION purgar_dados_antigos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias_analytics INT := COALESCE(NULLIF(current_setting('app.retencao_analytics_dias', true), '')::INT, 180);
  v_meses_chat     INT := COALESCE(NULLIF(current_setting('app.retencao_chat_meses', true), '')::INT, 12);
  v_analytics      INT := 0;
  v_mensagens      INT := 0;
BEGIN
  -- 1) Eventos de analytics antigos (tabela folha — sem dependentes)
  DELETE FROM analytics_eventos
   WHERE created_at < NOW() - (v_dias_analytics || ' days')::INTERVAL;
  GET DIAGNOSTICS v_analytics = ROW_COUNT;

  -- 2) Mensagens de chat antigas (apagar mensagem não viola o pai diária)
  DELETE FROM mensagens
   WHERE created_at < NOW() - (v_meses_chat || ' months')::INTERVAL;
  GET DIAGNOSTICS v_mensagens = ROW_COUNT;

  -- 3) (OPCIONAL) Diárias terminais antigas — DESCOMENTE só após confirmar que
  --    candidaturas/mensagens/avaliacoes_* têm FK ON DELETE CASCADE pra diaria_id.
  --    Sem cascade, este DELETE FALHA por violação de FK. Por isso vem desligado.
  -- DELETE FROM diarias
  --  WHERE status IN ('concluida','cancelada')
  --    AND created_at < NOW() - INTERVAL '12 months';

  RETURN jsonb_build_object(
    'analytics_apagados', v_analytics,
    'mensagens_apagadas', v_mensagens,
    'executado_em',       NOW()
  );
END $$;

REVOKE ALL ON FUNCTION purgar_dados_antigos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purgar_dados_antigos() TO service_role;

-- Agenda diária às 03:30 UTC (00:30 BRT). Só agenda se pg_cron existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purgar-dados-antigos-diario',
      '30 3 * * *',
      $cron$SELECT public.purgar_dados_antigos();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Teste manual (roda agora e mostra quantos apagou):
--   SELECT purgar_dados_antigos();
