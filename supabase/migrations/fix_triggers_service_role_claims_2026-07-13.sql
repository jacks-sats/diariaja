-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: detecção de service_role nos 8 triggers de enforcement restantes
-- Data: 2026-07-13
-- ═══════════════════════════════════════════════════════════════════════════
-- ── Causa-raiz (a MESMA do incidente do plano pago, corrigido em 2026-06-01) ─
-- Estas funções de trigger liam o papel do chamador só pelo path ANTIGO do
-- PostgREST:
--     current_setting('request.jwt.claim.role', true)
-- Nas versões atuais do PostgREST esse setting vem VAZIO — as claims ficam em
-- `request.jwt.claims` (JSON). Resultado: escritas de Edge Functions
-- (service_role) NÃO eram reconhecidas e caíam nas regras de usuário comum.
--
-- fix_protect_trigger_service_role_claims_2026-06-01.sql corrigiu SÓ
-- protect_user_profile_privileged_columns. Este arquivo corrige as 8
-- restantes. Hoje nenhum fluxo em produção quebra (as escritas atuais do
-- mp-webhook / delete-user / lembrar-diarias caem nos early-returns dos
-- triggers), mas é o mesmo bug latente que já causou o P0 do Pix — qualquer
-- fluxo novo com service_role pode tropeçar sem aviso.
--
-- ── O que muda ───────────────────────────────────────────────────────────────
-- APENAS a detecção de papel: v_role reconhece o service_role no path ANTIGO
-- e no NOVO (claims JSON), com fallback em current_user — padrão idêntico ao
-- fix de 2026-06-01, rodando em produção desde então. O resto de cada função
-- é CÓPIA EXATA da versão vigente (arquivo de origem anotado em cada seção).
--
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Re-executável.
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Dependências da seção 5 (cópia de launch_free_anunciante.sql — no-op se
--    aquele arquivo já foi aplicado; se não foi, instala flag OFF = mesmo
--    comportamento de antes).
-- ─────────────────────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.app_config') IS NOT NULL THEN
    INSERT INTO app_config (chave, valor) VALUES ('launch_free_anunciante', 'false')
      ON CONFLICT (chave) DO NOTHING;
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION launch_free_anunciante()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT valor = 'true' FROM app_config WHERE chave = 'launch_free_anunciante'), false);
$$;
REVOKE ALL ON FUNCTION launch_free_anunciante() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION launch_free_anunciante() TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. clamp_last_activity_at — origem: hotfix_triggers_cast.sql
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clamp_last_activity_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_la TIMESTAMPTZ;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.last_activity_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Cast defensivo: se já é timestamptz, no-op. Se for text, converte.
  BEGIN
    v_la := NEW.last_activity_at::TEXT::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    -- Valor inválido — clamp pra NOW() e sai.
    NEW.last_activity_at := NOW();
    RETURN NEW;
  END;
  IF v_la > NOW() + INTERVAL '1 minute' THEN
    NEW.last_activity_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clamp_last_activity_at ON user_profiles;
CREATE TRIGGER trg_clamp_last_activity_at
  BEFORE INSERT OR UPDATE OF last_activity_at ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION clamp_last_activity_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. force_safe_profile_defaults_on_insert — origem: fix_a1_force_safe_defaults_insert.sql
