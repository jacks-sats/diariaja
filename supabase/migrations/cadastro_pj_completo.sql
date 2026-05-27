-- ============================================================================
-- Cadastro PJ completo — colunas para Razão Social, Nome Fantasia e Responsável
-- ============================================================================
-- A spec do cadastro PJ pede campos separados que antes ficavam só em
-- `nome_negocio` (string genérica). Adicionamos colunas dedicadas e mantemos
-- `nome_negocio` por compatibilidade (usado em outras telas e legacy data).
--
-- Aplicar via Supabase Dashboard → SQL Editor. Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas em user_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS razao_social      TEXT,
  ADD COLUMN IF NOT EXISTS nome_fantasia     TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_nome  TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_cpf   TEXT;

-- Comentários (documentação inline)
COMMENT ON COLUMN user_profiles.razao_social     IS 'Razão social da empresa (PJ). NULL para PF.';
COMMENT ON COLUMN user_profiles.nome_fantasia    IS 'Nome fantasia / nome público da empresa. NULL para PF.';
COMMENT ON COLUMN user_profiles.responsavel_nome IS 'Nome completo do responsável legal pela conta PJ.';
COMMENT ON COLUMN user_profiles.responsavel_cpf  IS 'CPF do responsável legal pela conta PJ. Privado, não exibido publicamente.';

-- ---------------------------------------------------------------------------
-- 2. Migração leve de dados legacy (best-effort)
-- ---------------------------------------------------------------------------
-- Empresas existentes (pessoa_tipo = 'juridica') que só tinham `nome_negocio`
-- recebem o mesmo valor em `nome_fantasia` por default — `razao_social` fica
-- NULL e o user preenche ao editar perfil. Idempotente (só atualiza onde
-- nome_fantasia ainda é NULL).
UPDATE user_profiles
   SET nome_fantasia = nome_negocio
 WHERE pessoa_tipo = 'juridica'
   AND nome_negocio IS NOT NULL
   AND nome_fantasia IS NULL;

-- ---------------------------------------------------------------------------
-- 3. RPC para checar CNPJ duplicado sem expor user_id (UX pre-submit)
-- ---------------------------------------------------------------------------
-- A UNIQUE constraint em CNPJ (cadastro_p0_fixes.sql) já protege contra
-- duplicatas no INSERT, mas a UI quer feedback ANTES de enviar a senha.
-- Esta RPC só responde sim/não — não vaza dados de outro user.
CREATE OR REPLACE FUNCTION cnpj_ja_cadastrado(p_cnpj TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digitos TEXT := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_existe  BOOLEAN;
BEGIN
  IF length(v_digitos) <> 14 THEN
    RETURN FALSE;  -- formato inválido = trata como "não existe" (a tela valida DV antes)
  END IF;
  -- Compara tanto formato com máscara quanto só dígitos (legacy data).
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE cnpj IS NOT NULL
       AND regexp_replace(cnpj, '\D', '', 'g') = v_digitos
  ) INTO v_existe;
  RETURN v_existe;
END $$;

REVOKE ALL ON FUNCTION cnpj_ja_cadastrado(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cnpj_ja_cadastrado(TEXT) TO anon, authenticated;
-- anon precisa pra checar antes do signup (user ainda não tem JWT)

-- ============================================================================
-- Fim da migration cadastro_pj_completo.sql
-- ============================================================================
