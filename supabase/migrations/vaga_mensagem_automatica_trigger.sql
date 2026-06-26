-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de EMPREGO — Mensagem automática (Fase 2): injeta a 1ª msg da empresa
-- ═══════════════════════════════════════════════════════════════════════════
-- Quando o candidato CONFIRMA (candidaturas.status → 'confirmado') numa vaga de
-- EMPREGO que tem `mensagem_automatica`, este trigger insere essa mensagem no
-- chat COMO A EMPRESA (remetente = empregador).
--
-- POR QUE NO BANCO: a RLS de `mensagens` exige WITH CHECK (auth.uid() =
-- remetente_id) — ou seja, o cliente só insere msg como si mesmo. Quem confirma
-- é o candidato, então o front dele NÃO conseguiria postar "como a empresa".
-- SECURITY DEFINER resolve: o servidor é a autoridade e insere pela empresa.
--
-- Só EMPREGO (filtra tipo_oferta). Idempotente em dois níveis: (1) só dispara na
-- TRANSIÇÃO p/ 'confirmado'; (2) não duplica se a mesma msg já existe pro par.
-- NÃO toca diária/serviço.
--
-- Aplicar DEPOIS da coluna (vaga_mensagem_automatica_coluna.sql).
-- Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION injeta_mensagem_automatica_emprego()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo TEXT;
  v_emp  UUID;
  v_msg  TEXT;
BEGIN
  -- Só na ENTRADA em 'confirmado' (não em re-updates nem outros status).
  IF NEW.status <> 'confirmado'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR OLD.status = 'confirmado' THEN
    RETURN NEW;
  END IF;

  SELECT tipo_oferta, empregador_id, mensagem_automatica
    INTO v_tipo, v_emp, v_msg
    FROM diarias WHERE id = NEW.diaria_id;

  -- Só vaga de emprego com mensagem preenchida.
  IF v_tipo IS DISTINCT FROM 'emprego' THEN RETURN NEW; END IF;
  IF v_msg IS NULL OR btrim(v_msg) = '' THEN RETURN NEW; END IF;

  -- Idempotência: não duplica a mesma mensagem automática pro mesmo par.
  IF EXISTS (
    SELECT 1 FROM mensagens
     WHERE diaria_id = NEW.diaria_id
       AND remetente_id = v_emp
       AND destinatario_id = NEW.diarista_id
       AND conteudo = v_msg
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO mensagens (diaria_id, remetente_id, destinatario_id, conteudo)
  VALUES (NEW.diaria_id, v_emp, NEW.diarista_id, v_msg);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_msg_auto_emprego ON candidaturas;
CREATE TRIGGER trg_msg_auto_emprego
  AFTER UPDATE ON candidaturas
  FOR EACH ROW
  EXECUTE FUNCTION injeta_mensagem_automatica_emprego();

SELECT 'Vaga emprego: trigger de mensagem automática instalado.' AS resultado;
