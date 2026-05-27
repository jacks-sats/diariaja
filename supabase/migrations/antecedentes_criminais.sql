-- ═══════════════════════════════════════════════════════════════════════════
-- Antecedentes Criminais — upload de PDF da certidão negativa + revisão admin
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mecânica idêntica ao KYC de RG/CNH (kyc_documentos.sql), em colunas
-- separadas pra que o usuário possa estar Confiável em RG mas pendente em
-- antecedentes (e vice-versa).
--
-- Fluxo:
--   1. User emite gratuitamente no site da Polícia Federal ou estadual.
--   2. Sobe o PDF na tela `verificar-antecedentes`.
--   3. status passa nao_enviado → enviado (permitido pelo trigger).
--   4. Admin revisa em painel próprio → status enviado → aprovado/rejeitado
--      via RPC `revisar_antecedentes(user_id, decisao, motivo)`.
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas em user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS antecedentes_status            TEXT
    CHECK (antecedentes_status IS NULL OR antecedentes_status IN ('nao_enviado','enviado','aprovado','rejeitado')),
  ADD COLUMN IF NOT EXISTS antecedentes_url               TEXT,
  ADD COLUMN IF NOT EXISTS antecedentes_enviado_em        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS antecedentes_revisado_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS antecedentes_motivo_rejeicao   TEXT;

-- Default 'nao_enviado' pra novos registros (evita NULL no client)
ALTER TABLE user_profiles
  ALTER COLUMN antecedentes_status SET DEFAULT 'nao_enviado';

UPDATE user_profiles
   SET antecedentes_status = 'nao_enviado'
 WHERE antecedentes_status IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Estende o trigger anti-escalada pra cobrir antecedentes_*
--    Permite user transicionar (nao_enviado | rejeitado) → enviado, igual KYC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB := to_jsonb(OLD);
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF (v_new->>'is_admin') IS DISTINCT FROM (v_old->>'is_admin') THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor';
  END IF;
  IF (v_new->>'plano_ativo') IS DISTINCT FROM (v_old->>'plano_ativo') THEN
    RAISE EXCEPTION 'plano_ativo só via webhook do Mercado Pago';
  END IF;
  IF (v_new->>'mp_access_token') IS DISTINCT FROM (v_old->>'mp_access_token') THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth';
  END IF;
  IF (v_new->>'mp_user_id') IS DISTINCT FROM (v_old->>'mp_user_id') THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth';
  END IF;
  IF (v_new->>'telefone_verificado') IS DISTINCT FROM (v_old->>'telefone_verificado') THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP confirmado pelo servidor';
  END IF;
  IF (v_old->>'termos_aceitos_em') IS NOT NULL
     AND (v_new->>'termos_aceitos_em') IS DISTINCT FROM (v_old->>'termos_aceitos_em') THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável após o aceite';
  END IF;

  -- documento_status (RG/CNH): user pode (nao_enviado | rejeitado) → enviado
  IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
    IF NOT (
      COALESCE(v_old->>'documento_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
      AND (v_new->>'documento_status') = 'enviado'
    ) THEN
      RAISE EXCEPTION 'documento_status só pode ser alterado via revisão KYC (admin)';
    END IF;
  END IF;
  IF (v_new->>'documento_revisado_em') IS DISTINCT FROM (v_old->>'documento_revisado_em') THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC';
  END IF;

  -- antecedentes_status: mesma regra. User envia → enviado. Admin aprova/rejeita.
  IF (v_new->>'antecedentes_status') IS DISTINCT FROM (v_old->>'antecedentes_status') THEN
    IF NOT (
      COALESCE(v_old->>'antecedentes_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
      AND (v_new->>'antecedentes_status') = 'enviado'
    ) THEN
      RAISE EXCEPTION 'antecedentes_status só pode ser alterado via revisão (admin)';
    END IF;
  END IF;
  IF (v_new->>'antecedentes_revisado_em') IS DISTINCT FROM (v_old->>'antecedentes_revisado_em') THEN
    RAISE EXCEPTION 'antecedentes_revisado_em só via revisão admin';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC pra admin aprovar/rejeitar antecedentes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION revisar_antecedentes(
  p_user_id  UUID,
  p_decisao  TEXT,             -- 'aprovado' ou 'rejeitado'
  p_motivo   TEXT DEFAULT NULL  -- obrigatório se rejeitado
)
RETURNS TABLE (
  user_id                  UUID,
  antecedentes_status      TEXT,
  antecedentes_revisado_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores podem revisar antecedentes.';
  END IF;
  IF p_decisao NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida: use aprovado ou rejeitado.';
  END IF;
  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (mínimo 3 caracteres).';
  END IF;

  UPDATE user_profiles
     SET antecedentes_status            = p_decisao,
         antecedentes_revisado_em       = NOW(),
         antecedentes_motivo_rejeicao   = CASE WHEN p_decisao = 'rejeitado' THEN p_motivo ELSE NULL END
   WHERE id = p_user_id;

  RETURN QUERY
  SELECT up.id, up.antecedentes_status, up.antecedentes_revisado_em
    FROM user_profiles up
   WHERE up.id = p_user_id;
END $$;

REVOKE ALL ON FUNCTION revisar_antecedentes(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revisar_antecedentes(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. RPC pra admin listar pendentes (espelho de admin_documentos_pendentes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_antecedentes_pendentes()
RETURNS TABLE (
  user_id                  UUID,
  nome                     TEXT,
  user_type                TEXT,
  antecedentes_url         TEXT,
  antecedentes_enviado_em  TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;

  RETURN QUERY
    SELECT
      up.id,
      up.nome,
      up.user_type,
      up.antecedentes_url,
      up.antecedentes_enviado_em
    FROM user_profiles up
    WHERE up.antecedentes_status = 'enviado'
    ORDER BY up.antecedentes_enviado_em ASC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION admin_antecedentes_pendentes() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket "antecedentes" (privado) — criar manualmente se ainda
--    não existir. Bucket separado de "documentos" pra simplificar policies e
--    permitir retenção/expurgo independentes (antecedentes têm validade legal
--    de ~90 dias, RG/CNH é permanente).
--
--    Dashboard → Storage → New bucket:
--      name: antecedentes
--      public: NO
--      allowed_mime_types: application/pdf, image/jpeg, image/png, image/webp
--      file_size_limit: 5242880  (5 MB)
--
-- ─────────────────────────────────────────────────────────────────────────────

-- RLS policies do bucket "antecedentes":
-- Caminhos seguem o padrão: <user_id>/<filename>
-- Owner faz INSERT/UPDATE/SELECT/DELETE no próprio prefixo. Admin pode SELECT.

DO $policy_block$
BEGIN
  -- INSERT: usuário sobe arquivo no próprio prefixo
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_insert'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'antecedentes' AND (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  END IF;

  -- SELECT: dono OU admin
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_or_admin_select'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_or_admin_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'antecedentes'
          AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
          )
        )
    $p$;
  END IF;

  -- UPDATE: só o dono (pra trocar metadata, raro)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_update'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_update ON storage.objects
        FOR UPDATE TO authenticated
        USING (bucket_id = 'antecedentes' AND (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  END IF;

  -- DELETE: só o dono (descarte do próprio)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_delete'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'antecedentes' AND (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  END IF;
END
$policy_block$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verificação manual após rodar:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'user_profiles' AND column_name LIKE 'antecedentes%';
--   -- deve retornar 5 colunas.
--
--   SELECT proname FROM pg_proc WHERE proname = 'revisar_antecedentes';
--   -- deve retornar 1 linha.
-- ─────────────────────────────────────────────────────────────────────────────
