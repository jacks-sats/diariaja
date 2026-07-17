-- Painel Admin: funil cumulativo de conversao das oportunidades.
--
-- Cada etapa e um subconjunto da anterior:
--   publicadas -> interesse -> conversa dos dois lados -> contratacao -> conclusao
-- Isso evita o falso "funil" que apenas comparava status independentes.
-- Idempotente e restrito a administradores.

CREATE INDEX IF NOT EXISTS idx_diarias_admin_created_at
  ON public.diarias (created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_funil_conversao(p_dias INTEGER DEFAULT 30)
RETURNS TABLE (
  periodo_dias INTEGER,
  publicadas INTEGER,
  com_interesse INTEGER,
  com_conversa INTEGER,
  contratadas INTEGER,
  concluidas INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias INTEGER := LEAST(GREATEST(COALESCE(p_dias, 30), 1), 365);
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT d.id, d.status
    FROM public.diarias d
    WHERE d.created_at >= NOW() - make_interval(days => v_dias)
  ),
  candidaturas_resumo AS (
    SELECT
      c.diaria_id,
      BOOL_OR(c.status <> 'rejeitado') AS tem_interesse,
      BOOL_OR(c.status = 'confirmado') AS tem_contratacao
    FROM public.candidaturas c
    INNER JOIN base b ON b.id = c.diaria_id
    GROUP BY c.diaria_id
  ),
  mensagens_resumo AS (
    SELECT
      m.diaria_id,
      COUNT(DISTINCT m.remetente_id) >= 2 AS tem_conversa
    FROM public.mensagens m
    INNER JOIN base b ON b.id = m.diaria_id
    GROUP BY m.diaria_id
  ),
  etapas AS (
    SELECT
      b.status,
      (
        COALESCE(c.tem_interesse, FALSE)
        OR COALESCE(m.tem_conversa, FALSE)
        OR b.status IN ('aceita', 'em_andamento', 'concluida')
      ) AS tem_interesse,
      COALESCE(m.tem_conversa, FALSE) AS tem_conversa,
      (
        COALESCE(c.tem_contratacao, FALSE)
        OR b.status IN ('aceita', 'em_andamento', 'concluida')
      ) AS tem_contratacao
    FROM base b
    LEFT JOIN candidaturas_resumo c ON c.diaria_id = b.id
    LEFT JOIN mensagens_resumo m ON m.diaria_id = b.id
  )
  SELECT
    v_dias,
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE e.tem_interesse)::INTEGER,
    COUNT(*) FILTER (
      WHERE e.tem_interesse
        AND e.tem_conversa
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE e.tem_interesse
        AND e.tem_conversa
        AND e.tem_contratacao
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE e.tem_interesse
        AND e.tem_conversa
        AND e.tem_contratacao
        AND e.status = 'concluida'
    )::INTEGER
  FROM etapas e;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_funil_conversao(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_funil_conversao(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_funil_conversao(INTEGER) TO authenticated;

SELECT 'Funil de conversao do admin instalado.' AS resultado;
