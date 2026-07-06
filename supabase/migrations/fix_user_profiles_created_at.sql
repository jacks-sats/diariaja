-- ═══════════════════════════════════════════════════════════════════════════
-- HOTFIX — user_profiles sem created_at quebrava a SELEÇÃO de interessado
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma (produção, 06/07/2026): anunciante clica "Selecionar" num interessado
-- e recebe:
--   "Erro ao selecionar interessado: column \"created_at\" does not exist"
--
-- Causa raiz: a tabela `user_profiles` NUNCA teve a coluna `created_at`, mas
-- várias peças SQL a leem. Em especial, o trigger enforce_limite_selecao_candidato
-- (e a RPC pode_selecionar_candidato) checam a PROMO DE BOAS-VINDAS logo no
-- início, ANTES do desvio do grátis-no-lançamento:
--     SELECT created_at INTO v_cadastro_em FROM user_profiles WHERE id = ...;
-- Como a coluna não existe, o UPDATE em `diarias` (que dispara o trigger) estoura
-- com 42703 e o app mostra o erro acima. Independe da flag launch_free_anunciante
-- (o crash acontece antes do RETURN NEW do desvio).
--
-- Fix: cria a coluna e faz backfill com a data REAL de cadastro (auth.users),
-- pra a promo de 30 dias continuar contando o período certo por conta.
--
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Cria a coluna que faltava (idempotente)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- 2) Backfill com a data real de cadastro do usuário (fonte: auth.users)
UPDATE user_profiles up
   SET created_at = au.created_at
  FROM auth.users au
 WHERE au.id = up.id
   AND up.created_at IS NULL;

-- 3) Qualquer perfil sem correspondência em auth.users vira NOW();
--    define default pra novos perfis e trava NOT NULL.
UPDATE user_profiles SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE user_profiles ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE user_profiles ALTER COLUMN created_at SET NOT NULL;

-- Verificação (rodar manualmente após):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'user_profiles' AND column_name = 'created_at';  -- 1 linha
--   -- E a seleção de interessado deve funcionar no app.

SELECT 'user_profiles.created_at criada + backfill de auth.users concluído.' AS resultado;
