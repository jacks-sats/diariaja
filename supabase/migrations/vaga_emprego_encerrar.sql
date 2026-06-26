-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de EMPREGO — Fase 1: status 'encerrada' + candidatura só em vaga 'aberta'
-- ═══════════════════════════════════════════════════════════════════════════
-- A empresa ENCERRA a vaga de emprego quando decidir (≠ cancelar). Status próprio
-- 'encerrada': sai do feed (o feed só mostra 'aberta') e não recebe mais candidato,
-- SEM mandar "cancelado" pros candidatos já chamados. Só pra emprego.
--
-- 1) Recria a constraint de status incluindo 'encerrada' (preserva os atuais,
--    inclusive 'expirada', que o App.tsx já grava em vagas/diárias vencidas).
-- 2) Recria enforce_max_interessados (do max_interessados_trigger.sql) adicionando
--    a checagem de status: candidatura só entra em vaga 'aberta'. Backstop do
--    "encerrada não recebe mais candidato" (o feed já esconde; isto trava de vez).
--
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Constraint de status (atuais + 'expirada' + 'encerrada') ─────────────────
ALTER TABLE diarias DROP CONSTRAINT IF EXISTS diarias_status_check;
ALTER TABLE diarias ADD CONSTRAINT diarias_status_check
  CHECK (status = ANY (ARRAY[
    'aberta',       -- vaga aberta para candidaturas
    'pendente',     -- empregador selecionou, aguardando diarista confirmar (diária)
    'aceita',       -- diarista confirmou presença (diária)
    'em_andamento', -- serviço em execução (diária)
    'concluida',    -- serviço finalizado (diária)
    'cancelada',    -- cancelada por qualquer parte
    'expirada',     -- vaga/diária vencida (App.tsx seta status='expirada') — JÁ EXISTE em prod
    'encerrada'     -- NOVO: vaga de emprego encerrada pela empresa (sai do feed)
  ]));

-- 2. Candidatura só em vaga 'aberta' (recria a função; o trigger BEFORE INSERT
--    trg_max_interessados já existe — CREATE OR REPLACE da função basta) ────────
CREATE OR REPLACE FUNCTION enforce_max_interessados()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendentes INTEGER;
  v_status    TEXT;
  c_teto      CONSTANT INTEGER := 10;   -- == MAX_INTERESSADOS (src/constants.ts)
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Vaga precisa estar ABERTA (encerrada/pendente/cancelada não recebem mais).
  SELECT status INTO v_status FROM diarias WHERE id = NEW.diaria_id;
  IF v_status IS DISTINCT FROM 'aberta' THEN
    RAISE EXCEPTION 'Esta vaga não está mais aberta para candidaturas.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Teto de interessados pendentes (igual ao front: MAX_INTERESSADOS).
  SELECT COUNT(*) INTO v_pendentes
    FROM candidaturas
   WHERE diaria_id = NEW.diaria_id AND status = 'pendente';
  IF v_pendentes >= c_teto THEN
    RAISE EXCEPTION 'Esta vaga já atingiu o limite de interessados. Tente outra vaga.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

SELECT 'Vaga emprego: status encerrada + candidatura só em vaga aberta — instalado.' AS resultado;
