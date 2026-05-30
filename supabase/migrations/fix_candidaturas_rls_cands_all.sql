-- ═══════════════════════════════════════════════════════════════════════════
-- FIX — candidaturas.cands_all era porta aberta (FOR ALL TO public USING true)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Descoberto ao versionar o schema (2026-05-30): a policy `cands_all` permitia
-- a QUALQUER um — inclusive anon (anon key é pública) — ler/inserir/alterar/
-- APAGAR qualquer candidatura. Vazamento de dados + vandalismo (apagar/alterar
-- candidaturas alheias) + inserção de candidaturas falsas.
--
-- Fix: substitui por policies por operação.
--   SELECT  → authenticated (bloqueia anon; mantém a contagem de "lotação" que o
--             diarista faz em vagas alheias, e a visão do anunciante).
--   INSERT  → só a própria candidatura (diarista_id = auth.uid()).
--   UPDATE  → o próprio diarista (confirmar) OU o dono da diária (selecionar/
--             rejeitar/cancelar).
--   DELETE  → o próprio diarista (desistir) OU o dono da diária (cancelar vaga).
--
-- Não exige mudança de cliente — todas as operações do app se encaixam.
-- service_role (Edge Functions, ex.: delete-user) tem BYPASSRLS, não é afetado.
-- Idempotente. Rollback: recriar a policy antiga (NÃO recomendado):
--   CREATE POLICY cands_all ON public.candidaturas FOR ALL TO public USING (true) WITH CHECK (true);
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS cands_all ON public.candidaturas;

-- Leitura: qualquer autenticado (NÃO public → bloqueia anon).
DROP POLICY IF EXISTS candidaturas_select ON public.candidaturas;
CREATE POLICY candidaturas_select ON public.candidaturas
  FOR SELECT TO authenticated
  USING (true);

-- Inserção: só a própria candidatura.
DROP POLICY IF EXISTS candidaturas_insert_own ON public.candidaturas;
CREATE POLICY candidaturas_insert_own ON public.candidaturas
  FOR INSERT TO authenticated
  WITH CHECK (diarista_id = auth.uid());

-- Atualização: diarista dono da candidatura OU anunciante dono da diária.
DROP POLICY IF EXISTS candidaturas_update ON public.candidaturas;
CREATE POLICY candidaturas_update ON public.candidaturas
  FOR UPDATE TO authenticated
  USING (
    diarista_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.diarias d
                WHERE d.id = candidaturas.diaria_id AND d.empregador_id = auth.uid())
  )
  WITH CHECK (
    diarista_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.diarias d
                WHERE d.id = candidaturas.diaria_id AND d.empregador_id = auth.uid())
  );

-- Exclusão: diarista dono da candidatura OU anunciante dono da diária.
DROP POLICY IF EXISTS candidaturas_delete ON public.candidaturas;
CREATE POLICY candidaturas_delete ON public.candidaturas
  FOR DELETE TO authenticated
  USING (
    diarista_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.diarias d
                WHERE d.id = candidaturas.diaria_id AND d.empregador_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'candidaturas' ORDER BY cmd;
--   -- NÃO deve ter 'cands_all'; deve ter os 4 acima.
-- ─────────────────────────────────────────────────────────────────────────────
