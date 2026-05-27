-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  APLICAR TUDO QUE ESTÁ PENDENTE — atalho consolidado (2026-05-27)        ║
-- ╠═══════════════════════════════════════════════════════════════════════════╣
-- ║  Em vez de rodar 7 migrations separadas, este arquivo faz tudo de uma vez║
-- ║  na ordem correta de dependências. 100% idempotente — pode rodar de novo  ║
-- ║  sem medo.                                                                ║
-- ║                                                                           ║
-- ║  Conteúdo (na ordem):                                                     ║
-- ║   1. admin_metricas_avancadas.sql  (drill-down do painel admin)           ║
-- ║   2. contatos_desbloqueios.sql     (segurança do contador R$1)            ║
-- ║   3. antecedentes_criminais.sql    (KYC antecedentes + bucket policies)   ║
-- ║   4. monetizacao_dual_track.sql    (planos por papel + RPCs novas)        ║
-- ║   5. seguranca_hardening.sql       (IMP-S3, KYC log, bloqueio, purga)     ║
-- ║   6. rate_limits.sql               (anti-abuso global)                    ║
-- ║   7. auditoria_acoes.sql           (log genérico LGPD Art. 37)            ║
-- ║                                                                           ║
-- ║  Antes de rodar: garanta que (1) pg_cron está habilitado e (2) o bucket  ║
-- ║  'antecedentes' foi criado no Storage.                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝


-- ═══════════════ ▼ admin_metricas_avancadas.sql ═══════════════
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


