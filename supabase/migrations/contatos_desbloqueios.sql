-- ═══════════════════════════════════════════════════════════════════════════
-- Contatos desbloqueados — move contador do localStorage pro banco
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bug fechado: o contador `contatosDesbloqueados` morava só no localStorage
-- do navegador e era incrementado pelo redirect de retorno do MP
-- (`/?contato_desbloqueado=sucesso`), SEM o servidor validar o pagamento. O
-- comentário no mp-webhook deixava claro: "O webhook apenas loga". Permitia:
--   - Manipular URL e ganhar unlocks sem pagar
--   - Cada dispositivo via um contador diferente (não sincronizava)
--   - Limpar cache zerava o contador
--
-- Fix:
--   1. Tabela append-only `contatos_desbloqueios` (1 linha = 1 unlock pago).
--   2. UNIQUE em mp_payment_id pra idempotência (webhook não duplica).
--   3. RLS: cada user lê os próprios; service_role insere via webhook.
--   4. (Em separado) mp-webhook passa a INSERT aqui em vez de só logar.
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contatos_desbloqueios (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empregador_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mp_payment_id           TEXT,
  mp_external_reference   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência: o mesmo payment_id do MP só pode ser registrado uma vez.
-- Webhooks do MP podem disparar duplicado em retries — UNIQUE garante 1 linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contatos_desbloqueios_payment
  ON contatos_desbloqueios(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- Hot path da query: empregador X no mês Y.
CREATE INDEX IF NOT EXISTS idx_contatos_desbloqueios_emp_data
  ON contatos_desbloqueios(empregador_id, created_at DESC);

-- RLS
ALTER TABLE contatos_desbloqueios ENABLE ROW LEVEL SECURITY;

-- Usuário lê os próprios (pra UI mostrar quantos comprou no mês)
DROP POLICY IF EXISTS contatos_desbloqueios_owner_select ON contatos_desbloqueios;
CREATE POLICY contatos_desbloqueios_owner_select ON contatos_desbloqueios
  FOR SELECT TO authenticated
  USING (empregador_id = auth.uid());

-- Só service_role insere/atualiza/deleta (via Edge Function mp-webhook).
-- INSERT nem precisa de policy explícita pra authenticated — sem policy = bloqueado.
DROP POLICY IF EXISTS contatos_desbloqueios_service_all ON contatos_desbloqueios;
CREATE POLICY contatos_desbloqueios_service_all ON contatos_desbloqueios
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helper RPC: conta unlocks do empregador autenticado neste mês.
-- Usar via supabase.rpc("contar_contatos_desbloqueados_mes") no client.
CREATE OR REPLACE FUNCTION contar_contatos_desbloqueados_mes()
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM contatos_desbloqueios
   WHERE empregador_id = auth.uid()
     AND created_at >= date_trunc('month', NOW());
  RETURN COALESCE(v_count, 0);
END $$;

REVOKE ALL ON FUNCTION contar_contatos_desbloqueados_mes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contar_contatos_desbloqueados_mes() TO authenticated;

-- Verificação (rodar manualmente):
--   SELECT COUNT(*) FROM contatos_desbloqueios;  -- deve retornar 0 inicialmente
--   SELECT contar_contatos_desbloqueados_mes();  -- 0 pra qualquer user novo
