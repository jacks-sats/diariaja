-- ============================================================================
-- prestadores_publicos: ORDER BY determinístico no corte de 200
-- ============================================================================
-- A RPC tinha LIMIT mas NÃO tinha ORDER BY. Resultado: quando a base passar de
-- 200 prestadores, QUAIS 200 voltam fica arbitrário (ordem física do Postgres) e
-- pode mudar entre chamadas. Adicionamos um ORDER BY estável e por relevância:
--   1) documento aprovado primeiro   2) tem documento   3) disponível
--   4) id (desempate ESTÁVEL — corte determinístico)
-- O cliente ainda re-ordena por distância/nível no front; este ORDER BY só
-- garante que o SUBCONJUNTO de 200 carregado seja consistente e relevante.
--
-- Idempotente (CREATE OR REPLACE). Aplicar no Supabase Dashboard → SQL Editor.
-- Reproduz a definição de c2_passob_1_rpcs_perfil.sql + ORDER BY.
-- ============================================================================

CREATE OR REPLACE FUNCTION prestadores_publicos(p_limit INT DEFAULT 200)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', up.id, 'oculto', up.oculto, 'user_type', up.user_type, 'nome', up.nome,
    'nome_negocio', up.nome_negocio, 'segmento', up.segmento, 'funcao', up.funcao,
    'valor_diaria', up.valor_diaria, 'disponivel', up.disponivel, 'agenda', up.agenda,
    'bio', up.bio, 'foto_url', up.foto_url, 'categorias', up.categorias,
    'lat', up.lat, 'lng', up.lng, 'pessoa_tipo', up.pessoa_tipo,
    'razao_social', up.razao_social, 'nome_fantasia', up.nome_fantasia,
    'responsavel_nome', up.responsavel_nome, 'cep', up.cep,
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
  FROM user_profiles up
  WHERE up.user_type IN ('diarista','ambos')
    AND up.id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY
    (up.documento_status = 'aprovado') DESC,                                            -- aprovados primeiro
    ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')) DESC, -- com documento
    COALESCE(up.disponivel, false) DESC,                                                -- disponíveis primeiro
    up.id                                                                               -- desempate ESTÁVEL
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

-- Garante o privilégio (CREATE OR REPLACE preserva, mas reaplicamos por segurança)
REVOKE ALL ON FUNCTION prestadores_publicos(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prestadores_publicos(INT) TO authenticated;
