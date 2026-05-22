-- Migração: Tabela de Denúncias
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS denuncias (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  denunciante_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo             TEXT NOT NULL,   -- 'vaga' | 'usuario'
  alvo_id          TEXT NOT NULL,   -- id da vaga (diaria.id) ou do usuário (user_profiles.id)
  alvo_nome        TEXT,
  motivo           TEXT NOT NULL,
  status           TEXT DEFAULT 'pendente',  -- 'pendente' | 'analisado' | 'resolvido'
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: somente o sistema (service role) lê; qualquer autenticado pode inserir
ALTER TABLE denuncias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qualquer_auth_pode_denunciar" ON denuncias
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Admins leem tudo (via service role key — não precisa de policy)

-- Índices
CREATE INDEX IF NOT EXISTS idx_denuncias_alvo ON denuncias(alvo_id);
CREATE INDEX IF NOT EXISTS idx_denuncias_status ON denuncias(status);

SELECT 'Tabela denuncias criada com sucesso!' AS resultado;
