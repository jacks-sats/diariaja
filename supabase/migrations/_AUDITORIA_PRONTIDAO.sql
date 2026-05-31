-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORIA DE PRONTIDÃO — confere se TUDO que o app espera está no banco
-- ═══════════════════════════════════════════════════════════════════════════
-- NÃO altera nada. Só LÊ o catálogo do Postgres e reporta ✅/❌ por item.
-- Rode no Supabase → SQL Editor → Run e me mande o resultado.
-- Qualquer ❌ = aquele fluxo está quebrado em produção.
-- ═══════════════════════════════════════════════════════════════════════════

WITH checks AS (
  -- ── Colunas esperadas ──────────────────────────────────────────────
  SELECT 'coluna convites.pago_em' AS item,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='convites' AND column_name='pago_em') AS ok
  UNION ALL SELECT 'coluna convites.presenca_confirmada_em',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='convites' AND column_name='presenca_confirmada_em')
  UNION ALL SELECT 'coluna convites.diaria_id',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='convites' AND column_name='diaria_id')
  UNION ALL SELECT 'coluna user_profiles.cep',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='cep')
  UNION ALL SELECT 'coluna candidaturas.diarista_info',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='candidaturas' AND column_name='diarista_info')

  -- ── Funções (RPCs) esperadas ───────────────────────────────────────
  UNION ALL SELECT 'rpc criar_diaria_de_convite',
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='criar_diaria_de_convite')
  UNION ALL SELECT 'rpc meu_perfil',
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='meu_perfil')
  UNION ALL SELECT 'rpc pode_selecionar_candidato',
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='pode_selecionar_candidato')
  UNION ALL SELECT 'rpc perfis_publicos',
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='perfis_publicos')

  -- ── meu_perfil retorna cep? (precisa do to_jsonb atualizado) ───────
  UNION ALL SELECT 'meu_perfil usa to_jsonb (retorna cep)',
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='meu_perfil' AND pg_get_functiondef(oid) LIKE '%to_jsonb%')

  -- ── pode_selecionar_candidato com cota grátis 0 (R$1 sempre) ───────
  UNION ALL SELECT 'cobranca R$1 cota 0 (nao tem cota 3)',
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='pode_selecionar_candidato'
           AND pg_get_functiondef(oid) LIKE '%:= 0%'
           AND pg_get_functiondef(oid) NOT LIKE '%:= 3%')

  -- ── Constraint do status do convite aceita 'confirmado' ────────────
  UNION ALL SELECT 'convites aceita status confirmado',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='convites_status_check'
           AND pg_get_constraintdef(oid) LIKE '%confirmado%')

  -- ── Índices únicos de CPF/CNPJ ─────────────────────────────────────
  UNION ALL SELECT 'unique index CPF',
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='uq_user_profiles_cpf')
  UNION ALL SELECT 'unique index CNPJ',
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='uq_user_profiles_cnpj')

  -- ── Realtime: tabelas na publicação ────────────────────────────────
  UNION ALL SELECT 'realtime: mensagens',
    EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='mensagens')
  UNION ALL SELECT 'realtime: candidaturas',
    EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='candidaturas')
  UNION ALL SELECT 'realtime: convites',
    EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='convites')

  -- ── Grants de escrita em user_profiles (authenticated) ─────────────
  UNION ALL SELECT 'grant UPDATE user_profiles (authenticated)',
    EXISTS(SELECT 1 FROM information_schema.role_table_grants
           WHERE table_name='user_profiles' AND grantee='authenticated' AND privilege_type='UPDATE')
  UNION ALL SELECT 'grant INSERT user_profiles (authenticated)',
    EXISTS(SELECT 1 FROM information_schema.role_table_grants
           WHERE table_name='user_profiles' AND grantee='authenticated' AND privilege_type='INSERT')

  -- ── Grants de coluna em convites (presenca/diaria) ─────────────────
  UNION ALL SELECT 'grant UPDATE convites.presenca_confirmada_em',
    EXISTS(SELECT 1 FROM information_schema.column_privileges
           WHERE table_name='convites' AND grantee='authenticated'
           AND column_name='presenca_confirmada_em' AND privilege_type='UPDATE')
  UNION ALL SELECT 'grant UPDATE convites.diaria_id',
    EXISTS(SELECT 1 FROM information_schema.column_privileges
           WHERE table_name='convites' AND grantee='authenticated'
           AND column_name='diaria_id' AND privilege_type='UPDATE')

  -- ── RLS de mensagens (participante) ────────────────────────────────
  UNION ALL SELECT 'policy mensagens_select_participantes',
    EXISTS(SELECT 1 FROM pg_policies WHERE tablename='mensagens' AND policyname='mensagens_select_participantes')

  -- ── RLS de candidaturas (select) ───────────────────────────────────
  UNION ALL SELECT 'policy candidaturas_select',
    EXISTS(SELECT 1 FROM pg_policies WHERE tablename='candidaturas' AND policyname='candidaturas_select')
)
SELECT
  CASE WHEN ok THEN '✅' ELSE '❌ FALTA' END AS status,
  item
FROM checks
ORDER BY ok ASC, item;  -- ❌ primeiro (sobem pro topo)
