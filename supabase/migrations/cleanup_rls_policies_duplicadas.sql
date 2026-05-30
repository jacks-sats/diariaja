-- ═══════════════════════════════════════════════════════════════════════════
-- CLEANUP — policies RLS duplicadas (sujeira, sem mudança de segurança)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Descoberto ao versionar o schema: algumas tabelas têm policies PERMISSIVAS
-- EXATAMENTE idênticas (criadas em momentos diferentes). Como policies
-- permissivas são OR'd, ter duas iguais é redundante — remover uma não muda
-- nada do comportamento/segurança, só limpa.
--
-- Mantém a versão "nova" (criada nas migrations versionadas) e remove a antiga.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- mensagens: 'mensagens_insert' é idêntica a 'mensagens_insert_remetente'
--            'mensagens_select' é idêntica a 'mensagens_select_participantes'
--   (ver mensagens_rls_participantes.sql — as *_participantes/_remetente são as boas)
DROP POLICY IF EXISTS mensagens_insert ON public.mensagens;
DROP POLICY IF EXISTS mensagens_select ON public.mensagens;

-- webhook_eventos_processados: 'webhook_eventos_service_only' é idêntica a
--   'webhook_eventos_service_role' (ALL TO service_role USING true WITH CHECK true)
DROP POLICY IF EXISTS webhook_eventos_service_only ON public.webhook_eventos_processados;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('mensagens','webhook_eventos_processados')
--    ORDER BY tablename, policyname;
--   -- mensagens deve ficar só com *_participantes/_remetente (+ a de 'messages'
--   --   é outra tabela). webhook só com _service_role.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- OPCIONAL — tabelas LEGADAS sem uso no código (NÃO roda automático)
-- ═══════════════════════════════════════════════════════════════════════════
-- `messages` (vs mensagens), `avaliacoes` (vs avaliacoes_diarista/empregador) e
-- `contratacoes` (vs diarias) NÃO são referenciadas em nenhum lugar do app
-- (src/ + supabase/functions/). São resíduos de versões antigas do schema.
--
-- ⚠️ DROP de tabela é DESTRUTIVO. Antes de remover, CONFIRA se estão vazias:
--   SELECT 'messages' t, count(*) FROM public.messages
--   UNION ALL SELECT 'avaliacoes', count(*) FROM public.avaliacoes
--   UNION ALL SELECT 'contratacoes', count(*) FROM public.contratacoes;
--
-- Se as 3 derem 0 (ou só lixo antigo que pode descartar), remova:
--   DROP TABLE IF EXISTS public.messages;
--   DROP TABLE IF EXISTS public.avaliacoes;
--   DROP TABLE IF EXISTS public.contratacoes;
-- (Faça um backup/export antes se tiver qualquer dúvida.)
-- ═══════════════════════════════════════════════════════════════════════════
