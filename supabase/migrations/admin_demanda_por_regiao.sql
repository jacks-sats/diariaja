-- ═══════════════════════════════════════════════════════════════════════════
-- Painel admin: demanda × oferta por região (mapa de calor + top bairros)
-- ═══════════════════════════════════════════════════════════════════════════
-- RPC admin_demanda_por_regiao(p_dias) — SÓ ADMIN (assert_admin_caller, mesmo
-- padrão de admin_metricas_avancadas.sql). Devolve um JSONB com 3 blocos:
--
--   demanda_grade : diárias/vagas criadas no período, agregadas por célula de
--                   grade (lat/lng arredondados a 2 casas ≈ 1,1 km — mesma
--                   granularidade das RPCs públicas; nada de coordenada exata).
--   oferta_grade  : prestadores cadastrados (visíveis), pela mesma grade —
--                   pra cruzar "onde tem vaga sem gente" e vice-versa.
--   top_bairros   : ranking de bairros por vagas no período, com candidaturas
--                   e valor médio (só valores > 0 entram na média).
--
-- O front desenha isso sobre tiles do OpenStreetMap no painel admin
-- (seção "Demanda por região"). Se esta migração ainda não rodou, o painel
-- só não mostra a seção — nada quebra (mesma degradação das outras RPCs).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_demanda_por_regiao(p_dias INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ini TIMESTAMPTZ := NOW() - GREATEST(1, LEAST(COALESCE(p_dias, 30), 365)) * INTERVAL '1 day';
  v_out JSONB;
BEGIN
  PERFORM assert_admin_caller();

  SELECT jsonb_build_object(
    'demanda_grade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lat', t.lat, 'lng', t.lng, 'total', t.total))
      FROM (
        SELECT round(d.lat::numeric, 2) AS lat,
               round(d.lng::numeric, 2) AS lng,
               COUNT(*)::INT            AS total
          FROM diarias d
         WHERE d.created_at >= v_ini
           AND d.lat IS NOT NULL AND d.lng IS NOT NULL
         GROUP BY 1, 2
         ORDER BY 3 DESC
         LIMIT 400
      ) t), '[]'::jsonb),

    'oferta_grade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lat', t.lat, 'lng', t.lng, 'total', t.total))
      FROM (
        SELECT round(up.lat::numeric, 2) AS lat,
               round(up.lng::numeric, 2) AS lng,
               COUNT(*)::INT             AS total
          FROM user_profiles up
         WHERE up.user_type IN ('diarista', 'ambos')
           AND COALESCE(up.oculto, false) = false
           AND up.lat IS NOT NULL AND up.lng IS NOT NULL
         GROUP BY 1, 2
         ORDER BY 3 DESC
         LIMIT 400
      ) t), '[]'::jsonb),

    'top_bairros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'bairro', t.bairro, 'vagas', t.vagas,
               'candidaturas', t.candidaturas, 'valor_medio', t.valor_medio))
      FROM (
        SELECT COALESCE(NULLIF(BTRIM(d.bairro), ''), '(sem bairro)') AS bairro,
               COUNT(*)::INT                                          AS vagas,
               COALESCE(SUM(c.cnt), 0)::INT                           AS candidaturas,
               ROUND(AVG(d.valor) FILTER (WHERE d.valor > 0))::INT    AS valor_medio
          FROM diarias d
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM candidaturas c WHERE c.diaria_id = d.id
          ) c ON TRUE
         WHERE d.created_at >= v_ini
         GROUP BY 1
         ORDER BY 2 DESC, 1
         LIMIT 12
      ) t), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION admin_demanda_por_regiao(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_demanda_por_regiao(INT) TO authenticated;

SELECT 'RPC admin_demanda_por_regiao instalada (mapa de demanda do painel admin).' AS resultado;
