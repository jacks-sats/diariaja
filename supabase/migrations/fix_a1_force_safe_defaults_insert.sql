-- ═══════════════════════════════════════════════════════════════════════════
-- FIX A1 — Escalada de privilégio via INSERT em user_profiles
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Confirmado na auditoria (2026-05): a policy de INSERT de user_profiles
-- ("Usuário cria próprio perfil") NÃO trava is_admin no WITH CHECK, e o trigger
-- anti-escalada existente (protect_user_profile_privileged_columns) só roda em
-- BEFORE UPDATE. Logo, no PRIMEIRO cadastro um usuário comum pode fazer
--   supabase.from('user_profiles').upsert({ id: <meu uid>, is_admin: true, ... })
-- e virar admin (ou is_suporte, ou se conceder plano/verificação).
--
-- Fix: trigger BEFORE INSERT que FORÇA os campos privilegiados para valores
-- seguros quando o INSERT vem de um usuário comum (não service_role). Não
-- rejeita o cadastro — só neutraliza a escalada, então o signup legítimo
-- (que não envia esses campos) segue funcionando.
--
-- service_role (Edge Functions: verificar-whatsapp, mp-webhook, etc.) bypassa.
-- ADITIVO/idempotente. Complementa o trigger de UPDATE já existente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION force_safe_profile_defaults_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Edge Functions (service_role) têm privilégio total — não mexe.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Usuário comum NÃO pode nascer com privilégio/benefício. Força defaults.
  NEW.is_admin            := false;
  NEW.is_suporte          := false;
  NEW.plano_ativo         := 'gratis';
  NEW.plano_expira_em     := NULL;
  NEW.telefone_verificado := false;
  NEW.mp_access_token     := NULL;
  NEW.mp_user_id          := NULL;
  NEW.documento_status    := 'nao_enviado';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_safe_profile_defaults ON user_profiles;
CREATE TRIGGER trg_force_safe_profile_defaults
  BEFORE INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION force_safe_profile_defaults_on_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT tgname FROM pg_trigger WHERE tgrelid='user_profiles'::regclass
--      AND tgname='trg_force_safe_profile_defaults';   -- 1 linha
--   -- Como usuário comum, tentar inserir is_admin=true → a linha entra com
--   -- is_admin=false (forçado), não como admin.
-- ─────────────────────────────────────────────────────────────────────────────