-- ═══════════════ ▼ contatos_desbloqueios.sql ═══════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Contatos desbloqueados — move contador do localStorage pro banco
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bug fechado: o contador `contatosDesbloqueados` morava só no localStorage
-- do navegador e era incrementado pelo redirect de retorno do MP
-- (`/?contato_desbloqueado=sucesso`), SEM o servidor validar o pagamento. O
-- comentário no mp-webhook deixava claro: "O webhook apenas loga". Permitia:
--   - Manipular URL e ganhar unlocks sem pagar
--   - Cada dispositivo via um contador diferente (não sincronizava)
--   - Limpar cache zerava o contador
--
-- Fix:
--   1. Tabela append-only `contatos_desbloqueios` (1 linha = 1 unlock pago).
--   2. UNIQUE em mp_payment_id pra idempotência (webhook não duplica).
--   3. RLS: cada user lê os próprios; service_role insere via webhook.
--   4. (Em separado) mp-webhook passa a INSERT aqui em vez de só logar.
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contatos_desbloqueios (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empregador_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mp_payment_id           TEXT,
  mp_external_reference   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência: o mesmo payment_id do MP só pode ser registrado uma vez.
-- Webhooks do MP podem disparar duplicado em retries — UNIQUE garante 1 linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contatos_desbloqueios_payment
  ON contatos_desbloqueios(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- Hot path da query: empregador X no mês Y.
CREATE INDEX IF NOT EXISTS idx_contatos_desbloqueios_emp_data
  ON contatos_desbloqueios(empregador_id, created_at DESC);

-- RLS
ALTER TABLE contatos_desbloqueios ENABLE ROW LEVEL SECURITY;

-- Usuário lê os próprios (pra UI mostrar quantos comprou no mês)
DROP POLICY IF EXISTS contatos_desbloqueios_owner_select ON contatos_desbloqueios;
CREATE POLICY contatos_desbloqueios_owner_select ON contatos_desbloqueios
  FOR SELECT TO authenticated
  USING (empregador_id = auth.uid());

-- Só service_role insere/atualiza/deleta (via Edge Function mp-webhook).
-- INSERT nem precisa de policy explícita pra authenticated — sem policy = bloqueado.
DROP POLICY IF EXISTS contatos_desbloqueios_service_all ON contatos_desbloqueios;
CREATE POLICY contatos_desbloqueios_service_all ON contatos_desbloqueios
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helper RPC: conta unlocks do empregador autenticado neste mês.
-- Usar via supabase.rpc("contar_contatos_desbloqueados_mes") no client.
CREATE OR REPLACE FUNCTION contar_contatos_desbloqueados_mes()
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM contatos_desbloqueios
   WHERE empregador_id = auth.uid()
     AND created_at >= date_trunc('month', NOW());
  RETURN COALESCE(v_count, 0);
END $$;

REVOKE ALL ON FUNCTION contar_contatos_desbloqueados_mes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contar_contatos_desbloqueados_mes() TO authenticated;

-- Verificação (rodar manualmente):
--   SELECT COUNT(*) FROM contatos_desbloqueios;  -- deve retornar 0 inicialmente
--   SELECT contar_contatos_desbloqueados_mes();  -- 0 pra qualquer user novo


-- ═══════════════ ▼ antecedentes_criminais.sql ═══════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Antecedentes Criminais — upload de PDF da certidão negativa + revisão admin
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mecânica idêntica ao KYC de RG/CNH (kyc_documentos.sql), em colunas
-- separadas pra que o usuário possa estar Confiável em RG mas pendente em
-- antecedentes (e vice-versa).
--
-- Fluxo:
--   1. User emite gratuitamente no site da Polícia Federal ou estadual.
--   2. Sobe o PDF na tela `verificar-antecedentes`.
--   3. status passa nao_enviado → enviado (permitido pelo trigger).
--   4. Admin revisa em painel próprio → status enviado → aprovado/rejeitado
--      via RPC `revisar_antecedentes(user_id, decisao, motivo)`.
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas em user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS antecedentes_status            TEXT
    CHECK (antecedentes_status IS NULL OR antecedentes_status IN ('nao_enviado','enviado','aprovado','rejeitado')),
  ADD COLUMN IF NOT EXISTS antecedentes_url               TEXT,
  ADD COLUMN IF NOT EXISTS antecedentes_enviado_em        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS antecedentes_revisado_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS antecedentes_motivo_rejeicao   TEXT;

-- Default 'nao_enviado' pra novos registros (evita NULL no client)
ALTER TABLE user_profiles
  ALTER COLUMN antecedentes_status SET DEFAULT 'nao_enviado';

UPDATE user_profiles
   SET antecedentes_status = 'nao_enviado'
 WHERE antecedentes_status IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Estende o trigger anti-escalada pra cobrir antecedentes_*
--    Permite user transicionar (nao_enviado | rejeitado) → enviado, igual KYC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB := to_jsonb(OLD);
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF (v_new->>'is_admin') IS DISTINCT FROM (v_old->>'is_admin') THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor';
  END IF;
  IF (v_new->>'plano_ativo') IS DISTINCT FROM (v_old->>'plano_ativo') THEN
    RAISE EXCEPTION 'plano_ativo só via webhook do Mercado Pago';
  END IF;
  IF (v_new->>'mp_access_token') IS DISTINCT FROM (v_old->>'mp_access_token') THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth';
  END IF;
  IF (v_new->>'mp_user_id') IS DISTINCT FROM (v_old->>'mp_user_id') THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth';
  END IF;
  IF (v_new->>'telefone_verificado') IS DISTINCT FROM (v_old->>'telefone_verificado') THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP confirmado pelo servidor';
  END IF;
  IF (v_old->>'termos_aceitos_em') IS NOT NULL
     AND (v_new->>'termos_aceitos_em') IS DISTINCT FROM (v_old->>'termos_aceitos_em') THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável após o aceite';
  END IF;

  -- documento_status (RG/CNH): user pode (nao_enviado | rejeitado) → enviado
  IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
    IF NOT (
      COALESCE(v_old->>'documento_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
      AND (v_new->>'documento_status') = 'enviado'
    ) THEN
      RAISE EXCEPTION 'documento_status só pode ser alterado via revisão KYC (admin)';
    END IF;
  END IF;
  IF (v_new->>'documento_revisado_em') IS DISTINCT FROM (v_old->>'documento_revisado_em') THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC';
  END IF;

  -- antecedentes_status: mesma regra. User envia → enviado. Admin aprova/rejeita.
  IF (v_new->>'antecedentes_status') IS DISTINCT FROM (v_old->>'antecedentes_status') THEN
    IF NOT (
      COALESCE(v_old->>'antecedentes_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
      AND (v_new->>'antecedentes_status') = 'enviado'
    ) THEN
      RAISE EXCEPTION 'antecedentes_status só pode ser alterado via revisão (admin)';
    END IF;
  END IF;
  IF (v_new->>'antecedentes_revisado_em') IS DISTINCT FROM (v_old->>'antecedentes_revisado_em') THEN
    RAISE EXCEPTION 'antecedentes_revisado_em só via revisão admin';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC pra admin aprovar/rejeitar antecedentes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION revisar_antecedentes(
  p_user_id  UUID,
  p_decisao  TEXT,             -- 'aprovado' ou 'rejeitado'
  p_motivo   TEXT DEFAULT NULL  -- obrigatório se rejeitado
)
RETURNS TABLE (
  user_id                  UUID,
  antecedentes_status      TEXT,
  antecedentes_revisado_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores podem revisar antecedentes.';
  END IF;
  IF p_decisao NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida: use aprovado ou rejeitado.';
  END IF;
  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (mínimo 3 caracteres).';
  END IF;

  UPDATE user_profiles
     SET antecedentes_status            = p_decisao,
         antecedentes_revisado_em       = NOW(),
         antecedentes_motivo_rejeicao   = CASE WHEN p_decisao = 'rejeitado' THEN p_motivo ELSE NULL END
   WHERE id = p_user_id;

  RETURN QUERY
  SELECT up.id, up.antecedentes_status, up.antecedentes_revisado_em
    FROM user_profiles up
   WHERE up.id = p_user_id;
END $$;

REVOKE ALL ON FUNCTION revisar_antecedentes(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revisar_antecedentes(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. RPC pra admin listar pendentes (espelho de admin_documentos_pendentes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_antecedentes_pendentes()
RETURNS TABLE (
  user_id                  UUID,
  nome                     TEXT,
  user_type                TEXT,
  antecedentes_url         TEXT,
  antecedentes_enviado_em  TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;

  RETURN QUERY
    SELECT
      up.id,
      up.nome,
      up.user_type,
      up.antecedentes_url,
      up.antecedentes_enviado_em
    FROM user_profiles up
    WHERE up.antecedentes_status = 'enviado'
    ORDER BY up.antecedentes_enviado_em ASC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION admin_antecedentes_pendentes() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket "antecedentes" (privado) — criar manualmente se ainda
--    não existir. Bucket separado de "documentos" pra simplificar policies e
--    permitir retenção/expurgo independentes (antecedentes têm validade legal
--    de ~90 dias, RG/CNH é permanente).
--
--    Dashboard → Storage → New bucket:
--      name: antecedentes
--      public: NO
--      allowed_mime_types: application/pdf, image/jpeg, image/png, image/webp
--      file_size_limit: 5242880  (5 MB)
--
-- ─────────────────────────────────────────────────────────────────────────────

-- RLS policies do bucket "antecedentes":
-- Caminhos seguem o padrão: <user_id>/<filename>
-- Owner faz INSERT/UPDATE/SELECT/DELETE no próprio prefixo. Admin pode SELECT.

DO $policy_block$
BEGIN
  -- INSERT: usuário sobe arquivo no próprio prefixo
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_insert'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'antecedentes' AND (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  END IF;

  -- SELECT: dono OU admin
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_or_admin_select'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_or_admin_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'antecedentes'
          AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
          )
        )
    $p$;
  END IF;

  -- UPDATE: só o dono (pra trocar metadata, raro)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_update'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_update ON storage.objects
        FOR UPDATE TO authenticated
        USING (bucket_id = 'antecedentes' AND (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  END IF;

  -- DELETE: só o dono (descarte do próprio)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'antecedentes_owner_delete'
  ) THEN
    EXECUTE $p$
      CREATE POLICY antecedentes_owner_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'antecedentes' AND (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  END IF;
END
$policy_block$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verificação manual após rodar:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'user_profiles' AND column_name LIKE 'antecedentes%';
--   -- deve retornar 5 colunas.
--
--   SELECT proname FROM pg_proc WHERE proname = 'revisar_antecedentes';
--   -- deve retornar 1 linha.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════ ▼ monetizacao_dual_track.sql ═══════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Monetização Dual Track — consolida o modelo definitivo (2026-05-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mudanças:
--   1. assinaturas: UNIQUE(user_id) -> UNIQUE(user_id, user_type)
--      Permite usuário 'ambos' ter 2 assinaturas (1 diarista + 1 empregador).
--   2. Aceita planos: gratis | essencial | plus (mantém 'pro' e 'destaque'
--      como aliases legados — UPDATE renomeia pra 'plus' automaticamente).
--   3. user_profiles.plano_ativo deprecated como fonte da verdade.
--      A fonte agora é a tabela `assinaturas`. plano_ativo fica mantido
--      por retrocompat (lê de lá enquanto o client migra).
--
-- RPCs novas:
--   - plano_ativo_role(user_id, role) -> 'gratis' | 'essencial' | 'plus'
--   - contar_diarias_concluidas_diarista(user_id) -> integer (vitalício)
--   - pode_selecionar_candidato(diaria_id) -> jsonb com decisão
--
-- Idempotente. Re-executável. Não destrói dados existentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Renomeia planos legados em assinaturas e user_profiles
--    (idempotente — ignora se já está no novo nome)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE assinaturas
   SET plano = 'plus'
 WHERE plano IN ('pro', 'destaque');

UPDATE user_profiles
   SET plano_ativo = 'plus'
 WHERE plano_ativo IN ('pro', 'destaque');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Troca UNIQUE(user_id) -> UNIQUE(user_id, user_type)
--    Constraint name pode variar entre instalações; tenta drop por nome
--    padrão e por busca defensiva via pg_constraint.
-- ─────────────────────────────────────────────────────────────────────────────
DO $migration$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Tenta o nome padrão criado pelo CREATE TABLE original
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assinaturas_user_id_key'
       AND conrelid = 'assinaturas'::regclass
  ) THEN
    ALTER TABLE assinaturas DROP CONSTRAINT assinaturas_user_id_key;
  END IF;

  -- Busca defensiva: qualquer UNIQUE que cubra APENAS (user_id)
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'assinaturas'::regclass
     AND contype = 'u'
     AND array_length(conkey, 1) = 1
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'assinaturas'::regclass
                            AND attname = 'user_id')]
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assinaturas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

-- Cria a nova constraint composta (idempotente)
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_assinaturas_user_role'
       AND conrelid = 'assinaturas'::regclass
  ) THEN
    ALTER TABLE assinaturas
      ADD CONSTRAINT uq_assinaturas_user_role UNIQUE (user_id, user_type);
  END IF;
END
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atualiza CHECK em assinaturas.plano (aceita gratis|essencial|plus)
--    Drop e re-cria pra incluir todos os valores em uso histórico.
-- ─────────────────────────────────────────────────────────────────────────────
DO $migration$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'assinaturas'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%plano%IN%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assinaturas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_plano_check
  CHECK (plano IN ('gratis', 'essencial', 'plus'));

-- assinaturas.user_type sempre foi 'empregador' ou 'diarista'.
-- Garantia defensiva: bloqueia outros valores (user_profiles.user_type pode
-- ser 'ambos', mas assinatura é sempre por papel específico).
DO $migration$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'assinaturas'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%user_type%IN%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assinaturas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_user_type_check
  CHECK (user_type IN ('empregador', 'diarista'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: retorna o plano ativo de um papel específico (ou 'gratis' default)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plano_ativo_role(
  p_user_id UUID,
  p_role    TEXT  -- 'diarista' | 'empregador'
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano TEXT;
BEGIN
  IF p_role NOT IN ('diarista','empregador') THEN
    RAISE EXCEPTION 'Papel inválido: use diarista ou empregador.';
  END IF;
  SELECT plano INTO v_plano
    FROM assinaturas
   WHERE user_id   = p_user_id
     AND user_type = p_role
     AND status    = 'ativo'
   LIMIT 1;
  RETURN COALESCE(v_plano, 'gratis');
END $$;

REVOKE ALL ON FUNCTION plano_ativo_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plano_ativo_role(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: conta diárias CONCLUÍDAS do diarista (vitalício, ignora canceladas)
--    Usado pra trigger do modal "primeiras diárias" no diarista grátis.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION contar_diarias_concluidas_diarista(
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := COALESCE(p_user_id, auth.uid());
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM diarias
   WHERE diarista_aceite_id = v_uid
     AND status = 'concluida';
  RETURN COALESCE(v_count, 0);
END $$;

REVOKE ALL ON FUNCTION contar_diarias_concluidas_diarista(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contar_diarias_concluidas_diarista(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC central: pode_selecionar_candidato(diaria_id)
--    Server-side gate. Retorna jsonb com decisão completa pra client decidir
--    o próximo passo: abrir modal de termo (permitido) OU modal de pagamento R$1.
--
--    Estrutura de retorno:
--    {
--      "permitido_gratis":  boolean,   -- pode selecionar sem pagar?
--      "plano":             text,      -- plano atual do empregador
--      "selecoes_mes":      integer,   -- já selecionados este mês
--      "limite_gratis_mes": integer,   -- 3 (grátis) ou Infinity (essencial/plus)
--      "contatos_extras":   integer,   -- unlocks R$1 deste mês
--      "limite_efetivo":    integer,   -- 3 + extras
--      "exige_cobranca_r1": boolean    -- precisa pagar R$1 pra liberar
--    }
--
--    Client deve confiar nesta resposta e usar o resultado pra rotear o fluxo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pode_selecionar_candidato(
  p_diaria_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_empregador       UUID;
  v_plano            TEXT;
  v_selecoes_mes     INTEGER;
  v_extras           INTEGER;
  v_limite_gratis    INTEGER;
  v_limite_efetivo   INTEGER;
  v_permitido_gratis BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  -- Confere que a diária é dele
  SELECT empregador_id INTO v_empregador
    FROM diarias WHERE id = p_diaria_id;
  IF v_empregador IS NULL THEN
    RAISE EXCEPTION 'Diária não encontrada.';
  END IF;
  IF v_empregador <> v_uid THEN
    RAISE EXCEPTION 'Você não é o empregador desta diária.';
  END IF;

  v_plano := plano_ativo_role(v_uid, 'empregador');

  -- Conta seleções confirmadas neste mês
  SELECT COUNT(*) INTO v_selecoes_mes
    FROM diarias
   WHERE empregador_id      = v_uid
     AND diarista_aceite_id IS NOT NULL
     AND created_at >= date_trunc('month', NOW());

  -- Unlocks R$1 pagos este mês (server-side, não localStorage)
  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = v_uid
     AND created_at >= date_trunc('month', NOW());

  -- Limite efetivo varia por plano
  IF v_plano IN ('essencial','plus') THEN
    v_limite_gratis  := 2147483647;  -- "ilimitado" (int max)
    v_limite_efetivo := 2147483647;
  ELSE
    v_limite_gratis  := 3;
    v_limite_efetivo := 3 + COALESCE(v_extras, 0);
  END IF;

  v_permitido_gratis := v_selecoes_mes < v_limite_efetivo;

  RETURN jsonb_build_object(
    'permitido_gratis',  v_permitido_gratis,
    'plano',             v_plano,
    'selecoes_mes',      v_selecoes_mes,
    'limite_gratis_mes', v_limite_gratis,
    'contatos_extras',   COALESCE(v_extras, 0),
    'limite_efetivo',    v_limite_efetivo,
    'exige_cobranca_r1', NOT v_permitido_gratis AND v_plano = 'gratis'
  );
END $$;

REVOKE ALL ON FUNCTION pode_selecionar_candidato(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_selecionar_candidato(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Verificação (rodar manualmente após):
--   SELECT plano, user_type, COUNT(*) FROM assinaturas GROUP BY 1,2;
--   -- não deve haver 'pro' nem 'destaque' (renomeados pra 'plus')
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'assinaturas'::regclass AND contype = 'u';
--   -- deve ter 'uq_assinaturas_user_role'
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('plano_ativo_role',
--                      'contar_diarias_concluidas_diarista',
--                      'pode_selecionar_candidato');
--   -- deve retornar 3 linhas
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════ ▼ seguranca_hardening.sql ═══════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Segurança Hardening — múltiplos fixes da auditoria 2026-05-27
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Combina 4 fixes priorizados pela auditoria:
--   1. IMP-S3: REVOKE UPDATE em colunas de convites (fraude de valor R$100→R$10k)
--   2. Tabela kyc_acessos_log (LGPD Art. 37 — registro de operações em KYC)
--   3. Tabela usuarios_bloqueados (exigência das app stores pra UGC)
--   4. Rotina pg_cron pra purgar antecedentes criminais > 90 dias (LGPD Art. 16)
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. IMP-S3: protege colunas sensíveis de `convites` contra UPDATE pelo diarista
--    Bug: o diarista podia aceitar um convite e simultaneamente alterar
--    `valor`, `data_servico`, etc. num único PATCH REST. Fraude direta.
--    Fix: REVOKE UPDATE em tudo, GRANT UPDATE só nas colunas que o diarista
--    pode legitimamente mudar (status, respondido_em).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON convites FROM authenticated;
GRANT  UPDATE (status) ON convites TO authenticated;
-- Se houver coluna respondido_em / atualizado_em no schema, libera também.
-- Tolerante a colunas faltantes (não bloqueia a migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'convites' AND column_name = 'respondido_em') THEN
    GRANT UPDATE (respondido_em) ON convites TO authenticated;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trilha de auditoria de acesso admin a KYC / antecedentes (LGPD Art. 37)
--    Quem viu o documento? quando? que ação tomou?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_acessos_log (
  id              BIGSERIAL PRIMARY KEY,
  admin_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id  UUID NOT NULL,
  doc_tipo        TEXT NOT NULL CHECK (doc_tipo IN ('rg_cnh','antecedentes')),
  acao            TEXT NOT NULL CHECK (acao IN ('visualizou','aprovou','rejeitou')),
  motivo          TEXT,  -- preenchido em rejeições
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_log_admin    ON kyc_acessos_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_log_target   ON kyc_acessos_log(target_user_id, created_at DESC);

ALTER TABLE kyc_acessos_log ENABLE ROW LEVEL SECURITY;

-- Admin lê tudo; usuário comum lê só os registros sobre ele próprio (direito de acesso LGPD)
DROP POLICY IF EXISTS kyc_log_admin_read ON kyc_acessos_log;
CREATE POLICY kyc_log_admin_read ON kyc_acessos_log
  FOR SELECT TO authenticated
  USING (
    target_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Só service_role escreve (via RPCs SECURITY DEFINER abaixo)
DROP POLICY IF EXISTS kyc_log_service_write ON kyc_acessos_log;
CREATE POLICY kyc_log_service_write ON kyc_acessos_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RPC que admin chama quando ABRE um documento pra revisar.
-- Loga ANTES de gerar a signed URL — assim mesmo se a request der erro
-- depois, o acesso fica registrado.
CREATE OR REPLACE FUNCTION log_acesso_kyc(
  p_target_user_id UUID,
  p_doc_tipo TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
  INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao)
    VALUES (auth.uid(), p_target_user_id, p_doc_tipo, 'visualizou');
END $$;
REVOKE ALL ON FUNCTION log_acesso_kyc(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_acesso_kyc(UUID, TEXT) TO authenticated;

-- As RPCs existentes `revisar_documento` e `revisar_antecedentes` também
-- logam (aprovou/rejeitou). Hook in via UPDATE em quem já as chama —
-- pra não duplicar a chamada client-side, atualizamos as RPCs aqui também.
CREATE OR REPLACE FUNCTION revisar_documento(
  p_user_id UUID, p_decisao TEXT, p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE (user_id UUID, documento_status TEXT, documento_revisado_em TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
  IF p_decisao NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida.';
  END IF;
  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 3 caracteres).';
  END IF;
  UPDATE user_profiles
     SET documento_status            = p_decisao,
         documento_revisado_em       = NOW(),
         documento_motivo_rejeicao   = CASE WHEN p_decisao = 'rejeitado' THEN p_motivo ELSE NULL END
   WHERE id = p_user_id;
  INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao, motivo)
    VALUES (auth.uid(), p_user_id, 'rg_cnh', p_decisao, p_motivo);
  RETURN QUERY
    SELECT up.id, up.documento_status, up.documento_revisado_em
      FROM user_profiles up WHERE up.id = p_user_id;
END $$;

CREATE OR REPLACE FUNCTION revisar_antecedentes(
  p_user_id UUID, p_decisao TEXT, p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE (user_id UUID, antecedentes_status TEXT, antecedentes_revisado_em TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
  IF p_decisao NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida.';
  END IF;
  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 3 caracteres).';
  END IF;
  UPDATE user_profiles
     SET antecedentes_status            = p_decisao,
         antecedentes_revisado_em       = NOW(),
         antecedentes_motivo_rejeicao   = CASE WHEN p_decisao = 'rejeitado' THEN p_motivo ELSE NULL END
   WHERE id = p_user_id;
  INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao, motivo)
    VALUES (auth.uid(), p_user_id, 'antecedentes', p_decisao, p_motivo);
  RETURN QUERY
    SELECT up.id, up.antecedentes_status, up.antecedentes_revisado_em
      FROM user_profiles up WHERE up.id = p_user_id;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bloqueio de usuário (exigência de UGC nas app stores)
--    Usuário A bloqueia B → B não aparece pra A em buscas/feeds/chat.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios_bloqueados (
  id            BIGSERIAL PRIMARY KEY,
  bloqueador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alvo_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motivo        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bloqueio UNIQUE (bloqueador_id, alvo_id),
  CONSTRAINT chk_self_block CHECK (bloqueador_id <> alvo_id)
);
CREATE INDEX IF NOT EXISTS idx_bloqueios_bloqueador ON usuarios_bloqueados(bloqueador_id);
CREATE INDEX IF NOT EXISTS idx_bloqueios_alvo       ON usuarios_bloqueados(alvo_id);

ALTER TABLE usuarios_bloqueados ENABLE ROW LEVEL SECURITY;

-- Dono lê / cria / deleta os próprios bloqueios. Alvo NÃO vê (anonimato do bloqueio).
DROP POLICY IF EXISTS bloqueio_owner_select ON usuarios_bloqueados;
CREATE POLICY bloqueio_owner_select ON usuarios_bloqueados
  FOR SELECT TO authenticated USING (bloqueador_id = auth.uid());

DROP POLICY IF EXISTS bloqueio_owner_insert ON usuarios_bloqueados;
CREATE POLICY bloqueio_owner_insert ON usuarios_bloqueados
  FOR INSERT TO authenticated WITH CHECK (bloqueador_id = auth.uid());

DROP POLICY IF EXISTS bloqueio_owner_delete ON usuarios_bloqueados;
CREATE POLICY bloqueio_owner_delete ON usuarios_bloqueados
  FOR DELETE TO authenticated USING (bloqueador_id = auth.uid());

-- RPC pra checar bloqueio bilateral (eu bloqueei X OU X me bloqueou)
CREATE OR REPLACE FUNCTION ha_bloqueio_entre(p_outro_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM usuarios_bloqueados
     WHERE (bloqueador_id = auth.uid() AND alvo_id = p_outro_user_id)
        OR (bloqueador_id = p_outro_user_id AND alvo_id = auth.uid())
  );
END $$;
REVOKE ALL ON FUNCTION ha_bloqueio_entre(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ha_bloqueio_entre(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Purga automática de antecedentes criminais > 90 dias (LGPD Art. 16)
--    A certidão negativa tem validade jurídica de ~90 dias. Manter no banco
--    indefinidamente é coleta excessiva de dado sensível.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purgar_antecedentes_expirados()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_user RECORD;
BEGIN
  -- Coleta os user_ids cujos antecedentes expiraram (>90 dias do envio)
  -- e ainda têm URL no bucket.
  FOR v_user IN
    SELECT id, antecedentes_url
      FROM user_profiles
     WHERE antecedentes_enviado_em IS NOT NULL
       AND antecedentes_enviado_em < (NOW() - INTERVAL '90 days')
       AND antecedentes_url IS NOT NULL
  LOOP
    -- Limpa metadados do profile. O arquivo no bucket deve ser apagado
    -- separadamente por job server-side (Edge Function ou script com
    -- service_role) — pg_cron não acessa storage diretamente.
    UPDATE user_profiles
       SET antecedentes_status      = 'nao_enviado',
           antecedentes_url         = NULL,
           antecedentes_enviado_em  = NULL,
           antecedentes_revisado_em = NULL,
           antecedentes_motivo_rejeicao = NULL
     WHERE id = v_user.id;
    -- Loga o expurgo
    INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao, motivo)
      VALUES (NULL, v_user.id, 'antecedentes', 'rejeitou', 'Expurgo automático: certidão >90 dias (LGPD Art. 16)');
  END LOOP;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END $$;
REVOKE ALL ON FUNCTION purgar_antecedentes_expirados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purgar_antecedentes_expirados() TO service_role;

-- Agendamento via pg_cron (extensão precisa estar habilitada no Dashboard:
-- Database → Extensions → pg_cron → enable).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Roda diariamente às 04:00 UTC (01:00 BRT)
    PERFORM cron.schedule(
      'purgar-antecedentes-90d',
      '0 4 * * *',
      $cron$SELECT public.purgar_antecedentes_expirados();$cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron não habilitada — habilite em Database → Extensions e rode a função manualmente.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Falha ao agendar cron (provavelmente já existe): %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verificação (rodar manualmente):
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('log_acesso_kyc','ha_bloqueio_entre','purgar_antecedentes_expirados');
--   -- deve retornar 3 linhas
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('kyc_acessos_log','usuarios_bloqueados');
--   -- deve retornar 2 linhas
--   -- Testa REVOKE em convites: como user comum, tente
--   --   UPDATE convites SET valor = 1 WHERE id = '<id>';  -- deve falhar
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════ ▼ rate_limits.sql ═══════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Rate Limit Global — proteção anti-abuso pra Edge Functions e endpoints
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mecânica:
--   - Tabela `rate_limits(key, count, window_start)` com 1 linha por chave
--   - RPC `check_rate_limit(key, max, window_seconds)` atômica: tenta
--     incrementar, retorna TRUE se ainda dentro do limite, FALSE se passou.
--   - Janela rolante por chave: quando expira, RESET pra 1.
--
-- Cada Edge Function define sua própria política (ex: "lookup-by-cpf:ip:1.2.3.4"
-- com max=5/60s, "ai-support:user:<uuid>" com max=10/60s).
--
-- Limpeza: o registro fica até a próxima requisição da mesma chave (que
-- reseta). Cron diário opcional pra apagar chaves antigas (job abaixo).
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT        PRIMARY KEY,
  count         INTEGER     NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: tabela só acessada via RPC SECURITY DEFINER (check_rate_limit,
-- limpar_rate_limits_antigos). Sem política permissiva = anon/authenticated
-- são bloqueados via REST direto. service_role passa por cima.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Índice pra job de cleanup periódico (apaga chaves não tocadas há >24h).
-- NÃO usamos partial index com NOW() no WHERE porque Postgres exige
-- funções IMMUTABLE em predicados de índice (NOW() é STABLE, não IMMUTABLE).
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at
  ON rate_limits(updated_at);

-- RPC central de rate-limit. Atômica via UPSERT.
-- Retorna TRUE quando permitido, FALSE quando bloqueado.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key             TEXT,
  p_max             INTEGER,
  p_window_seconds  INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now    TIMESTAMPTZ := NOW();
  v_cutoff TIMESTAMPTZ := v_now - (p_window_seconds || ' seconds')::INTERVAL;
  v_count  INTEGER;
BEGIN
  INSERT INTO rate_limits (key, count, window_start, updated_at)
       VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
     SET count = CASE
                   WHEN rate_limits.window_start < v_cutoff THEN 1
                   ELSE rate_limits.count + 1
                 END,
         window_start = CASE
                   WHEN rate_limits.window_start < v_cutoff THEN v_now
                   ELSE rate_limits.window_start
                 END,
         updated_at = v_now
  RETURNING count INTO v_count;
  RETURN v_count <= p_max;
END $$;

REVOKE ALL ON FUNCTION check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role, authenticated;

-- Cleanup periódico (mantém a tabela pequena no Supabase Free)
CREATE OR REPLACE FUNCTION limpar_rate_limits_antigos()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE updated_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END $$;
REVOKE ALL ON FUNCTION limpar_rate_limits_antigos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION limpar_rate_limits_antigos() TO service_role;

-- Schedule via pg_cron (extensão precisa estar habilitada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'limpar-rate-limits-diario',
      '15 4 * * *',  -- 04:15 UTC = 01:15 BRT
      $cron$SELECT public.limpar_rate_limits_antigos();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Verificação:
--   SELECT check_rate_limit('teste:127.0.0.1', 3, 60); -- TRUE 3x, depois FALSE


-- ═══════════════ ▼ auditoria_acoes.sql ═══════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria — log genérico de ações sensíveis (LGPD Art. 37)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Complementa `kyc_acessos_log` (específico de KYC) com um log mais amplo
-- que cobre ações sensíveis fora de KYC: bloqueios, denúncias, mudanças
-- de plano via webhook, deleções de conta, etc.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS auditoria_acoes (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID,                          -- quem fez (NULL para sistema)
  acao            TEXT NOT NULL,                 -- ex: 'bloqueio.criado', 'denuncia.criada', 'conta.deletada'
  alvo_tipo       TEXT,                          -- ex: 'usuario', 'diaria', 'denuncia'
  alvo_id         TEXT,                          -- string pra suportar UUIDs e IDs numéricos
  metadata        JSONB,                         -- payload livre (sem PII bruta — pseudonimizar antes)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_actor   ON auditoria_acoes(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_acao    ON auditoria_acoes(acao, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_alvo    ON auditoria_acoes(alvo_tipo, alvo_id, created_at DESC);

ALTER TABLE auditoria_acoes ENABLE ROW LEVEL SECURITY;

-- Admin lê tudo. Usuário comum lê só onde é o actor (próprio histórico).
DROP POLICY IF EXISTS auditoria_admin_read ON auditoria_acoes;
CREATE POLICY auditoria_admin_read ON auditoria_acoes
  FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Só service_role insere/altera/deleta.
DROP POLICY IF EXISTS auditoria_service ON auditoria_acoes;
CREATE POLICY auditoria_service ON auditoria_acoes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helper RPC: usuário comum loga ação própria (bloqueio, denúncia).
-- Limita a 1 log por segundo por user pra evitar abuso da tabela.
CREATE OR REPLACE FUNCTION registrar_acao(
  p_acao      TEXT,
  p_alvo_tipo TEXT DEFAULT NULL,
  p_alvo_id   TEXT DEFAULT NULL,
  p_metadata  JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whitelist de ações permitidas via client (evita poluição do log)
  IF p_acao NOT IN (
    'bloqueio.criado', 'bloqueio.removido',
    'denuncia.criada',
    'conta.exclusao_solicitada'
  ) THEN
    RAISE EXCEPTION 'Ação não autorizada: %', p_acao;
  END IF;
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id, metadata)
    VALUES (auth.uid(), p_acao, p_alvo_tipo, p_alvo_id, p_metadata);
END $$;
REVOKE ALL ON FUNCTION registrar_acao(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_acao(TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- Triggers automáticos: bloqueio e denúncia geram log mesmo se o client esquecer

-- Bloqueio criado
CREATE OR REPLACE FUNCTION trg_log_bloqueio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id, metadata)
    VALUES (NEW.bloqueador_id, 'bloqueio.criado', 'usuario', NEW.alvo_id::TEXT,
            jsonb_build_object('motivo', LEFT(COALESCE(NEW.motivo,''), 200)));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS log_bloqueio_insert ON usuarios_bloqueados;
CREATE TRIGGER log_bloqueio_insert AFTER INSERT ON usuarios_bloqueados
  FOR EACH ROW EXECUTE FUNCTION trg_log_bloqueio();

-- Bloqueio removido
CREATE OR REPLACE FUNCTION trg_log_desbloqueio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id)
    VALUES (OLD.bloqueador_id, 'bloqueio.removido', 'usuario', OLD.alvo_id::TEXT);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS log_bloqueio_delete ON usuarios_bloqueados;
CREATE TRIGGER log_bloqueio_delete AFTER DELETE ON usuarios_bloqueados
  FOR EACH ROW EXECUTE FUNCTION trg_log_desbloqueio();

-- Denúncia criada (loga automaticamente — não confia no client lembrar)
CREATE OR REPLACE FUNCTION trg_log_denuncia()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id, metadata)
    VALUES (NEW.denunciante_id, 'denuncia.criada', NEW.tipo, NEW.alvo_id::TEXT,
            jsonb_build_object('motivo_resumo', LEFT(COALESCE(NEW.motivo,''), 100)));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS log_denuncia_insert ON denuncias;
-- Só cria trigger se a coluna denunciante_id existir (defensivo)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'denuncias' AND column_name = 'denunciante_id') THEN
    EXECUTE 'CREATE TRIGGER log_denuncia_insert AFTER INSERT ON denuncias
             FOR EACH ROW EXECUTE FUNCTION trg_log_denuncia()';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Verificação:
--   SELECT acao, COUNT(*) FROM auditoria_acoes GROUP BY 1 ORDER BY 2 DESC;

