-- ============================================================================
-- FIX 2026-08-05 — tem_documento vira selo REAL (audit produto #3)
-- ============================================================================
-- Antes: `tem_documento = (cpf NOT NULL OR cnpj NOT NULL)` em perfis_publicos
-- e prestadores_publicos. Como CPF é obrigatório no wizard de diarista, 100%
-- dos perfis apareciam "Verificado" — selo perdia sinal, ninguém tinha
-- incentivo pra completar o KYC de documento (RG/CNH).
--
-- Depois: `tem_documento = (documento_status = 'aprovado')`. Só quem
-- efetivamente enviou documento e passou pela análise interna aparece
-- como Verificado no card do feed e no perfil detalhado.
--
-- Impacto: destrava a jornada de KYC real como fator de diferenciação
-- competitiva. Diarista que quiser aparecer verificado precisa mandar doc.
--
-- Frontend NÃO precisa mudar — App.tsx:442 e :15031 consultam apenas
-- profissional.tem_documento; a definição fica ancorada aqui.
--
-- Idempotente. Aplicar no Supabase → SQL Editor → Run.
-- ============================================================================

-- 1) perfis_publicos: hidratação de perfil + listas de candidatos
CREATE OR REPLACE FUNCTION perfis_publicos(p_ids UUID[])
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id',                  up.id,
    'oculto',              up.oculto,
    'user_type',           up.user_type,
    'nome',                up.nome,
    'nome_negocio',        up.nome_negocio,
    'segmento',            up.segmento,
    'funcao',              up.funcao,
    'valor_diaria',        up.valor_diaria,
    'disponivel',          up.disponivel,
    'agenda',              up.agenda,
    'bio',                 up.bio,
    'foto_url',            up.foto_url,
    'categorias',          up.categorias,
    'lat',                 round(up.lat::numeric, 2),
    'lng',                 round(up.lng::numeric, 2),
    'catalogo_bairro',     up.catalogo_bairro,
    'catalogo_cidade',     up.catalogo_cidade,
    'pessoa_tipo',         up.pessoa_tipo,
    'razao_social',        up.razao_social,
    'nome_fantasia',       up.nome_fantasia,
    'plano_ativo',         up.plano_ativo,
    'plano_expira_em',     up.plano_expira_em,
    'telefone_verificado', up.telefone_verificado,
    'documento_status',    up.documento_status,
    -- FIX 2026-08-05: só verdadeiro se KYC aprovado. Antes qualquer CPF valia.
    'tem_documento',       (up.documento_status = 'aprovado'),
    'antecedentes_verificado', (up.antecedentes_status = 'aprovado'),
    'nivel', CASE
               WHEN ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> ''))
                    AND up.documento_status = 'aprovado' THEN 3
               WHEN ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')) THEN 2
               ELSE 1
             END
  )
  FROM user_profiles up
  WHERE up.id = ANY(p_ids);
$$;

REVOKE ALL ON FUNCTION perfis_publicos(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION perfis_publicos(UUID[]) TO authenticated;

-- 2) prestadores_publicos: catálogo geral / home do empregador
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
    -- FIX 2026-08-05: idem — só verdadeiro se KYC aprovado.
    'tem_documento', (up.documento_status = 'aprovado'),
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

-- Verificação
-- SELECT COUNT(*) FILTER (WHERE (p->>'tem_documento')::bool) AS verificados,
--        COUNT(*) AS total
--   FROM prestadores_publicos(200) t(p);
