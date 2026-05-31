-- ═══════════════════════════════════════════════════════════════════════════
-- Convite: confirmação de presença DEPOIS do pagamento (libera chat só então)
-- ═══════════════════════════════════════════════════════════════════════════
-- Novo fluxo do convite:
--   1. anunciante convida → diarista aceita (status 'aceito')   [já existia]
--   2. anunciante paga R$1 → webhook marca `pago_em` + notifica  [novo]
--   3. diarista confirma presença → `presenca_confirmada_em` + status 'confirmado'
--   4. chat libera pros dois                                     [gate novo]
--
-- Antes: pagar liberava o chat na hora (sem o aceite final do prestador).
--
-- Aplicar em: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Colunas de timeline do convite (aditivas, nullable)
ALTER TABLE convites
  ADD COLUMN IF NOT EXISTS pago_em                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presenca_confirmada_em TIMESTAMPTZ;

-- 1b. CHECK constraint precisa aceitar 'confirmado' (senão o UPDATE é rejeitado
--     pelo banco e a confirmação de presença falha — bug "Não foi possível confirmar").
ALTER TABLE convites DROP CONSTRAINT IF EXISTS convites_status_check;
ALTER TABLE convites ADD CONSTRAINT convites_status_check
  CHECK (status IN ('pendente','aceito','recusado','cancelado','expirado','confirmado'));

-- 2. RLS: o diarista agora também pode marcar status 'confirmado' (além de
--    aceito/recusado). Continua restrito ao próprio convite e só ao campo status
--    via WITH CHECK. `pago_em` é gravado só pelo webhook (service_role bypassa RLS).
DROP POLICY IF EXISTS "diarista_responde_status" ON convites;
CREATE POLICY "diarista_responde_status" ON convites
  FOR UPDATE
  USING (auth.uid() = diarista_id)
  WITH CHECK (
    auth.uid() = diarista_id
    AND status IN ('aceito', 'recusado', 'confirmado')
  );

SELECT 'Convite: confirmação de presença pós-pagamento instalada.' AS resultado;
