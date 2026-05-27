-- ============================================================================
-- Painel Admin — métricas avançadas (séries temporais, drill-down, agregados)
-- ============================================================================
-- Adiciona 3 RPCs SECURITY DEFINER (só admin executa):
--   1. admin_metricas_serie(p_metrica, p_dias) — série temporal pra gráfico
--   2. admin_drill_lista(p_tipo, p_limit)      — lista de itens pra modal
--   3. admin_metricas_extras()                  — agregados pra cards extras
--
-- Aplicar via Supabase Dashboard → SQL Editor. Idempotente.
-- ============================================================================

-- Helper: valida que o caller é admin (DRY)
CREATE OR REPLACE FUNCTION assert_admin_caller()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION assert_admin_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_admin_caller() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. admin_metricas_serie(p_metrica, p_dias)
-- ---------------------------------------------------------------------------
-- Retorna array de {dia, valor} pra os últimos p_dias.
-- Métricas suportadas:
--   - novos_usuarios   : INSERTs em auth.users por dia
--   - diarias_criadas  : INSERTs em diarias por dia
--   - diarias_concluidas: diárias com status='concluida' por dia
--   - tickets_criados  : INSERTs em suporte_tickets por dia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_metricas_serie(p_metrica TEXT, p_dias INT DEFAULT 14)
RETURNS TABLE (dia DATE, valor INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();
  -- Gera série de dias (zero-fill: dias sem evento aparecem como 0)
  RETURN QUERY
  WITH dias_serie AS (
    SELECT generate_series(
      CURRENT_DATE - (p_dias - 1) * INTERVAL '1 day',
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS d
  )
  SELECT
    ds.d AS dia,
    CASE p_metrica
      WHEN 'novos_usuarios' THEN
        (SELECT COUNT(*)::INTEGER FROM auth.users u WHERE u.created_at::DATE = ds.d)
      WHEN 'diarias_criadas' THEN
        (SELECT COUNT(*)::INTEGER FROM diarias di WHERE di.created_at::DATE = ds.d)
      WHEN 'diarias_concluidas' THEN
        (SELECT COUNT(*)::INTEGER FROM diarias di
          WHERE di.status = 'concluida'
            AND COALESCE(di.updated_at, di.created_at)::DATE = ds.d)
      WHEN 'tickets_criados' THEN
        (SELECT COUNT(*)::INTEGER FROM suporte_tickets st WHERE st.created_at::DATE = ds.d)
      ELSE 0
    END AS valor
  FROM dias_serie ds
  ORDER BY ds.d;
END $$;

REVOKE ALL ON FUNCTION admin_metricas_serie(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_metricas_serie(TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_drill_lista(p_tipo, p_limit)
-- ---------------------------------------------------------------------------
-- Retorna lista de itens pra mostrar em modal drill-down ao clicar num card.
-- Retorna sempre {id, titulo, subtitulo, badge, badge_cor, criado_em} pra
-- renderização uniforme no frontend.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_drill_lista(p_tipo TEXT, p_limit INT DEFAULT 30)
RETURNS TABLE (
  id          TEXT,
  titulo      TEXT,
  subtitulo   TEXT,
  badge       TEXT,
  badge_cor   TEXT,
  criado_em   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();

  IF p_tipo = 'usuarios_total' THEN
    RETURN QUERY
    SELECT
      up.id::TEXT,
      COALESCE(up.nome, 'Sem nome')::TEXT,
      (COALESCE(up.user_type, 'sem tipo') ||
        CASE WHEN up.cpf IS NOT NULL OR up.cnpj IS NOT NULL THEN ' · doc ok' ELSE '' END)::TEXT,
      CASE WHEN up.documento_status = 'aprovado' THEN 'KYC ✓'
           WHEN up.documento_status = 'enviado' THEN 'em análise'
           ELSE COALESCE(up.user_type, '—')
      END::TEXT,
      CASE WHEN up.documento_status = 'aprovado' THEN '#16a34a'
           WHEN up.documento_status = 'enviado' THEN '#f59e0b'
           ELSE '#3A86FF'
      END::TEXT,
      up.created_at
    FROM user_profiles up
    ORDER BY up.created_at DESC NULLS LAST
    LIMIT p_limit;

  ELSIF p_tipo = 'online_agora' THEN
    RETURN QUERY
    SELECT
      up.id::TEXT,
      COALESCE(up.nome, 'Sem nome')::TEXT,
      ('🟢 ativo ' || extract(epoch from (NOW() - up.last_activity_at))::INTEGER || 's atrás')::TEXT,
      COALESCE(up.user_type, '—')::TEXT,
      '#16a34a'::TEXT,
      up.last_activity_at
    FROM user_profiles up
    WHERE up.last_activity_at > NOW() - INTERVAL '5 minutes'
    ORDER BY up.last_activity_at DESC
    LIMIT p_limit;

  ELSIF p_tipo = 'novos_hoje' THEN
    RETURN QUERY
    SELECT
      au.id::TEXT,
      COALESCE(up.nome, au.email, 'Sem nome')::TEXT,
      ('Cadastrou às ' || to_char(au.created_at, 'HH24:MI'))::TEXT,
      COALESCE(up.user_type, 'sem perfil')::TEXT,
      CASE WHEN up.user_type IS NULL THEN '#94a3b8' ELSE '#FF6B35' END::TEXT,
      au.created_at
    FROM auth.users au
    LEFT JOIN user_profiles up ON up.id = au.id
    WHERE au.created_at::DATE = CURRENT_DATE
    ORDER BY au.created_at DESC
    LIMIT p_limit;

  ELSIF p_tipo = 'novos_semana' THEN
    RETURN QUERY
    SELECT
      au.id::TEXT,
      COALESCE(up.nome, au.email, 'Sem nome')::TEXT,
      ('Cadastrou em ' || to_char(au.created_at, 'DD/MM HH24:MI'))::TEXT,
      COALESCE(up.user_type, 'sem perfil')::TEXT,
      CASE WHEN up.user_type IS NULL THEN '#94a3b8' ELSE '#a855f7' END::TEXT,
      au.created_at
    FROM auth.users au
    LEFT JOIN user_profiles up ON up.id = au.id
    WHERE au.created_at > NOW() - INTERVAL '7 days'
    ORDER BY au.created_at DESC
    LIMIT p_limit;

  ELSIF p_tipo = 'diarias_ativas' THEN
    RETURN QUERY
    SELECT
      di.id::TEXT,
      (COALESCE(di.funcao, di.segmento, 'Diária') ||
        ' · R$ ' || di.valor::TEXT)::TEXT,
      (COALESCE(di.nome_negocio, '—') || ' · ' || to_char(di.data, 'DD/MM'))::TEXT,
      di.status::TEXT,
      CASE di.status
        WHEN 'aberta'        THEN '#3A86FF'
        WHEN 'aceita'        THEN '#16a34a'
        WHEN 'em_andamento'  THEN '#f59e0b'
        ELSE '#94a3b8'
      END::TEXT,
      di.created_at
    FROM diarias di
    WHERE di.status IN ('aberta', 'aceita', 'em_andamento')
    ORDER BY di.created_at DESC
    LIMIT p_limit;

  ELSIF p_tipo = 'tickets_abertos' THEN
    RETURN QUERY
    SELECT
      st.id::TEXT,
      st.assunto::TEXT,
      ('Atualizado ' || to_char(st.updated_at, 'DD/MM HH24:MI'))::TEXT,
      st.status::TEXT,
      CASE st.status
        WHEN 'aberto'           THEN '#ef4444'
        WHEN 'aguardando_user'  THEN '#f59e0b'
        ELSE '#94a3b8'
      END::TEXT,
      st.updated_at
    FROM suporte_tickets st
    WHERE st.status IN ('aberto', 'aguardando_user')
    ORDER BY st.updated_at DESC
    LIMIT p_limit;

  ELSE
    -- tipo desconhecido → lista vazia
    RETURN;
  END IF;
END $$;

REVOKE ALL ON FUNCTION admin_drill_lista(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_drill_lista(TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_metricas_extras()
-- ---------------------------------------------------------------------------
-- Retorna agregados pra cards extras (distribuição, conversão, etc.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_metricas_extras()
RETURNS TABLE (
  total_diaristas        INTEGER,
  total_empregadores     INTEGER,
  total_pj               INTEGER,
  total_kyc_aprovado     INTEGER,
  total_kyc_pendente     INTEGER,
  diarias_concluidas     INTEGER,
  diarias_canceladas     INTEGER,
  diarias_total          INTEGER,
  taxa_conclusao_pct     INTEGER,
  cursos_concluidos      INTEGER,
  candidaturas_total     INTEGER,
  avaliacoes_medias_dia  NUMERIC,
  assinaturas_ativas     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_concluidas INT;
  v_canceladas INT;
  v_total      INT;
BEGIN
  PERFORM assert_admin_caller();

  SELECT COUNT(*)::INT INTO v_concluidas FROM diarias WHERE status = 'concluida';
  SELECT COUNT(*)::INT INTO v_canceladas FROM diarias WHERE status = 'cancelada';
  SELECT COUNT(*)::INT INTO v_total FROM diarias;

  RETURN QUERY SELECT
    (SELECT COUNT(*)::INT FROM user_profiles WHERE user_type = 'diarista'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE user_type = 'empregador'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE pessoa_tipo = 'juridica'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE documento_status = 'aprovado'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE documento_status = 'enviado'),
    v_concluidas,
    v_canceladas,
    v_total,
    CASE WHEN v_total = 0 THEN 0 ELSE (v_concluidas * 100 / v_total) END,
    -- academy: 0 se as tabelas não existirem (try/catch dentro do COUNT via COALESCE +
    -- subquery defensiva). Usa pg_class pra checar existência.
    COALESCE((SELECT COUNT(*)::INT FROM academy_certificados), 0),
    (SELECT COUNT(*)::INT FROM candidaturas),
    -- média aritmética simples das avaliações concluídas (pode ser NULL se vazio)
    COALESCE((SELECT ROUND(AVG(nota)::NUMERIC, 2) FROM avaliacoes_diarista), 0),
    (SELECT COUNT(*)::INT FROM assinaturas WHERE status = 'ativo');

EXCEPTION WHEN undefined_table THEN
  -- Algumas tabelas (academy_certificados, candidaturas, avaliacoes_diarista,
  -- assinaturas) podem não existir em projetos antigos. Retorna 0s defensivos.
  RETURN QUERY SELECT
    (SELECT COUNT(*)::INT FROM user_profiles WHERE user_type = 'diarista'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE user_type = 'empregador'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE pessoa_tipo = 'juridica'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE documento_status = 'aprovado'),
    (SELECT COUNT(*)::INT FROM user_profiles WHERE documento_status = 'enviado'),
    v_concluidas,
    v_canceladas,
    v_total,
    CASE WHEN v_total = 0 THEN 0 ELSE (v_concluidas * 100 / v_total) END,
    0, 0, 0::NUMERIC, 0;
END $$;

REVOKE ALL ON FUNCTION admin_metricas_extras() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_metricas_extras() TO authenticated;

-- ============================================================================
-- Fim
-- ============================================================================
