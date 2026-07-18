-- ═══════════════════════════════════════════════════════════════════════════
-- Painel admin — PULSO (home do fundador): os sinais vitais do marketplace.
-- Cada numero tem UMA definicao exata e honesta. Nada de vago.
-- ═══════════════════════════════════════════════════════════════════════════
-- Definicoes (pra nao haver ambiguidade nem repeticao com as outras abas):
--   • empresas_ativas_hoje    = anunciantes (empregador/ambos) com atividade HOJE.
--   • prestadores_ativos_hoje = prestadores (diarista/ambos) com atividade HOJE.
--   • vagas_abertas           = diarias status='aberta' e nao vencidas (agora).
--   • media_candidatos_vaga   = candidaturas nao-recusadas ÷ vagas criadas no periodo.
--   • tempo_1a_candidatura_h  = MEDIANA de horas entre publicar e a 1a candidatura.
--   • tempo_contratacao_h     = MEDIANA de horas entre publicar e a selecao (contratacao).
--   • contratacoes            = candidaturas com selecionado_em no periodo (a contratacao aconteceu).
--   • diarias_concluidas      = diarias status='concluida' finalizadas no periodo (updated_at).
--   • valor_movimentado       = soma do valor das diarias/servicos CONCLUIDOS no periodo (GMV; emprego nao entra: salario nao e numerico).
--
-- Cada metrica de fluxo (contratacoes, diarias_concluidas, valor_movimentado)
-- vem com o valor do PERIODO ANTERIOR de mesmo tamanho, pro front mostrar se
-- esta crescendo (o "esta vivo").
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
  v_out     JSONB;
BEGIN
  PERFORM assert_admin_caller();

  SELECT jsonb_build_object(
    -- ── Agora (snapshots) ──────────────────────────────────────────────────
    'empresas_ativas_hoje', (
      SELECT COUNT(*)::INT FROM user_profiles
       WHERE user_type IN ('empregador','ambos') AND last_activity_at::date = CURRENT_DATE),
    'prestadores_ativos_hoje', (
      SELECT COUNT(*)::INT FROM user_profiles
       WHERE user_type IN ('diarista','ambos') AND last_activity_at::date = CURRENT_DATE),
    'vagas_abertas', (
      SELECT COUNT(*)::INT FROM diarias d
       WHERE d.status = 'aberta'
         AND (d.tipo_oferta = 'emprego'
              OR COALESCE(NULLIF(d.data::text,''),'1900-01-01')::date >= CURRENT_DATE)),

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
       WHERE d.status = 'concluida' AND COALESCE(d.updated_at, d.created_at) >= v_ini),
    'diarias_concluidas_ant', (
      SELECT COUNT(*)::INT FROM diarias d
       WHERE d.status = 'concluida'
         AND COALESCE(d.updated_at, d.created_at) >= v_ini_ant
         AND COALESCE(d.updated_at, d.created_at) < v_ini),

    'valor_movimentado', COALESCE((
      SELECT SUM(d.valor)::numeric FROM diarias d
       WHERE d.status = 'concluida'
         AND d.tipo_oferta IN ('diaria','servico','servico_empresa')
         AND COALESCE(d.valor,0) > 0
         AND COALESCE(d.updated_at, d.created_at) >= v_ini), 0),
    'valor_movimentado_ant', COALESCE((
      SELECT SUM(d.valor)::numeric FROM diarias d
       WHERE d.status = 'concluida'
         AND d.tipo_oferta IN ('diaria','servico','servico_empresa')
         AND COALESCE(d.valor,0) > 0
         AND COALESCE(d.updated_at, d.created_at) >= v_ini_ant
         AND COALESCE(d.updated_at, d.created_at) < v_ini), 0),

    'periodo_dias', v_dias
  ) INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION admin_pulso_vivo(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_pulso_vivo(INT) FROM anon;
GRANT EXECUTE ON FUNCTION admin_pulso_vivo(INT) TO authenticated;

SELECT 'Pulso do fundador instalado (admin_pulso_vivo).' AS resultado;
