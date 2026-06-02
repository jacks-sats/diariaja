-- Migração: corrige detecção de service_role na trava anti-escalada de
-- user_profiles — RESTAURA o desbloqueio de plano pago (Pix/MP).
-- Data: 2026-06-01
-- Aplicada manualmente em produção (Supabase Dashboard → SQL Editor) e agora
-- salva no repositório pra não se perder num redeploy/restore.
--
-- ── Causa-raiz ───────────────────────────────────────────────────────────────
-- A versão anterior (fix_auditoria_banco_2026-05-28.sql) lia o papel do chamador
-- só pelo path ANTIGO do PostgREST:
--     current_setting('request.jwt.claim.role', true)
-- Nas versões atuais do PostgREST esse setting vem VAZIO — as claims passaram a
-- ficar em `request.jwt.claims` (JSON). Resultado: o webhook do Mercado Pago,
-- que escreve com service_role, NÃO era reconhecido e batia na trava
-- "plano_ativo só via webhook MP" → o plano pago (Pix) NUNCA era liberado.
--
-- ── Conserto ─────────────────────────────────────────────────────────────────
-- v_role agora reconhece o service_role no path ANTIGO e no NOVO (claims JSON),
-- com fallback adicional em current_user. O resto das travas é idêntico ao da
-- migração anterior — só a detecção de papel mudou.
-- Idempotente: CREATE OR REPLACE; pode ser re-rodada sem efeito colateral.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB := to_jsonb(OLD);
  -- FIX: reconhece o service_role no PostgREST ANTIGO (request.jwt.claim.role)
  -- E no NOVO (request.jwt.claims em JSON). Antes só lia o antigo, que vem vazio
  -- nas versões atuais -> nem o webhook do MP passava na trava, então Pix pago
  -- nunca liberava o plano.
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
  v_caller_is_admin BOOLEAN;
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_admin, FALSE) INTO v_caller_is_admin
    FROM user_profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN RETURN NEW; END IF;

  IF (v_new->>'is_admin') IS DISTINCT FROM (v_old->>'is_admin') THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor'; END IF;
  IF (v_new->>'plano_ativo') IS DISTINCT FROM (v_old->>'plano_ativo') THEN
    RAISE EXCEPTION 'plano_ativo só via webhook MP'; END IF;
  IF (v_new->>'mp_access_token') IS DISTINCT FROM (v_old->>'mp_access_token') THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth'; END IF;
  IF (v_new->>'mp_user_id') IS DISTINCT FROM (v_old->>'mp_user_id') THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth'; END IF;
  IF (v_new->>'telefone_verificado') IS DISTINCT FROM (v_old->>'telefone_verificado') THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP'; END IF;
  IF (v_old->>'termos_aceitos_em') IS NOT NULL
     AND (v_new->>'termos_aceitos_em') IS DISTINCT FROM (v_old->>'termos_aceitos_em') THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável'; END IF;

  IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
    IF NOT (COALESCE(v_old->>'documento_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
            AND (v_new->>'documento_status') = 'enviado') THEN
      RAISE EXCEPTION 'documento_status só pode ser alterado via revisão KYC (admin)';
    END IF;
  END IF;
  IF (v_new->>'documento_revisado_em') IS DISTINCT FROM (v_old->>'documento_revisado_em') THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC'; END IF;

  IF (v_new->>'antecedentes_status') IS DISTINCT FROM (v_old->>'antecedentes_status') THEN
    IF NOT (COALESCE(v_old->>'antecedentes_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
            AND (v_new->>'antecedentes_status') = 'enviado') THEN
      RAISE EXCEPTION 'antecedentes_status só via revisão admin';
    END IF;
  END IF;
  IF (v_new->>'antecedentes_revisado_em') IS DISTINCT FROM (v_old->>'antecedentes_revisado_em') THEN
    RAISE EXCEPTION 'antecedentes_revisado_em só via revisão admin'; END IF;

  RETURN NEW;
END $$;

-- Re-vincula o trigger (CREATE OR REPLACE preserva o vínculo, mas é defensivo
-- e idempotente — espelha o padrão das migrações anteriores).
DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

SELECT 'protect_user_profile_privileged_columns: service_role reconhecido (claim antigo + claims novo).' AS resultado;
