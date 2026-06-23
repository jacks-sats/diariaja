-- ═══════════════════════════════════════════════════════════════════════════
-- Bloqueio de usuário aplicado no ENVIO de mensagem (P1-3)
-- ═══════════════════════════════════════════════════════════════════════════
-- A funcionalidade de bloquear usuário (usuarios_bloqueados) só fechava o chat
-- do BLOQUEADOR no cliente — não impedia o envio de mensagens em nenhum lugar:
--   - o cliente (enviarMensagemReal) não checava bloqueio antes do INSERT;
--   - a RLS de INSERT de `mensagens` só valida auth.uid() = remetente_id;
--   - a RPC ha_bloqueio_entre (bilateral) existia mas NUNCA era chamada (morta).
-- Resultado: quem foi bloqueado continuava conseguindo mandar mensagem.
--
-- Este trigger fecha no SERVIDOR (autoridade), reaproveitando a RPC bilateral
-- ha_bloqueio_entre — mesmo padrão do anti_exit_mensagens_trigger.sql.
-- Bloqueia o INSERT se houver bloqueio em QUALQUER direção entre remetente e
-- destinatário. service_role (Edge Functions, ex.: msg automática do mp-webhook)
-- não é barrado.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_bloqueio_mensagem()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Inserts internos (Edge Functions com service_role) não são barrados.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Bloqueio bilateral (eu bloqueei o destinatário OU ele me bloqueou).
  -- Checa direto na tabela pelos ids do registro (não depende de auth.uid()),
  -- cobrindo as duas direções de forma robusta.
  IF EXISTS (
    SELECT 1 FROM usuarios_bloqueados
     WHERE (bloqueador_id = NEW.remetente_id    AND alvo_id = NEW.destinatario_id)
        OR (bloqueador_id = NEW.destinatario_id AND alvo_id = NEW.remetente_id)
  ) THEN
    RAISE EXCEPTION 'Não é possível enviar: há um bloqueio entre você e este usuário.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_bloqueio_mensagem ON mensagens;
CREATE TRIGGER trg_enforce_bloqueio_mensagem
  BEFORE INSERT ON mensagens
  FOR EACH ROW
  EXECUTE FUNCTION enforce_bloqueio_mensagem();

SELECT 'Trava de bloqueio no envio de mensagem instalada.' AS resultado;
