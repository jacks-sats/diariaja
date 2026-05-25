-- Migração: Chat v2 — read receipts + índices pra contagem de não-lidas
-- Suporta:
--   • ✓✓ visto: lida_em é preenchido quando destinatário abre o chat.
--   • Contagem por conversa: query rápida via índice (destinatario, lida_em).
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Coluna lida_em (NULL = não lida)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE mensagens
  ADD COLUMN IF NOT EXISTS lida_em TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índice pra contar não-lidas por destinatário em O(log n)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mensagens_destinatario_naolidas
  ON mensagens (destinatario_id, diaria_id)
  WHERE lida_em IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índice pra listar conversas mais recentes do usuário
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mensagens_diaria_created
  ON mensagens (diaria_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Política: destinatário pode marcar a mensagem dele como lida
-- ─────────────────────────────────────────────────────────────────────────────
-- O destinatário deve poder fazer UPDATE em lida_em da própria mensagem.
DROP POLICY IF EXISTS "destinatario_marca_lida" ON mensagens;
CREATE POLICY "destinatario_marca_lida" ON mensagens
  FOR UPDATE
  USING (auth.uid() = destinatario_id)
  WITH CHECK (auth.uid() = destinatario_id);

SELECT 'Chat v2 (read receipts + índices) instalado.' AS resultado;
