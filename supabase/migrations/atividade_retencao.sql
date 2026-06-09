-- ============================================================================
-- Retenção & atividade — histórico de dias ativos por usuário + métricas
-- ============================================================================
-- O painel admin já tinha "online agora" (carimbo last_activity_at), mas isso
-- só guarda a ÚLTIMA atividade — não dá pra calcular retenção/recorrência.
-- Aqui criamos um histórico leve (1 linha por usuário por dia) e as RPCs que
-- o painel consome.
--
-- ⚠️ O histórico só passa a contar A PARTIR do dia que esta migration rodar —
--    dias anteriores nunca foram gravados. Retencao fica "redonda" apos ~2 sem.
--
-- Aplicar via Supabase Dashboard → SQL Editor. Idempotente (pode re-rodar).
-- "Dia" é calculado no fuso de Campo Grande (America/Campo_Grande, UTC-4) pra
-- bater com o dia real do usuário, não o UTC do servidor.
-- ============================================================================

-- Helper de admin (já existe em admin_metricas_avancadas.sql; recriado aqui
-- pra esta migration ser auto-suficiente — mesma definição, idempotente).
CREATE OR REPLACE FUNCTION assert_admin_caller()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION assert_admin_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_admin_caller() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tabela de atividade diária (PK composta = 1 linha por usuário/dia)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atividade_diaria (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia      DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Campo_Grande')::DATE),
  PRIMARY KEY (user_id, dia)
);
CREATE INDEX IF NOT EXISTS idx_atividade_diaria_dia ON atividade_diaria (dia);

-- RLS ligada SEM políticas: ninguém acessa a tabela direto pelo PostgREST.
-- A escrita é feita só pela função SECURITY DEFINER abaixo, e a leitura só
-- pelas RPCs de admin (que também são SECURITY DEFINER e furam a RLS).
ALTER TABLE atividade_diaria ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. registrar_atividade_diaria() — chamada pelo app 1x por dia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_atividade_diaria()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO atividade_diaria (user_id, dia)
  VALUES (auth.uid(), (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE)
  ON CONFLICT (user_id, dia) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION registrar_atividade_diaria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_atividade_diaria() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_metricas_retencao() — agregados pros cards
-- ---------------------------------------------------------------------------
-- DAU/WAU/MAU + retornantes (≥2 dias em 7) + recorrentes (≥7 dias em 14) +
-- stickiness (DAU/MAU) + retenção D1/D7 de novos cadastros.
--
-- D1/D7 só contam coortes cujo cadastro aconteceu DEPOIS do início do
-- rastreio (senão a falta de histórico antigo baixaria a taxa falsamente).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_metricas_retencao()
RETURNS TABLE (
  ativos_hoje      INTEGER,
  ativos_7d        INTEGER,
  ativos_30d       INTEGER,
  retornantes_7d   INTEGER,
  recorrentes_14d  INTEGER,
  stickiness_pct   INTEGER,
  retencao_d1_pct  INTEGER,
  retencao_d7_pct  INTEGER,
  novos_30d        INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje        DATE := (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE;
  v_track_start DATE;
  v_ativos_hoje INT;
  v_ativos_30d  INT;
  v_d1_total INT; v_d1_volta INT;
  v_d7_total INT; v_d7_volta INT;
BEGIN
  PERFORM assert_admin_caller();

  SELECT COALESCE(MIN(dia), v_hoje) INTO v_track_start FROM atividade_diaria;

  SELECT COUNT(DISTINCT user_id)::INT INTO v_ativos_hoje
    FROM atividade_diaria WHERE dia = v_hoje;
  SELECT COUNT(DISTINCT user_id)::INT INTO v_ativos_30d
    FROM atividade_diaria WHERE dia > v_hoje - 30;

  -- D1 — coorte: cadastrou entre o início do rastreio e anteontem (teve um
  -- "dia seguinte" já coberto). Voltou no dia seguinte ao cadastro?
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM atividade_diaria ad
      WHERE ad.user_id = au.id
        AND ad.dia = (au.created_at AT TIME ZONE 'America/Campo_Grande')::DATE + 1))::INT
  INTO v_d1_total, v_d1_volta
  FROM auth.users au
  WHERE (au.created_at AT TIME ZONE 'America/Campo_Grande')::DATE BETWEEN v_track_start AND v_hoje - 2;

  -- D7 — coorte: cadastrou entre o início e 8 dias atrás. Voltou em algum dos
  -- dias 1..7 depois do cadastro?
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM atividade_diaria ad
      WHERE ad.user_id = au.id
        AND ad.dia BETWEEN (au.created_at AT TIME ZONE 'America/Campo_Grande')::DATE + 1
                       AND (au.created_at AT TIME ZONE 'America/Campo_Grande')::DATE + 7))::INT
  INTO v_d7_total, v_d7_volta
  FROM auth.users au
  WHERE (au.created_at AT TIME ZONE 'America/Campo_Grande')::DATE BETWEEN v_track_start AND v_hoje - 8;

  RETURN QUERY SELECT
    v_ativos_hoje,
    (SELECT COUNT(DISTINCT user_id)::INT FROM atividade_diaria WHERE dia > v_hoje - 7),
    v_ativos_30d,
    (SELECT COUNT(*)::INT FROM (
        SELECT user_id FROM atividade_diaria WHERE dia > v_hoje - 7
        GROUP BY user_id HAVING COUNT(DISTINCT dia) >= 2) q),
    (SELECT COUNT(*)::INT FROM (
        SELECT user_id FROM atividade_diaria WHERE dia > v_hoje - 14
        GROUP BY user_id HAVING COUNT(DISTINCT dia) >= 7) q),
    CASE WHEN v_ativos_30d = 0 THEN 0 ELSE (v_ativos_hoje * 100 / v_ativos_30d) END,
    CASE WHEN v_d1_total  = 0 THEN 0 ELSE (v_d1_volta  * 100 / v_d1_total)  END,
    CASE WHEN v_d7_total  = 0 THEN 0 ELSE (v_d7_volta  * 100 / v_d7_total)  END,
    (SELECT COUNT(*)::INT FROM auth.users WHERE created_at > NOW() - INTERVAL '30 days');
END $$;
REVOKE ALL ON FUNCTION admin_metricas_retencao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_metricas_retencao() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_serie_ativos(p_dias) — usuários ativos por dia (pro mini-gráfico)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_serie_ativos(p_dias INT DEFAULT 14)
RETURNS TABLE (dia DATE, valor INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY
  WITH dias_serie AS (
    SELECT generate_series(
      (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE - (p_dias - 1) * INTERVAL '1 day',
      (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE,
      INTERVAL '1 day')::DATE AS d
  )
  SELECT
    ds.d AS dia,
    (SELECT COUNT(DISTINCT ad.user_id)::INTEGER FROM atividade_diaria ad WHERE ad.dia = ds.d) AS valor
  FROM dias_serie ds
  ORDER BY ds.d;
END $$;
REVOKE ALL ON FUNCTION admin_serie_ativos(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_serie_ativos(INT) TO authenticated;

-- ============================================================================
-- Confirma resultado
-- ============================================================================
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'atividade_diaria') AS tab_atividade,
  (SELECT COUNT(*) FROM pg_proc WHERE proname IN
    ('registrar_atividade_diaria','admin_metricas_retencao','admin_serie_ativos')) AS funcs;
-- Resultado esperado: 1 | 3
-- ============================================================================
