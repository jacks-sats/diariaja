-- ═══════════════════════════════════════════════════════════════════════════
-- KYC: Fluxo de envio + revisão de documentos (RG/CNH)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Depende de cadastro_p0_fixes.sql (trigger anti-escalada).
--
-- O que esta migration faz:
-- 1. Ajusta `protect_user_profile_privileged_columns()` pra permitir o user
--    fazer transição `nao_enviado → enviado` (ou `rejeitado → enviado` no
--    reenvio) nos campos `documento_status`, `documento_url`,
--    `documento_enviado_em`. Aprovação/rejeição continua só via admin.
-- 2. Cria RPC `revisar_documento(user_id, decisao, motivo)` com
--    SECURITY DEFINER que valida `is_admin` e atualiza o profile.
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger atualizado: permite user transições de envio próprio
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := current_setting('request.jwt.claim.role', true);

  -- service_role bypassa tudo (Edge Functions + RPC SECURITY DEFINER)
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Colunas administrativas — NUNCA mutáveis pelo cliente
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor';
  END IF;
  IF NEW.plano_ativo IS DISTINCT FROM OLD.plano_ativo THEN
    RAISE EXCEPTION 'plano_ativo só via webhook MP';
  END IF;
  IF NEW.mp_access_token IS DISTINCT FROM OLD.mp_access_token THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth';
  END IF;
  IF NEW.mp_user_id IS DISTINCT FROM OLD.mp_user_id THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth';
  END IF;
  IF NEW.telefone_verificado IS DISTINCT FROM OLD.telefone_verificado THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP';
  END IF;
  IF OLD.termos_aceitos_em IS NOT NULL
     AND NEW.termos_aceitos_em IS DISTINCT FROM OLD.termos_aceitos_em THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável';
  END IF;

  -- documento_status: user pode passar de (nao_enviado | rejeitado) → enviado.
  -- Outras transições (→ aprovado, → rejeitado) só admin via RPC.
  IF NEW.documento_status IS DISTINCT FROM OLD.documento_status THEN
    IF NOT (
      COALESCE(OLD.documento_status, 'nao_enviado') IN ('nao_enviado', 'rejeitado')
      AND NEW.documento_status = 'enviado'
    ) THEN
      RAISE EXCEPTION 'documento_status só pode ser alterado via revisão KYC (admin)';
    END IF;
  END IF;

  -- documento_revisado_em é exclusivo do admin
  IF NEW.documento_revisado_em IS DISTINCT FROM OLD.documento_revisado_em THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC';
  END IF;

  RETURN NEW;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Coluna pra motivo de rejeição (opcional, mostrado pro user)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS documento_motivo_rejeicao TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC pra admin aprovar/rejeitar documento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION revisar_documento(
  p_user_id  UUID,
  p_decisao  TEXT,             -- 'aprovado' ou 'rejeitado'
  p_motivo   TEXT DEFAULT NULL  -- obrigatório se rejeitado
)
RETURNS TABLE (
  user_id           UUID,
  documento_status  TEXT,
  documento_revisado_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só admin executa
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores podem revisar documentos.';
  END IF;

  IF p_decisao NOT IN ('aprovado', 'rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida. Use "aprovado" ou "rejeitado".';
  END IF;

  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR length(trim(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (mínimo 3 caracteres) para o usuário poder reenviar.';
  END IF;

  -- Confere que o user tem um documento enviado
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = p_user_id AND documento_status = 'enviado'
  ) THEN
    RAISE EXCEPTION 'Documento desse usuário não está em análise (status atual ≠ enviado).';
  END IF;

  UPDATE user_profiles
  SET
    documento_status         = p_decisao,
    documento_revisado_em    = NOW(),
    documento_motivo_rejeicao = CASE WHEN p_decisao = 'rejeitado' THEN trim(p_motivo) ELSE NULL END
  WHERE id = p_user_id;

  RETURN QUERY
    SELECT id, user_profiles.documento_status, user_profiles.documento_revisado_em
    FROM user_profiles WHERE id = p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION revisar_documento(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC pra admin listar pendentes (com nome do user pra UI)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_documentos_pendentes()
RETURNS TABLE (
  user_id              UUID,
  nome                 TEXT,
  user_type            TEXT,
  documento_url        TEXT,
  documento_enviado_em TIMESTAMPTZ
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
      up.documento_url,
      up.documento_enviado_em
    FROM user_profiles up
    WHERE up.documento_status = 'enviado'
    ORDER BY up.documento_enviado_em ASC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION admin_documentos_pendentes() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Confirma resultado
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM pg_proc
   WHERE proname IN ('revisar_documento','admin_documentos_pendentes')) AS funcs,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='user_profiles' AND column_name='documento_motivo_rejeicao') AS col_motivo;
-- Esperado: 2 | 1
