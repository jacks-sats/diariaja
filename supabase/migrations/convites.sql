-- Migração: Tabela de Convites Diretos
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS convites (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contratante_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  diarista_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  contratante_nome TEXT,
  diarista_nome    TEXT,
  funcao           TEXT,
  local_servico    TEXT NOT NULL,
  data_servico     DATE NOT NULL,
  horario_servico  TEXT NOT NULL,
  observacoes      TEXT,
  valor            NUMERIC,
  status           TEXT DEFAULT 'pendente', -- 'pendente' | 'aceito' | 'recusado'
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE convites ENABLE ROW LEVEL SECURITY;

-- Contratante pode criar convites
CREATE POLICY "contratante_pode_criar_convite" ON convites
  FOR INSERT WITH CHECK (auth.uid() = contratante_id);

-- Ambas as partes podem ver seus convites
CREATE POLICY "partes_podem_ver_convite" ON convites
  FOR SELECT USING (auth.uid() = contratante_id OR auth.uid() = diarista_id);

-- Diarista pode responder (atualizar status)
CREATE POLICY "diarista_pode_responder" ON convites
  FOR UPDATE USING (auth.uid() = diarista_id);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_convites_diarista ON convites(diarista_id, status);
CREATE INDEX IF NOT EXISTS idx_convites_contratante ON convites(contratante_id, status);

-- Habilitar Realtime na tabela (para notificações ao vivo)
ALTER PUBLICATION supabase_realtime ADD TABLE convites;

SELECT 'Tabela convites criada com sucesso!' AS resultado;
