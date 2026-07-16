-- ============================================================================
-- Profissionais: compatibilidade dos perfis publicos anteriores ao opt-in
-- ============================================================================
-- Antes de `visibilidade` existir, estes prestadores ja apareciam publicamente
-- na vitrine retornada por prestadores_publicos(). A primeira migracao criou os
-- novos campos com OFF/null e, por isso, zerou a nova aba Profissionais.
--
-- Esta migracao:
--   1. migra somente perfis antigos que ja atendem aos criterios de qualidade;
--   2. nao reativa quem ja fez uma escolha explicita no novo controle;
--   3. mantem novos cadastros com opt-in (DEFAULT OFF).

WITH perfis_legados_elegiveis AS (
  SELECT id
  FROM user_profiles
  WHERE catalogo_atualizado_em IS NULL
    AND visibilidade = 'OFF'
    AND user_type IN ('diarista', 'ambos')
    AND COALESCE(oculto, false) = false
    AND NULLIF(BTRIM(foto_url), '') IS NOT NULL
    AND foto_url NOT ILIKE 'data:%'
    AND NULLIF(BTRIM(funcao), '') IS NOT NULL
    AND NULLIF(BTRIM(bio), '') IS NOT NULL
    AND (COALESCE(telefone_verificado, false) OR documento_status = 'aprovado')
)
UPDATE user_profiles AS up
SET
  visibilidade = 'CATALOGO',
  profissao_principal = COALESCE(
    NULLIF(BTRIM(up.profissao_principal), ''),
    NULLIF(BTRIM(up.funcao), '')
  ),
  descricao_curta = COALESCE(
    NULLIF(BTRIM(up.descricao_curta), ''),
    LEFT(BTRIM(up.bio), 220)
  ),
  -- O produto operava apenas em Campo Grande quando esses perfis foram criados.
  -- Novos perfis continuam gravando a cidade real informada por CEP/GPS.
  catalogo_cidade = COALESCE(
    NULLIF(BTRIM(up.catalogo_cidade), ''),
    'Campo Grande'
  ),
  catalogo_atualizado_em = NOW()
FROM perfis_legados_elegiveis AS legado
WHERE up.id = legado.id;

