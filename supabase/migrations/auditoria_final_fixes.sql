-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria Final — RPCs + tabela faltante
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O que esta migration faz:
-- 1. RPC `confirmar_telefone_verificado(telefone)` — usuário pode marcar
--    `telefone_verificado=true` no próprio perfil DEPOIS de validar OTP no
--    Supabase Auth. O trigger anti-escalada bloqueia UPDATE direto.
-- 2. Tabela `score_events` (gamificação) — `delete-user/index.ts` tenta
--    apagar dessa tabela mas ela nunca foi criada. Cria com schema mínimo.
-- 3. RPC `aceitar_termos(versao)` — usuário pode persistir aceite dos termos
--    após primeiro login (signup com confirm email não tem sessão).
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RPC: confirmar telefone verificado (bypass do trigger)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirmar_telefone_verificado(p_telefone TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_phone_confirmed TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  -- Confere se o OTP foi mesmo confirmado no auth.users
  SELECT phone_confirmed_at INTO v_phone_confirmed
  FROM auth.users WHERE id = v_caller;

  IF v_phone_confirmed IS NULL THEN
    RAISE EXCEPTION 'OTP de telefone ainda não foi confirmado no Auth.';
  END IF;

  -- Salva só dígitos no perfil (sem máscara) pra consistência
  UPDATE user_profiles
  SET telefone = regexp_replace(p_telefone, '\D', '', 'g'),
      telefone_verificado = TRUE
  WHERE id = v_caller;
END $$;

GRANT EXECUTE ON FUNCTION confirmar_telefone_verificado(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabela score_events — gamificação (delete-user referencia)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS score_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo        TEXT         NOT NULL,
  pontos      INTEGER      NOT NULL DEFAULT 0,
  descricao   TEXT,
  referencia_id UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_events_user_created
  ON score_events (user_id, created_at DESC);

ALTER TABLE score_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_ve_proprios_scores" ON score_events;
CREATE POLICY "user_ve_proprios_scores" ON score_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "service_role_gerencia_scores" ON score_events;
CREATE POLICY "service_role_gerencia_scores" ON score_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: aceitar termos (após primeiro login, contorna RLS no signup)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aceitar_termos(p_versao TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  -- INSERT do profile se não existir + UPDATE do aceite. Idempotente.
  INSERT INTO user_profiles (id, termos_aceitos_em, termos_versao)
  VALUES (v_caller, NOW(), p_versao)
  ON CONFLICT (id) DO UPDATE
  SET termos_aceitos_em = COALESCE(user_profiles.termos_aceitos_em, NOW()),
      termos_versao     = COALESCE(user_profiles.termos_versao,     p_versao);
END $$;

GRANT EXECUTE ON FUNCTION aceitar_termos(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Confirma resultado
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM pg_proc
   WHERE proname IN ('confirmar_telefone_verificado','aceitar_termos')) AS rpcs_novas,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'score_events') AS tab_score_events;
-- Esperado: 2 | 1
