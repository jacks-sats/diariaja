-- ═══════════════════════════════════════════════════════════════════════════
-- Cobrança R$1 por contato: SEMPRE no plano grátis (cota grátis 3 → 0)
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG (teste real): anunciante selecionou candidato e o chat liberou SEM cobrar
-- o R$1. Causa: a RPC/trigger no banco estão com cota grátis = 3 (as 3 primeiras
-- seleções do mês não cobram). A decisão do dono é: no plano grátis paga R$1
-- CADA contato (cota 0). Plano pago (essencial/plus) = ilimitado.
--
-- Este arquivo (re)cria pode_selecionar_candidato (RPC consultiva) e
-- enforce_limite_selecao_candidato (trigger no servidor) com cota grátis 0.
-- Crédito interno mantido: no-show ('expirada') não conta na cota.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. RPC consultiva (client decide se abre o modal de R$1)
CREATE OR REPLACE FUNCTION pode_selecionar_candidato(
  p_diaria_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_empregador       UUID;
  v_plano            TEXT;
  v_selecoes_mes     INTEGER;
  v_extras           INTEGER;
  v_limite_gratis    INTEGER;
  v_limite_efetivo   INTEGER;
  v_permitido_gratis BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT empregador_id INTO v_empregador
    FROM diarias WHERE id = p_diaria_id;
  IF v_empregador IS NULL THEN
    RAISE EXCEPTION 'Diária não encontrada.';
  END IF;
  IF v_empregador <> v_uid THEN
    RAISE EXCEPTION 'Você não é o empregador desta diária.';
  END IF;

  v_plano := plano_ativo_role(v_uid, 'empregador');

  -- Seleções do mês — NÃO conta no-show (status 'expirada'): crédito interno.
  SELECT COUNT(*) INTO v_selecoes_mes
    FROM diarias
   WHERE empregador_id      = v_uid
     AND diarista_aceite_id IS NOT NULL
     AND status <> 'expirada'
     AND created_at >= date_trunc('month', NOW());

  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = v_uid
     AND created_at >= date_trunc('month', NOW());

  IF v_plano IN ('essencial','plus') THEN
    v_limite_gratis  := 2147483647;  -- "ilimitado" (int max)
    v_limite_efetivo := 2147483647;
  ELSE
    -- Cota grátis = 0. Cada contato no plano grátis exige R$1.
    v_limite_gratis  := 0;
    v_limite_efetivo := 0 + COALESCE(v_extras, 0);
  END IF;

  v_permitido_gratis := v_selecoes_mes < v_limite_efetivo;

  RETURN jsonb_build_object(
    'permitido_gratis',  v_permitido_gratis,
    'plano',             v_plano,
    'selecoes_mes',      v_selecoes_mes,
    'limite_gratis_mes', v_limite_gratis,
    'contatos_extras',   COALESCE(v_extras, 0),
    'limite_efetivo',    v_limite_efetivo,
    'exige_cobranca_r1', NOT v_permitido_gratis AND v_plano = 'gratis'
  );
END $$;

REVOKE ALL ON FUNCTION pode_selecionar_candidato(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_selecionar_candidato(UUID) TO authenticated;

-- 2. Trigger de enforcement (autoridade no servidor — mesma regra de contagem)
CREATE OR REPLACE FUNCTION enforce_limite_selecao_candidato()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano    TEXT;
  v_selecoes INTEGER;
  v_extras   INTEGER;
  v_limite   INTEGER;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça quando diarista_aceite_id é DEFINIDO pela 1ª vez (NULL -> valor).
  IF NEW.diarista_aceite_id IS NULL
     OR OLD.diarista_aceite_id IS NOT NULL
     OR NEW.diarista_aceite_id IS NOT DISTINCT FROM OLD.diarista_aceite_id THEN
    RETURN NEW;
  END IF;

  v_plano := plano_ativo_role(NEW.empregador_id, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;  -- plano pago = ilimitado
  END IF;

  -- Seleções do mês — NÃO conta no-show (status 'expirada'): crédito interno.
  SELECT COUNT(*) INTO v_selecoes
    FROM diarias
   WHERE empregador_id      = NEW.empregador_id
     AND diarista_aceite_id IS NOT NULL
     AND status <> 'expirada'
     AND created_at >= date_trunc('month', NOW());

  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = NEW.empregador_id
     AND created_at >= date_trunc('month', NOW());

  -- Cota grátis = 0. Limite = só os R$1 pagos no mês.
  v_limite := 0 + COALESCE(v_extras, 0);

  IF v_selecoes >= v_limite THEN
    RAISE EXCEPTION 'Pague o desbloqueio (R$1) para liberar o contato, ou assine um plano para contatos ilimitados.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_selecao ON diarias;
CREATE TRIGGER trg_enforce_limite_selecao
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_selecao_candidato();

SELECT 'Cobrança R$1 por contato (cota grátis 0; pago ilimitado) instalada.' AS resultado;
