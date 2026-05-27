-- ═══════════════════════════════════════════════════════════════════════════
-- HOTFIX — Trigger anti-escalada falhando com "record 'new' has no field X"
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma: salvar perfil retorna
--   "Erro ao salvar perfil: record 'new' has no field 'telefone_verificado'"
-- (ou 'is_admin', 'plano_ativo', 'mp_access_token', 'mp_user_id',
--  'documento_status', 'documento_revisado_em', 'documento_motivo_rejeicao').
--
-- Causa: o trigger `protect_user_profile_privileged_columns` (criado em
-- cadastro_p0_fixes.sql) referencia 7 colunas. Se QUALQUER uma faltar na
-- tabela user_profiles, o trigger crasha em TODO UPDATE — bloqueia o app
-- inteiro.
--
-- Fix duplo:
--   1. Garante as 7 colunas existem (idempotente, ADD COLUMN IF NOT EXISTS).
--   2. Re-cria o trigger usando to_jsonb(NEW)/to_jsonb(OLD) — assim,
--      mesmo que uma coluna seja dropada no futuro, o trigger não crasha,
--      apenas pula silenciosamente aquele check (defesa em profundidade).
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Garante todas as 7 colunas que o trigger referencia
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_admin              BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS plano_ativo           TEXT        NOT NULL DEFAULT 'gratis',
  ADD COLUMN IF NOT EXISTS mp_access_token       TEXT,
  ADD COLUMN IF NOT EXISTS mp_user_id            TEXT,
  ADD COLUMN IF NOT EXISTS telefone_verificado   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS documento_status      TEXT
    CHECK (documento_status IS NULL OR documento_status IN ('nao_enviado','enviado','aprovado','rejeitado')),
  ADD COLUMN IF NOT EXISTS documento_revisado_em TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-cria o trigger usando JSONB pra ser resiliente a colunas faltantes
--    (não crasha se a coluna sumir; só pula o check daquele campo).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB := to_jsonb(OLD);
BEGIN
  -- service_role bypassa (Edge Functions têm privilégio total)
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF (v_new->>'is_admin') IS DISTINCT FROM (v_old->>'is_admin') THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor (não pode ser alterado pelo cliente)';
  END IF;
  IF (v_new->>'plano_ativo') IS DISTINCT FROM (v_old->>'plano_ativo') THEN
    RAISE EXCEPTION 'plano_ativo só pode ser alterado via webhook do Mercado Pago';
  END IF;
  IF (v_new->>'mp_access_token') IS DISTINCT FROM (v_old->>'mp_access_token') THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth';
  END IF;
  IF (v_new->>'mp_user_id') IS DISTINCT FROM (v_old->>'mp_user_id') THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth';
  END IF;
  IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
    RAISE EXCEPTION 'documento_status só via revisão KYC do admin';
  END IF;
  IF (v_new->>'documento_revisado_em') IS DISTINCT FROM (v_old->>'documento_revisado_em') THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC';
  END IF;
  IF (v_new->>'telefone_verificado') IS DISTINCT FROM (v_old->>'telefone_verificado') THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP confirmado pelo servidor';
  END IF;
  -- termos_aceitos_em: imutável após aceite (audit trail LGPD).
  IF (v_old->>'termos_aceitos_em') IS NOT NULL
     AND (v_new->>'termos_aceitos_em') IS DISTINCT FROM (v_old->>'termos_aceitos_em') THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável após o aceite';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação rápida (rodar manualmente após):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='user_profiles'
--      AND column_name IN ('is_admin','plano_ativo','mp_access_token',
--          'mp_user_id','telefone_verificado','documento_status',
--          'documento_revisado_em');
--   -- Deve retornar TODAS as 7.
-- ─────────────────────────────────────────────────────────────────────────────
