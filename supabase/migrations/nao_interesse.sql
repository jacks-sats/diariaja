-- Migração: Tabela de "Não tenho interesse"
-- Registra quando um diarista oculta uma vaga da listagem
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS nao_interesse (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  diarista_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  diaria_id    UUID REFERENCES diarias(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(diarista_id, diaria_id)   -- evita duplicatas
);

-- RLS
ALTER TABLE nao_interesse ENABLE ROW LEVEL SECURITY;

-- Diarista só vê/insere os próprios registros
CREATE POLICY "diarista_proprios_nao_interesse" ON nao_interesse
  FOR ALL USING (auth.uid() = diarista_id);

-- View auxiliar: conta dislikes por diária (para o empregador ver)
CREATE OR REPLACE VIEW diarias_dislikes AS
  SELECT diaria_id, COUNT(*)::int AS total
  FROM nao_interesse
  GROUP BY diaria_id;

-- Permite SELECT na view para qualquer autenticado
GRANT SELECT ON diarias_dislikes TO authenticated;

-- Índices
CREATE INDEX IF NOT EXISTS idx_nao_interesse_diaria ON nao_interesse(diaria_id);
CREATE INDEX IF NOT EXISTS idx_nao_interesse_diarista ON nao_interesse(diarista_id);

SELECT 'Tabela nao_interesse criada com sucesso!' AS resultado;
