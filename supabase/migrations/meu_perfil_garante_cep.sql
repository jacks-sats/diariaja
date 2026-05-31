-- ═══════════════════════════════════════════════════════════════════════════
-- Garante que meu_perfil() retorna TODAS as colunas atuais (incl. cep)
-- ═══════════════════════════════════════════════════════════════════════════
-- Contexto do loop "informe seu CEP": o app lê o próprio perfil via meu_perfil()
-- e o gate de roteamento decide a tela por data.cep / data.lat. Se a RPC no banco
-- for uma versão antiga (criada ANTES da coluna `cep` existir), o to_jsonb pode
-- não refletir a coluna nova até a função ser recriada → data.cep vem undefined
-- → o app acha que o CEP nunca foi informado → loop.
--
-- Recriar com to_jsonb(up) garante o snapshot atual de colunas (cep incluso).
-- SECURITY DEFINER + STABLE, idêntico ao original (c2_passob_1). Idempotente.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION meu_perfil()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(up) FROM user_profiles up WHERE up.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION meu_perfil() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meu_perfil() TO authenticated;

-- Verificação (rode logado no app, não aqui — auth.uid() é NULL no SQL Editor):
--   o app deve passar a enxergar data.cep preenchido após salvar.

SELECT 'meu_perfil() recriada (retorna cep/lat/lng atuais).' AS resultado;
