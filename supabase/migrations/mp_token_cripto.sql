-- ============================================================================
-- Criptografia em repouso do mp_access_token (token de repasse do prestador)
-- ============================================================================
-- Hoje o mp_access_token fica em TEXTO PURO em user_profiles. Está protegido por
-- REVOKE de coluna (cliente não consegue SELECT), mas um dump do banco o expõe.
-- Esta migration prepara a criptografia usando o SUPABASE VAULT (chave mestra)
-- + pgcrypto (pgp_sym).
--
-- ⚠️  ATENÇÃO — NÃO APLIQUE ISOLADO. Esta é a FASE 1 (aditiva, não quebra nada,
--     mas tampouco confere segurança ainda, porque o texto puro continua lá).
--     A proteção real só existe após a FASE 2 (cutover):
--       (a) Edge Function mp-oauth passa a gravar via mp_token_set()
--       (b) qualquer leitor passa a usar mp_token_get()
--       (c) DROP da coluna mp_access_token (texto puro)
--     A fase 2 mexe em código deployado e PRECISA de teste com token real —
--     por isso deve ser feita como tarefa dedicada, não num "apply e pronto".
--
-- Idempotente. Requer Vault (disponível por padrão no Supabase) + pgcrypto.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Chave mestra no Vault (criada uma única vez; 32 bytes aleatórios)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'mp_token_key') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'mp_token_key',
      'Chave mestra de criptografia do mp_access_token (NUNCA expor)'
    );
  END IF;
END $$;

-- 2) Coluna cifrada (aditiva — convive com o texto puro durante a fase 1)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mp_access_token_enc BYTEA;

-- 3) Helpers (service_role apenas)
CREATE OR REPLACE FUNCTION mp_token_set(p_uid UUID, p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'mp_token_key';
  UPDATE user_profiles
     SET mp_access_token_enc = CASE
           WHEN p_token IS NULL OR p_token = '' THEN NULL
           ELSE extensions.pgp_sym_encrypt(p_token, v_key)
         END
   WHERE id = p_uid;
END $$;

CREATE OR REPLACE FUNCTION mp_token_get(p_uid UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_key TEXT; v_enc BYTEA;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'mp_token_key';
  SELECT mp_access_token_enc INTO v_enc FROM user_profiles WHERE id = p_uid;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(v_enc, v_key);
END $$;

REVOKE ALL ON FUNCTION mp_token_set(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION mp_token_get(UUID)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mp_token_set(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION mp_token_get(UUID)       TO service_role;

-- 4) Trigger: mantém a coluna cifrada em sincronia enquanto o texto puro existir
--    (fase 1). Toda escrita de mp_access_token reflete em mp_access_token_enc.
CREATE OR REPLACE FUNCTION trg_sync_mp_token_enc()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_key TEXT;
BEGIN
  IF NEW.mp_access_token IS DISTINCT FROM OLD.mp_access_token THEN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'mp_token_key';
    NEW.mp_access_token_enc := CASE
      WHEN NEW.mp_access_token IS NULL OR NEW.mp_access_token = '' THEN NULL
      ELSE extensions.pgp_sym_encrypt(NEW.mp_access_token, v_key)
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_mp_token_enc ON user_profiles;
CREATE TRIGGER sync_mp_token_enc
  BEFORE UPDATE OF mp_access_token ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION trg_sync_mp_token_enc();

-- 5) Backfill dos tokens já existentes
DO $$
DECLARE v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'mp_token_key';
  UPDATE user_profiles
     SET mp_access_token_enc = extensions.pgp_sym_encrypt(mp_access_token, v_key)
   WHERE mp_access_token IS NOT NULL AND mp_access_token <> ''
     AND mp_access_token_enc IS NULL;
END $$;

-- ── FASE 2 (cutover — fazer como tarefa dedicada, com teste) ─────────────────
--  a) mp-oauth: trocar UPDATE direto por  SELECT mp_token_set(uid, token);
--  b) leitores do token: trocar  up.mp_access_token  por  mp_token_get(uid);
--  c) depois de validar em produção:
--        ALTER TABLE user_profiles DROP COLUMN mp_access_token;
--        DROP TRIGGER sync_mp_token_enc ON user_profiles;
--        DROP FUNCTION trg_sync_mp_token_enc();
-- ============================================================================
