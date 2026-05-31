-- ═══════════════════════════════════════════════════════════════════════════
-- CPF/CNPJ único: 1 documento = 1 conta (anti multi-conta / fraude)
-- ═══════════════════════════════════════════════════════════════════════════
-- Bug (teste real): foi possível criar uma conta com o MESMO CPF de outra conta.
-- O UNIQUE INDEX (cadastro_p0_fixes.sql) não estava aplicado em produção.
--
-- ⚠️ PASSO 1 OBRIGATÓRIO — checar duplicados ANTES (o CREATE INDEX falha se houver):
--
--   SELECT cpf, COUNT(*) FROM user_profiles
--    WHERE cpf IS NOT NULL AND length(cpf) > 0
--    GROUP BY cpf HAVING COUNT(*) > 1;
--
--   SELECT cnpj, COUNT(*) FROM user_profiles
--    WHERE cnpj IS NOT NULL AND length(cnpj) > 0
--    GROUP BY cnpj HAVING COUNT(*) > 1;
--
-- Se voltar linhas: escolha a conta que FICA com o documento e ANULE nas outras:
--   UPDATE user_profiles SET cpf = NULL WHERE id = '<id_da_conta_duplicada>';
-- (Ex.: a conta de teste do Jackson — anule o cpf dela e mantenha na conta real.)
--
-- PASSO 2 — depois que as queries acima voltarem 0 linhas, rode este arquivo.
-- Idempotente (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- Aviso prévio no log se ainda houver duplicado (não cria o índice à força).
DO $$
DECLARE dup_cpf INT; dup_cnpj INT;
BEGIN
  SELECT COUNT(*) INTO dup_cpf FROM (
    SELECT cpf FROM user_profiles WHERE cpf IS NOT NULL AND length(cpf) > 0
    GROUP BY cpf HAVING COUNT(*) > 1) t;
  SELECT COUNT(*) INTO dup_cnpj FROM (
    SELECT cnpj FROM user_profiles WHERE cnpj IS NOT NULL AND length(cnpj) > 0
    GROUP BY cnpj HAVING COUNT(*) > 1) t2;
  IF dup_cpf > 0 OR dup_cnpj > 0 THEN
    RAISE EXCEPTION 'Há % CPF(s) e % CNPJ(s) duplicados. Anule os documentos das contas extras antes (veja o comentário no topo).', dup_cpf, dup_cnpj;
  END IF;
END $$;

-- Índices únicos parciais (ignoram NULL e string vazia).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_cpf
  ON user_profiles(cpf)
  WHERE cpf IS NOT NULL AND length(cpf) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_cnpj
  ON user_profiles(cnpj)
  WHERE cnpj IS NOT NULL AND length(cnpj) > 0;

SELECT 'CPF/CNPJ únicos garantidos (1 documento = 1 conta).' AS resultado;
