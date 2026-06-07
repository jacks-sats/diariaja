-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO DE PRODUÇÃO (READ-ONLY) — confirma se os fixes de segurança/LGPD
-- e as features estão realmente APLICADOS no banco de produção.
-- ═══════════════════════════════════════════════════════════════════════════
-- Por quê: as 87 migrations são aplicadas À MÃO no SQL Editor. O código do repo
-- tem todos os fixes, mas é preciso garantir que rodaram em produção (risco de
-- "drift"). Este script NÃO altera nada — só lê o catálogo e reporta.
--
-- Como usar: Supabase Dashboard → SQL Editor → cole a SEÇÃO A → Run.
-- Tudo "✅" = produção em dia. Qualquer "❌ FALTA" = aplicar a migration daquele item.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── SEÇÃO A — Objetos críticos presentes? ───────────────────────────────────
SELECT objeto, CASE WHEN ok THEN '✅' ELSE '❌ FALTA' END AS status
FROM (
  VALUES
    ('fn  enforce_limite_selecao_candidato (paywall R$1 no servidor)', to_regprocedure('public.enforce_limite_selecao_candidato()') IS NOT NULL),
    ('fn  pode_selecionar_candidato (gate de cobrança)',              to_regprocedure('public.pode_selecionar_candidato(uuid)') IS NOT NULL),
    ('fn  protect_user_profile_privileged_columns (anti-escalada)',   to_regprocedure('public.protect_user_profile_privileged_columns()') IS NOT NULL),
    ('fn  purgar_dados_antigos (retenção LGPD)',                      to_regprocedure('public.purgar_dados_antigos()') IS NOT NULL),
    ('fn  purgar_antecedentes_expirados (LGPD 90 dias)',              to_regprocedure('public.purgar_antecedentes_expirados()') IS NOT NULL),
    ('trg trg_enforce_limite_selecao em diarias',                     EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_enforce_limite_selecao' AND NOT tgisinternal)),
    ('trg protect em user_profiles',                                  EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='user_profiles' AND NOT t.tgisinternal)),
    ('col diarias.vagas (multi-vagas Fase 1)',                        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='diarias' AND column_name='vagas')),
    ('col diarias.vagas_preenchidas',                                 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='diarias' AND column_name='vagas_preenchidas')),
    ('col candidaturas.selecionado_em (cobrança por vaga)',           EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='candidaturas' AND column_name='selecionado_em')),
    ('col user_profiles.antecedentes_url',                            EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='antecedentes_url')),
    ('rls assinaturas: authenticated NÃO faz UPDATE',                 NOT has_table_privilege('authenticated','public.assinaturas','UPDATE')),
    ('rls habilitado em diarias',                                     COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.diarias')), false)),
    ('rls habilitado em candidaturas',                               COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.candidaturas')), false)),
    ('rls habilitado em user_profiles',                             COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.user_profiles')), false)),
    ('rls habilitado em mensagens',                                  COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.mensagens')), false)),
    ('rls habilitado em assinaturas',                                COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.assinaturas')), false)),
    ('ext pg_cron habilitada (purgas LGPD agendadas)',               EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron'))
) AS t(objeto, ok)
ORDER BY ok, objeto;


-- ═══════════════════════════════════════════════════════════════════════════
-- ── SEÇÃO B — Quem é o seu público (rode separadamente, uma query por vez) ──
-- ═══════════════════════════════════════════════════════════════════════════

-- B1. Usuários por papel
-- SELECT user_type, COUNT(*) FROM user_profiles GROUP BY user_type ORDER BY 2 DESC;

-- B2. Liquidez (a razão mais importante do marketplace: oferta vs demanda)
-- SELECT
--   COUNT(*) FILTER (WHERE user_type='diarista')   AS prestadores,
--   COUNT(*) FILTER (WHERE user_type='empregador') AS anunciantes
-- FROM user_profiles;

-- B3. Concentração geográfica
-- SELECT cidade, COUNT(*) FROM user_profiles GROUP BY cidade ORDER BY 2 DESC LIMIT 20;

-- B4. Funil real (últimos 30 dias)
-- SELECT evento, COUNT(*) FROM analytics_eventos
-- WHERE created_at > NOW() - INTERVAL '30 days'
-- GROUP BY evento ORDER BY 2 DESC;

-- B5. Diárias por status (saúde do ciclo)
-- SELECT status, COUNT(*) FROM diarias GROUP BY status ORDER BY 2 DESC;

-- B6. Conversão / receita
-- SELECT COUNT(*) AS assinaturas_ativas FROM assinaturas WHERE status='ativo';
-- SELECT COUNT(*) AS contatos_r1_no_mes FROM contatos_desbloqueios
--   WHERE created_at >= date_trunc('month', NOW());

-- B7. KYC / confiança
-- SELECT documento_status, COUNT(*) FROM user_profiles GROUP BY documento_status;
