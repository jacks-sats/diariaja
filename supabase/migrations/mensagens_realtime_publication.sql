-- ═══════════════════════════════════════════════════════════════════════════
-- Garante que `mensagens` está na publicação de Realtime
-- ═══════════════════════════════════════════════════════════════════════════
-- Sem isso, o canal mensagens-${diariaId} nunca recebe o INSERT da outra ponta
-- e quem está com o chat aberto não vê a mensagem chegar ao vivo (só após
-- reabrir o chat). Idempotente: só adiciona se ainda não estiver na publicação.
--
-- REPLICA IDENTITY FULL garante que o payload do Realtime traga todas as colunas
-- (necessário pros filtros por diaria_id funcionarem de forma confiável).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'mensagens'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE mensagens;
    RAISE NOTICE 'Tabela mensagens adicionada à publicação supabase_realtime.';
  ELSE
    RAISE NOTICE 'mensagens já estava na publicação (nada a fazer).';
  END IF;
END $$;

-- Payload completo nos eventos de Realtime/replicação.
ALTER TABLE mensagens REPLICA IDENTITY FULL;

SELECT 'Realtime de mensagens garantido.' AS resultado;
