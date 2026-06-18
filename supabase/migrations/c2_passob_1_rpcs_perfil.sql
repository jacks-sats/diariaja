-- ═══════════════════════════════════════════════════════════════════════════
-- C2 PASSO B.1 — RPCs de perfil (ADITIVO, não quebra nada)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cria as 3 funções que o cliente vai passar a usar (passo B.2) para que, depois
-- do REVOKE de coluna (passo B.3), ninguém leia telefone/cpf/cnpj/pix/token de
-- terceiros direto da tabela.
--
--   meu_perfil()                 → perfil COMPLETO do próprio usuário (dono).
--   perfis_publicos(ids[])       → colunas públicas + flags derivadas
--                                  (tem_documento, nivel) — SEM cpf/cnpj/telefone.
--   contato_prestador(diarista)  → telefone/pix/cpf do prestador SOMENTE se quem
--                                  chama tem relação legítima (diária com ele
--                                  selecionado, ou convite aceito).
--
-- Retornam JSONB para serem resilientes a variações de tipo de coluna.
-- SECURITY DEFINER + REVOKE/GRANT. Aplicar é seguro: enquanto o cliente não usar
-- (passo B.2), nada muda. NÃO contém o REVOKE — esse é o passo B.3, por último.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. meu_perfil() — dono lê o próprio perfil inteiro ───────────────────────
CREATE OR REPLACE FUNCTION meu_perfil()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(up) FROM user_profiles up WHERE up.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION meu_perfil() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meu_perfil() TO authenticated;

-- ── 2. perfis_publicos(ids[]) — perfis de terceiros, só dados públicos ───────
-- Substitui cpf/cnpj/telefone por flags derivadas:
--   tem_documento = tem CPF ou CNPJ no cadastro (pro selo "Verificado")
--   nivel         = 1 Básico / 2 Verificado / 3 Confiável (espelha o helper
--                   calcularNivelConfiabilidade, assumindo email confirmado e
--                   sem 2FA — que é como o cliente já calcula pra terceiros).
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
    -- Localização ARREDONDADA a 2 casas (~1,1 km de grade) — não expõe a
    -- coordenada exata de terceiros. A distância exibida e o filtro de raio
    -- (5/20/50/100 km) seguem funcionando: o cálculo usa a coordenada exata
    -- DO PRÓPRIO usuário (via meu_perfil) contra esta coordenada grosseira.
    'lat',                 round(up.lat::numeric, 2),
    'lng',                 round(up.lng::numeric, 2),
    'pessoa_tipo',         up.pessoa_tipo,
    'razao_social',        up.razao_social,
    'nome_fantasia',       up.nome_fantasia,
    -- responsavel_nome e cep REMOVIDOS da projeção pública (PII; o cliente
    -- nunca os lê de terceiros — só do próprio perfil via meu_perfil).
    'plano_ativo',         up.plano_ativo,
    'plano_expira_em',     up.plano_expira_em,
    'telefone_verificado', up.telefone_verificado,
    'documento_status',    up.documento_status,
    'tem_documento',       ((up.cpf IS NOT NULL AND up.cpf <> '') OR (up.cnpj IS NOT NULL AND up.cnpj <> '')),
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

-- ── 2b. prestadores_publicos(limit) — feed da home (lista por papel) ─────────
-- O feed não tem a lista de ids de antemão (filtra por user_type), então
-- perfis_publicos(ids[]) não serve aqui. Mesma projeção pública + derivados.
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
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;
REVOKE ALL ON FUNCTION prestadores_publicos(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prestadores_publicos(INT) TO authenticated;

-- ── 3. (REMOVIDA) contato_prestador ──────────────────────────────────────────
-- Decisão de produto/privacidade: o app NÃO revela mais chave PIX/CPF/telefone
-- do prestador. O pagamento da diária é combinado direto entre as partes pelo
-- chat (PIX ou dinheiro). Logo esta RPC não é mais necessária. Se ela já foi
-- criada numa aplicação anterior, remova-a (para não deixar um caminho de
-- revelação de contato aberto):
--   DROP FUNCTION IF EXISTS contato_prestador(UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('meu_perfil','perfis_publicos','contato_prestador');  -- 3 linhas
--   SELECT meu_perfil();                                  -- seu perfil completo
--   SELECT perfis_publicos(ARRAY['<algum_uuid>']::uuid[]); -- sem telefone/cpf, com nivel
-- ─────────────────────────────────────────────────────────────────────────────
