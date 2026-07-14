-- ============================================================================
-- Painel Admin - retencao por lado (prestadores x anunciantes)
-- ============================================================================
-- Mostra para o dono do app:
-- - quantos prestadores e anunciantes existem;
-- - quantos voltam hoje / 7d / 30d;
-- - quantos sao retornantes e recorrentes;
-- - frequencia media de retorno nos ultimos 14 dias.
--
-- Idempotente. Pode rodar no SQL Editor do Supabase mais de uma vez.
-- ============================================================================

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

CREATE TABLE IF NOT EXISTS atividade_diaria (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Campo_Grande')::DATE),
  PRIMARY KEY (user_id, dia)
);

CREATE INDEX IF NOT EXISTS idx_atividade_diaria_dia ON atividade_diaria (dia);
ALTER TABLE atividade_diaria ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION registrar_atividade_diaria()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO atividade_diaria (user_id, dia)
  VALUES (auth.uid(), (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE)
  ON CONFLICT (user_id, dia) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION registrar_atividade_diaria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_atividade_diaria() TO authenticated;

CREATE OR REPLACE FUNCTION admin_retencao_por_lado()
RETURNS TABLE (
  tipo              TEXT,
  total_usuarios    INTEGER,
  ativos_hoje       INTEGER,
  ativos_7d         INTEGER,
  ativos_30d        INTEGER,
  retornantes_7d    INTEGER,
  recorrentes_14d   INTEGER,
  freq_media_14d    NUMERIC,
  stickiness_pct    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE;
BEGIN
  PERFORM assert_admin_caller();

  RETURN QUERY
  WITH tipos AS (
    SELECT 'empregador'::TEXT AS tipo
    UNION ALL
    SELECT 'diarista'::TEXT AS tipo
  ),
  dias_14 AS (
    SELECT
      up.user_type::TEXT AS tipo,
      up.id AS user_id,
      COUNT(DISTINCT ad.dia)::INTEGER AS dias_ativos
    FROM user_profiles up
    JOIN atividade_diaria ad ON ad.user_id = up.id
    WHERE up.user_type IN ('empregador', 'diarista')
      AND ad.dia > v_hoje - 14
    GROUP BY up.user_type, up.id
  ),
  dias_7 AS (
    SELECT
      up.user_type::TEXT AS tipo,
      up.id AS user_id,
      COUNT(DISTINCT ad.dia)::INTEGER AS dias_ativos
    FROM user_profiles up
    JOIN atividade_diaria ad ON ad.user_id = up.id
    WHERE up.user_type IN ('empregador', 'diarista')
      AND ad.dia > v_hoje - 7
    GROUP BY up.user_type, up.id
  )
  SELECT
    t.tipo,
    COALESCE((SELECT COUNT(*)::INTEGER FROM user_profiles up WHERE up.user_type = t.tipo), 0),
    COALESCE((SELECT COUNT(DISTINCT ad.user_id)::INTEGER
      FROM atividade_diaria ad
      JOIN user_profiles up ON up.id = ad.user_id
      WHERE up.user_type = t.tipo
        AND ad.dia = v_hoje), 0),
    COALESCE((SELECT COUNT(DISTINCT ad.user_id)::INTEGER
      FROM atividade_diaria ad
      JOIN user_profiles up ON up.id = ad.user_id
      WHERE up.user_type = t.tipo
        AND ad.dia > v_hoje - 7), 0),
    COALESCE((SELECT COUNT(DISTINCT ad.user_id)::INTEGER
      FROM atividade_diaria ad
      JOIN user_profiles up ON up.id = ad.user_id
      WHERE up.user_type = t.tipo
        AND ad.dia > v_hoje - 30), 0),
    COALESCE((SELECT COUNT(*)::INTEGER
      FROM dias_7 d
      WHERE d.tipo = t.tipo
        AND d.dias_ativos >= 2), 0),
    COALESCE((SELECT COUNT(*)::INTEGER
      FROM dias_14 d
      WHERE d.tipo = t.tipo
        AND d.dias_ativos >= 7), 0),
    COALESCE((SELECT ROUND(AVG(d.dias_ativos)::NUMERIC, 1)
      FROM dias_14 d
      WHERE d.tipo = t.tipo), 0),
    CASE
      WHEN COALESCE((SELECT COUNT(DISTINCT ad.user_id)
        FROM atividade_diaria ad
        JOIN user_profiles up ON up.id = ad.user_id
        WHERE up.user_type = t.tipo
          AND ad.dia > v_hoje - 30), 0) = 0 THEN 0
      ELSE (
        COALESCE((SELECT COUNT(DISTINCT ad.user_id)
          FROM atividade_diaria ad
          JOIN user_profiles up ON up.id = ad.user_id
          WHERE up.user_type = t.tipo
            AND ad.dia = v_hoje), 0) * 100
        /
        COALESCE((SELECT COUNT(DISTINCT ad.user_id)
          FROM atividade_diaria ad
          JOIN user_profiles up ON up.id = ad.user_id
          WHERE up.user_type = t.tipo
            AND ad.dia > v_hoje - 30), 1)
      )::INTEGER
    END
  FROM tipos t
  ORDER BY CASE t.tipo WHEN 'empregador' THEN 1 ELSE 2 END;
END $$;

REVOKE ALL ON FUNCTION admin_retencao_por_lado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_retencao_por_lado() TO authenticated;

SELECT COUNT(*) AS func_criada
FROM pg_proc
WHERE proname = 'admin_retencao_por_lado';
