-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: pagamento de liberação de contato em convites diretos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O que faz:
--   1. Adiciona contato_pago_em (TIMESTAMPTZ) + pagamento_mp_id (TEXT) em
--      convites pra registrar quando o contratante pagou os R$ 1 pra liberar
--      o contato do diarista (fluxo "convite direto").
--   2. Permite UPDATE pelo service_role (mp-webhook precisa marcar como pago).
--   3. Índice em contato_pago_em pra ler "convites com contato liberado" rápido.
--
-- Rodar em: Supabase Dashboard → SQL Editor. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE convites
  ADD COLUMN IF NOT EXISTS contato_pago_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pagamento_mp_id  TEXT;

-- service_role precisa atualizar (mp-webhook não usa JWT de usuário)
DROP POLICY IF EXISTS "service_role_gerencia_convites" ON convites;
CREATE POLICY "service_role_gerencia_convites" ON convites
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_convites_contato_pago
  ON convites (contratante_id, contato_pago_em)
  WHERE contato_pago_em IS NOT NULL;

-- Força PostgREST a recarregar o schema cache
NOTIFY pgrst, 'reload schema';

SELECT 'OK — convites.contato_pago_em + RLS service_role + índice' AS resultado;
