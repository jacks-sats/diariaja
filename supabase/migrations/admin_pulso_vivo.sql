-- ═══════════════════════════════════════════════════════════════════════════
-- Painel admin — PULSO (home do fundador): os sinais vitais do marketplace.
-- Cada numero tem UMA definicao exata e honesta. Nada de vago, nada inventado.
-- ═══════════════════════════════════════════════════════════════════════════
-- Definicoes (pra nao haver ambiguidade nem repeticao com as outras abas):
--   • empresas_ativas_hoje       = anunciantes (empregador/ambos) com atividade HOJE.
--   • prestadores_ativos_hoje    = prestadores (diarista/ambos) com atividade HOJE.
--   • empresas_ativas_periodo    = anunciantes UNICOS ativos no periodo (atividade_diaria).
--   • prestadores_ativos_periodo = prestadores UNICOS ativos no periodo (atividade_diaria).
--       ↳ *_ant = mesma medida no periodo anterior de igual tamanho (pro delta real).
--       ↳ NULL se a tabela atividade_diaria ainda nao existir (migracao nao rodada).
--   • vagas_abertas              = diarias status='aberta' e nao vencidas (agora).
--   • vagas_sem_candidato        = vagas abertas SEM nenhum interessado (onde agir).
--   • empresas_esperando_resposta= empresas UNICAS com candidato recebido e ainda
--                                   nao respondido (nem selecionou nem rejeitou).
--   • candidatos_aguardando_retorno = candidaturas pendentes de resposta da empresa.
--   • media_candidatos_vaga      = candidaturas nao-recusadas ÷ vagas criadas no periodo.
--   • tempo_1a_candidatura_h     = MEDIANA de horas entre publicar e a 1a candidatura.
--   • tempo_contratacao_h        = MEDIANA de horas entre publicar e a selecao.
--   • contratacoes               = candidaturas com selecionado_em no periodo.
--   • diarias_concluidas         = diarias status='concluida' finalizadas no periodo (checkout_em).
--   • valor_movimentado          = soma do valor das diarias/servicos CONCLUIDOS no periodo (GMV).
--
-- Metricas de fluxo/atividade vem com o valor do PERIODO ANTERIOR de mesmo
-- tamanho, pro front mostrar se esta crescendo (o "esta vivo").
--
-- So-admin (assert_admin_caller). Idempotente. Aplicar no SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_pulso_vivo(p_dias INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias    INT := GREATEST(1, LEAST(COALESCE(p_dias, 30), 365));
  v_ini     TIMESTAMPTZ := NOW() - make_interval(days => v_dias);
  v_ini_ant TIMESTAMPTZ := NOW() - make_interval(days => v_dias * 2);
  -- Atividade por dia (retencao) pode nao ter sido criada ainda — guardamos.
  v_tem_atividade BOOLEAN := to_regclass('public.atividade_diaria') IS NOT NULL;
  v_emp_per INT; v_emp_ant INT; v_pre_per INT; v_pre_ant INT;
  v_out     JSONB;
BEGIN
  PERFORM assert_admin_caller();

  -- Ativos UNICOS por lado, no periodo e no periodo anterior (delta honesto).
  -- So calcula se o historico existe; senao o front cai no snapshot "hoje".
  IF v_tem_atividade THEN
    SELECT
      COUNT(DISTINCT ad.user_id) FILTER (
        WHERE up.user_type IN ('empregador','ambos') AND ad.dia > CURRENT_DATE - v_dias),
      COUNT(DISTINCT ad.user_id) FILTER (
        WHERE up.user_type IN ('empregador','ambos')
          AND ad.dia > CURRENT_DATE - v_dias * 2 AND ad.dia <= CURRENT_DATE - v_dias),
      COUNT(DISTINCT ad.user_id) FILTER (
        WHERE up.user_type IN ('diarista','ambos') AND ad.dia > CURRENT_DATE - v_dias),
      COUNT(DISTINCT ad.user_id) FILTER (
        WHERE up.user_type IN ('diarista','ambos')
          AND ad.dia > CURRENT_DATE - v_dias * 2 AND ad.dia <= CURRENT_DATE - v_dias)
      INTO v_emp_per, v_emp_ant, v_pre_per, v_pre_ant
    FROM atividade_diaria ad
    JOIN user_profiles up ON up.id = ad.user_id
    WHERE ad.dia > CURRENT_DATE - v_dias * 2;
  END IF;

  SELECT jsonb_build_object(
    -- ── Agora (snapshots) ──────────────────────────────────────────────────
    'empresas_ativas_hoje', (
      SELECT COUNT(*)::INT FROM user_profiles
       WHERE user_type IN ('empregador','ambos') AND last_activity_at::date = CURRENT_DATE),
    'prestadores_ativos_hoje', (
      SELECT COUNT(*)::INT FROM user_profiles
       WHERE user_type IN ('diarista','ambos') AND last_activity_at::date = CURRENT_DATE),
    'empresas_ativas_periodo',    v_emp_per,
    'empresas_ativas_periodo_ant', v_emp_ant,
    'prestadores_ativos_periodo',  v_pre_per,
    'prestadores_ativos_periodo_ant', v_pre_ant,
    'vagas_abertas', (
      SELECT COUNT(*)::INT FROM diarias d
       WHERE d.status = 'aberta'
         AND (d.tipo_oferta = 'emprego'
              OR COALESCE(NULLIF(d.data::text,''),'1900-01-01')::date >= CURRENT_DATE)),

    -- ── Onde agir (gargalos acionaveis, snapshot agora) ────────────────────
    'vagas_sem_candidato', (
      SELECT COUNT(*)::INT FROM diarias d
       WHERE d.status = 'aberta'
         AND (d.tipo_oferta = 'emprego'
              OR COALESCE(NULLIF(d.data::text,''),'1900-01-01')::date >= CURRENT_DATE)
         AND NOT EXISTS (
           SELECT 1 FROM candidaturas c
            WHERE c.diaria_id = d.id AND c.status <> 'rejeitado')),
    'empresas_esperando_resposta', (
      SELECT COUNT(DISTINCT d.empregador_id)::INT FROM diarias d
       WHERE d.status = 'aberta'
         AND (d.tipo_oferta = 'emprego'
              OR COALESCE(NULLIF(d.data::text,''),'1900-01-01')::date >= CURRENT_DATE)
         AND EXISTS (
           SELECT 1 FROM candidaturas c
            WHERE c.diaria_id = d.id AND c.selecionado_em IS NULL AND c.status <> 'rejeitado')),
    'candidatos_aguardando_retorno', (
      SELECT COUNT(*)::INT FROM candidaturas c
        JOIN diarias d ON d.id = c.diaria_id
       WHERE d.status = 'aberta'
         AND (d.tipo_oferta = 'emprego'
              OR COALESCE(NULLIF(d.data::text,''),'1900-01-01')::date >= CURRENT_DATE)
         AND c.selecionado_em IS NULL AND c.status <> 'rejeitado'),

    -- ── Liquidez / velocidade (periodo) ────────────────────────────────────
    'media_candidatos_vaga', COALESCE((
      SELECT ROUND(
               COUNT(*) FILTER (WHERE c.id IS NOT NULL)::numeric
               / NULLIF(COUNT(DISTINCT d.id), 0), 1)
        FROM diarias d
        LEFT JOIN candidaturas c ON c.diaria_id = d.id AND c.status <> 'rejeitado'
       WHERE d.created_at >= v_ini), 0),
    'tempo_1a_candidatura_h', (
      SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (prim.primeira - d.created_at)) / 3600.0)::numeric, 1)
        FROM diarias d
        JOIN LATERAL (
          SELECT MIN(c.created_at) AS primeira
            FROM candidaturas c WHERE c.diaria_id = d.id AND c.status <> 'rejeitado'
        ) prim ON prim.primeira IS NOT NULL
       WHERE d.created_at >= v_ini),
    'tempo_contratacao_h', (
      SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (c.selecionado_em - d.created_at)) / 3600.0)::numeric, 1)
        FROM candidaturas c
        JOIN diarias d ON d.id = c.diaria_id
       WHERE c.selecionado_em >= v_ini
         AND c.selecionado_em >= d.created_at),

    -- ── Fluxo (periodo) + periodo anterior pro delta ───────────────────────
    'contratacoes', (
      SELECT COUNT(*)::INT FROM candidaturas c WHERE c.selecionado_em >= v_ini),
    'contratacoes_ant', (
      SELECT COUNT(*)::INT FROM candidaturas c
       WHERE c.selecionado_em >= v_ini_ant AND c.selecionado_em < v_ini),

    'diarias_concluidas', (
      SELECT COUNT(*)::INT FROM diarias d
       WHERE d.status = 'concluida' AND COALESCE(d.checkout_em, d.created_at) >= v_ini),
    'diarias_concluidas_ant', (
      SELECT COUNT(*)::INT FROM diarias d
       WHERE d.status = 'concluida'
         AND COALESCE(d.checkout_em, d.created_at) >= v_ini_ant
         AND COALESCE(d.checkout_em, d.created_at) < v_ini),

    'valor_movimentado', COALESCE((
      SELECT SUM(d.valor)::numeric FROM diarias d
       WHERE d.status = 'concluida'
         AND d.tipo_oferta IN ('diaria','servico','servico_empresa')
         AND COALESCE(d.valor,0) > 0
         AND COALESCE(d.checkout_em, d.created_at) >= v_ini), 0),
    'valor_movimentado_ant', COALESCE((
      SELECT SUM(d.valor)::numeric FROM diarias d
       WHERE d.status = 'concluida'
         AND d.tipo_oferta IN ('diaria','servico','servico_empresa')
         AND COALESCE(d.valor,0) > 0
         AND COALESCE(d.checkout_em, d.created_at) >= v_ini_ant
         AND COALESCE(d.checkout_em, d.created_at) < v_ini), 0),

    'periodo_dias', v_dias
  ) INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION admin_pulso_vivo(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_pulso_vivo(INT) FROM anon;
GRANT EXECUTE ON FUNCTION admin_pulso_vivo(INT) TO authenticated;

SELECT 'Pulso do fundador instalado/atualizado (admin_pulso_vivo v2).' AS resultado;
