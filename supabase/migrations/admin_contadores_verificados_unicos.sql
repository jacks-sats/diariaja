-- Admin dashboard: exact opportunity counters and unique verified professionals.
-- Idempotent: safe to run more than once in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.admin_contadores_oportunidades()
RETURNS TABLE (
  total_usuarios INTEGER,
  total_diarias INTEGER,
  total_servicos INTEGER,
  total_vagas_emprego INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT
      (SELECT COUNT(*)::INTEGER FROM public.user_profiles),
      (SELECT COUNT(*)::INTEGER FROM public.diarias WHERE tipo_oferta = 'diaria'),
      (SELECT COUNT(*)::INTEGER FROM public.diarias WHERE tipo_oferta IN ('servico', 'servico_empresa')),
      (SELECT COUNT(*)::INTEGER FROM public.diarias WHERE tipo_oferta = 'emprego');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_contadores_oportunidades() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_contadores_oportunidades() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_contadores_oportunidades() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_documentos_verificados()
RETURNS TABLE (
  user_id UUID,
  nome TEXT,
  user_type TEXT,
  documento_url TEXT,
  documento_revisado_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT
      verificados.user_id,
      verificados.nome,
      verificados.user_type,
      verificados.documento_url,
      verificados.documento_revisado_em
    FROM (
      SELECT DISTINCT ON (up.id)
        up.id AS user_id,
        up.nome,
        up.user_type,
        up.documento_url,
        up.documento_revisado_em
      FROM public.user_profiles up
      WHERE up.documento_status = 'aprovado'
        AND up.user_type IN ('diarista', 'ambos')
      ORDER BY up.id, up.documento_revisado_em DESC NULLS LAST
    ) AS verificados
    ORDER BY verificados.documento_revisado_em DESC NULLS LAST
    LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_documentos_verificados() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_documentos_verificados() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_documentos_verificados() TO authenticated;

SELECT 'Contadores do admin e profissionais verificados unicos instalados.' AS resultado;
