-- ═══════════════════════════════════════════════════════════════════════════
-- Crédito interno: no-show NÃO consome a cota de seleção do mês
-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicar manualmente: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- Aplicar DEPOIS de: monetizacao_dual_track.sql, fix_c3_plano_avulso_no_gate.sql,
-- fix_c1_enforce_selecao_candidato.sql e da Fase A (que cria o no-show:
-- 'aceita' sem check-in que expira → 'expirada').
--
-- DECISÃO (crédito interno, escolhido pelo dono):
--   Quando uma seleção NÃO vira diária de verdade, o anunciante não deve
--   "perder" a vaga grátis daquele mês. Em vez de estornar dinheiro, devolvemos
--   a COTA: a seleção liberada pode ser usada em outra diária, sem pagar de novo.
--
-- Como já funciona hoje:
--   • Desistência do prestador (`desistirDiaria`): limpa `diarista_aceite_id`
--     → a diária deixa de contar na cota automaticamente. ✅ (já era crédito)
--
-- O que esta migração corrige:
--   • No-show: a diária expira mas MANTÉM `diarista_aceite_id` (necessário para
--     o feedback de no-show da Fase A.5). Hoje ela continua ocupando 1 das 3
--     seleções grátis do mês. Passamos a EXCLUIR `status = 'expirada'` da
--     contagem → a cota volta sozinha.
--
-- O momento da cobrança (na seleção, status 'pendente') é preservado: seleções
-- ativas (pendente/aceita/em_andamento/concluida) e canceladas continuam
-- contando — só o no-show expirado deixa de contar.
--
-- ⚠️ Tradeoff conhecido: um no-show DEPOIS da confirmação (chat já abriu) também
--    é creditado. É pró-anunciante (não recebeu o serviço) e exige um prestador
--    cúmplice para virar abuso — risco baixo, e o no-show fica registrado no
--    feedback obrigatório (Fase A.5).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RPC consultiva (client decide se abre o modal de R$1)
-- ─────────────────────────────────────────────────────────────────────────────
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
    v_limite_gratis  := 2147483647;
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
    'exige_cobranca_r1', NOT v_permitido_gratis AND v_plano = 'gratis'
  );
END $$;

REVOKE ALL ON FUNCTION pode_selecionar_candidato(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_selecionar_candidato(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger de enforcement (autoridade no servidor — mesma regra de contagem)
-- ─────────────────────────────────────────────────────────────────────────────
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
    RETURN NEW;
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

  v_limite := 3 + COALESCE(v_extras, 0);

  IF v_selecoes >= v_limite THEN
    RAISE EXCEPTION 'Limite de seleções do mês atingido. Pague o desbloqueio (R$1) ou assine um plano para selecionar mais.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_selecao ON diarias;
CREATE TRIGGER trg_enforce_limite_selecao
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_selecao_candidato();

SELECT 'Crédito interno (no-show não consome cota) instalado.' AS resultado;
