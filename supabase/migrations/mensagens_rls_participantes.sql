-- ============================================================================
-- Mensagens: leitura/escrita por PARTICIPANTE (remetente ou destinatário)
-- ----------------------------------------------------------------------------
-- O chat por CONVITE grava mensagens com diaria_id = convite.id (não existe
-- diária real). Se a política de leitura de `mensagens` fosse baseada na diária,
-- o prestador não conseguia LER as mensagens do convite (o anunciante lia porque
-- é o remetente). Estas políticas garantem que ambos os lados (remetente e
-- destinatário) leem e enviam — independente de existir diária. São PERMISSIVAS
-- (somam com as existentes via OR), idempotentes e seguras.
--
-- Aplicar no SQL Editor do Supabase.
-- ============================================================================

ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;

-- Leitura: participantes da conversa
DROP POLICY IF EXISTS "mensagens_select_participantes" ON mensagens;
CREATE POLICY "mensagens_select_participantes" ON mensagens
  FOR SELECT
  USING (auth.uid() = remetente_id OR auth.uid() = destinatario_id);

-- Envio: só em nome próprio (remetente = você)
DROP POLICY IF EXISTS "mensagens_insert_remetente" ON mensagens;
CREATE POLICY "mensagens_insert_remetente" ON mensagens
  FOR INSERT
  WITH CHECK (auth.uid() = remetente_id);
