-- ============================================================================
-- PERFORMANCE — Indexes para hot paths sem cobertura adequada
-- ============================================================================
-- Identificados durante auditoria de escala (2026-05-28). Cada index aqui
-- existe pra evitar full table scan em query que roda múltiplas vezes por
-- usuário ativo. Aplicar é seguro: CREATE INDEX IF NOT EXISTS é idempotente
-- e Postgres faz online (sem lock de leitura/escrita pesado em tabelas
-- pequenas; tabelas grandes precisam CONCURRENTLY — vide nota abaixo).
--
-- NOTA: pra produção com tabelas muito grandes (>100k rows), rode os
-- comandos individualmente com `CREATE INDEX CONCURRENTLY` em transação
-- separada. Como o projeto ainda tá pré-marketing, full lock é aceitável.
-- ============================================================================

-- diarias.diarista_aceite_id — usado em send-push, queries de "minhas
-- aceitas" do diarista, contagem de diárias concluídas. Sem index = table
-- scan a cada query.
CREATE INDEX IF NOT EXISTS idx_diarias_diarista_aceite
  ON diarias(diarista_aceite_id)
  WHERE diarista_aceite_id IS NOT NULL;

-- diarias.data + status — feed de oportunidades filtra por status='aberta'
-- e ordena por data. Index composto cobre os 2.
CREATE INDEX IF NOT EXISTS idx_diarias_data_status
  ON diarias(data, status);

-- mensagens.destinatario_id simples — partial existente é só pra não-lidas.
-- Quando user abre conversa antiga já lida, parts não ajudam.
CREATE INDEX IF NOT EXISTS idx_mensagens_destinatario_id
  ON mensagens(destinatario_id);

-- mensagens.created_at — chat ordena DESC por created_at na timeline.
-- Sem index, ORDER BY = full scan + sort em memória.
CREATE INDEX IF NOT EXISTS idx_mensagens_created_at
  ON mensagens(created_at DESC);

-- push_subscriptions.user_id — send-push faz lookup por user_id pra cada
-- destinatário. Sem index, busca linear no array de subscriptions.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

-- analytics_eventos.created_at — admin queries de "últimos eventos", e
-- futura limpeza com TTL via DELETE WHERE created_at < NOW() - INTERVAL.
CREATE INDEX IF NOT EXISTS idx_analytics_eventos_created
  ON analytics_eventos(created_at DESC);

-- contatos_desbloqueios.empregador_id — hidratar contatosLiberados no
-- login do anunciante usa este filtro. Hoje sem index.
CREATE INDEX IF NOT EXISTS idx_contatos_desbloq_empregador
  ON contatos_desbloqueios(empregador_id);

-- contatos_desbloqueios.mp_external_reference — também usado pra parse
-- do convite_id na hidratação.
CREATE INDEX IF NOT EXISTS idx_contatos_desbloq_extref
  ON contatos_desbloqueios(mp_external_reference);

-- ============================================================================
-- VALIDAÇÃO PÓS-APLICAÇÃO
-- ============================================================================
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE indexname LIKE 'idx_%' AND tablename IN
--   ('diarias','mensagens','push_subscriptions','analytics_eventos','contatos_desbloqueios')
-- ORDER BY tablename, indexname;
