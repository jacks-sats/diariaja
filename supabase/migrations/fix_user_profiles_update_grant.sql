-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: "permission denied for table user_profiles" ao salvar o perfil
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma (teste real): editar perfil / informar CEP → "Erro ao salvar perfil:
-- permission denied for table user_profiles". Como o CEP/lat/lng não salvavam,
-- o usuário também ficava preso no loop "informe seu CEP".
--
-- Causa: em algum hardening, o privilégio de TABELA INSERT/UPDATE de
-- user_profiles foi revogado do `authenticated` (o c2_passob_3 só mexeu em
-- SELECT, mas o UPDATE/INSERT ficou sem GRANT). A RLS de UPDATE/INSERT existe
-- e está correta (auth.uid() = id), mas sem o GRANT de tabela o Postgres
-- recusa ANTES de avaliar a RLS — daí "permission denied for table".
--
-- Correção: devolve INSERT/UPDATE ao authenticated. A SEGURANÇA continua: a RLS
-- (policies "Usuário cria/atualiza próprio perfil", auth.uid() = id) garante que
-- cada um só mexe no PRÓPRIO perfil. O SELECT continua restrito por coluna
-- (c2_passob_3) — este fix NÃO reabre leitura de PII.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- Garante a RLS ligada (defensivo — não muda nada se já estiver).
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Recria as policies de escrita do próprio perfil (idempotente).
DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON user_profiles;
CREATE POLICY "Usuário atualiza próprio perfil" ON user_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário cria próprio perfil" ON user_profiles;
CREATE POLICY "Usuário cria próprio perfil" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Devolve o privilégio de TABELA (a RLS acima é quem limita ao próprio perfil).
GRANT INSERT, UPDATE ON user_profiles TO authenticated;

SELECT 'Permissão de salvar perfil restaurada (RLS continua: só o próprio).' AS resultado;
