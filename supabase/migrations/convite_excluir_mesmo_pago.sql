-- ═══════════════════════════════════════════════════════════════════════════
-- Convites: contratante pode EXCLUIR convite recusado MESMO se foi pago
-- ═══════════════════════════════════════════════════════════════════════════
-- Decisão de produto (28/06/2026): quando o anunciante paga R$ 2,50 pra
-- desbloquear o contato e o profissional recusa/desiste, o anunciante pode
-- EXCLUIR o convite de vez (sem devolução de crédito — decisão consciente).
--
-- A policy anterior (contratante_cancela_convite) bloqueava o DELETE com
-- `pago_em IS NULL`, pra "preservar o histórico do desbloqueio". Mas esse
-- histórico NÃO mora no convite — mora em `contatos_desbloqueios`
-- (o app reconstrói "contato liberado" pelo mp_external_reference). Logo,
-- apagar o convite NÃO perde nada financeiro: o registro do pagamento e o
-- estado de "já paguei por esse contato" continuam intactos.
--
-- Esta migração apenas REMOVE a condição `pago_em IS NULL` da policy. Continua
-- restrita ao próprio contratante e a convites pendente/recusado (não mexe em
-- convites aceitos/compromissados).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS contratante_cancela_convite ON convites;
CREATE POLICY contratante_cancela_convite ON convites
  FOR DELETE
  USING (auth.uid() = contratante_id
         AND status IN ('pendente', 'recusado'));

SELECT 'Policy contratante_cancela_convite atualizada (exclui mesmo pago).' AS resultado;
