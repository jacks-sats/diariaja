-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de EMPREGO — Fase 1: gate Essencial movido p/ a tabela `candidaturas`
-- ═══════════════════════════════════════════════════════════════════════════
-- Antes, contatar candidato de vaga de emprego era travado no trigger de `diarias`
-- (enforce_limite_selecao_candidato), que dispara quando diarista_aceite_id vai de
-- NULL→valor. Como o emprego agora CHAMA VÁRIOS sem setar diarista_aceite_id, aquele
-- trigger não dispara mais p/ emprego — então a autoridade migra p/ cá.
--
-- Regra: ao "chamar" (candidaturas.status → 'selecionado') numa vaga de EMPREGO,
-- a empresa precisa de Essencial/Plus. COM plano, é ILIMITADO (1ª chamada exige
-- plano; com plano, todas as seguintes passam). Diária/serviço NÃO são afetados
-- (seguem pelo trigger de `diarias`, INALTERADO — não enfraquece a diária).
--
-- SECURITY DEFINER (lê diarias/plano). Idempotente. Aplicar no SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_plano_chamar_emprego()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo  TEXT;
  v_emp   UUID;
  v_plano TEXT;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só quando a candidatura ENTRA em 'selecionado' (a empresa "chama") — não em
  -- re-updates nem em 'confirmado'/'rejeitado'.
  IF NEW.status <> 'selecionado'
     OR OLD.status = 'selecionado'
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT tipo_oferta, empregador_id INTO v_tipo, v_emp
    FROM diarias WHERE id = NEW.diaria_id;

  -- SÓ emprego é gated aqui. Diária/serviço passam direto (a trava deles é o
  -- trigger de `diarias`, que continua valendo).
  IF v_tipo IS DISTINCT FROM 'emprego' THEN
    RETURN NEW;
  END IF;

  v_plano := plano_ativo_role(v_emp, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;   -- com plano = chamar ILIMITADO
  END IF;

  RAISE EXCEPTION 'Contatar candidatos de vagas de emprego exige o plano Essencial. Assine para liberar.'
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS trg_enforce_plano_chamar_emprego ON candidaturas;
CREATE TRIGGER trg_enforce_plano_chamar_emprego
  BEFORE UPDATE ON candidaturas
  FOR EACH ROW
  EXECUTE FUNCTION enforce_plano_chamar_emprego();

SELECT 'Vaga emprego: gate Essencial no chamar (candidaturas) — instalado.' AS resultado;
