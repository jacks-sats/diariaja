-- ============================================================================
-- Modo Beta — lançamento controlado
-- ============================================================================
-- Enquanto LIGADO, quem NÃO é tester (acesso_total) nem admin:
--   • PODE: cadastrar, completar perfil/KYC, navegar, CRIAR VAGA, CANDIDATAR-SE
--           e VER os candidatos/interessados.
--   • NÃO PODE (abre no lançamento): SELECIONAR candidato e ENVIAR CONVITE
--           (a "conexão" real). O chat depende disso, então fica travado sozinho.
-- Os usuários de HOJE viram testers (backfill). Quem entrar depois nasce gated.
--
-- LANÇAR (abrir pra todo mundo), quando chegar a hora:
--   UPDATE app_config SET valor = 'false' WHERE chave = 'modo_beta';
--
-- LIBERAR um usuário específico como tester depois:
--   UPDATE user_profiles SET acesso_total = true WHERE id = '<uuid>';
--   (ou pelo painel admin, se adicionarmos o botão)
--
-- Idempotente. Aplicar no Supabase Dashboard → SQL Editor.
-- ============================================================================

-- 1) Flag global
CREATE TABLE IF NOT EXISTS app_config (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;  -- sem policy = só via RPC/service_role
INSERT INTO app_config (chave, valor) VALUES ('modo_beta', 'true')
  ON CONFLICT (chave) DO NOTHING;

-- 2) Coluna de tester + backfill (todos os usuários de HOJE = testers)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS acesso_total BOOLEAN NOT NULL DEFAULT false;
UPDATE user_profiles SET acesso_total = true WHERE acesso_total IS NOT TRUE;

-- 3) RPC pública: o app pergunta se o beta está ligado
CREATE OR REPLACE FUNCTION modo_beta_ativo()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT valor = 'true' FROM app_config WHERE chave = 'modo_beta'), false);
$$;
REVOKE ALL ON FUNCTION modo_beta_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION modo_beta_ativo() TO anon, authenticated;

-- 4) Helper: o caller pode agir? (beta off, OU tester, OU admin, OU sistema)
CREATE OR REPLACE FUNCTION acesso_liberado_beta()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    auth.uid() IS NULL  -- contexto de sistema/service_role (RLS já barra anônimo)
    OR NOT COALESCE((SELECT valor = 'true' FROM app_config WHERE chave = 'modo_beta'), false)
    OR EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid() AND (acesso_total IS TRUE OR is_admin IS TRUE)
    );
$$;

-- 5) Trava no servidor. CRIAR VAGA e CANDIDATAR-SE ficam LIBERADOS.
--    Travado até o lançamento: ENVIAR CONVITE (INSERT em convites) e SELECIONAR
--    candidato (UPDATE de diarias setando diarista_aceite_id).
--    Service_role/sistema (auth.uid() nulo) sempre passam.

-- 5a) Bloqueio de INSERT — aplicado em CONVITES
CREATE OR REPLACE FUNCTION trg_bloqueio_beta()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT acesso_liberado_beta() THEN
    RAISE EXCEPTION 'MODO_BETA: ação indisponível durante o beta'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bloqueio_beta_convites ON convites;
CREATE TRIGGER bloqueio_beta_convites
  BEFORE INSERT ON convites
  FOR EACH ROW EXECUTE FUNCTION trg_bloqueio_beta();

-- Remove triggers antigos de INSERT (caso a versão anterior tenha sido aplicada):
-- criar vaga e candidatar agora são LIBERADOS.
DROP TRIGGER IF EXISTS bloqueio_beta_diarias ON diarias;
DROP TRIGGER IF EXISTS bloqueio_beta_candidaturas ON candidaturas;

-- 5b) Bloqueio da SELEÇÃO — UPDATE de diarias que define o diarista_aceite_id
CREATE OR REPLACE FUNCTION trg_bloqueio_beta_selecao()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.diarista_aceite_id IS NOT NULL
     AND NEW.diarista_aceite_id IS DISTINCT FROM OLD.diarista_aceite_id
     AND NOT acesso_liberado_beta()
  THEN
    RAISE EXCEPTION 'MODO_BETA: selecionar candidato abre no lançamento'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bloqueio_beta_selecao ON diarias;
CREATE TRIGGER bloqueio_beta_selecao
  BEFORE UPDATE OF diarista_aceite_id ON diarias
  FOR EACH ROW EXECUTE FUNCTION trg_bloqueio_beta_selecao();

-- 6) Anti-escalada: usuário comum não pode se auto-conceder acesso_total
CREATE OR REPLACE FUNCTION trg_protege_acesso_total()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.acesso_total IS DISTINCT FROM OLD.acesso_total
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin IS TRUE)
  THEN
    NEW.acesso_total := OLD.acesso_total;  -- ignora a tentativa
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protege_acesso_total ON user_profiles;
CREATE TRIGGER protege_acesso_total
  BEFORE UPDATE OF acesso_total ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION trg_protege_acesso_total();

-- Verificação:
--   SELECT modo_beta_ativo();                       -- true
--   SELECT count(*) FROM user_profiles WHERE acesso_total;  -- = total de hoje
