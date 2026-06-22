-- ═══════════════════════════════════════════════════════════════════════════
-- pagamentos_intencao — registro do VALOR ESPERADO de cada cobrança (P0-1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Defesa em profundidade contra a falha P0-1 (webhook não validava valor).
-- As Edge Functions create-* gravam aqui, no momento em que criam a preferência
-- do Mercado Pago, a amarração:  external_reference ↔ valor_esperado ↔ user.
-- O mp-webhook, ao receber um pagamento aprovado, confere o transaction_amount
-- contra esta linha (além do valor canônico hardcoded na própria função) antes
-- de conceder o benefício. Sem este cruzamento, qualquer pagamento aprovado de
-- qualquer valor liberava o benefício.
--
-- O valor canônico continua sendo "fonte da verdade no servidor" tanto aqui
-- (gravado pela create-*, que define o preço) quanto no mapa hardcoded do
-- webhook — os dois precisam bater.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pagamentos_intencao (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference    TEXT NOT NULL,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL,                  -- 'contato' | 'vaga' | 'plano'
  valor_esperado        NUMERIC(10,2) NOT NULL,
  user_type             TEXT,                           -- 'diarista' | 'empregador' (plano)
  plano_id              TEXT,                           -- 'essencial' | 'plus' (plano)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- O webhook busca pela referência; uma referência pode ter várias tentativas,
-- então índice (não UNIQUE) — pega a mais recente.
CREATE INDEX IF NOT EXISTS idx_pag_intencao_ref ON pagamentos_intencao (external_reference, created_at DESC);

ALTER TABLE pagamentos_intencao ENABLE ROW LEVEL SECURITY;

-- O dono autenticado só pode INSERIR a própria intenção (user_id = auth.uid()).
-- Ninguém (a não ser service_role) LÊ — o webhook usa service-role.
DROP POLICY IF EXISTS pag_intencao_insert_own ON pagamentos_intencao;
CREATE POLICY pag_intencao_insert_own ON pagamentos_intencao
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Sem policy de SELECT/UPDATE/DELETE para authenticated/anon → bloqueado por padrão.
REVOKE ALL ON pagamentos_intencao FROM anon;

SELECT 'pagamentos_intencao criada (P0-1: amarração valor esperado ↔ referência ↔ user).' AS resultado;
