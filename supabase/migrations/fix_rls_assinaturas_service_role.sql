-- ═══════════════════════════════════════════════════════════════════════════
-- FIX SEGURANÇA — RLS de `assinaturas` (CRIT-4 da auditoria)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA
-- A policy criada em `mercadopago_tables.sql:50-51` era:
--   CREATE POLICY "service_role_assinaturas" ON assinaturas
--     FOR ALL USING (true) WITH CHECK (true);
-- Sem o `TO service_role`, ela vale para TODOS os roles — incluindo
-- `authenticated`. Resultado: qualquer usuário logado podia alterar
-- a própria assinatura via REST do Supabase:
--   UPDATE assinaturas SET plano='pro', status='ativo' WHERE user_id=<seu>
-- Bypass total de pagamento.
--
-- CORREÇÃO
-- Trocar por uma policy restrita ao role `service_role` (usado pelas Edge
-- Functions com SERVICE_ROLE_KEY). A policy de SELECT do usuário continua
-- inalterada (cada um vê só a própria assinatura).
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Remove a policy aberta antiga (se existir)
DROP POLICY IF EXISTS "service_role_assinaturas" ON assinaturas;

-- 2. Cria a policy restrita ao service_role
-- service_role bypassa RLS por padrão no Postgres, mas declaramos a policy
-- explicitamente pra ficar claro no schema quem pode escrever.
CREATE POLICY "service_role_gerencia_assinaturas" ON assinaturas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Confirma que a policy de SELECT do dono continua existindo
--    (foi criada em mercadopago_tables.sql:46-47)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'assinaturas'
      AND policyname = 'usuario_ve_propria_assinatura'
  ) THEN
    CREATE POLICY "usuario_ve_propria_assinatura" ON assinaturas
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Reforço: revoga UPDATE/INSERT/DELETE diretos do role authenticated.
-- Isso é defesa em profundidade — mesmo se alguém criasse outra policy
-- aberta no futuro, o GRANT não estaria lá.
REVOKE INSERT, UPDATE, DELETE ON assinaturas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON assinaturas FROM anon;

-- 5. Confirma resultado
SELECT
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'assinaturas'
ORDER BY policyname;
-- Resultado esperado: 2 linhas
--   service_role_gerencia_assinaturas | {service_role} | ALL
--   usuario_ve_propria_assinatura     | {authenticated} | SELECT
