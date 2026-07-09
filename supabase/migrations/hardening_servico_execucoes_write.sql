-- ═══════════════════════════════════════════════════════════════════════════
-- HARDENING (P2, módulo empresas) — execuções só mudam pelas RPCs
-- ═══════════════════════════════════════════════════════════════════════════
-- A policy servico_execucoes_owner_write dava ao PRESTADOR UPDATE direto na
-- própria execução — dava pra setar checkin_em/checkout_em via API crua,
-- pulando a validação de GPS (raio de 300 m) das RPCs registrar_checkin/
-- checkout_servico_empresa. O front nunca escreve nessa tabela diretamente
-- (verificado): todas as mutações passam pelas RPCs SECURITY DEFINER, que
-- não dependem desta policy. Restringe a escrita direta ao DONO do serviço
-- (empregador); o prestador mantém SELECT das próprias execuções.
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS servico_execucoes_owner_write ON servico_execucoes;
CREATE POLICY servico_execucoes_owner_write ON servico_execucoes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  );

SELECT 'Execuções: escrita direta restrita ao dono; prestador via RPCs (GPS).' AS resultado;
