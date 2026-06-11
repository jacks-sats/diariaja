-- ═══════════════════════════════════════════════════════════════════════════
-- Cota grátis de CONTATO/SELEÇÃO: volta de 0 → 3 por mês (plano grátis)
-- ═══════════════════════════════════════════════════════════════════════════
-- Decisão do dono: anunciante no plano grátis ganha as 3 PRIMEIRAS seleções
-- de candidato do mês SEM pagar o R$1. Da 4ª em diante (no mês), R$1 por
-- contato — ou assina um plano (essencial/plus = ilimitado).
--
-- Isto REVERTE a migration `cobranca_r1_sempre_contato.sql` (que tinha zerado a
-- cota), voltando ao comportamento original de 3 grátis/mês. O frontend
-- (useLimits.ts) já usa 3 — então isto também REALINHA servidor e app.
--
-- Mantém: crédito interno (no-show 'expirada' NÃO consome a cota) e o
-- enforcement server-side (trigger). Reversível: rode cobranca_r1_sempre_contato
-- de novo pra voltar a 0.
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
    -- Cota grátis = 3/mês. Acima disso, cada contato exige R$1 (+ extras já pagos).
    v_limite_gratis  := 3;
    v_limite_efetivo := 3 + COALESCE(v_extras, 0);
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

  -- Cota grátis = 3/mês. Limite = 3 + os R$1 pagos no mês.
  v_limite := 3 + COALESCE(v_extras, 0);

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

SELECT 'Cota grátis de contato = 3/mês (pago ilimitado) instalada.' AS resultado;
