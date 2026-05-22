-- Migração: Pagamento Mercado Pago Split
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

-- Colunas na tabela diarias
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS pagamento_status  TEXT    DEFAULT 'aguardando',
  ADD COLUMN IF NOT EXISTS pagamento_mp_id   TEXT,
  ADD COLUMN IF NOT EXISTS taxa_plataforma   NUMERIC,
  ADD COLUMN IF NOT EXISTS valor_diarista    NUMERIC;

-- Colunas no perfil do diarista (para conectar conta MP)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS mp_user_id      TEXT,
  ADD COLUMN IF NOT EXISTS mp_access_token TEXT;

-- Índice para busca por preference ID
CREATE INDEX IF NOT EXISTS idx_diarias_mp_id ON diarias(pagamento_mp_id);

-- RLS: diarista só vê o próprio mp_access_token, nunca de outro usuário
-- (se já tiver RLS habilitada, adicione esta policy)
-- CREATE POLICY "users_own_mp_token" ON user_profiles
--   USING (auth.uid() = id);

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('diarias', 'user_profiles')
  AND column_name IN ('pagamento_status','pagamento_mp_id','taxa_plataforma','valor_diarista','mp_user_id','mp_access_token')
ORDER BY table_name, column_name;
