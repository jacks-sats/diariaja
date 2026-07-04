-- ── perfis_publicos: expõe "antecedentes_verificado" (booleano) ──────────────
-- Passo 4 do workstream Confiabilidade: propagar o selo de antecedentes nos
-- cards de prestador que o contratante vê ANTES de selecionar.
--
-- Privacidade: expõe SÓ um booleano positivo (true quando o antecedentes está
-- 'aprovado'). NUNCA revela "enviado"/"rejeitado" de terceiros — evita vazar o
-- estado sensível de certidão criminal de outra pessoa. Mesmo espírito do
-- 'tem_documento' já público. O PDF em si continua em storage privado.
--
-- Idempotente: CREATE OR REPLACE. Re-executável no SQL editor do Supabase.
-- Mantém 1:1 a projeção existente (c2_passob_1_rpcs_perfil.sql) + 1 campo novo.

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
    'pessoa_tipo',         up.pessoa_tipo,
    'razao_social',        up.razao_social,
    'nome_fantasia',       up.nome_fantasia,
    'plano_ativo',         up.plano_ativo,
    'plano_expira_em',     up.plano_expira_em,
    'telefone_verificado', up.telefone_verificado,
    'documento_status',    up.documento_status,
    'tem_documento',       ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')),
    -- Selo extra de segurança (o moat): só o positivo, nada de estado sensível.
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
