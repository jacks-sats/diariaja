-- ═══════════════════════════════════════════════════════════════════════════
-- C2 PASSO B.3 — REVOKE de PII em user_profiles (VERSÃO QUE FUNCIONA)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fecha o vazamento: authenticated/anon deixam de ler colunas sensíveis de
-- user_profiles direto da tabela. Leitura do próprio perfil = meu_perfil();
-- de terceiros = perfis_publicos()/prestadores_publicos() (SECURITY DEFINER,
-- imunes a este REVOKE).
--
-- ⚠️ LIÇÃO IMPORTANTE (por que a 1ª tentativa falhou):
--   Um `REVOKE SELECT (coluna) ... FROM authenticated` NÃO BASTA quando existe
--   um GRANT de SELECT no NÍVEL DA TABELA (que cobre todas as colunas). O grant
--   de tabela continua valendo e o vazamento permanece. É preciso REVOGAR o
--   SELECT da tabela inteira e DEVOLVER SELECT só nas colunas não-sensíveis.
--
-- Aplicar SOMENTE após o cliente já estar usando as RPCs em produção
-- (passo B.2 deployado), senão o cliente antigo (select('*')) quebra.
-- Idempotente. Rollback: GRANT SELECT ON user_profiles TO authenticated, anon;
-- ═══════════════════════════════════════════════════════════════════════════

-- 0) Remove a RPC de contato (descontinuada — o pagamento é combinado no chat,
--    o app não revela mais telefone/PIX/CPF do prestador).
DROP FUNCTION IF EXISTS contato_prestador(UUID);

-- 1) Remove o SELECT amplo (nível tabela) que cobria TODAS as colunas.
REVOKE SELECT ON user_profiles FROM authenticated, anon;

-- 2) Devolve SELECT só nas colunas NÃO-sensíveis (gerado dinamicamente — as 12
--    sensíveis ficam de fora). Resiliente a colunas que venham a ser adicionadas.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_profiles'
     AND column_name NOT IN (
       'telefone','cpf','cnpj','responsavel_cpf','mp_access_token','mp_user_id',
       'pix_chave','pix_tipo','documento_url','antecedentes_url',
       'data_nascimento','sexo'
     );
  EXECUTE format('GRANT SELECT (%s) ON user_profiles TO authenticated, anon', cols);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar após):
--   -- Seguras liberadas, sensíveis trancadas:
--   SELECT column_name, string_agg(DISTINCT grantee, ',') AS quem_le
--     FROM information_schema.column_privileges
--    WHERE table_name='user_profiles' AND privilege_type='SELECT'
--      AND grantee IN ('authenticated','anon')
--      AND column_name IN ('id','user_type','nome','foto_url','telefone','cpf','pix_chave')
--    GROUP BY column_name ORDER BY column_name;
--   -- Esperado: id/user_type/nome/foto_url presentes; telefone/cpf/pix_chave ausentes.
-- ─────────────────────────────────────────────────────────────────────────────
