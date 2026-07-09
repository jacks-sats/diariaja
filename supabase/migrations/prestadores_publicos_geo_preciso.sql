-- ============================================================================
-- vitrine: prestadores_publicos volta a devolver geo_preciso (fix da distância)
-- ============================================================================
-- Bug (08/07/2026): na home do anunciante, TODOS os cards de prestadores
-- mostravam "📍 distância aproximada" em vez de "~X km". Causa: a reescrita da
-- RPC no audit de segurança (P1-2 → c2_passob_1 → prestadores_publicos_ordenado
-- → vitrine_ignora_foto_base64) removeu o campo `geo_preciso` da projeção junto
-- com os campos PII. O front (rotuloDistanciaFeed) só mostra o número quando
-- AMBOS os lados têm geo_preciso=true — sem o campo, d.geo_preciso chega
-- undefined e 100% dos cards caem no fallback.
--
-- geo_preciso NÃO é PII: é um boolean de QUALIDADE da coordenada (fonte precisa
-- vs centroide de CEP/cidade). A coordenada continua ARREDONDADA a 2 casas
-- (~1,1 km de grade) — nada do audit é revertido aqui.
--
-- Reproduz vitrine_ignora_foto_base64.sql por inteiro (guard do base64 +
-- arredondamento + ORDER BY + REVOKEs) adicionando SÓ o campo geo_preciso.
-- Idempotente (CREATE OR REPLACE). Aplicar no Supabase Dashboard → SQL Editor.
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
    -- vitrine multiplicavam o egress por carga — ver vitrine_ignora_foto_base64.
    'foto_url', CASE WHEN up.foto_url LIKE 'data:%' THEN NULL ELSE up.foto_url END,
    'categorias', up.categorias,
    -- Localização ARREDONDADA a 2 casas (~1,1 km de grade) — não expõe a
    -- coordenada exata de terceiros. ORDER BY não usa lat/lng, então o corte
    -- de 200 não muda. Distância/raio seguem ok (calculados contra a coord
    -- exata do próprio usuário via meu_perfil).
    'lat', round(up.lat::numeric, 2), 'lng', round(up.lng::numeric, 2), 'pessoa_tipo', up.pessoa_tipo,
    -- geo_preciso: boolean de QUALIDADE da coord (fonte precisa vs centroide).
    -- Não é PII (a coord segue arredondada). O front precisa dele pra distância
    -- honesta (rotuloDistanciaFeed) — sem ele, todo card caía no fallback.
    'geo_preciso', up.geo_preciso,
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

-- Mesmos privilégios da versão anterior (anon segue bloqueado).
REVOKE ALL ON FUNCTION prestadores_publicos(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prestadores_publicos(INT) FROM anon;
GRANT EXECUTE ON FUNCTION prestadores_publicos(INT) TO authenticated;

SELECT 'prestadores_publicos devolve geo_preciso (distância honesta na vitrine).' AS resultado;
