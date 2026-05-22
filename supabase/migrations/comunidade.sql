-- Migração: Comunidade (tópicos + comentários)
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

-- Tabela de tópicos
CREATE TABLE IF NOT EXISTS topicos (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  autor_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_nome       TEXT NOT NULL,
  autor_tipo       TEXT,                       -- 'diarista' | 'empregador' | 'ambos'
  titulo           TEXT NOT NULL,
  conteudo         TEXT NOT NULL,
  categoria        TEXT DEFAULT 'geral',       -- 'geral' | 'dicas' | 'duvidas' | 'conquistas' | 'suporte'
  likes            INTEGER DEFAULT 0,
  total_comentarios INTEGER DEFAULT 0,
  pinned           BOOLEAN DEFAULT false,      -- admin pode fixar tópicos importantes
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de comentários
CREATE TABLE IF NOT EXISTS comentarios_comunidade (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topico_id        UUID REFERENCES topicos(id) ON DELETE CASCADE NOT NULL,
  autor_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_nome       TEXT NOT NULL,
  autor_tipo       TEXT,
  conteudo         TEXT NOT NULL,
  likes            INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Adicionar flag de admin em user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- RLS: Tópicos
ALTER TABLE topicos ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode ler
CREATE POLICY "todos_leem_topicos" ON topicos
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Autenticados podem criar
CREATE POLICY "auth_cria_topico" ON topicos
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = autor_id);

-- Admin ou próprio autor pode deletar
CREATE POLICY "autor_ou_admin_deleta_topico" ON topicos
  FOR DELETE USING (
    auth.uid() = autor_id OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin pode atualizar (pinned, etc.)
CREATE POLICY "admin_atualiza_topico" ON topicos
  FOR UPDATE USING (
    auth.uid() = autor_id OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- RLS: Comentários
ALTER TABLE comentarios_comunidade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "todos_leem_comentarios" ON comentarios_comunidade
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_cria_comentario" ON comentarios_comunidade
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = autor_id);

CREATE POLICY "autor_ou_admin_deleta_comentario" ON comentarios_comunidade
  FOR DELETE USING (
    auth.uid() = autor_id OR
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_topicos_categoria ON topicos(categoria, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topicos_pinned   ON topicos(pinned, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comentarios_topico ON comentarios_comunidade(topico_id, created_at ASC);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE topicos;
ALTER PUBLICATION supabase_realtime ADD TABLE comentarios_comunidade;

-- ⚠️  IMPORTANTE: defina você mesmo como admin após rodar este script:
-- UPDATE user_profiles SET is_admin = true WHERE id = 'SEU_USER_ID_AQUI';
-- (encontre seu ID em: Authentication → Users → copie o UUID)

SELECT 'Comunidade criada com sucesso!' AS resultado;
