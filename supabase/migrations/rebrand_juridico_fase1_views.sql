-- ============================================================================
-- REBRAND JURÍDICO — FASE 1 (additive only, ZERO destruição)
-- ============================================================================
-- Cria VIEWS com nomenclatura nova ("anuncios", "interessados", etc.) que
-- espelham as tabelas existentes. Permite que o app continue usando os nomes
-- originais SEM quebrar, mas expõe a nomenclatura nova pra auditoria jurídica
-- e migrações futuras.
--
-- POSICIONAMENTO JURÍDICO
-- DiariaJá é PLATAFORMA DE ANÚNCIOS — não empregadora, não intermediadora.
-- Anunciante (ex-empregador) publica anúncio (ex-vaga); prestador (ex-diarista)
-- demonstra interesse (ex-candidatura). Relação entre eles é autônoma.
--
-- SEGURANÇA
-- Não renomeia colunas, tabelas, índices, RLS policies — só adiciona views.
-- Roda quantas vezes quiser (idempotente via CREATE OR REPLACE).
--
-- FASE 2 (futura, sessão separada): renomeação real das colunas + migration
-- dos valores `user_type='diarista'|'empregador'` pra `'prestador'|'anunciante'`,
-- com atualização coordenada de TODO o código que referencia esses identificadores.
-- ============================================================================

-- ── Anúncios (espelha tabela "diarias") ─────────────────────────────────────
CREATE OR REPLACE VIEW anuncios AS
SELECT
  id,
  empregador_id      AS anunciante_id,
  nome_negocio,
  segmento,
  funcao,
  descricao,
  data,
  horario_inicio,
  horario_fim,
  valor,
  status,
  diarista_aceite_id AS prestador_aceite_id,
  created_at,
  motivo_cancelamento,
  endereco,
  lat,
  lng,
  valor_encostada,
  valor_por_entrega,
  ganho_estimado_dia,
  pagamento_status,
  pagamento_mp_id,
  taxa_plataforma,
  valor_diarista     AS valor_prestador,
  bairro
FROM diarias;

COMMENT ON VIEW anuncios IS 'View com nomenclatura jurídica nova. Lê de "diarias". Rebrand fase 1.';

-- ── Interesses (espelha tabela "candidaturas") ──────────────────────────────
-- Só cria se a tabela candidaturas existir (instalações antigas).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='candidaturas') THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW interesses AS
      SELECT
        id,
        diaria_id      AS anuncio_id,
        diarista_id    AS prestador_id,
        status,
        created_at
      FROM candidaturas
    $sql$;
    COMMENT ON VIEW interesses IS 'View com nomenclatura jurídica nova. Lê de "candidaturas".';
  END IF;
END$$;

-- ── Conexões (espelha tabela "convites") ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='convites') THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW conexoes_diretas AS
      SELECT
        id,
        contratante_id   AS anunciante_id,
        diarista_id      AS prestador_id,
        contratante_nome AS anunciante_nome,
        diarista_nome    AS prestador_nome,
        funcao,
        local_servico,
        data_servico,
        horario_servico,
        observacoes,
        valor,
        status,
        created_at
      FROM convites
    $sql$;
    COMMENT ON VIEW conexoes_diretas IS 'View com nomenclatura jurídica nova. Lê de "convites".';
  END IF;
END$$;

-- ── Perfis com label de papel renomeado ────────────────────────────────────
-- View que expõe user_type traduzido pra terminologia nova.
-- Útil pra dashboards, exports legais e relatórios.
CREATE OR REPLACE VIEW usuarios_publicos AS
SELECT
  id,
  CASE user_type
    WHEN 'diarista'   THEN 'prestador'
    WHEN 'empregador' THEN 'anunciante'
    ELSE user_type
  END AS papel,
  nome,
  segmento,
  funcao,
  bio,
  categorias,
  plano_ativo,
  created_at
FROM user_profiles;

COMMENT ON VIEW usuarios_publicos IS 'View de perfis com papel traduzido pra terminologia nova (prestador/anunciante).';

-- ============================================================================
-- VALIDAÇÃO — rode após aplicar pra confirmar
-- ============================================================================
-- SELECT count(*) FROM anuncios;           -- deve bater com count(*) FROM diarias
-- SELECT count(*) FROM interesses;         -- deve bater com count(*) FROM candidaturas
-- SELECT count(*) FROM conexoes_diretas;   -- deve bater com count(*) FROM convites
-- SELECT count(*) FROM usuarios_publicos;  -- deve bater com count(*) FROM user_profiles

-- ============================================================================
-- ROLLBACK (se algo der errado — improvável, é só DROP VIEW)
-- ============================================================================
-- DROP VIEW IF EXISTS anuncios;
-- DROP VIEW IF EXISTS interesses;
-- DROP VIEW IF EXISTS conexoes_diretas;
-- DROP VIEW IF EXISTS usuarios_publicos;
