-- Migração: Suporte a login por CPF/CNPJ
-- A edge function `lookup-by-cpf` mapeia CPF → e-mail. Pra essa busca
-- ser rápida E garantir que não há dois usuários com o mesmo CPF,
-- criamos índices únicos parciais (ignorando NULL/vazio).
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Limpa CPF/CNPJ vazios pra evitar conflito com a constraint UNIQUE
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE user_profiles SET cpf  = NULL WHERE cpf  = '' OR cpf  = '   ';
UPDATE user_profiles SET cnpj = NULL WHERE cnpj = '' OR cnpj = '   ';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índice único parcial em CPF (só quando preenchido)
-- ─────────────────────────────────────────────────────────────────────────────
-- Se já houver duplicatas reais, este CREATE vai FALHAR. Nesse caso, rode
-- antes:
--   SELECT cpf, COUNT(*) FROM user_profiles WHERE cpf IS NOT NULL
--   GROUP BY cpf HAVING COUNT(*) > 1;
-- E resolva manualmente (mantém o mais antigo, anula o outro).
DROP INDEX IF EXISTS idx_user_profiles_cpf_unico;
CREATE UNIQUE INDEX idx_user_profiles_cpf_unico
  ON user_profiles (cpf)
  WHERE cpf IS NOT NULL;

DROP INDEX IF EXISTS idx_user_profiles_cnpj_unico;
CREATE UNIQUE INDEX idx_user_profiles_cnpj_unico
  ON user_profiles (cnpj)
  WHERE cnpj IS NOT NULL;

SELECT 'Índices únicos parciais em CPF/CNPJ criados.' AS resultado;
