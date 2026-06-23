-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de emprego: CONTATAR candidato exige plano Essencial (trava no servidor)
-- ═══════════════════════════════════════════════════════════════════════════
-- Regra: para SELECIONAR/contatar um candidato de uma vaga de emprego
-- (tipo_oferta='emprego'), o anunciante precisa de plano Essencial/Plus ativo.
-- NÃO há os 3 grátis/mês nem o avulso de R$ 2,50 (isso é só para DIÁRIA/SERVIÇO).
--
-- Recria as DUAS peças que já controlam o contato, adicionando o ramo de emprego:
--   1. pode_selecionar_candidato(p_diaria_id)  — consultiva (o app decide o modal).
--      Passa a ler tipo_oferta e a devolver o novo campo `exige_plano_vaga`.
--   2. enforce_limite_selecao_candidato()      — trigger BEFORE UPDATE (AUTORIDADE).
--      Bloqueia no servidor o contato de vaga para quem não tem plano — mesmo que
--      alguém chame a API direto com a anon key (não depende do botão no app).
--
-- Diária/serviço: lógica INALTERADA (3 grátis/mês + R$ 2,50 + plano).
-- Idempotente (CREATE OR REPLACE). Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. RPC consultiva ───────────────────────────────────────────────────────────
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
  v_tipo             TEXT;
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

  SELECT empregador_id, tipo_oferta INTO v_empregador, v_tipo
    FROM diarias WHERE id = p_diaria_id;
  IF v_empregador IS NULL THEN
    RAISE EXCEPTION 'Diária não encontrada.';
  END IF;
  IF v_empregador <> v_uid THEN
    RAISE EXCEPTION 'Você não é o empregador desta diária.';
  END IF;

  v_plano := plano_ativo_role(v_uid, 'empregador');

  -- ── VAGA DE EMPREGO: contato só com Essencial/Plus (sem grátis, sem R$ 2,50) ──
  IF v_tipo = 'emprego' THEN
    IF v_plano IN ('essencial', 'plus') THEN
      RETURN jsonb_build_object(
        'permitido_gratis',  true,
        'plano',             v_plano,
        'selecoes_mes',      0,
        'limite_gratis_mes', 2147483647,
        'contatos_extras',   0,
        'limite_efetivo',    2147483647,
        'exige_cobranca_r1', false,
        'exige_plano_vaga',  false
      );
    ELSE
      RETURN jsonb_build_object(
        'permitido_gratis',  false,
        'plano',             v_plano,
        'selecoes_mes',      0,
        'limite_gratis_mes', 0,
        'contatos_extras',   0,
        'limite_efetivo',    0,
        'exige_cobranca_r1', false,
        'exige_plano_vaga',  true   -- app abre o modal "Assine o Essencial"
      );
    END IF;
  END IF;

  -- ── DIÁRIA / SERVIÇO: lógica original (3 grátis/mês + R$ 2,50) ───────────────
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
    'exige_cobranca_r1', NOT v_permitido_gratis AND v_plano = 'gratis',
    'exige_plano_vaga',  false
  );
END $$;

REVOKE ALL ON FUNCTION pode_selecionar_candidato(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_selecionar_candidato(UUID) TO authenticated;

-- 2. Trigger de enforcement (AUTORIDADE no servidor) ──────────────────────────
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
    RETURN NEW;  -- plano pago = libera contato (inclui vaga de emprego)
  END IF;

  -- Chegou aqui = plano GRÁTIS.
  -- VAGA DE EMPREGO: contato exige Essencial. Sem 3 grátis, sem R$ 2,50.
  IF NEW.tipo_oferta = 'emprego' THEN
    RAISE EXCEPTION 'Contatar candidatos de vagas de emprego exige o plano Essencial. Assine para liberar.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- DIÁRIA / SERVIÇO no grátis: 3/mês + extras pagos (R$ 2,50).
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

  v_limite := 3 + COALESCE(v_extras, 0);

  IF v_selecoes >= v_limite THEN
    RAISE EXCEPTION 'Pague o desbloqueio (R$ 2,50) para liberar o contato, ou assine um plano para contatos ilimitados.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_selecao ON diarias;
CREATE TRIGGER trg_enforce_limite_selecao
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_selecao_candidato();

SELECT 'Contato de vaga de emprego agora exige plano Essencial (RPC + trigger).' AS resultado;
