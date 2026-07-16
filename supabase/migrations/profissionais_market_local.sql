-- ============================================================================
-- DiariaJa - Profissionais como nova entrada do mesmo fluxo de servicos
-- ============================================================================
-- Objetivo: encontrar pessoas sem criar um sistema paralelo.
-- A visibilidade e flexivel para permitir evolucao futura (ex.: destaque/premium).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS visibilidade text NOT NULL DEFAULT 'OFF',
  ADD COLUMN IF NOT EXISTS profissao_principal text,
  ADD COLUMN IF NOT EXISTS descricao_curta text,
  ADD COLUMN IF NOT EXISTS catalogo_cidade text,
  ADD COLUMN IF NOT EXISTS catalogo_bairro text,
  ADD COLUMN IF NOT EXISTS catalogo_atualizado_em timestamptz;

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_visibilidade_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_visibilidade_check
  CHECK (visibilidade IN ('OFF', 'CATALOGO', 'DESTAQUE'));

COMMENT ON COLUMN user_profiles.visibilidade IS
  'OFF = nao aparece em Profissionais; CATALOGO = aparece; DESTAQUE = reservado para prioridade futura.';
COMMENT ON COLUMN user_profiles.profissao_principal IS
  'Titulo principal exibido em Profissionais. Normalmente espelha funcao/categorias[1].';
COMMENT ON COLUMN user_profiles.descricao_curta IS
  'Resumo curto para cards de Profissionais. A bio continua sendo a fonte longa.';
COMMENT ON COLUMN user_profiles.catalogo_cidade IS
  'Cidade publica aproximada exibida em Profissionais.';
COMMENT ON COLUMN user_profiles.catalogo_bairro IS
  'Bairro publico aproximado exibido em Profissionais.';

ALTER TABLE convites
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'convite_direto',
  ADD COLUMN IF NOT EXISTS tipo_solicitacao text NOT NULL DEFAULT 'diaria';

ALTER TABLE convites
  DROP CONSTRAINT IF EXISTS convites_tipo_solicitacao_check;

ALTER TABLE convites
  ADD CONSTRAINT convites_tipo_solicitacao_check
  CHECK (tipo_solicitacao IN ('diaria', 'servico', 'orcamento'));

COMMENT ON COLUMN convites.origem IS
  'Entrada que gerou a solicitacao: convite_direto, profissionais, perfil_profissional, etc.';
COMMENT ON COLUMN convites.tipo_solicitacao IS
  'Mantem compatibilidade com convites e permite distinguir pedidos de orcamento.';

CREATE INDEX IF NOT EXISTS idx_user_profiles_profissionais_feed
  ON user_profiles (visibilidade, user_type, last_activity_at DESC, id)
  WHERE visibilidade IN ('CATALOGO', 'DESTAQUE')
    AND user_type IN ('diarista', 'ambos')
    AND COALESCE(oculto, false) = false;

CREATE INDEX IF NOT EXISTS idx_user_profiles_profissionais_categoria
  ON user_profiles (segmento, funcao, profissao_principal)
  WHERE visibilidade IN ('CATALOGO', 'DESTAQUE')
    AND user_type IN ('diarista', 'ambos')
    AND COALESCE(oculto, false) = false;

CREATE INDEX IF NOT EXISTS idx_user_profiles_profissionais_local
  ON user_profiles (catalogo_cidade, catalogo_bairro)
  WHERE visibilidade IN ('CATALOGO', 'DESTAQUE')
    AND user_type IN ('diarista', 'ambos')
    AND COALESCE(oculto, false) = false;

CREATE INDEX IF NOT EXISTS idx_user_profiles_profissionais_busca
  ON user_profiles USING gin (
    to_tsvector(
      'portuguese',
      COALESCE(nome, '') || ' ' ||
      COALESCE(profissao_principal, '') || ' ' ||
      COALESCE(funcao, '') || ' ' ||
      COALESCE(segmento, '') || ' ' ||
      COALESCE(catalogo_cidade, '') || ' ' ||
      COALESCE(catalogo_bairro, '') || ' ' ||
      COALESCE(descricao_curta, '') || ' ' ||
      COALESCE(bio, '')
    )
  )
  WHERE visibilidade IN ('CATALOGO', 'DESTAQUE')
    AND user_type IN ('diarista', 'ambos')
    AND COALESCE(oculto, false) = false;

CREATE INDEX IF NOT EXISTS idx_avaliacoes_diarista_diarista_id
  ON avaliacoes_diarista (diarista_id);

CREATE INDEX IF NOT EXISTS idx_diarias_profissional_concluidas
  ON diarias (diarista_aceite_id, status)
  WHERE diarista_aceite_id IS NOT NULL;

