-- Migração: Sistema de expiração de vagas + feedback
-- Rodar em: Supabase Dashboard → SQL Editor → New Query.
-- Pode ser re-executada (CREATE TABLE IF NOT EXISTS / DROP+CREATE para constraint).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Adiciona o status 'expirada' ao constraint de diarias
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE diarias DROP CONSTRAINT IF EXISTS diarias_status_check;
ALTER TABLE diarias ADD CONSTRAINT diarias_status_check
  CHECK (status = ANY (ARRAY[
    'aberta',
    'pendente',
    'aceita',
    'em_andamento',
    'concluida',
    'cancelada',
    'expirada'      -- horário_fim passou e ninguém aceitou/confirmou
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Feedback do empregador para vagas que expiraram sem aceite
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_vaga_expirada (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id       UUID NOT NULL REFERENCES diarias(id) ON DELETE CASCADE,
  empregador_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motivo_categoria TEXT NOT NULL CHECK (motivo_categoria IN (
    'sem_candidatos',   -- ninguém se candidatou
    'valor_baixo',      -- empregador acha que ofereceu pouco
    'data_passou',      -- esqueceu de selecionar a tempo
    'desisti',          -- desistiu de contratar
    'contratei_fora',   -- contratou alguém fora do app
    'outro'
  )),
  motivo_texto    TEXT,                              -- detalhe opcional
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (diaria_id)   -- 1 feedback por vaga expirada
);

ALTER TABLE feedback_vaga_expirada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empregador_le_proprio_feedback_exp" ON feedback_vaga_expirada;
CREATE POLICY "empregador_le_proprio_feedback_exp" ON feedback_vaga_expirada
  FOR SELECT USING (auth.uid() = empregador_id);

DROP POLICY IF EXISTS "empregador_cria_proprio_feedback_exp" ON feedback_vaga_expirada;
CREATE POLICY "empregador_cria_proprio_feedback_exp" ON feedback_vaga_expirada
  FOR INSERT WITH CHECK (auth.uid() = empregador_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Feedback do empregador pós-conclusão da diária
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_pos_conclusao (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id         UUID NOT NULL REFERENCES diarias(id) ON DELETE CASCADE,
  empregador_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chegou_no_horario BOOLEAN NOT NULL,
  nota_qualidade    INTEGER NOT NULL CHECK (nota_qualidade BETWEEN 1 AND 5),
  recomendaria      BOOLEAN NOT NULL,
  comentario        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (diaria_id)   -- 1 pesquisa por diária concluída
);

ALTER TABLE feedback_pos_conclusao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empregador_le_proprio_pos" ON feedback_pos_conclusao;
CREATE POLICY "empregador_le_proprio_pos" ON feedback_pos_conclusao
  FOR SELECT USING (auth.uid() = empregador_id);

DROP POLICY IF EXISTS "empregador_cria_proprio_pos" ON feedback_pos_conclusao;
CREATE POLICY "empregador_cria_proprio_pos" ON feedback_pos_conclusao
  FOR INSERT WITH CHECK (auth.uid() = empregador_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Índices para o modal de "vagas pendentes de feedback"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_diarias_status_data
  ON diarias (status, data);
CREATE INDEX IF NOT EXISTS idx_feedback_exp_empregador
  ON feedback_vaga_expirada (empregador_id);
CREATE INDEX IF NOT EXISTS idx_feedback_pos_empregador
  ON feedback_pos_conclusao (empregador_id);

SELECT 'Sistema de expiração e feedback de vagas instalado.' AS resultado;
