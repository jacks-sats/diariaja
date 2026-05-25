-- Migração: Portfólio do diarista persistido no banco
-- Antes só vivia em localStorage — trocar de aparelho perdia tudo.
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS portfolio_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Limite duro de 3 fotos como o frontend já enforça
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS portfolio_urls_max3;
ALTER TABLE user_profiles
  ADD CONSTRAINT portfolio_urls_max3 CHECK (array_length(portfolio_urls, 1) IS NULL OR array_length(portfolio_urls, 1) <= 3);

SELECT 'Coluna portfolio_urls em user_profiles instalada.' AS resultado;
