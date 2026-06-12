-- ═══════════════════════════════════════════════════════════════════════════
-- Convites: contratante pode CANCELAR (DELETE) o próprio convite
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG em produção (12/06/2026): "Cancelar convite" falhava em silêncio.
-- Causa: a tabela `convites` não tinha NENHUMA policy de DELETE para o
-- contratante (só INSERT contratante / UPDATE diarista / SELECT partes).
-- O PostgREST não retorna erro quando o RLS barra um DELETE — retorna
-- sucesso com 0 linhas — e o client removia o item da tela "com sucesso",
-- mas a linha continuava no banco e voltava no próximo carregamento.
--
-- Esta policy permite o cancelamento APENAS enquanto o convite não virou
-- compromisso pago: status pendente/recusado e pago_em nulo (protege o
-- histórico do desbloqueio R$1). O client (cancelarConvite) também passou a
-- conferir as linhas afetadas via .select() — 0 linhas = erro visível.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- (Aplicada pelo dono em 12/06/2026 — arquivo mantido como registro.)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS contratante_cancela_convite ON convites;
CREATE POLICY contratante_cancela_convite ON convites
  FOR DELETE
  USING (auth.uid() = contratante_id
         AND status IN ('pendente', 'recusado')
         AND pago_em IS NULL);

SELECT 'Policy contratante_cancela_convite instalada.' AS resultado;
