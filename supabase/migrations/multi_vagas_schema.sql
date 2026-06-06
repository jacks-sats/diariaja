-- ═══════════════════════════════════════════════════════════════════════════
-- Multi-vagas: anunciante define quantas vagas a diária oferece e pode
-- selecionar VÁRIOS contratados (até preencher). SCHEMA aditivo e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
-- Esta migration é SEGURA de aplicar a qualquer momento: só adiciona colunas
-- (com default) e uma tabela nova vazia. NÃO muda o fluxo atual sozinha — a
-- lógica de cobrança (RPC/trigger) e o frontend são alterados JUNTOS, conforme
-- docs/spec-multi-vagas.md. Enquanto vagas=1 (default), tudo segue como hoje.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Quantas vagas a diária oferece (default 1 = comportamento atual).
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS vagas INTEGER NOT NULL DEFAULT 1;

-- 2. Contador denormalizado de vagas já preenchidas (mantido pela app/trigger).
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS vagas_preenchidas INTEGER NOT NULL DEFAULT 0;

-- Garante 1..N vagas e que preenchidas nunca passe de vagas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diarias_vagas_min_chk') THEN
    ALTER TABLE diarias ADD CONSTRAINT diarias_vagas_min_chk CHECK (vagas >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diarias_vagas_preenchidas_chk') THEN
    ALTER TABLE diarias ADD CONSTRAINT diarias_vagas_preenchidas_chk
      CHECK (vagas_preenchidas >= 0 AND vagas_preenchidas <= vagas);
  END IF;
END $$;

-- 3. Uma linha por contratação (hire). Substitui o "1 diarista_aceite_id" único
--    quando vagas > 1. Para vagas=1, diarias.diarista_aceite_id continua sendo o
--    "contratado principal" (compat. com chat/check-in/avaliação atuais).
CREATE TABLE IF NOT EXISTS diaria_contratacoes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id    UUID NOT NULL REFERENCES diarias(id) ON DELETE CASCADE,
  diarista_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empregador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- selecionado → diarista ainda não confirmou; confirmado → aceitou;
  -- cancelada → desistência/cancelamento (libera a vaga); concluida → finalizada.
  status       TEXT NOT NULL DEFAULT 'selecionado'
               CHECK (status IN ('selecionado','confirmado','cancelada','concluida')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Não pode contratar o mesmo diarista duas vezes na mesma diária.
  UNIQUE (diaria_id, diarista_id)
);

CREATE INDEX IF NOT EXISTS idx_contratacoes_diaria      ON diaria_contratacoes(diaria_id);
CREATE INDEX IF NOT EXISTS idx_contratacoes_diarista    ON diaria_contratacoes(diarista_id);
CREATE INDEX IF NOT EXISTS idx_contratacoes_empregador  ON diaria_contratacoes(empregador_id);
-- Para a contagem mensal da cobrança R$1 (ver spec).
CREATE INDEX IF NOT EXISTS idx_contratacoes_emp_mes     ON diaria_contratacoes(empregador_id, created_at);

-- 4. RLS — anunciante dono e diarista contratado enxergam suas linhas.
ALTER TABLE diaria_contratacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contratacoes_select ON diaria_contratacoes;
CREATE POLICY contratacoes_select ON diaria_contratacoes
  FOR SELECT USING (auth.uid() = empregador_id OR auth.uid() = diarista_id);

-- Só o empregador dono insere/atualiza contratações (a seleção parte dele).
DROP POLICY IF EXISTS contratacoes_insert ON diaria_contratacoes;
CREATE POLICY contratacoes_insert ON diaria_contratacoes
  FOR INSERT WITH CHECK (auth.uid() = empregador_id);

-- Empregador atualiza (cancelar/concluir); diarista pode mudar p/ 'confirmado'
-- a própria linha (aceite). Enforcement fino fica na RPC de aceite (ver spec).
DROP POLICY IF EXISTS contratacoes_update ON diaria_contratacoes;
CREATE POLICY contratacoes_update ON diaria_contratacoes
  FOR UPDATE USING (auth.uid() = empregador_id OR auth.uid() = diarista_id)
  WITH CHECK (auth.uid() = empregador_id OR auth.uid() = diarista_id);

DROP POLICY IF EXISTS contratacoes_delete ON diaria_contratacoes;
CREATE POLICY contratacoes_delete ON diaria_contratacoes
  FOR DELETE USING (auth.uid() = empregador_id);

SELECT 'Schema multi-vagas (colunas vagas/vagas_preenchidas + tabela diaria_contratacoes) instalado.' AS resultado;
