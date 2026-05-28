-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIX BUNDLE — Auditoria Banco/RPCs 2026-05-28                             ║
-- ║ Atende achados C-1, C-2, A-4, A-7, M-8.                                  ║
-- ║ Idempotente. Re-executável.                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ─── C-2 + A-1 fix: adicionar user_profiles.updated_at ──────────────────────
-- (created_at também: ver fix anterior em rebrand_juridico_fase1_views.sql)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION trg_user_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_user_profiles_set_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION trg_user_profiles_updated_at();

-- ─── C-1 fix: admin_drill_lista usa auth.users.created_at ──────────────────
CREATE OR REPLACE FUNCTION admin_drill_lista(p_tipo TEXT, p_limit INT DEFAULT 30)
RETURNS TABLE (
  id          TEXT, titulo    TEXT, subtitulo TEXT,
  badge       TEXT, badge_cor TEXT, criado_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin_caller();

  IF p_tipo = 'usuarios_total' THEN
    RETURN QUERY
    SELECT up.id::TEXT,
           COALESCE(up.nome, 'Sem nome')::TEXT,
           (COALESCE(up.user_type, 'sem tipo') ||
            CASE WHEN up.cpf IS NOT NULL OR up.cnpj IS NOT NULL THEN ' · doc ok' ELSE '' END)::TEXT,
           CASE WHEN up.documento_status='aprovado' THEN 'KYC ✓'
                WHEN up.documento_status='enviado'  THEN 'em análise'
                ELSE COALESCE(up.user_type,'—') END::TEXT,
           CASE WHEN up.documento_status='aprovado' THEN '#16a34a'
                WHEN up.documento_status='enviado'  THEN '#f59e0b'
                ELSE '#3A86FF' END::TEXT,
           au.created_at
      FROM user_profiles up
      LEFT JOIN auth.users au ON au.id = up.id
     ORDER BY au.created_at DESC NULLS LAST
     LIMIT p_limit;

  ELSIF p_tipo = 'online_agora' THEN
    RETURN QUERY
    SELECT up.id::TEXT, COALESCE(up.nome, 'Sem nome')::TEXT,
           ('🟢 ativo ' || extract(epoch from (NOW() - up.last_activity_at))::INTEGER || 's atrás')::TEXT,
           COALESCE(up.user_type, '—')::TEXT, '#16a34a'::TEXT, up.last_activity_at
      FROM user_profiles up
     WHERE up.last_activity_at > NOW() - INTERVAL '5 minutes'
     ORDER BY up.last_activity_at DESC
     LIMIT p_limit;

  ELSIF p_tipo = 'novos_hoje' THEN
    RETURN QUERY
    SELECT au.id::TEXT, COALESCE(up.nome, au.email, 'Sem nome')::TEXT,
           ('Cadastrou às ' || to_char(au.created_at, 'HH24:MI'))::TEXT,
           COALESCE(up.user_type, 'sem perfil')::TEXT,
           CASE WHEN up.user_type IS NULL THEN '#94a3b8' ELSE '#FF6B35' END::TEXT,
           au.created_at
      FROM auth.users au
      LEFT JOIN user_profiles up ON up.id = au.id
     WHERE au.created_at::DATE = CURRENT_DATE
     ORDER BY au.created_at DESC LIMIT p_limit;

  ELSIF p_tipo = 'novos_semana' THEN
    RETURN QUERY
    SELECT au.id::TEXT, COALESCE(up.nome, au.email, 'Sem nome')::TEXT,
           ('Cadastrou em ' || to_char(au.created_at, 'DD/MM HH24:MI'))::TEXT,
           COALESCE(up.user_type, 'sem perfil')::TEXT,
           CASE WHEN up.user_type IS NULL THEN '#94a3b8' ELSE '#a855f7' END::TEXT,
           au.created_at
      FROM auth.users au
      LEFT JOIN user_profiles up ON up.id = au.id
     WHERE au.created_at > NOW() - INTERVAL '7 days'
     ORDER BY au.created_at DESC LIMIT p_limit;

  ELSIF p_tipo = 'diarias_ativas' THEN
    RETURN QUERY
    SELECT di.id::TEXT,
           (COALESCE(di.funcao, di.segmento, 'Diária') || ' · R$ ' || di.valor::TEXT)::TEXT,
           (COALESCE(di.nome_negocio, '—') || ' · ' || to_char(di.data, 'DD/MM'))::TEXT,
           di.status::TEXT,
           CASE di.status WHEN 'aberta' THEN '#3A86FF'
                          WHEN 'aceita' THEN '#16a34a'
                          WHEN 'em_andamento' THEN '#f59e0b'
                          ELSE '#94a3b8' END::TEXT,
           di.created_at
      FROM diarias di
     WHERE di.status IN ('aberta','aceita','em_andamento')
     ORDER BY di.created_at DESC LIMIT p_limit;

  ELSIF p_tipo = 'tickets_abertos' THEN
    RETURN QUERY
    SELECT st.id::TEXT, st.assunto::TEXT,
           ('Atualizado ' || to_char(st.updated_at, 'DD/MM HH24:MI'))::TEXT,
           st.status::TEXT,
           CASE st.status WHEN 'aberto' THEN '#ef4444'
                          WHEN 'aguardando_user' THEN '#f59e0b'
                          ELSE '#94a3b8' END::TEXT,
           st.updated_at
      FROM suporte_tickets st
     WHERE st.status IN ('aberto','aguardando_user')
     ORDER BY st.updated_at DESC LIMIT p_limit;

  ELSE RETURN;
  END IF;
END $$;

REVOKE ALL ON FUNCTION admin_drill_lista(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_drill_lista(TEXT, INT) TO authenticated;

-- ─── A-4 fix: trigger anti-escalada respeita admin (caller via JWT) ─────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB := to_jsonb(OLD);
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_caller_is_admin BOOLEAN;
BEGIN
  IF v_role = 'service_role' THEN RETURN NEW; END IF;

  SELECT COALESCE(is_admin, FALSE) INTO v_caller_is_admin
    FROM user_profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN RETURN NEW; END IF;

  IF (v_new->>'is_admin') IS DISTINCT FROM (v_old->>'is_admin') THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor'; END IF;
  IF (v_new->>'plano_ativo') IS DISTINCT FROM (v_old->>'plano_ativo') THEN
    RAISE EXCEPTION 'plano_ativo só via webhook MP'; END IF;
  IF (v_new->>'mp_access_token') IS DISTINCT FROM (v_old->>'mp_access_token') THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth'; END IF;
  IF (v_new->>'mp_user_id') IS DISTINCT FROM (v_old->>'mp_user_id') THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth'; END IF;
  IF (v_new->>'telefone_verificado') IS DISTINCT FROM (v_old->>'telefone_verificado') THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP'; END IF;
  IF (v_old->>'termos_aceitos_em') IS NOT NULL
     AND (v_new->>'termos_aceitos_em') IS DISTINCT FROM (v_old->>'termos_aceitos_em') THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável'; END IF;

  IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
    IF NOT (COALESCE(v_old->>'documento_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
            AND (v_new->>'documento_status') = 'enviado') THEN
      RAISE EXCEPTION 'documento_status só pode ser alterado via revisão KYC (admin)';
    END IF;
  END IF;
  IF (v_new->>'documento_revisado_em') IS DISTINCT FROM (v_old->>'documento_revisado_em') THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC'; END IF;

  IF (v_new->>'antecedentes_status') IS DISTINCT FROM (v_old->>'antecedentes_status') THEN
    IF NOT (COALESCE(v_old->>'antecedentes_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
            AND (v_new->>'antecedentes_status') = 'enviado') THEN
      RAISE EXCEPTION 'antecedentes_status só via revisão admin';
    END IF;
  END IF;
  IF (v_new->>'antecedentes_revisado_em') IS DISTINCT FROM (v_old->>'antecedentes_revisado_em') THEN
    RAISE EXCEPTION 'antecedentes_revisado_em só via revisão admin'; END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- ─── M-8 fix: webhook_eventos_processados sem RLS ──────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='webhook_eventos_processados') THEN
    EXECUTE 'ALTER TABLE webhook_eventos_processados ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS webhook_eventos_service_only ON webhook_eventos_processados';
    EXECUTE 'CREATE POLICY webhook_eventos_service_only ON webhook_eventos_processados FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─── A-7 fix: views da rebrand jurídica com security_invoker ───────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='anuncios')          THEN
    EXECUTE 'ALTER VIEW anuncios          SET (security_invoker = true)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='interesses')        THEN
    EXECUTE 'ALTER VIEW interesses        SET (security_invoker = true)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='conexoes_diretas')  THEN
    EXECUTE 'ALTER VIEW conexoes_diretas  SET (security_invoker = true)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='usuarios_publicos') THEN
    EXECUTE 'ALTER VIEW usuarios_publicos SET (security_invoker = true)'; END IF;
END $$;

-- ── Verificação ────────────────────────────────────────────────────────────
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_name='user_profiles' AND column_name='updated_at')          AS up_updated_at,
--   (SELECT COUNT(*) FROM pg_proc WHERE proname='admin_drill_lista')         AS rpc_drill_lista,
--   (SELECT COUNT(*) FROM pg_proc WHERE proname='protect_user_profile_privileged_columns') AS trg_proc;
-- Esperado: 1 | 1 | 1
