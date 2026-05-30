-- ═══════════════════════════════════════════════════════════════════════════
-- BASELINE das políticas RLS (snapshot de produção, 2026-05-30)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Gerado a partir de pg_policies em produção (o schema/RLS era aplicado à mão no
-- Dashboard e NÃO estava versionado — este arquivo passa a ser a referência).
-- NÃO é para reaplicar cegamente: serve como documentação/baseline auditável.
--
-- ⚠️ ACHADOS desta foto (ver docs-auditoria) — corrigir à parte:
--   - candidaturas.cands_all  → `FOR ALL TO public USING(true) WITH CHECK(true)`
--     = QUALQUER autenticado lê/edita/apaga QUALQUER candidatura. Buraco aberto.
--   - Policies DUPLICADAS (sem dano, mas sujeira): mensagens_insert +
--     mensagens_insert_remetente; mensagens_select + mensagens_select_participantes;
--     webhook_eventos_service_only + webhook_eventos_service_role; várias em
--     suporte_respostas.
--   - Tabelas possivelmente legadas com policy própria: `messages` (vs `mensagens`),
--     `avaliacoes` (vs avaliacoes_diarista/empregador), `contratacoes` (vs diarias).
--   - user_profiles "Perfis públicos para leitura autenticada" USING(true): leitura
--     de linha é ampla por design; a proteção de PII é por COLUNA (ver c2_passob_3).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY academy_aulas_admin ON public.academy_aulas AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY academy_aulas_leitura ON public.academy_aulas AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY academy_certificados_leitura ON public.academy_certificados AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY academy_cursos_admin ON public.academy_cursos AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY academy_cursos_leitura ON public.academy_cursos AS PERMISSIVE FOR SELECT TO authenticated USING ((publicado = true));
CREATE POLICY academy_modulos_admin ON public.academy_modulos AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY academy_modulos_leitura ON public.academy_modulos AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY academy_opcoes_admin ON public.academy_opcoes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY academy_perguntas_admin ON public.academy_perguntas AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY academy_perguntas_leitura ON public.academy_perguntas AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY academy_progresso_dono ON public.academy_progresso_aulas AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY academy_tentativas_dono ON public.academy_quiz_tentativas AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Leitura restrita a admins" ON public.analytics_eventos AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true)))));
CREATE POLICY insercao_eventos_proprios ON public.analytics_eventos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY service_role_gerencia_assinaturas ON public.assinaturas AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY usuario_ve_propria_assinatura ON public.assinaturas AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY auditoria_admin_read ON public.auditoria_acoes AS PERMISSIVE FOR SELECT TO authenticated USING (((actor_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))));
CREATE POLICY auditoria_service ON public.auditoria_acoes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inserir_propria_avaliacao ON public.avaliacoes AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = empregador_id));
CREATE POLICY ler_todas_avaliacoes ON public.avaliacoes AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY inserir_propria ON public.avaliacoes_diarista AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = empregador_id));
CREATE POLICY leitura_auth ON public.avaliacoes_diarista AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
CREATE POLICY inserir_propria ON public.avaliacoes_empregador AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = diarista_id));
CREATE POLICY leitura_auth ON public.avaliacoes_empregador AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
CREATE POLICY cands_all ON public.candidaturas AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY auth_cria_comentario ON public.comentarios_comunidade AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() IS NOT NULL) AND (auth.uid() = autor_id)));
CREATE POLICY autor_ou_admin_deleta_comentario ON public.comentarios_comunidade AS PERMISSIVE FOR DELETE TO public USING (((auth.uid() = autor_id) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))));
CREATE POLICY todos_leem_comentarios ON public.comentarios_comunidade AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
CREATE POLICY contatos_desbloqueios_owner_select ON public.contatos_desbloqueios AS PERMISSIVE FOR SELECT TO authenticated USING ((empregador_id = auth.uid()));
CREATE POLICY contatos_desbloqueios_service_all ON public.contatos_desbloqueios AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY partes_veem_contratacao ON public.contratacoes AS PERMISSIVE FOR ALL TO public USING (((auth.uid() = empregador_id) OR (auth.uid() = diarista_id)));
CREATE POLICY contratante_pode_criar_convite ON public.convites AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = contratante_id));
CREATE POLICY diarista_pode_responder ON public.convites AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = diarista_id));
CREATE POLICY partes_podem_ver_convite ON public.convites AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = contratante_id) OR (auth.uid() = diarista_id)));
CREATE POLICY service_role_gerencia_convites ON public.convites AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY qualquer_auth_pode_denunciar ON public.denuncias AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY diarias_empregador ON public.diarias AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = empregador_id)) WITH CHECK ((auth.uid() = empregador_id));
CREATE POLICY diarias_leitura ON public.diarias AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
CREATE POLICY diarista_aceite_pode_confirmar ON public.diarias AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = diarista_aceite_id) AND (status = 'pendente'::text))) WITH CHECK ((auth.uid() = diarista_aceite_id));
CREATE POLICY empregador_cria_proprio_pos ON public.feedback_pos_conclusao AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = empregador_id));
CREATE POLICY empregador_le_proprio_pos ON public.feedback_pos_conclusao AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = empregador_id));
CREATE POLICY empregador_cria_proprio_feedback_exp ON public.feedback_vaga_expirada AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = empregador_id));
CREATE POLICY empregador_le_proprio_feedback_exp ON public.feedback_vaga_expirada AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = empregador_id));
CREATE POLICY kyc_log_admin_read ON public.kyc_acessos_log AS PERMISSIVE FOR SELECT TO authenticated USING (((target_user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))));
CREATE POLICY kyc_log_service_write ON public.kyc_acessos_log AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mensagens_insert ON public.mensagens AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = remetente_id));
CREATE POLICY mensagens_insert_remetente ON public.mensagens AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = remetente_id));
CREATE POLICY mensagens_select ON public.mensagens AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = remetente_id) OR (auth.uid() = destinatario_id)));
CREATE POLICY mensagens_select_participantes ON public.mensagens AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = remetente_id) OR (auth.uid() = destinatario_id)));
CREATE POLICY "Empregador pode gerenciar suas mensagens" ON public.messages AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = empregador_id));
CREATE POLICY diarista_proprios_nao_interesse ON public.nao_interesse AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = diarista_id));
CREATE POLICY oauth_states_service_role ON public.oauth_states AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Usuário gerencia suas próprias assinaturas" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO public USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY service_role_gerencia_scores ON public.score_events AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY user_ve_proprios_scores ON public.score_events AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY envia_resposta ON public.suporte_respostas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((auth.uid() = sender_id) AND (((sender_role = 'user'::text) AND (EXISTS ( SELECT 1 FROM suporte_tickets WHERE ((suporte_tickets.id = suporte_respostas.ticket_id) AND (suporte_tickets.user_id = auth.uid()))))) OR ((sender_role = 'admin'::text) AND (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))))));
CREATE POLICY suporte_respostas_admin_all ON public.suporte_respostas AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1 FROM user_profiles up WHERE ((up.id = auth.uid()) AND ((up.is_admin = true) OR (up.is_suporte = true))))));
CREATE POLICY suporte_respostas_thread_insert ON public.suporte_respostas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM suporte_tickets t WHERE ((t.id = suporte_respostas.ticket_id) AND (t.user_id = auth.uid()))))));
CREATE POLICY suporte_respostas_thread_select ON public.suporte_respostas AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1 FROM suporte_tickets t WHERE ((t.id = suporte_respostas.ticket_id) AND (t.user_id = auth.uid())))));
CREATE POLICY ve_respostas_proprio_ticket ON public.suporte_respostas AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1 FROM suporte_tickets t WHERE ((t.id = suporte_respostas.ticket_id) AND ((t.user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true)))))))));
CREATE POLICY admin_atualiza_ticket ON public.suporte_tickets AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true)))));
CREATE POLICY suporte_tickets_admin_all ON public.suporte_tickets AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1 FROM user_profiles up WHERE ((up.id = auth.uid()) AND ((up.is_admin = true) OR (up.is_suporte = true))))));
CREATE POLICY suporte_tickets_owner_insert ON public.suporte_tickets AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY suporte_tickets_owner_select ON public.suporte_tickets AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY user_cria_proprio_ticket ON public.suporte_tickets AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY user_ve_propio_ticket ON public.suporte_tickets AS PERMISSIVE FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))));
CREATE POLICY admin_atualiza_topico ON public.topicos AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid() = autor_id) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))));
CREATE POLICY auth_cria_topico ON public.topicos AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() IS NOT NULL) AND (auth.uid() = autor_id)));
CREATE POLICY autor_ou_admin_deleta_topico ON public.topicos AS PERMISSIVE FOR DELETE TO public USING (((auth.uid() = autor_id) OR (EXISTS ( SELECT 1 FROM user_profiles WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.is_admin = true))))));
CREATE POLICY todos_leem_topicos ON public.topicos AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
CREATE POLICY "Perfis públicos para leitura autenticada" ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuário atualiza próprio perfil" ON public.user_profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id));
CREATE POLICY "Usuário cria próprio perfil" ON public.user_profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = id));
CREATE POLICY "Usuário vê próprio perfil" ON public.user_profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));
CREATE POLICY bloqueio_owner_delete ON public.usuarios_bloqueados AS PERMISSIVE FOR DELETE TO authenticated USING ((bloqueador_id = auth.uid()));
CREATE POLICY bloqueio_owner_insert ON public.usuarios_bloqueados AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bloqueador_id = auth.uid()));
CREATE POLICY bloqueio_owner_select ON public.usuarios_bloqueados AS PERMISSIVE FOR SELECT TO authenticated USING ((bloqueador_id = auth.uid()));
CREATE POLICY webhook_eventos_service_only ON public.webhook_eventos_processados AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY webhook_eventos_service_role ON public.webhook_eventos_processados AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS + RLS-ENABLED (verificado em 2026-05-30)
-- ─────────────────────────────────────────────────────────────────────────────
-- Grants de tabela: `anon` e `authenticated` têm privilégios amplos em quase
-- todas as tabelas — é o MODELO PADRÃO do Supabase (a proteção real é o RLS,
-- não o grant). Desvios confirmados (nossas correções pegaram):
--   - diarias:        anon SEM DML (A2 revogou).
--   - user_profiles:  SEM SELECT de tabela p/ anon/authenticated (C2 B.3 — é por
--                     coluna agora; sensíveis revogadas).
--   - convites:       authenticated SEM UPDATE de tabela (column-restricted em
--                     status — fix IMP-S3).
--   - assinaturas:    escrita só service_role.
--
-- ✅ TODAS as tabelas de `public` têm RLS HABILITADO (verificado:
--    SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--     WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;
--    → 0 rows). Logo, os grants amplos NÃO são exploráveis: o RLS gateia tudo.
-- ─────────────────────────────────────────────────────────────────────────────
