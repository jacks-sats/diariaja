-- ═══════════════════════════════════════════════════════════════════════════
-- FIX v3 (2026-08-05) — "Você não tem permissão" na conclusão do cadastro
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma reportado (Felipe, cadastro anunciante PF): passo final "Confira seus
-- dados" → clica "Criar conta e ganhar +100 XP" → app mostra:
--   "Você não tem permissão para isso. Tente sair e entrar de novo."
-- A retentativa com refreshSession (App.tsx:4209) NÃO resolve → não é sessão
-- stale. É "permission denied for table/column user_profiles" persistente.
--
-- Causa raiz: fix_user_profiles_grant_v2.sql (05/2026) fez `GRANT UPDATE/INSERT`
-- dinamicamente em TODAS as colunas então existentes de user_profiles. Depois
-- foram adicionadas várias colunas novas em migrations posteriores SEM re-executar
-- o grant dinâmico:
--   - niveis_confiabilidade.sql       → telefone_verificado, documento_*
--   - denuncias_auto_suspensao.sql    → oculto, oculto_em, oculto_motivo
--   - fix_user_profiles_created_at.sql → created_at
--   - portfolio_no_banco.sql          → portfolio_urls
--   - mp_token_cripto.sql             → mp_access_token_enc
--   - cadastro_p0_fixes.sql           → pix_chave, pix_tipo, termos_aceitos_em, termos_versao
--   - kyc_documentos.sql              → colunas do KYC
--   - antecedentes_criminais.sql      → antecedentes_*
--   - launch_free_anunciante.sql      → indicações
--   ... e outras.
--
-- Como o `saveProfile` do App.tsx (linha 4157) monta um objeto `full` com
-- TODAS as colunas do perfil (fallback pra profile? ?? "") e faz UPSERT/UPDATE,
-- qualquer coluna sem column-privilege de UPDATE dispara "permission denied for
-- column X" mesmo com o table-privilege presente e a RLS correta.
--
-- Fix: re-executa o grant dinâmico contra o schema CORRENTE. Idempotente e
-- resistente a colunas futuras (o mesmo problema volta a acontecer se
-- adicionarem colunas depois — próxima defesa: gatilho de deployment que
-- re-executa esse GRANT). Segurança inalterada: a RLS
-- ("Usuário atualiza/cria próprio perfil", auth.uid() = id) segue gateando.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Recria as policies de escrita do próprio perfil (idempotente, defensivo).
DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON user_profiles;
CREATE POLICY "Usuário atualiza próprio perfil" ON user_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário cria próprio perfil" ON user_profiles;
CREATE POLICY "Usuário cria próprio perfil" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Privilégio de TABELA (redundante ao column-level abaixo, mas explícito).
GRANT INSERT, UPDATE ON user_profiles TO authenticated;

-- Privilégio de COLUNA em TODAS as colunas atuais — é o que efetivamente
-- destrava o UPSERT/UPDATE quando column-privileges já foram introduzidos
-- (por c2_passob_3 e similares).
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

-- Diagnóstico: quantas colunas cada tipo de privilégio cobre? Deve dar o
-- mesmo total das colunas de user_profiles (~50+) pra INSERT e UPDATE.
SELECT privilege_type, COUNT(*) AS colunas
  FROM information_schema.column_privileges
 WHERE table_name = 'user_profiles' AND grantee = 'authenticated'
 GROUP BY privilege_type ORDER BY privilege_type;

SELECT 'user_profiles grants de coluna restaurados (v3 2026-08-05).' AS resultado;
