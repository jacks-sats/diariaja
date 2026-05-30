-- ═══════════════════════════════════════════════════════════════════════════
-- FIX C3 — Plano avulso de 30 dias (Pix/cartão) não liberava nada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bug (auditoria 2026-05-29): a tela de planos compra via create-plano-payment
-- (CheckoutPro avulso, aceita Pix). O webhook grava o plano em
-- `user_profiles.plano_ativo` + `plano_expira_em`, mas NUNCA em `assinaturas`.
-- Como `plano_ativo_role()` (usada por `pode_selecionar_candidato`) só olhava
-- `assinaturas`, o anunciante que pagou via Pix continuava sendo cobrado R$1
-- por seleção — pagou e não recebeu.
--
-- Fix: `plano_ativo_role()` passa a considerar TAMBÉM o plano avulso do perfil
-- (não vencido), pegando o MELHOR entre as duas fontes. Self-enforce do
-- vencimento via `plano_expira_em > NOW()`.
--
-- ADITIVO e idempotente: só faz CREATE OR REPLACE da função. Não destrói dados,
-- não muda schema. Seguro aplicar a qualquer momento (inclusive antes do deploy
-- do frontend — o pior caso é continuar como hoje até o front subir).
--
-- NOTA: `user_profiles.plano_ativo` é role-agnostic (não guarda se era plano de
-- diarista ou empregador). Aplica-se ao papel consultado. Para usuário 'ambos'
-- que comprou só um papel, isso pode liberar os dois — caso raro e aceitável
-- (melhor que cobrar por algo já pago). Endereçar isso de forma estrita exigiria
-- gravar o papel no fluxo de compra (create-plano-payment + webhook).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION plano_ativo_role(
  p_user_id UUID,
  p_role    TEXT  -- 'diarista' | 'empregador'
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assinatura TEXT;
  v_perfil     TEXT;
  v_expira     TIMESTAMPTZ;
  v_peso       INT;
BEGIN
  IF p_role NOT IN ('diarista','empregador') THEN
    RAISE EXCEPTION 'Papel inválido: use diarista ou empregador.';
  END IF;

  -- Fonte 1: assinatura recorrente ativa do papel
  SELECT plano INTO v_assinatura
    FROM assinaturas
   WHERE user_id   = p_user_id
     AND user_type = p_role
     AND status    = 'ativo'
   LIMIT 1;
  v_assinatura := COALESCE(v_assinatura, 'gratis');
  IF v_assinatura IN ('pro','destaque') THEN v_assinatura := 'plus'; END IF;

  -- Fonte 2: plano avulso de 30 dias (user_profiles), se não vencido
  SELECT plano_ativo, plano_expira_em INTO v_perfil, v_expira
    FROM user_profiles
   WHERE id = p_user_id;
  IF v_perfil IS NULL
     OR v_perfil = 'gratis'
     OR (v_expira IS NOT NULL AND v_expira <= NOW()) THEN
    v_perfil := 'gratis';
  ELSIF v_perfil IN ('pro','destaque') THEN
    v_perfil := 'plus';
  END IF;

  -- Retorna o MELHOR entre as duas fontes (plus > essencial > gratis)
  v_peso := GREATEST(
    CASE v_assinatura WHEN 'plus' THEN 2 WHEN 'essencial' THEN 1 ELSE 0 END,
    CASE v_perfil     WHEN 'plus' THEN 2 WHEN 'essencial' THEN 1 ELSE 0 END
  );
  RETURN CASE v_peso WHEN 2 THEN 'plus' WHEN 1 THEN 'essencial' ELSE 'gratis' END;
END $$;

REVOKE ALL ON FUNCTION plano_ativo_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plano_ativo_role(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar manualmente após aplicar):
--   -- Para um usuário que pagou plano avulso (tem plano_ativo<>'gratis' e
--   -- plano_expira_em no futuro), deve retornar o plano, não 'gratis':
--   SELECT plano_ativo_role('<USER_ID>', 'empregador');
--   -- E pode_selecionar_candidato deve trazer exige_cobranca_r1 = false:
--   -- (rodar como o próprio usuário / via app)
-- ─────────────────────────────────────────────────────────────────────────────
