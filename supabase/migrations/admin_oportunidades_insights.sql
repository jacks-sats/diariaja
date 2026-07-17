-- ═══════════════════════════════════════════════════════════════════════════
-- Painel admin (aba Oportunidades): vagas ativas + interessados e ranking por
-- função. Idempotente e restrito a administradores (assert_admin_caller).
-- ═══════════════════════════════════════════════════════════════════════════
-- Duas visões que NÃO existem em nenhum outro lugar do painel:
--   1. admin_vagas_ativas_interessados — lista as oportunidades ABERTAS agora
--      (status='aberta' e, pra diária/serviço, ainda não vencidas; emprego não
--      vence por data) com quantos interessados cada uma tem. Ordena pelo mais
--      procurado. Responde "o que está no ar e onde a galera está querendo".
--   2. admin_ranking_funcao — quantas oportunidades por FUNÇÃO (motoboy, babá,
--      faxineira…), pra entender a composição da demanda e que perfil recrutar.
--
-- "Interessado" = candidatura não-rejeitada (mesma régua do funil de conversão).
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_vagas_ativas_interessados(p_limit INTEGER DEFAULT 60)
RETURNS TABLE (
  id UUID,
  titulo TEXT,
  tipo_oferta TEXT,
  bairro TEXT,
  valor NUMERIC,
  interessados INTEGER,
  criada_em TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY
    SELECT
      d.id,
      COALESCE(NULLIF(BTRIM(d.funcao), ''), NULLIF(BTRIM(d.segmento), ''), 'Sem título') AS titulo,
      d.tipo_oferta,
      NULLIF(BTRIM(d.bairro), '') AS bairro,
      d.valor,
      COALESCE(c.cnt, 0)::INTEGER AS interessados,
      d.created_at
    FROM public.diarias d
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM public.candidaturas ca
      WHERE ca.diaria_id = d.id AND ca.status <> 'rejeitado'
    ) c ON TRUE
    WHERE d.status = 'aberta'
      AND (d.tipo_oferta = 'emprego'
           OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)
    ORDER BY interessados DESC, d.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_vagas_ativas_interessados(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_vagas_ativas_interessados(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_vagas_ativas_interessados(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ranking_funcao(
  p_dias            INTEGER DEFAULT 30,
  p_somente_ativas  BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  funcao TEXT,
  total INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias INTEGER := LEAST(GREATEST(COALESCE(p_dias, 30), 1), 365);
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY
    SELECT
      COALESCE(NULLIF(BTRIM(d.funcao), ''), NULLIF(BTRIM(d.segmento), ''), 'Sem função') AS funcao,
      COUNT(*)::INTEGER AS total
    FROM public.diarias d
    WHERE d.created_at >= NOW() - make_interval(days => v_dias)
      AND (NOT p_somente_ativas OR (
            d.status = 'aberta'
            AND (d.tipo_oferta = 'emprego'
                 OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)))
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ranking_funcao(INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_ranking_funcao(INTEGER, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_ranking_funcao(INTEGER, BOOLEAN) TO authenticated;

SELECT 'Insights de oportunidades do admin instalados (vagas ativas + ranking por funcao).' AS resultado;