--    (signup-empresa INSERE user_profiles com service_role — sem este fix o
--    trigger trataria o cadastro PJ como usuário comum e forçaria defaults.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION force_safe_profile_defaults_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  -- Edge Functions (service_role) têm privilégio total — não mexe.
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Usuário comum NÃO pode nascer com privilégio/benefício. Força defaults.
  NEW.is_admin            := false;
  NEW.is_suporte          := false;
  NEW.plano_ativo         := 'gratis';
  NEW.plano_expira_em     := NULL;
  NEW.telefone_verificado := false;
  NEW.mp_access_token     := NULL;
  NEW.mp_user_id          := NULL;
  NEW.documento_status    := 'nao_enviado';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_safe_profile_defaults ON user_profiles;
CREATE TRIGGER trg_force_safe_profile_defaults
  BEFORE INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION force_safe_profile_defaults_on_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. enforce_bloqueio_mensagem — origem: enforce_bloqueio_mensagem.sql
--    (mp-webhook insere mensagem automática com service_role.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_bloqueio_mensagem()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  -- Inserts internos (Edge Functions com service_role) não são barrados.
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Bloqueio bilateral (eu bloqueei o destinatário OU ele me bloqueou).
  -- Checa direto na tabela pelos ids do registro (não depende de auth.uid()),
  -- cobrindo as duas direções de forma robusta.
  IF EXISTS (
    SELECT 1 FROM usuarios_bloqueados
     WHERE (bloqueador_id = NEW.remetente_id    AND alvo_id = NEW.destinatario_id)
        OR (bloqueador_id = NEW.destinatario_id AND alvo_id = NEW.remetente_id)
  ) THEN
    RAISE EXCEPTION 'Não é possível enviar: há um bloqueio entre você e este usuário.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_bloqueio_mensagem ON mensagens;
CREATE TRIGGER trg_enforce_bloqueio_mensagem
  BEFORE INSERT ON mensagens
  FOR EACH ROW
  EXECUTE FUNCTION enforce_bloqueio_mensagem();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. enforce_cota_gratis_diarista — origem: enforce_cota_gratis_diarista.sql
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_cota_gratis_diarista()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano      TEXT;
  v_concluidas INTEGER;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  -- service_role (Edge Functions/admin) não é barrado.
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça na transição PARA 'aceita' (aceitação do serviço pelo diarista).
  IF NEW.status IS DISTINCT FROM 'aceita'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR NEW.diarista_aceite_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_plano := plano_ativo_role(NEW.diarista_aceite_id, 'diarista');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;  -- plano pago = diárias ilimitadas
  END IF;

  v_concluidas := contar_diarias_concluidas_diarista(NEW.diarista_aceite_id);
  IF v_concluidas >= 3 THEN
    RAISE EXCEPTION 'Você já concluiu suas 3 diárias grátis. Assine um plano para aceitar novas diárias.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_cota_gratis_diarista ON diarias;
CREATE TRIGGER trg_enforce_cota_gratis_diarista
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_cota_gratis_diarista();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. enforce_limite_selecao_candidato — origem: launch_free_anunciante.sql
--    (versão vigente: promo 30 dias + flag launch_free + gates de plano)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_limite_selecao_candidato()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano       TEXT;
  v_cadastro_em TIMESTAMPTZ;
  v_selecoes    INTEGER;
  v_extras      INTEGER;
  v_limite      INTEGER;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça quando diarista_aceite_id é DEFINIDO pela 1ª vez (NULL -> valor).
  IF NEW.diarista_aceite_id IS NULL
     OR OLD.diarista_aceite_id IS NOT NULL
     OR NEW.diarista_aceite_id IS NOT DISTINCT FROM OLD.diarista_aceite_id THEN
    RETURN NEW;
  END IF;

  -- ── PROMO BOAS-VINDAS: 30 dias do cadastro = libera tudo (diária E emprego) ──
  SELECT created_at INTO v_cadastro_em FROM user_profiles WHERE id = NEW.empregador_id;
  IF v_cadastro_em IS NOT NULL AND NOW() < v_cadastro_em + INTERVAL '30 days' THEN
    RETURN NEW;
  END IF;

  -- ── LANÇAMENTO GRÁTIS (anunciante): flag global libera a seleção sem cobrança ──
  IF launch_free_anunciante() THEN
    RETURN NEW;
  END IF;

  v_plano := plano_ativo_role(NEW.empregador_id, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;  -- plano pago = libera contato (inclui vaga de emprego)
  END IF;

  -- Chegou aqui = plano GRÁTIS (e fora da promo).
  -- VAGA DE EMPREGO: contato exige Essencial. Sem 3 grátis, sem R$ 2,50.
  IF NEW.tipo_oferta = 'emprego' THEN
    RAISE EXCEPTION 'Contatar candidatos de vagas de emprego exige o plano Essencial. Assine para liberar.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- DIÁRIA / SERVIÇO no grátis: 3/mês + extras pagos (R$ 2,50).
  SELECT COUNT(*) INTO v_selecoes
    FROM diarias
   WHERE empregador_id      = NEW.empregador_id
     AND diarista_aceite_id IS NOT NULL
     AND status <> 'expirada'
     AND created_at >= date_trunc('month', NOW());

  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = NEW.empregador_id
     AND created_at >= date_trunc('month', NOW());

  v_limite := 3 + COALESCE(v_extras, 0);

  IF v_selecoes >= v_limite THEN
    RAISE EXCEPTION 'Pague o desbloqueio (R$ 2,50) para liberar o contato, ou assine um plano para contatos ilimitados.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_selecao ON diarias;
CREATE TRIGGER trg_enforce_limite_selecao
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_selecao_candidato();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. enforce_limite_vaga_emprego — origem: vagas_emprego_limite.sql
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_limite_vaga_emprego()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano    TEXT;
  v_postadas INTEGER;
  v_extras   INTEGER;
  v_limite   INTEGER;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  -- service_role (webhook, RPCs SECURITY DEFINER) bypassa.
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça VAGA DE EMPREGO. Diária e serviço passam direto.
  IF NEW.tipo_oferta IS DISTINCT FROM 'emprego' THEN
    RETURN NEW;
  END IF;

  -- Plano pago (essencial/plus, por assinatura OU plano avulso 30d) = ilimitado.
  v_plano := plano_ativo_role(NEW.empregador_id, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;
  END IF;

  -- Vagas de emprego JÁ publicadas neste mês (NEW ainda não existe na tabela).
  SELECT COUNT(*) INTO v_postadas
    FROM diarias
   WHERE empregador_id = NEW.empregador_id
     AND tipo_oferta   = 'emprego'
     AND created_at   >= date_trunc('month', NOW());

  -- Desbloqueios pagos neste mês (cada um soma 1 ao limite).
  SELECT COUNT(*) INTO v_extras
    FROM vagas_emprego_desbloqueios
   WHERE empregador_id = NEW.empregador_id
     AND created_at   >= date_trunc('month', NOW());

  v_limite := 3 + COALESCE(v_extras, 0);

  IF v_postadas >= v_limite THEN
    RAISE EXCEPTION 'Limite de vagas de emprego do mês atingido. Pague a publicação avulsa ou assine um plano para publicar ilimitado.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_vaga_emprego ON diarias;
CREATE TRIGGER trg_enforce_limite_vaga_emprego
  BEFORE INSERT ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_vaga_emprego();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. enforce_max_interessados — origem: vaga_emprego_encerrar.sql
--    (versão vigente: teto de 10 + só vaga 'aberta' recebe candidatura)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_max_interessados()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendentes INTEGER;
  v_status    TEXT;
  c_teto      CONSTANT INTEGER := 10;   -- == MAX_INTERESSADOS (src/constants.ts)
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Vaga precisa estar ABERTA (encerrada/pendente/cancelada não recebem mais).
  SELECT status INTO v_status FROM diarias WHERE id = NEW.diaria_id;
  IF v_status IS DISTINCT FROM 'aberta' THEN
    RAISE EXCEPTION 'Esta vaga não está mais aberta para candidaturas.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Teto de interessados pendentes (igual ao front: MAX_INTERESSADOS).
  SELECT COUNT(*) INTO v_pendentes
    FROM candidaturas
   WHERE diaria_id = NEW.diaria_id AND status = 'pendente';
  IF v_pendentes >= c_teto THEN
    RAISE EXCEPTION 'Esta vaga já atingiu o limite de interessados. Tente outra vaga.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_max_interessados ON candidaturas;
CREATE TRIGGER trg_max_interessados
  BEFORE INSERT ON candidaturas
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_interessados();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. enforce_plano_chamar_emprego — origem: vaga_emprego_gate_chamar.sql
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_plano_chamar_emprego()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo  TEXT;
  v_emp   UUID;
  v_plano TEXT;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só quando a candidatura ENTRA em 'selecionado' (a empresa "chama") — não em
  -- re-updates nem em 'confirmado'/'rejeitado'.
  IF NEW.status <> 'selecionado'
     OR OLD.status = 'selecionado'
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT tipo_oferta, empregador_id INTO v_tipo, v_emp
    FROM diarias WHERE id = NEW.diaria_id;

  -- SÓ emprego é gated aqui. Diária/serviço passam direto (a trava deles é o
  -- trigger de `diarias`, que continua valendo).
  IF v_tipo IS DISTINCT FROM 'emprego' THEN
    RETURN NEW;
  END IF;

  v_plano := plano_ativo_role(v_emp, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;   -- com plano = chamar ILIMITADO
  END IF;

  RAISE EXCEPTION 'Contatar candidatos de vagas de emprego exige o plano Essencial. Assine para liberar.'
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS trg_enforce_plano_chamar_emprego ON candidaturas;
CREATE TRIGGER trg_enforce_plano_chamar_emprego
  BEFORE UPDATE ON candidaturas
  FOR EACH ROW
  EXECUTE FUNCTION enforce_plano_chamar_emprego();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar após aplicar) — deve retornar 0 LINHAS (nenhuma função
-- lendo SÓ o path antigo):
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.prosrc LIKE '%request.jwt.claim.role%'
--      AND p.prosrc NOT LIKE '%request.jwt.claims%';
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'service_role reconhecido (claim antigo + claims novo) em 8 triggers de enforcement.' AS resultado;
