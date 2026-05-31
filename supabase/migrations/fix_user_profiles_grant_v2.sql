-- ═══════════════════════════════════════════════════════════════════════════
-- FIX v2: "permission denied for table user_profiles" persistente ao salvar
-- ═══════════════════════════════════════════════════════════════════════════
-- O fix v1 (GRANT INSERT, UPDATE no nível de tabela) não bastou. Causa provável:
-- o hardening (c2_passob_3) mexeu em privilégios de COLUNA — e quando existem
-- grants de coluna, o INSERT/UPDATE exige privilégio em CADA coluna escrita.
-- Um GRANT de tabela não "vence" um cenário com grants de coluna pendentes.
--
-- Este script: (1) garante a RLS de escrita do próprio perfil; (2) dá
-- INSERT/UPDATE no nível de TABELA; (3) dá UPDATE/INSERT em TODAS as colunas
-- explicitamente (cobre o caso column-level). A segurança continua na RLS
-- (auth.uid() = id) — só mexe no próprio perfil. SELECT de PII segue restrito.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS de escrita (idempotente)
DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON user_profiles;
CREATE POLICY "Usuário atualiza próprio perfil" ON user_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário cria próprio perfil" ON user_profiles;
CREATE POLICY "Usuário cria próprio perfil" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Privilégio de TABELA
GRANT INSERT, UPDATE ON user_profiles TO authenticated;

-- Privilégio de COLUNA (UPDATE e INSERT em todas as colunas) — necessário
-- quando já existem grants de coluna no SELECT (c2_passob_3). Gerado dinâmico
-- pra cobrir qualquer coluna atual/futura.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_profiles';
  EXECUTE format('GRANT UPDATE (%s) ON user_profiles TO authenticated', cols);
  EXECUTE format('GRANT INSERT (%s) ON user_profiles TO authenticated', cols);
END $$;

-- Diagnóstico: confirma que INSERT/UPDATE aparecem pro authenticated.
SELECT privilege_type, COUNT(*) AS colunas
  FROM information_schema.column_privileges
 WHERE table_name = 'user_profiles' AND grantee = 'authenticated'
 GROUP BY privilege_type ORDER BY privilege_type;

SELECT 'Permissão de salvar perfil restaurada (tabela + colunas).' AS resultado;
