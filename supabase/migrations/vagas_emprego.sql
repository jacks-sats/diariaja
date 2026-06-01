-- ═══════════════════════════════════════════════════════════════════════════
-- Vagas de Emprego — mural de classificados (CNPJ anuncia vaga formal)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Funcionalidade NOVA, separada das diárias. Uma EMPRESA (pessoa jurídica)
-- pode anunciar uma vaga de emprego (CLT/PJ/estágio…) com salário, carga
-- horária, função e benefícios. O candidato demonstra interesse de GRAÇA
-- (reusa o padrão "tenho interesse" das diárias) e a empresa fala direto
-- com ele.
--
-- Modelo legal: MURAL DE CLASSIFICADOS. O DiáriaJá apenas DIVULGA a vaga —
-- NÃO é o empregador, NÃO é agência de emprego, NÃO garante contratação.
-- A relação de trabalho é direto entre a empresa e o candidato.
--
-- Monetização: a EMPRESA paga para publicar (CheckoutPro). O candidato nunca
-- paga. A publicação (status='aberta' + pago_em) só acontece via webhook do
-- pagamento (service_role) — o cliente não consegue auto-publicar de graça.
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabela vagas_emprego
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vagas_emprego (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_empresa       TEXT,                       -- snapshot do nome fantasia/razão social
  segmento           TEXT,
  funcao             TEXT NOT NULL,              -- cargo (ex.: "Operador de Caixa")
  descricao          TEXT,
  tipo_contrato      TEXT NOT NULL DEFAULT 'clt'
    CHECK (tipo_contrato IN ('clt','pj','temporario','estagio','aprendiz')),
  salario            NUMERIC(10,2),              -- salário mensal; NULL se a combinar
  salario_a_combinar BOOLEAN NOT NULL DEFAULT FALSE,
  carga_horaria      TEXT,                       -- texto livre no MVP (ex.: "44h/sem, Seg-Sex")
  beneficios         TEXT,                       -- texto livre (VT, VR, plano de saúde…)
  cidade             TEXT,
  bairro             TEXT,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  status             TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','aberta','fechada','expirada')),
  -- Publicação: só o webhook do pagamento preenche (status='aberta' + pago_em).
  pago_em            TIMESTAMPTZ,
  mp_payment_id      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência do pagamento: 1 payment_id do MP = 1 vaga.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vagas_emprego_payment
  ON vagas_emprego(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- Hot paths: mural (vagas abertas recentes) e "minhas vagas" da empresa.
CREATE INDEX IF NOT EXISTS idx_vagas_emprego_abertas
  ON vagas_emprego(status, created_at DESC)
  WHERE status = 'aberta';
CREATE INDEX IF NOT EXISTS idx_vagas_emprego_empresa
  ON vagas_emprego(empresa_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabela candidaturas_emprego (candidato demonstra interesse — grátis)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidaturas_emprego (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vaga_id        UUID NOT NULL REFERENCES vagas_emprego(id) ON DELETE CASCADE,
  candidato_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'interessado'
    CHECK (status IN ('interessado','visto','descartado')),
  candidato_info JSONB,        -- snapshot { nome, funcao, foto_url, telefone, bio }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 1 candidatura por pessoa por vaga (evita duplo-clique / spam).
  CONSTRAINT uq_candidatura_emprego UNIQUE (vaga_id, candidato_id)
);

CREATE INDEX IF NOT EXISTS idx_cand_emprego_vaga
  ON candidaturas_emprego(vaga_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cand_emprego_candidato
  ON candidaturas_emprego(candidato_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger anti-fraude: só o webhook (service_role) publica/marca como paga.
--    IMPORTANTE: detecta service_role no PostgREST ANTIGO e NOVO — não repete o
--    bug que travava o webhook (request.jwt.claim.role vinha vazio).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION proteger_publicacao_vaga_emprego()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
  v_is_service BOOLEAN := (v_role = 'service_role' OR current_user = 'service_role');
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Cliente nunca cria já publicada/paga; só o webhook publica.
    IF NOT v_is_service THEN
      NEW.pago_em := NULL;
      NEW.mp_payment_id := NULL;
      IF NEW.status = 'aberta' THEN NEW.status := 'rascunho'; END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: cliente não pode se auto-publicar nem forjar o pagamento.
  IF NOT v_is_service THEN
    IF NEW.pago_em IS DISTINCT FROM OLD.pago_em THEN
      RAISE EXCEPTION 'pago_em só via webhook do pagamento';
    END IF;
    IF NEW.mp_payment_id IS DISTINCT FROM OLD.mp_payment_id THEN
      RAISE EXCEPTION 'mp_payment_id só via webhook do pagamento';
    END IF;
    IF NEW.status = 'aberta' AND COALESCE(OLD.status,'') <> 'aberta' THEN
      RAISE EXCEPTION 'publicação da vaga só após pagamento (webhook)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_proteger_publicacao_vaga_emprego ON vagas_emprego;
CREATE TRIGGER trg_proteger_publicacao_vaga_emprego
  BEFORE INSERT OR UPDATE ON vagas_emprego
  FOR EACH ROW EXECUTE FUNCTION proteger_publicacao_vaga_emprego();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — vagas_emprego
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vagas_emprego ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado vê as vagas PUBLICADAS (o mural).
DROP POLICY IF EXISTS vagas_emprego_publicas_select ON vagas_emprego;
CREATE POLICY vagas_emprego_publicas_select ON vagas_emprego
  FOR SELECT TO authenticated
  USING (status = 'aberta');

-- A empresa dona vê as próprias vagas em qualquer status (rascunho incluso).
DROP POLICY IF EXISTS vagas_emprego_owner_select ON vagas_emprego;
CREATE POLICY vagas_emprego_owner_select ON vagas_emprego
  FOR SELECT TO authenticated
  USING (empresa_id = auth.uid());

-- INSERT: só a própria empresa E só se for PESSOA JURÍDICA (CNPJ).
DROP POLICY IF EXISTS vagas_emprego_owner_insert ON vagas_emprego;
CREATE POLICY vagas_emprego_owner_insert ON vagas_emprego
  FOR INSERT TO authenticated
  WITH CHECK (
    empresa_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.pessoa_tipo = 'juridica'
    )
  );

-- UPDATE: a empresa edita/fecha as próprias (o trigger acima impede auto-publicar).
DROP POLICY IF EXISTS vagas_emprego_owner_update ON vagas_emprego;
CREATE POLICY vagas_emprego_owner_update ON vagas_emprego
  FOR UPDATE TO authenticated
  USING (empresa_id = auth.uid())
  WITH CHECK (empresa_id = auth.uid());

-- DELETE: a empresa apaga as próprias.
DROP POLICY IF EXISTS vagas_emprego_owner_delete ON vagas_emprego;
CREATE POLICY vagas_emprego_owner_delete ON vagas_emprego
  FOR DELETE TO authenticated
  USING (empresa_id = auth.uid());

-- service_role (Edge Functions / webhook) tem acesso total.
DROP POLICY IF EXISTS vagas_emprego_service_all ON vagas_emprego;
CREATE POLICY vagas_emprego_service_all ON vagas_emprego
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — candidaturas_emprego
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE candidaturas_emprego ENABLE ROW LEVEL SECURITY;

-- O candidato vê as próprias candidaturas.
DROP POLICY IF EXISTS cand_emprego_self_select ON candidaturas_emprego;
CREATE POLICY cand_emprego_self_select ON candidaturas_emprego
  FOR SELECT TO authenticated
  USING (candidato_id = auth.uid());

-- A empresa vê quem se candidatou às vagas dela.
DROP POLICY IF EXISTS cand_emprego_empresa_select ON candidaturas_emprego;
CREATE POLICY cand_emprego_empresa_select ON candidaturas_emprego
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM vagas_emprego v
    WHERE v.id = candidaturas_emprego.vaga_id AND v.empresa_id = auth.uid()
  ));

-- INSERT: o candidato se candidata (de graça) em vaga ABERTA.
DROP POLICY IF EXISTS cand_emprego_self_insert ON candidaturas_emprego;
CREATE POLICY cand_emprego_self_insert ON candidaturas_emprego
  FOR INSERT TO authenticated
  WITH CHECK (
    candidato_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM vagas_emprego v
      WHERE v.id = candidaturas_emprego.vaga_id AND v.status = 'aberta'
    )
  );

-- UPDATE: a empresa marca como visto/descartado nas vagas dela.
DROP POLICY IF EXISTS cand_emprego_empresa_update ON candidaturas_emprego;
CREATE POLICY cand_emprego_empresa_update ON candidaturas_emprego
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM vagas_emprego v
    WHERE v.id = candidaturas_emprego.vaga_id AND v.empresa_id = auth.uid()
  ));

DROP POLICY IF EXISTS cand_emprego_service_all ON candidaturas_emprego;
CREATE POLICY cand_emprego_service_all ON candidaturas_emprego
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar manualmente):
--   SELECT COUNT(*) FROM vagas_emprego;          -- 0 inicialmente
--   SELECT COUNT(*) FROM candidaturas_emprego;   -- 0 inicialmente
-- ─────────────────────────────────────────────────────────────────────────────
