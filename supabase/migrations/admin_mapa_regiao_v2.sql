-- ═══════════════════════════════════════════════════════════════════════════
-- Mapa do painel admin v2: precisão por bolha + "só abertas" + drill por região
-- ═══════════════════════════════════════════════════════════════════════════
-- Feedback do dono (16/07): a bolha gigante no centro era artefato — perfis com
-- localização APROXIMADA (centroide de CEP/cidade, geo_preciso=false) caem
-- todos na mesma célula e parecem um bairro lotado. E tocar na bolha não fazia
-- nada. Esta v2 resolve os dois e adiciona "vagas abertas AGORA":
--
--   1. admin_demanda_por_regiao ganha:
--      • campo `precisos` por célula (quantos têm geo_preciso=true) — o front
--        desenha bolha tracejada quando a célula é só-aproximada;
--      • parâmetro p_somente_abertas: TRUE = conta só vagas status='aberta'
--        e não vencidas (emprego não vence por data). FALSE = como antes
--        (publicadas no período).
--   2. NOVA admin_regiao_detalhe(p_camada, p_lat, p_lng, ...): lista o que há
--      numa célula tocada — as vagas (demanda) ou os prestadores (oferta) —
--      no MESMO shape do admin_drill_lista (reusa o modal do painel).
--
-- Tudo SÓ ADMIN (assert_admin_caller). Coordenadas seguem agregadas a 2 casas.
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- Assinatura antiga (só p_dias) sai pra não criar sobrecarga ambígua; a nova
-- tem DEFAULT no parâmetro extra, então quem chama só com p_dias continua ok.
DROP FUNCTION IF EXISTS admin_demanda_por_regiao(INT);

CREATE OR REPLACE FUNCTION admin_demanda_por_regiao(
  p_dias            INT     DEFAULT 30,
  p_somente_abertas BOOLEAN DEFAULT FALSE
)
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
      SELECT jsonb_agg(jsonb_build_object(
               'lat', t.lat, 'lng', t.lng, 'total', t.total, 'precisos', t.precisos))
      FROM (
        SELECT round(d.lat::numeric, 2) AS lat,
               round(d.lng::numeric, 2) AS lng,
               COUNT(*)::INT            AS total,
               COUNT(*) FILTER (WHERE COALESCE(d.geo_preciso, false))::INT AS precisos
          FROM diarias d
         WHERE d.created_at >= v_ini
           AND d.lat IS NOT NULL AND d.lng IS NOT NULL
           AND (NOT p_somente_abertas OR (
                 d.status = 'aberta'
                 AND (d.tipo_oferta = 'emprego'
                      OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)))
         GROUP BY 1, 2
         ORDER BY 3 DESC
         LIMIT 400
      ) t), '[]'::jsonb),

    'oferta_grade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'lat', t.lat, 'lng', t.lng, 'total', t.total, 'precisos', t.precisos))
      FROM (
        SELECT round(up.lat::numeric, 2) AS lat,
               round(up.lng::numeric, 2) AS lng,
               COUNT(*)::INT             AS total,
               COUNT(*) FILTER (WHERE COALESCE(up.geo_preciso, false))::INT AS precisos
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
           AND (NOT p_somente_abertas OR (
                 d.status = 'aberta'
                 AND (d.tipo_oferta = 'emprego'
                      OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)))
         GROUP BY 1
         ORDER BY 2 DESC, 1
         LIMIT 12
      ) t), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION admin_demanda_por_regiao(INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_demanda_por_regiao(INT, BOOLEAN) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drill por região: o que tem DENTRO da bolha tocada (célula lat/lng, 2 casas).
-- Devolve no shape do modal de drill-down do painel (id/titulo/subtitulo/badge).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_regiao_detalhe(
  p_camada          TEXT,                    -- 'demanda' | 'oferta'
  p_lat             NUMERIC,
  p_lng             NUMERIC,
  p_dias            INT     DEFAULT 30,
  p_somente_abertas BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (id TEXT, titulo TEXT, subtitulo TEXT, badge TEXT, badge_cor TEXT, criado_em TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ini TIMESTAMPTZ := NOW() - GREATEST(1, LEAST(COALESCE(p_dias, 30), 365)) * INTERVAL '1 day';
BEGIN
  PERFORM assert_admin_caller();

  IF p_camada = 'oferta' THEN
    RETURN QUERY
    SELECT up.id::text,
           COALESCE(NULLIF(BTRIM(up.nome), ''), 'Prestador') AS titulo,
           CONCAT_WS(' · ',
             NULLIF(BTRIM(COALESCE(up.funcao, '')), ''),
             CASE WHEN up.valor_diaria > 0 THEN 'R$ ' || up.valor_diaria::text ELSE NULL END,
             CASE WHEN COALESCE(up.disponivel, false) THEN 'disponível' ELSE 'indisponível' END
           ) AS subtitulo,
           CASE WHEN COALESCE(up.geo_preciso, false) THEN 'local preciso' ELSE 'aproximado' END AS badge,
           CASE WHEN COALESCE(up.geo_preciso, false) THEN '#16a34a' ELSE '#f59e0b' END AS badge_cor,
           up.created_at::text AS criado_em
      FROM user_profiles up
     WHERE up.user_type IN ('diarista', 'ambos')
       AND COALESCE(up.oculto, false) = false
       AND up.lat IS NOT NULL AND up.lng IS NOT NULL
       AND round(up.lat::numeric, 2) = round(p_lat, 2)
       AND round(up.lng::numeric, 2) = round(p_lng, 2)
     ORDER BY COALESCE(up.disponivel, false) DESC, up.created_at DESC
     LIMIT 60;
  ELSE
    RETURN QUERY
    SELECT d.id::text,
           COALESCE(NULLIF(BTRIM(d.funcao), ''), NULLIF(BTRIM(d.segmento), ''), 'Vaga') AS titulo,
           CONCAT_WS(' · ',
             NULLIF(BTRIM(COALESCE(d.bairro, '')), ''),
             CASE WHEN d.valor > 0 THEN 'R$ ' || d.valor::text ELSE NULL END,
             NULLIF(d.data::text, '')
           ) AS subtitulo,
           COALESCE(d.status, '?') AS badge,
           CASE COALESCE(d.status, '')
             WHEN 'aberta'    THEN '#16a34a'
             WHEN 'aceita'    THEN '#3A86FF'
             WHEN 'concluida' THEN '#a855f7'
             ELSE '#94a3b8'
           END AS badge_cor,
           d.created_at::text AS criado_em
      FROM diarias d
     WHERE d.created_at >= v_ini
       AND d.lat IS NOT NULL AND d.lng IS NOT NULL
       AND round(d.lat::numeric, 2) = round(p_lat, 2)
       AND round(d.lng::numeric, 2) = round(p_lng, 2)
       AND (NOT p_somente_abertas OR (
             d.status = 'aberta'
             AND (d.tipo_oferta = 'emprego'
                  OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)))
     ORDER BY d.created_at DESC
     LIMIT 60;
  END IF;
END $$;

REVOKE ALL ON FUNCTION admin_regiao_detalhe(TEXT, NUMERIC, NUMERIC, INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_regiao_detalhe(TEXT, NUMERIC, NUMERIC, INT, BOOLEAN) TO authenticated;

SELECT 'Mapa admin v2 instalado: precisos por celula, so-abertas e drill por regiao.' AS resultado;
