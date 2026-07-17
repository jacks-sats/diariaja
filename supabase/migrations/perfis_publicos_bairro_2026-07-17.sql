-- ── perfis_publicos: expõe catalogo_bairro + catalogo_cidade ────────────────
-- Pra mostrar "Bairro · Cidade" no perfil do prestador e nas listas de
-- candidatos (que hidratam via perfis_publicos). Privacidade: bairro/cidade
-- são GROSSOS (nunca rua/número) — é o mesmo nível que profissionais_publicos
-- já expõe no catálogo, e mais coarse que a coordenada arredondada já pública.
--
-- Idempotente (CREATE OR REPLACE). Mantém 1:1 a projeção vigente
-- (perfis_publicos_antecedentes_verificado_2026-07-04.sql) + 2 campos.
-- Aplicar no Supabase → SQL Editor → Run.

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
    -- Bairro/cidade do catálogo (coarse, nunca endereço). Mesmo dado que o
    -- profissionais_publicos já expõe; aqui pro perfil e listas de candidatos.
    'catalogo_bairro',     up.catalogo_bairro,
    'catalogo_cidade',     up.catalogo_cidade,
    'pessoa_tipo',         up.pessoa_tipo,
    'razao_social',        up.razao_social,
    'nome_fantasia',       up.nome_fantasia,
    'plano_ativo',         up.plano_ativo,
    'plano_expira_em',     up.plano_expira_em,
    'telefone_verificado', up.telefone_verificado,
    'documento_status',    up.documento_status,
    'tem_documento',       ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')),
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

SELECT 'perfis_publicos expoe catalogo_bairro/cidade (perfil + listas).' AS resultado;
