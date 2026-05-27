-- ═══════════════════════════════════════════════════════════════════════════
-- Rate Limit Global — proteção anti-abuso pra Edge Functions e endpoints
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mecânica:
--   - Tabela `rate_limits(key, count, window_start)` com 1 linha por chave
--   - RPC `check_rate_limit(key, max, window_seconds)` atômica: tenta
--     incrementar, retorna TRUE se ainda dentro do limite, FALSE se passou.
--   - Janela rolante por chave: quando expira, RESET pra 1.
--
-- Cada Edge Function define sua própria política (ex: "lookup-by-cpf:ip:1.2.3.4"
-- com max=5/60s, "ai-support:user:<uuid>" com max=10/60s).
--
-- Limpeza: o registro fica até a próxima requisição da mesma chave (que
-- reseta). Cron diário opcional pra apagar chaves antigas (job abaixo).
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT        PRIMARY KEY,
  count         INTEGER     NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice pra job de cleanup periódico (apaga chaves não tocadas há >24h)
CREATE INDEX IF NOT EXISTS idx_rate_limits_stale
  ON rate_limits(updated_at)
  WHERE updated_at < NOW() - INTERVAL '24 hours';

-- RPC central de rate-limit. Atômica via UPSERT.
-- Retorna TRUE quando permitido, FALSE quando bloqueado.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key             TEXT,
  p_max             INTEGER,
  p_window_seconds  INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now    TIMESTAMPTZ := NOW();
  v_cutoff TIMESTAMPTZ := v_now - (p_window_seconds || ' seconds')::INTERVAL;
  v_count  INTEGER;
BEGIN
  INSERT INTO rate_limits (key, count, window_start, updated_at)
       VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
     SET count = CASE
                   WHEN rate_limits.window_start < v_cutoff THEN 1
                   ELSE rate_limits.count + 1
                 END,
         window_start = CASE
                   WHEN rate_limits.window_start < v_cutoff THEN v_now
                   ELSE rate_limits.window_start
                 END,
         updated_at = v_now
  RETURNING count INTO v_count;
  RETURN v_count <= p_max;
END $$;

REVOKE ALL ON FUNCTION check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role, authenticated;

-- Cleanup periódico (mantém a tabela pequena no Supabase Free)
CREATE OR REPLACE FUNCTION limpar_rate_limits_antigos()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE updated_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END $$;
REVOKE ALL ON FUNCTION limpar_rate_limits_antigos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION limpar_rate_limits_antigos() TO service_role;

-- Schedule via pg_cron (extensão precisa estar habilitada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'limpar-rate-limits-diario',
      '15 4 * * *',  -- 04:15 UTC = 01:15 BRT
      $cron$SELECT public.limpar_rate_limits_antigos();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Verificação:
--   SELECT check_rate_limit('teste:127.0.0.1', 3, 60); -- TRUE 3x, depois FALSE
