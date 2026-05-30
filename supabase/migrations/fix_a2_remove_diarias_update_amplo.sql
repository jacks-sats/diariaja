-- ═══════════════════════════════════════════════════════════════════════════
-- FIX A2 — UPDATE amplo em diarias (qualquer autenticado edita vaga alheia)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Confirmado na auditoria (2026-05): a policy `diarias_aceitar` tem
--   USING = (auth.uid() IS NOT NULL AND status = 'aberta')
-- e o WITH CHECK NÃO amarra o dono (empregador_id). Combinada com o GRANT de
-- UPDATE em todas as colunas, isso deixa QUALQUER usuário autenticado alterar
-- QUALQUER vaga com status='aberta' de terceiros (mudar valor, função,
-- descrição, ou se autoatribuir como diarista_aceite_id).
--
-- Revisão do cliente: nenhum fluxo legítimo depende dessa policy. Os UPDATEs
-- reais em diarias são:
--   - do DONO (selecionar candidato, editar/cancelar vaga, auto-expirar)
--     → cobertos por `diarias_empregador` (ALL, USING auth.uid()=empregador_id);
--   - do PRESTADOR SELECIONADO confirmando presença
--     → coberto por `diarista_aceite_pode_confirmar`
--       (USING auth.uid()=diarista_aceite_id AND status='pendente').
-- A `diarias_aceitar` é resíduo legado e pode ser removida.
--
-- Idempotente. Se algum fluxo inesperado quebrar (UPDATE de não-dono numa vaga
-- aberta), reavaliar — mas a revisão não encontrou nenhum.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS diarias_aceitar ON diarias;

-- Higiene (defesa em profundidade): o papel anon não deve escrever em diarias.
-- Toda escrita exige usuário autenticado; anon nunca tem fluxo legítimo de
-- INSERT/UPDATE/DELETE aqui. (SELECT permanece, caso a listagem pública use.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON diarias FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT policyname FROM pg_policies
--    WHERE tablename='diarias' AND policyname='diarias_aceitar';  -- 0 linhas
--   -- Selecionar candidato (como dono) e confirmar presença (como prestador
--   -- selecionado) devem continuar funcionando normalmente.
-- ─────────────────────────────────────────────────────────────────────────────
