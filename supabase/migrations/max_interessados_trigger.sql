-- ═══════════════════════════════════════════════════════════════════════════
-- Teto de candidatos por vaga: trava server-side (backstop do soft cap do front)
-- ═══════════════════════════════════════════════════════════════════════════
-- Hoje o teto (MAX_INTERESSADOS) é só no front: a vaga some do feed ao atingir N
-- candidaturas pendentes, mas o banco NÃO impede o insert da (N+1)-ésima (ex.:
-- alguém com a vaga ainda carregada, ou chamada direta na API). Risco real é
-- BAIXO e cosmético (a lista do anunciante passar de N), mas esta trava fecha de vez.
--
-- BEFORE INSERT em candidaturas: conta as PENDENTES da vaga e rejeita ao atingir
-- o teto. SECURITY DEFINER é OBRIGATÓRIO: a policy candidaturas_select do PR #252
-- esconde candidaturas de terceiros do candidato — sem DEFINER, o COUNT rodaria
-- como o candidato e veria ~0, não travando nada. Como DEFINER, conta todas.
--
-- ⚠️ O número (10) precisa BATER com src/constants.ts → MAX_INTERESSADOS.
--    Postgres não lê a constante do JS; se mudar lá, mude aqui também.
--
-- Idempotente (CREATE OR REPLACE). Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_max_interessados()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendentes INTEGER;
  c_teto      CONSTANT INTEGER := 10;   -- == MAX_INTERESSADOS (src/constants.ts)
BEGIN
  -- Jobs internos (service_role) não são travados.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Conta as candidaturas PENDENTES da vaga (mesma base do front). SECURITY
  -- DEFINER → enxerga todas, apesar do RLS de SELECT do #252.
  SELECT COUNT(*) INTO v_pendentes
    FROM candidaturas
   WHERE diaria_id = NEW.diaria_id
     AND status = 'pendente';

  IF v_pendentes >= c_teto THEN
    RAISE EXCEPTION 'Esta vaga já atingiu o limite de interessados. Tente outra vaga.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_max_interessados ON candidaturas;
CREATE TRIGGER trg_max_interessados
  BEFORE INSERT ON candidaturas
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_interessados();

-- Nota: sem lock pesado de propósito. Em corrida (2 inserts simultâneos no limite)
-- pode passar 1 a mais — aceitável pra um teto de UX, e o front já evita o caso
-- comum (vaga some do feed). Quem quiser cravar exato usaria SERIALIZABLE/advisory
-- lock, mas é overkill aqui.

SELECT 'Trigger enforce_max_interessados (teto 10 por vaga) instalado.' AS resultado;
