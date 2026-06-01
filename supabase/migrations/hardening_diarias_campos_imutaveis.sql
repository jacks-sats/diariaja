-- ═══════════════════════════════════════════════════════════════════════════
-- Hardening de diárias: prestador selecionado NÃO pode mudar valor/dono
-- ═══════════════════════════════════════════════════════════════════════════
-- Contexto (auditoria 2026-06): a policy `diarista_aceite_pode_confirmar`
--   FOR UPDATE USING (auth.uid()=diarista_aceite_id AND status='pendente')
--   WITH CHECK (auth.uid()=diarista_aceite_id)
-- existe para o PRESTADOR confirmar presença. Mas o WITH CHECK é amplo: ele
-- não amarra coluna nenhuma. Via API direta (DevTools/SDK), o prestador
-- selecionado conseguiria, no mesmo UPDATE, alterar `valor` ou `empregador_id`
-- da diária. O app não intermedia o pagamento (PIX direto), então o impacto é
-- baixo — mas é defesa em profundidade que um investidor espera.
--
-- Fix: trigger BEFORE UPDATE que, QUANDO o autor da operação é o prestador
-- selecionado (e não o dono), restaura os campos sensíveis ao valor original.
-- Não dispara para o DONO (auth.uid()=empregador_id) nem para o service_role
-- das Edge Functions (auth.uid() IS NULL → condição falsa), preservando o
-- webhook do Mercado Pago e a seleção de candidato.
--
-- Idempotente (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). Sem mudança de app.
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.proteger_campos_criticos_diaria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só protege quando quem atualiza é o PRESTADOR SELECIONADO (não o dono).
  -- Dono (empregador) e service_role (auth.uid() IS NULL) passam intactos.
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.diarista_aceite_id
     AND auth.uid() IS DISTINCT FROM OLD.empregador_id THEN
    NEW.valor         := OLD.valor;
    NEW.empregador_id := OLD.empregador_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_campos_criticos_diaria ON public.diarias;
CREATE TRIGGER trg_proteger_campos_criticos_diaria
  BEFORE UPDATE ON public.diarias
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_campos_criticos_diaria();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.diarias'::regclass
--     AND tgname='trg_proteger_campos_criticos_diaria';  -- 1 linha
--   -- Como dono: editar/cancelar/selecionar continua normal.
--   -- Como prestador selecionado: confirmar presença OK; tentar mudar valor
--   -- via API → o UPDATE "passa" mas valor/empregador_id ficam inalterados.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'Hardening de diárias: valor/empregador_id imutáveis para o prestador.' AS resultado;
