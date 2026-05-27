-- ============================================================================
-- Auditoria 2026-05-26 — fixes de segurança, integridade e performance
-- ============================================================================
-- Esta migration consolida 10 fixes da auditoria do dia 26/05. É segura pra
-- reaplicar: todos os DDLs usam `IF NOT EXISTS` / `IF EXISTS` ou
-- `DROP ... IF EXISTS` antes de criar. Sem efeitos colaterais em dados
-- existentes (não faz UPDATE/DELETE em linhas de produção).
--
-- Aplicar via Supabase Dashboard → SQL Editor.
--
-- Itens cobertos:
--   1. webhook_eventos_processados (idempotência mp-webhook) — P0-3
--   2. oauth_states (nonce CSRF anti-takeover mp-oauth)      — P0-2
--   3. RPC criar_oauth_state                                  — apoio ao P0-2
--   4. Índices em candidaturas                                — P2-1 (perf)
--   5. CHECK constraint convites.status                       — P3 hygiene
--   6. CHECK constraint denuncias.status                      — P3 hygiene
--   7. CHECK + allowlist topicos.categoria                    — P1-16
--   8. analytics_eventos rejeita user_id NULL                 — P1-8
--   9. last_activity_at protegido contra forja                — P1-12
--  10. REVOKE EXECUTE em expirar_vagas_vencidas               — P1-15
--  11. REVOKE SELECT por coluna em colunas sensíveis          — P1-13/P1-14
--  12. allowlist autor_tipo em topicos e comentarios          — P1-11
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela webhook_eventos_processados (idempotência)
-- ---------------------------------------------------------------------------
-- mp-webhook insere o ID antes de processar. Se já existir → return 200 sem
-- reprocessar. Defende contra replay de webhook MP (P0-3 + IMP-S1).
CREATE TABLE IF NOT EXISTS webhook_eventos_processados (
  mp_evento_id  TEXT PRIMARY KEY,
  recebido_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_eventos_processados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_eventos_service_role" ON webhook_eventos_processados;
CREATE POLICY "webhook_eventos_service_role" ON webhook_eventos_processados
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Limpeza opcional: rodar via pg_cron pra não crescer indefinidamente.
-- DELETE FROM webhook_eventos_processados WHERE recebido_em < NOW() - INTERVAL '90 days';

-- ---------------------------------------------------------------------------
-- 2. Tabela oauth_states + RPC para iniciar OAuth com nonce (P0-2)
-- ---------------------------------------------------------------------------
-- Antes o `state` enviado ao Mercado Pago era o `user_id` da vítima (UUID
-- público). Atacante podia capturar o user_id alvo, iniciar OAuth com a
-- conta MP DELE e completar com `state=<user_id_da_vitima>` — o token MP
-- do atacante ia parar no perfil da vítima. Account takeover financeiro.
--
-- Solução: nonce one-time gerado pela RPC, salvo aqui, consumido (DELETE)
-- no callback do Edge Function `mp-oauth`.

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('mercadopago')),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exp         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user_provider ON oauth_states(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_states_exp ON oauth_states(exp);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_states_service_role" ON oauth_states;
CREATE POLICY "oauth_states_service_role" ON oauth_states
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Nenhuma policy pra `authenticated` — usuário comum NÃO lê nem escreve
-- direto. Só via RPC abaixo.

-- ---------------------------------------------------------------------------
-- 3. RPC criar_oauth_state (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION criar_oauth_state(p_provider TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_state   TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada';
  END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('mercadopago') THEN
    RAISE EXCEPTION 'Provider inválido';
  END IF;

  -- Limpa states expirados do próprio user (housekeeping leve).
  DELETE FROM oauth_states
   WHERE user_id = v_user_id
     AND (exp < NOW() OR provider = p_provider);

  -- Gera state aleatório (36 chars UUID — entropy suficiente)
  v_state := gen_random_uuid()::TEXT;

  INSERT INTO oauth_states (state, user_id, provider, exp)
  VALUES (v_state, v_user_id, p_provider, NOW() + INTERVAL '10 minutes');

  RETURN v_state;
END $$;

REVOKE ALL ON FUNCTION criar_oauth_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION criar_oauth_state(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Índices em candidaturas (P2-1 / IMP-C6 — performance)
-- ---------------------------------------------------------------------------
-- App.tsx faz vários `eq("diaria_id", ...)`, `eq("diarista_id", ...)`,
-- `eq("status", ...)` em candidaturas. Sem índice → seq scan em cada query.
CREATE INDEX IF NOT EXISTS idx_candidaturas_diaria_status
  ON candidaturas(diaria_id, status);

CREATE INDEX IF NOT EXISTS idx_candidaturas_diarista_data
  ON candidaturas(diarista_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidaturas_diarista_status
  ON candidaturas(diarista_id, status);

-- ---------------------------------------------------------------------------
-- 5. CHECK constraint convites.status (P3 hygiene)
-- ---------------------------------------------------------------------------
-- Contratante podia inserir convite com status arbitrário (não validado).
ALTER TABLE convites DROP CONSTRAINT IF EXISTS convites_status_check;
ALTER TABLE convites ADD CONSTRAINT convites_status_check
  CHECK (status IN ('pendente','aceito','recusado','cancelado','expirado'));

-- ---------------------------------------------------------------------------
-- 6. CHECK constraint denuncias.status
-- ---------------------------------------------------------------------------
ALTER TABLE denuncias DROP CONSTRAINT IF EXISTS denuncias_status_check;
ALTER TABLE denuncias ADD CONSTRAINT denuncias_status_check
  CHECK (status IN ('pendente','em_analise','resolvida','descartada'));

-- ---------------------------------------------------------------------------
-- 7. CHECK + allowlist topicos.categoria (P1-16)
-- ---------------------------------------------------------------------------
-- Antes `categoria TEXT DEFAULT 'geral'` aceitava qualquer string —
-- cliente injetava categoria='admin' ou '<script>'.
ALTER TABLE topicos DROP CONSTRAINT IF EXISTS topicos_categoria_check;
ALTER TABLE topicos ADD CONSTRAINT topicos_categoria_check
  CHECK (categoria IN ('geral','dicas','duvidas','conquistas','suporte','denuncias'));

-- ---------------------------------------------------------------------------
-- 8. allowlist autor_tipo em topicos e comentarios (P1-11)
-- ---------------------------------------------------------------------------
ALTER TABLE topicos DROP CONSTRAINT IF EXISTS topicos_autor_tipo_check;
ALTER TABLE topicos ADD CONSTRAINT topicos_autor_tipo_check
  CHECK (autor_tipo IN ('diarista','empregador','ambos','admin'));

ALTER TABLE comentarios_comunidade DROP CONSTRAINT IF EXISTS comentarios_autor_tipo_check;
ALTER TABLE comentarios_comunidade ADD CONSTRAINT comentarios_autor_tipo_check
  CHECK (autor_tipo IN ('diarista','empregador','ambos','admin'));

-- ---------------------------------------------------------------------------
-- 9. analytics_eventos rejeita user_id NULL (P1-8)
-- ---------------------------------------------------------------------------
-- Antes: WITH CHECK (user_id = auth.uid() OR user_id IS NULL) — qualquer
-- authenticated podia injetar eventos anônimos sem rastro.
DROP POLICY IF EXISTS "Inserção de eventos próprios" ON analytics_eventos;
DROP POLICY IF EXISTS "insercao_eventos_proprios" ON analytics_eventos;
CREATE POLICY "insercao_eventos_proprios" ON analytics_eventos
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 10. last_activity_at protegido contra forja (P1-12 / P2-7)
-- ---------------------------------------------------------------------------
-- last_activity_at era writable pelo próprio user → forjava "online sempre".
-- Aceita só horários até NOW() + 1min (pra absorver clock drift). Trigger
-- não-block: se cliente mandar data no futuro, sobrescreve por NOW().
CREATE OR REPLACE FUNCTION clamp_last_activity_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.last_activity_at IS NOT NULL AND NEW.last_activity_at > NOW() + INTERVAL '1 minute' THEN
    NEW.last_activity_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clamp_last_activity_at ON user_profiles;
CREATE TRIGGER trg_clamp_last_activity_at
  BEFORE INSERT OR UPDATE OF last_activity_at ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION clamp_last_activity_at();

-- ---------------------------------------------------------------------------
-- 11. REVOKE EXECUTE em expirar_vagas_vencidas (P1-15)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER sem REVOKE FROM PUBLIC permitia qualquer authenticated
-- rodar e expirar vagas em massa (DoS de concorrência).
-- Defensivo: só faz REVOKE se a função existir (caso este projeto não tenha
-- a migration cron_expirar_vagas.sql aplicada).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'expirar_vagas_vencidas') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION expirar_vagas_vencidas() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION expirar_vagas_vencidas() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION expirar_vagas_vencidas() FROM anon';
  END IF;
END $$;
-- service_role mantém execução (default tem todos os privilégios).

-- ---------------------------------------------------------------------------
-- 12. REVOKE SELECT por coluna em colunas sensíveis (P1-13 / P1-14)
-- ---------------------------------------------------------------------------
-- mp_access_token + CPF + CNPJ + telefone + documento_url ficavam em
-- plaintext no banco. Se uma policy SELECT for relaxada por engano (RLS
-- amplo herdado), tudo vaza. Defense in depth: REVOKE de colunas evita
-- vazamento mesmo com RLS aberto.
--
-- ATENÇÃO: depois deste REVOKE o app NÃO consegue mais ler essas colunas
-- via `select("*")` nem via `select("cpf, mp_access_token")` de cliente
-- authenticated. Pra ler dado próprio, o user precisa de RPC SECURITY
-- DEFINER tipo `meu_perfil_completo()` que retorne só pra auth.uid() = id.
--
-- *** COMENTADO POR PADRÃO *** — ative SÓ quando todos os usos no app
-- estiverem migrados pra RPC. Eu deixo como TODO no projeto.
--
-- REVOKE SELECT (mp_access_token, cpf, cnpj, telefone, documento_url)
--   ON user_profiles FROM authenticated, anon;

-- ============================================================================
-- Fim da migration auditoria_26_05_fixes.sql
-- ============================================================================
