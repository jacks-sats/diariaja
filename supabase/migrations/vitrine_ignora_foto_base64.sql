-- ============================================================================
-- vitrine: prestadores_publicos NUNCA devolve foto em base64 (data: URI)
-- ============================================================================
-- Auditoria 02/07/2026: 6 perfis tinham a foto gravada como data-URI DENTRO de
-- user_profiles.foto_url (fallback antigo do App quando o upload pro Storage
-- falhava — removido no mesmo PR). Resultado: a resposta da RPC pesava
-- 16,25 MB por carga da home do anunciante (15,4 MB só de foto_url), queimando
-- egress e estourando timeout em rede móvel.
--
-- Este guard é a defesa PERMANENTE no servidor: mesmo que alguma foto base64
-- volte a aparecer no banco (app antigo em cache, escrita manual), a vitrine
-- devolve NULL no lugar (o front já mostra o avatar-placeholder pra foto nula).
-- A migração/anulação das 6 fotos existentes é feita à parte pelo script
-- scripts/migrar-fotos-base64.mjs (precisa da service role pra subir os
-- arquivos no bucket avatars — SQL não escreve no Storage).
--
-- Idempotente (CREATE OR REPLACE). Aplicar no Supabase Dashboard → SQL Editor.
-- Reproduz prestadores_publicos_ordenado.sql + o guard do foto_url.
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
    'bio', up.bio,
    -- Foto SÓ como URL (Storage/https). data-URIs de megabytes no JSON da
    -- vitrine multiplicavam o egress por carga — ver cabeçalho.
    'foto_url', CASE WHEN up.foto_url LIKE 'data:%' THEN NULL ELSE up.foto_url END,
    'categorias', up.categorias,
    -- Localização ARREDONDADA a 2 casas (~1,1 km de grade) — não expõe a
    -- coordenada exata de terceiros. ORDER BY não usa lat/lng, então o corte
    -- de 200 não muda. Distância/raio seguem ok (calculados contra a coord
    -- exata do próprio usuário via meu_perfil).
    'lat', round(up.lat::numeric, 2), 'lng', round(up.lng::numeric, 2), 'pessoa_tipo', up.pessoa_tipo,
    'razao_social', up.razao_social, 'nome_fantasia', up.nome_fantasia,
    -- responsavel_nome e cep REMOVIDOS da projeção pública (PII; não lidos de terceiros).
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

-- Garante o privilégio (CREATE OR REPLACE preserva, mas reaplicamos por segurança).
-- ⚠️ Observação da auditoria (02/07/2026): produção respondia também pra ANON.
-- REVOKE ... FROM PUBLIC NÃO desfaz um GRANT dado diretamente ao role `anon`
-- no passado — por isso o REVOKE explícito FROM anon abaixo. O app só chama
-- esta RPC logado (home do anunciante), então fechar o anon é seguro.
REVOKE ALL ON FUNCTION prestadores_publicos(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prestadores_publicos(INT) FROM anon;
GRANT EXECUTE ON FUNCTION prestadores_publicos(INT) TO authenticated;
