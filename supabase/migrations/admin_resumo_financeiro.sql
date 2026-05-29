-- ============================================================================
-- Painel financeiro do admin — DiáriaJá
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que devolve, em um único JSON:
--   • unlocks       → desbloqueios de chat (R$ 1 cada): total / hoje / mês + valores
--   • unlocks_serie → série diária (14 dias) de desbloqueios
--   • planos        → assinantes ativos (snapshot), receita estimada e quebra por plano
--
-- Só admin pode chamar (mesmo padrão de admin_stats / admin_metricas_serie).
-- Preços espelham src/constants.ts. Aplicar no SQL Editor do Supabase. Idempotente.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_resumo_financeiro()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;

  SELECT jsonb_build_object(

    -- Desbloqueios de chat (R$ 1 cada) — receita real, com timestamp
    'unlocks', (
      SELECT jsonb_build_object(
        'total',       COUNT(*),
        'hoje',        COUNT(*) FILTER (WHERE created_at >= date_trunc('day',   now())),
        'mes',         COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now())),
        'valor_total', COUNT(*) * 1.0,
        'valor_hoje',  COUNT(*) FILTER (WHERE created_at >= date_trunc('day',   now())) * 1.0,
        'valor_mes',   COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now())) * 1.0
      )
      FROM contatos_desbloqueios
    ),

    -- Série diária (últimos 14 dias) de desbloqueios
    'unlocks_serie', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('dia', d, 'valor', c) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT gs::date AS d, COUNT(cd.created_at) AS c
        FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') gs
        LEFT JOIN contatos_desbloqueios cd
          ON cd.created_at >= gs AND cd.created_at < gs + interval '1 day'
        GROUP BY gs
      ) s
    ),

    -- Planos ativos (snapshot) — fonte: user_profiles.plano_ativo (vale pros 2 modelos)
    'planos', (
      SELECT jsonb_build_object(
        'ativos_total',   COUNT(*),
        'valor_estimado', COALESCE(SUM(
          CASE
            WHEN user_type = 'diarista'   AND plano_ativo = 'essencial' THEN 9.90
            WHEN user_type = 'diarista'   AND plano_ativo = 'plus'      THEN 19.90
            WHEN user_type = 'empregador' AND plano_ativo = 'essencial' THEN 24.90
            WHEN user_type = 'empregador' AND plano_ativo = 'plus'      THEN 49.90
            ELSE 0
          END
        ), 0),
        'por_plano', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('plano', plano_ativo, 'user_type', user_type, 'qtd', q)), '[]'::jsonb)
          FROM (
            SELECT plano_ativo, user_type, COUNT(*) AS q
            FROM user_profiles
            WHERE plano_ativo IS NOT NULL AND plano_ativo NOT IN ('gratis', '')
            GROUP BY plano_ativo, user_type
          ) p
        )
      )
      FROM user_profiles
      WHERE plano_ativo IS NOT NULL AND plano_ativo NOT IN ('gratis', '')
    )

  ) INTO v;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_resumo_financeiro() TO authenticated;
