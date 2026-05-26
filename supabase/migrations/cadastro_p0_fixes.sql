-- ═══════════════════════════════════════════════════════════════════════════
-- Cadastro P0 Fixes — 6 mudanças no schema + RLS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Resolve P0s da auditoria de cadastro (AUDITORIA_CADASTRO.md):
--   1. P0-1: trigger anti-escalada de privilégio em user_profiles
--   2. P0-2: UNIQUE em cpf/cnpj (impede multi-conta com mesmo doc)
--   3. P0-4: trigger de idade mínima 18 anos para diarista
--   4. P0-6: coluna pix_chave + pix_tipo para diarista receber pagamento
--   5. P0-?: coluna termos_aceitos_em + termos_versao (audit trail LGPD)
--   6. RLS de UPDATE em user_profiles explícita (defesa em profundidade)
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NOVAS COLUNAS em user_profiles
-- ─────────────────────────────────────────────────────────────────────────────

-- PIX do diarista pra receber pagamentos da plataforma
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS pix_chave TEXT,
  ADD COLUMN IF NOT EXISTS pix_tipo  TEXT
    CHECK (pix_tipo IS NULL OR pix_tipo IN ('cpf','cnpj','email','telefone','aleatoria'));

-- Audit trail de aceite dos Termos (LGPD — prova de consentimento server-side)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS termos_aceitos_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS termos_versao     TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. P0-1: Trigger anti-escalada de privilégio
--    Bloqueia user comum de alterar colunas privilegiadas via REST.
--    Só service_role pode mudar essas colunas (webhook MP, OAuth callback,
--    revisão KYC, OTP de telefone, heartbeat).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- service_role bypassa (tem privilégio total — usado pelas Edge Functions)
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor (não pode ser alterado pelo cliente)';
  END IF;
  IF NEW.plano_ativo IS DISTINCT FROM OLD.plano_ativo THEN
    RAISE EXCEPTION 'plano_ativo só pode ser alterado via webhook do Mercado Pago';
  END IF;
  IF NEW.mp_access_token IS DISTINCT FROM OLD.mp_access_token THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth';
  END IF;
  IF NEW.mp_user_id IS DISTINCT FROM OLD.mp_user_id THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth';
  END IF;
  IF NEW.documento_status IS DISTINCT FROM OLD.documento_status THEN
    RAISE EXCEPTION 'documento_status só via revisão KYC do admin';
  END IF;
  IF NEW.documento_revisado_em IS DISTINCT FROM OLD.documento_revisado_em THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC';
  END IF;
  IF NEW.telefone_verificado IS DISTINCT FROM OLD.telefone_verificado THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP confirmado pelo servidor';
  END IF;
  -- termos_aceitos_em / termos_versao podem ser setadas pelo próprio user no signup
  -- mas não pode VOLTAR atrás (proteção contra repúdio).
  IF OLD.termos_aceitos_em IS NOT NULL
     AND NEW.termos_aceitos_em IS DISTINCT FROM OLD.termos_aceitos_em THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável após o aceite';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. P0-4: Idade mínima 18 anos para diarista (server-side enforcement)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION valida_idade_diarista()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_type = 'diarista'
     AND NEW.data_nascimento IS NOT NULL
     AND NEW.data_nascimento > (CURRENT_DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'Diaristas devem ter pelo menos 18 anos completos.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_valida_idade_diarista ON user_profiles;
CREATE TRIGGER trg_valida_idade_diarista
  BEFORE INSERT OR UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION valida_idade_diarista();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. P0-2: UNIQUE em CPF/CNPJ (parciais — ignora NULL e string vazia)
--
-- ⚠️ ATENÇÃO: se já existirem duplicados, o CREATE INDEX abaixo VAI FALHAR.
-- Antes de aplicar, rode pra diagnosticar:
--
--   SELECT cpf, COUNT(*) FROM user_profiles
--   WHERE cpf IS NOT NULL AND length(cpf) > 0
--   GROUP BY cpf HAVING COUNT(*) > 1;
--
--   SELECT cnpj, COUNT(*) FROM user_profiles
--   WHERE cnpj IS NOT NULL AND length(cnpj) > 0
--   GROUP BY cnpj HAVING COUNT(*) > 1;
--
-- Se voltar 0 linhas → pode aplicar. Se voltar duplicados → resolva
-- manualmente (mantenha o mais antigo, anule cpf/cnpj nos outros) antes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Aviso prévio se houver duplicados (não bloqueia, mas avisa no log)
DO $$
DECLARE dup_cpf INT;
        dup_cnpj INT;
BEGIN
  SELECT COUNT(*) INTO dup_cpf FROM (
    SELECT cpf FROM user_profiles
    WHERE cpf IS NOT NULL AND length(cpf) > 0
    GROUP BY cpf HAVING COUNT(*) > 1
  ) t;
  SELECT COUNT(*) INTO dup_cnpj FROM (
    SELECT cnpj FROM user_profiles
    WHERE cnpj IS NOT NULL AND length(cnpj) > 0
    GROUP BY cnpj HAVING COUNT(*) > 1
  ) t2;
  IF dup_cpf > 0 OR dup_cnpj > 0 THEN
    RAISE NOTICE '⚠️ Detectados % CPFs e % CNPJs duplicados — UNIQUE INDEX vai falhar. Resolva antes.', dup_cpf, dup_cnpj;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_cpf
  ON user_profiles(cpf)
  WHERE cpf IS NOT NULL AND length(cpf) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_cnpj
  ON user_profiles(cnpj)
  WHERE cnpj IS NOT NULL AND length(cnpj) > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Storage: bucket privado pra documentos (RG/CNH) — manual no Dashboard
--
-- O bucket `documentos` precisa ser CRIADO MANUALMENTE no Supabase Dashboard:
--   Storage → Create new bucket → Name: documentos → Public: OFF (privado)
--   Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf
--   File size limit: 5 MB
--
-- E configure essas policies de storage:
--   - User pode INSERT no próprio path (auth.uid()/qualquercoisa.ext)
--   - User pode SELECT no próprio path
--   - Admin (is_admin=true) pode SELECT em qualquer path
--   - Ninguém pode DELETE (auditoria) — só service_role
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Confirma resultado
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='user_profiles'
     AND column_name IN ('pix_chave','pix_tipo','termos_aceitos_em','termos_versao')) AS colunas_novas,
  (SELECT COUNT(*) FROM pg_trigger
   WHERE tgname IN ('trg_protect_user_profile_privileged','trg_valida_idade_diarista')) AS triggers,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE indexname IN ('uq_user_profiles_cpf','uq_user_profiles_cnpj')) AS indices_unique;
-- Resultado esperado: 4 | 2 | 2
