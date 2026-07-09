-- ============================================================================
-- Distancia confiavel + suporte realtime
-- ============================================================================
-- Idempotente. Aplicar no Supabase SQL Editor.
-- 1) prestadores_publicos volta a devolver geo_preciso sem expor foto base64.
-- 2) check-in de servico empresarial so bloqueia distancia quando a loja e precisa.
-- 3) suporte_tickets/suporte_respostas entram no Realtime.
-- 4) painel de suporte lista tickets com nome via RPC segura.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prestadores_publicos(p_limit INT DEFAULT 200)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', up.id, 'oculto', up.oculto, 'user_type', up.user_type, 'nome', up.nome,
    'nome_negocio', up.nome_negocio, 'segmento', up.segmento, 'funcao', up.funcao,
    'valor_diaria', up.valor_diaria, 'disponivel', up.disponivel, 'agenda', up.agenda,
    'bio', up.bio,
    'foto_url', CASE WHEN up.foto_url LIKE 'data:%' THEN NULL ELSE up.foto_url END,
    'categorias', up.categorias,
    'lat', round(up.lat::numeric, 2), 'lng', round(up.lng::numeric, 2),
    'geo_preciso', up.geo_preciso,
    'pessoa_tipo', up.pessoa_tipo,
    'razao_social', up.razao_social, 'nome_fantasia', up.nome_fantasia,
    'plano_ativo', up.plano_ativo, 'plano_expira_em', up.plano_expira_em,
    'telefone_verificado', up.telefone_verificado, 'documento_status', up.documento_status,
    'tem_documento', ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')),
    'nivel', CASE
               WHEN ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> ''))
                    AND up.documento_status = 'aprovado' THEN 3
               WHEN ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')) THEN 2
               ELSE 1
             END
  )
  FROM public.user_profiles up
  WHERE up.user_type IN ('diarista','ambos')
    AND up.id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY
    (up.documento_status = 'aprovado') DESC,
    ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')) DESC,
    COALESCE(up.disponivel, false) DESC,
    up.id
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.prestadores_publicos(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prestadores_publicos(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.prestadores_publicos(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_checkin_servico_empresa(
  p_execucao_id UUID,
  p_lat         DOUBLE PRECISION DEFAULT NULL,
  p_lng         DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.servico_execucoes%ROWTYPE;
  l public.servico_lojas%ROWTYPE;
  d public.diarias%ROWTYPE;
  v_uid UUID := auth.uid();
  v_dist INTEGER := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  SELECT * INTO e FROM public.servico_execucoes WHERE id = p_execucao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;
  IF e.prestador_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;
  IF e.status = 'concluida' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_concluida');
  END IF;
  IF e.checkin_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_feito', true, 'checkin_em', e.checkin_em);
  END IF;

  SELECT * INTO l FROM public.servico_lojas WHERE id = e.loja_id;
  SELECT * INTO d FROM public.diarias WHERE id = e.diaria_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL THEN
    v_dist := round(
      6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - l.lat) / 2), 2) +
        cos(radians(l.lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - l.lng) / 2), 2)
      ))
    );
    IF COALESCE(l.geo_preciso, false) AND v_dist > 300 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'muito_longe', 'distancia_m', v_dist);
    END IF;
  END IF;

  UPDATE public.servico_execucoes
     SET status = 'em_andamento',
         checkin_em = NOW(),
         checkin_lat = p_lat,
         checkin_lng = p_lng,
         checkin_metodo = 'gps',
         checkin_distancia_m = v_dist,
         updated_at = NOW()
   WHERE id = p_execucao_id;

  IF d.status = 'aceita' THEN
    UPDATE public.diarias SET status = 'em_andamento', checkin_em = COALESCE(checkin_em, NOW())
     WHERE id = d.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'checkin_em', NOW(), 'distancia_m', v_dist);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_checkin_servico_empresa(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_checkin_servico_empresa(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF to_regclass('public.suporte_tickets') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'suporte_tickets'
       ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_tickets;
    END IF;

    IF to_regclass('public.suporte_respostas') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'suporte_respostas'
       ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_respostas;
    END IF;
  END IF;

  IF to_regclass('public.suporte_tickets') IS NOT NULL THEN
    ALTER TABLE public.suporte_tickets REPLICA IDENTITY FULL;
  END IF;
  IF to_regclass('public.suporte_respostas') IS NOT NULL THEN
    ALTER TABLE public.suporte_respostas REPLICA IDENTITY FULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.suporte_tickets_painel(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  assunto TEXT,
  status TEXT,
  ultima_resposta_role TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_nome TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
     WHERE up.id = auth.uid()
       AND (up.is_admin = TRUE OR up.is_suporte = TRUE)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: somente admin ou suporte.';
  END IF;

  RETURN QUERY
  SELECT
    st.id,
    st.user_id,
    st.assunto,
    st.status,
    st.ultima_resposta_role,
    st.created_at,
    st.updated_at,
    COALESCE(NULLIF(up.nome, ''), 'Usuario')::TEXT AS user_nome
  FROM public.suporte_tickets st
  LEFT JOIN public.user_profiles up ON up.id = st.user_id
  ORDER BY st.updated_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.suporte_tickets_painel(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suporte_tickets_painel(INT) TO authenticated;

SELECT 'Distancia confiavel + suporte realtime instalados.' AS resultado;
