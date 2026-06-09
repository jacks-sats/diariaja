-- ═══════════════════════════════════════════════════════════════════════════
-- Limite de VAGAS DE EMPREGO por mês (plano grátis: 3/mês; pago: ilimitado)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisão do dono: o anunciante no plano GRÁTIS pode publicar até 3 vagas de
-- emprego (tipo_oferta = 'emprego') por mês. A partir da 4ª, paga avulso para
-- liberar a publicação (mesmo modelo do R$1 por contato). Planos pagos
-- (essencial/plus) = ilimitado. Diária e serviço continuam ilimitados (não
-- entram nesta conta).
--
-- Espelha a infra já existente de `contatos_desbloqueios`:
--   1. Tabela append-only `vagas_emprego_desbloqueios` (1 linha = 1 vaga paga).
--   2. UNIQUE em mp_payment_id pra idempotência (webhook não duplica).
--   3. RLS: cada user lê os próprios; service_role insere via mp-webhook.
--   4. RPC consultiva `pode_postar_vaga_emprego()` (o client decide se abre o
--      modal de pagamento).
--   5. Trigger BEFORE INSERT em `diarias` que enforça o limite no servidor
--      (autoridade real — a checagem do client é só UX).
--
-- Dependências (já existentes): função `plano_ativo_role(uuid, text)`.
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente / re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Tabela de desbloqueios pagos (1 linha = 1 vaga de emprego extra liberada)
CREATE TABLE IF NOT EXISTS vagas_emprego_desbloqueios (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empregador_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mp_payment_id           TEXT,
  mp_external_reference   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência: o mesmo payment_id do MP só pode ser registrado uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vagas_emprego_desbloqueios_payment
  ON vagas_emprego_desbloqueios(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- Hot path: desbloqueios do empregador X no mês corrente.
CREATE INDEX IF NOT EXISTS idx_vagas_emprego_desbloqueios_emp_data
  ON vagas_emprego_desbloqueios(empregador_id, created_at DESC);

-- RLS
ALTER TABLE vagas_emprego_desbloqueios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vagas_emprego_desbloqueios_owner_select ON vagas_emprego_desbloqueios;
CREATE POLICY vagas_emprego_desbloqueios_owner_select ON vagas_emprego_desbloqueios
  FOR SELECT TO authenticated
  USING (empregador_id = auth.uid());

-- Só service_role insere/atualiza/deleta (via Edge Function mp-webhook).
DROP POLICY IF EXISTS vagas_emprego_desbloqueios_service_all ON vagas_emprego_desbloqueios;
CREATE POLICY vagas_emprego_desbloqueios_service_all ON vagas_emprego_desbloqueios
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. RPC consultiva (client decide se abre o modal de pagamento)
CREATE OR REPLACE FUNCTION pode_postar_vaga_emprego()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_plano          TEXT;
  v_postadas_mes   INTEGER;
  v_extras         INTEGER;
  v_limite_gratis  INTEGER := 3;   -- cota grátis de vagas de emprego por mês
  v_limite_efetivo INTEGER;
  v_permitido      BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_plano := plano_ativo_role(v_uid, 'empregador');

  -- Vagas de emprego publicadas neste mês (qualquer status — publicar é o ato
  -- que consome a cota; cancelar/expirar depois não devolve a cota).
  SELECT COUNT(*) INTO v_postadas_mes
    FROM diarias
   WHERE empregador_id = v_uid
     AND tipo_oferta   = 'emprego'
     AND created_at   >= date_trunc('month', NOW());

  SELECT COUNT(*) INTO v_extras
    FROM vagas_emprego_desbloqueios
   WHERE empregador_id = v_uid
     AND created_at   >= date_trunc('month', NOW());

  IF v_plano IN ('essencial', 'plus') THEN
    v_limite_efetivo := 2147483647;  -- "ilimitado" (int max)
  ELSE
    v_limite_efetivo := v_limite_gratis + COALESCE(v_extras, 0);
  END IF;

  v_permitido := v_postadas_mes < v_limite_efetivo;

  RETURN jsonb_build_object(
    'permitido',         v_permitido,
    'plano',             v_plano,
    'postadas_mes',      v_postadas_mes,
    'limite_gratis_mes', v_limite_gratis,
    'extras_pagas',      COALESCE(v_extras, 0),
    'limite_efetivo',    v_limite_efetivo,
    'exige_pagamento',   NOT v_permitido AND v_plano = 'gratis'
  );
END $$;

REVOKE ALL ON FUNCTION pode_postar_vaga_emprego() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_postar_vaga_emprego() TO authenticated;

-- 3. Trigger de enforcement (autoridade no servidor — mesma regra de contagem)
CREATE OR REPLACE FUNCTION enforce_limite_vaga_emprego()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano    TEXT;
  v_postadas INTEGER;
  v_extras   INTEGER;
  v_limite   INTEGER;
BEGIN
  -- service_role (webhook, RPCs SECURITY DEFINER) bypassa.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça VAGA DE EMPREGO. Diária e serviço passam direto.
  IF NEW.tipo_oferta IS DISTINCT FROM 'emprego' THEN
    RETURN NEW;
  END IF;

  -- Plano pago (essencial/plus, por assinatura OU plano avulso 30d) = ilimitado.
  v_plano := plano_ativo_role(NEW.empregador_id, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;
  END IF;

  -- Vagas de emprego JÁ publicadas neste mês (NEW ainda não existe na tabela).
  SELECT COUNT(*) INTO v_postadas
    FROM diarias
   WHERE empregador_id = NEW.empregador_id
     AND tipo_oferta   = 'emprego'
     AND created_at   >= date_trunc('month', NOW());

  -- Desbloqueios pagos neste mês (cada um soma 1 ao limite).
  SELECT COUNT(*) INTO v_extras
    FROM vagas_emprego_desbloqueios
   WHERE empregador_id = NEW.empregador_id
     AND created_at   >= date_trunc('month', NOW());

  v_limite := 3 + COALESCE(v_extras, 0);

  IF v_postadas >= v_limite THEN
    RAISE EXCEPTION 'Limite de vagas de emprego do mês atingido. Pague a publicação avulsa ou assine um plano para publicar ilimitado.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_vaga_emprego ON diarias;
CREATE TRIGGER trg_enforce_limite_vaga_emprego
  BEFORE INSERT ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_vaga_emprego();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar manualmente após aplicar):
--   SELECT pode_postar_vaga_emprego();  -- como anunciante: vê postadas/limite
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'diarias'::regclass
--      AND tgname = 'trg_enforce_limite_vaga_emprego';  -- deve existir
--   -- Como anunciante grátis com 3 vagas de emprego no mês, um INSERT extra de
--   -- tipo_oferta='emprego' deve falhar com 'Limite de vagas de emprego...'.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Limite de vagas de emprego (grátis 3/mês; pago ilimitado) instalado.' AS resultado;