CREATE OR REPLACE FUNCTION profissionais_publicos(
  p_limit int DEFAULT 24,
  p_offset int DEFAULT 0,
  p_busca text DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_cidade text DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtros AS (
    SELECT
      NULLIF(BTRIM(p_busca), '') AS busca,
      NULLIF(BTRIM(p_categoria), '') AS categoria,
      NULLIF(BTRIM(p_cidade), '') AS cidade,
      LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50) AS limite,
      GREATEST(COALESCE(p_offset, 0), 0) AS deslocamento
  )
  SELECT jsonb_build_object(
    'id', up.id,
    'nome', up.nome,
    'user_type', up.user_type,
    'nome_negocio', up.nome_negocio,
    'segmento', up.segmento,
    'funcao', COALESCE(NULLIF(up.profissao_principal, ''), up.funcao),
    'profissao_principal', COALESCE(NULLIF(up.profissao_principal, ''), up.funcao),
    'descricao_curta', COALESCE(NULLIF(up.descricao_curta, ''), NULLIF(up.bio, '')),
    'bio', up.bio,
    'foto_url', up.foto_url,
    'categorias', up.categorias,
    'valor_diaria', up.valor_diaria,
    'disponivel', up.disponivel,
    'agenda', up.agenda,
    'lat', up.lat,
    'lng', up.lng,
    'geo_preciso', up.geo_preciso,
    'telefone_verificado', COALESCE(up.telefone_verificado, false),
    'tem_documento', (up.documento_status = 'aprovado'),
    'antecedentes_verificado', (up.antecedentes_status = 'aprovado'),
    'nivel', CASE
      WHEN up.antecedentes_status = 'aprovado' AND up.documento_status = 'aprovado' THEN 4
      WHEN up.documento_status = 'aprovado' THEN 3
      WHEN COALESCE(up.telefone_verificado, false) THEN 2
      ELSE 1
    END,
    'visibilidade', up.visibilidade,
    'catalogo_cidade', up.catalogo_cidade,
    'catalogo_bairro', up.catalogo_bairro,
    'last_activity_at', up.last_activity_at,
    'servicos_concluidos', COALESCE(serv.servicos_concluidos, 0),
    'nota_media', aval.nota_media,
    'total_avaliacoes', COALESCE(aval.total_avaliacoes, 0)
  )
  FROM user_profiles up
  CROSS JOIN filtros f
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS servicos_concluidos
    FROM diarias d
    WHERE d.diarista_aceite_id = up.id
      AND d.status = 'concluida'
  ) serv ON true
  LEFT JOIN LATERAL (
    SELECT
      ROUND(AVG(a.nota)::numeric, 2)::float AS nota_media,
      COUNT(*)::int AS total_avaliacoes
    FROM avaliacoes_diarista a
    WHERE a.diarista_id = up.id
  ) aval ON true
  WHERE up.user_type IN ('diarista', 'ambos')
    AND up.id <> auth.uid()
    AND COALESCE(up.oculto, false) = false
    AND up.visibilidade IN ('CATALOGO', 'DESTAQUE')
    AND NULLIF(BTRIM(up.foto_url), '') IS NOT NULL
    AND up.foto_url NOT ILIKE 'data:%'
    AND COALESCE(NULLIF(BTRIM(up.profissao_principal), ''), NULLIF(BTRIM(up.funcao), '')) IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(up.descricao_curta), ''), NULLIF(BTRIM(up.bio), '')) IS NOT NULL
    AND NULLIF(BTRIM(up.catalogo_cidade), '') IS NOT NULL
    AND (COALESCE(up.telefone_verificado, false) = true OR up.documento_status = 'aprovado')
    AND (
      f.categoria IS NULL
      OR up.segmento = f.categoria
      OR up.funcao = f.categoria
      OR up.profissao_principal = f.categoria
      OR COALESCE(up.categorias, ARRAY[]::text[]) && ARRAY[f.categoria]::text[]
    )
    AND (f.cidade IS NULL OR up.catalogo_cidade ILIKE '%' || f.cidade || '%')
    AND (
      f.busca IS NULL
      OR to_tsvector(
           'portuguese',
           COALESCE(up.nome, '') || ' ' ||
           COALESCE(up.profissao_principal, '') || ' ' ||
           COALESCE(up.funcao, '') || ' ' ||
           COALESCE(up.segmento, '') || ' ' ||
           COALESCE(up.catalogo_cidade, '') || ' ' ||
           COALESCE(up.catalogo_bairro, '') || ' ' ||
           COALESCE(up.descricao_curta, '') || ' ' ||
           COALESCE(up.bio, '')
         ) @@ plainto_tsquery('portuguese', f.busca)
      OR up.nome ILIKE '%' || f.busca || '%'
      OR up.profissao_principal ILIKE '%' || f.busca || '%'
      OR up.funcao ILIKE '%' || f.busca || '%'
      OR up.catalogo_bairro ILIKE '%' || f.busca || '%'
      OR up.catalogo_cidade ILIKE '%' || f.busca || '%'
    )
  ORDER BY
    (up.visibilidade = 'DESTAQUE') DESC,
    COALESCE(up.telefone_verificado, false) DESC,
    up.disponivel DESC,
    up.last_activity_at DESC NULLS LAST,
    aval.nota_media DESC NULLS LAST,
    serv.servicos_concluidos DESC,
    up.id
  LIMIT (SELECT limite FROM filtros)
  OFFSET (SELECT deslocamento FROM filtros);
$$;

REVOKE ALL ON FUNCTION profissionais_publicos(int, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profissionais_publicos(int, int, text, text, text) TO authenticated;
