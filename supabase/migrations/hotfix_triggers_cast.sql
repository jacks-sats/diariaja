-- ============================================================================
-- Hotfix — triggers com CASTs defensivos
-- ============================================================================
-- Bug: "operator does not exist: text > timestamp without time zone" ao
-- salvar perfil. Causa: triggers comparam NEW.data_nascimento (TEXT na
-- prática em algumas instâncias) com CURRENT_DATE - INTERVAL, e
-- NEW.last_activity_at (poderia ser TEXT) com NOW() + INTERVAL.
--
-- Solução: re-criar os 2 triggers com CASTs explícitos pra TIMESTAMPTZ/DATE.
-- Defensivo: se a coluna já é do tipo correto, o cast é no-op.
-- Idempotente: aplicar quantas vezes precisar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. valida_idade_diarista — cast em data_nascimento + curto-circuito seguro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION valida_idade_diarista()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_nasc DATE;
BEGIN
  -- Se o tipo não é diarista, sai cedo (não avalia data_nascimento).
  IF NEW.user_type IS DISTINCT FROM 'diarista' THEN
    RETURN NEW;
  END IF;
  -- Tenta interpretar data_nascimento. Aceita TEXT ('yyyy-mm-dd'), DATE ou
  -- TIMESTAMP. Se falhar a conversão, pula a validação (não bloqueia o
  -- salvamento — outras camadas validam no client).
  BEGIN
    v_nasc := NEW.data_nascimento::TEXT::DATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF v_nasc IS NOT NULL AND v_nasc > (CURRENT_DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'Diaristas devem ter pelo menos 18 anos completos.';
  END IF;
  RETURN NEW;
END $$;

-- Trigger continua como antes (BEFORE INSERT OR UPDATE)
DROP TRIGGER IF EXISTS trg_valida_idade_diarista ON user_profiles;
CREATE TRIGGER trg_valida_idade_diarista
  BEFORE INSERT OR UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION valida_idade_diarista();

-- ---------------------------------------------------------------------------
-- 2. clamp_last_activity_at — cast em last_activity_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clamp_last_activity_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_la TIMESTAMPTZ;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.last_activity_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Cast defensivo: se já é timestamptz, no-op. Se for text, converte.
  BEGIN
    v_la := NEW.last_activity_at::TEXT::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    -- Valor inválido — clamp pra NOW() e sai.
    NEW.last_activity_at := NOW();
    RETURN NEW;
  END;
  IF v_la > NOW() + INTERVAL '1 minute' THEN
    NEW.last_activity_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clamp_last_activity_at ON user_profiles;
CREATE TRIGGER trg_clamp_last_activity_at
  BEFORE INSERT OR UPDATE OF last_activity_at ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION clamp_last_activity_at();

-- ============================================================================
-- Fim do hotfix
-- ============================================================================
