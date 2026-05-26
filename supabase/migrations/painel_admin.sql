-- ═══════════════════════════════════════════════════════════════════════════
-- Painel Admin — campo de atividade + suporte por tickets
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O que esta migration faz:
-- 1. Garante `last_activity_at` em `user_profiles` (heartbeat de presença)
-- 2. Tabelas `suporte_tickets` + `suporte_respostas` (sistema de chamados)
-- 3. RLS: user vê próprios tickets, admin vê todos
-- 4. RPC `admin_stats()` — chamável só por admins, retorna painel agregado
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. last_activity_at em user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_profiles_last_activity
  ON user_profiles (last_activity_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabela de tickets de suporte
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suporte_tickets (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assunto       TEXT         NOT NULL CHECK (length(assunto) BETWEEN 1 AND 200),
  status        TEXT         NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'aguardando_user', 'resolvido', 'fechado')),
  -- contadores pra UI saber quem tem msg nova sem buscar todas as respostas
  ultima_resposta_role TEXT  CHECK (ultima_resposta_role IN ('user', 'admin') OR ultima_resposta_role IS NULL),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suporte_tickets_user_id
  ON suporte_tickets (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_suporte_tickets_status
  ON suporte_tickets (status, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tabela de respostas (conversação)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suporte_respostas (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID         NOT NULL REFERENCES suporte_tickets(id) ON DELETE CASCADE,
  sender_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role  TEXT         NOT NULL CHECK (sender_role IN ('user', 'admin')),
  mensagem     TEXT         NOT NULL CHECK (length(mensagem) BETWEEN 1 AND 4000),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suporte_respostas_ticket
  ON suporte_respostas (ticket_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — suporte_tickets
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE suporte_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_ve_propio_ticket"   ON suporte_tickets;
DROP POLICY IF EXISTS "user_cria_proprio_ticket" ON suporte_tickets;
DROP POLICY IF EXISTS "admin_atualiza_ticket"   ON suporte_tickets;

-- SELECT: user vê próprios, admin vê todos
CREATE POLICY "user_ve_propio_ticket" ON suporte_tickets
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- INSERT: user cria só pra si
CREATE POLICY "user_cria_proprio_ticket" ON suporte_tickets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: só admin muda status / dados gerais
CREATE POLICY "admin_atualiza_ticket" ON suporte_tickets
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — suporte_respostas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE suporte_respostas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ve_respostas_proprio_ticket" ON suporte_respostas;
DROP POLICY IF EXISTS "envia_resposta"             ON suporte_respostas;

-- SELECT: dono do ticket OU admin
CREATE POLICY "ve_respostas_proprio_ticket" ON suporte_respostas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM suporte_tickets t
      WHERE t.id = ticket_id
        AND (
          t.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
        )
    )
  );

-- INSERT: user respondendo no próprio ticket OU admin respondendo qualquer
CREATE POLICY "envia_resposta" ON suporte_respostas
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      (sender_role = 'user' AND EXISTS (
        SELECT 1 FROM suporte_tickets WHERE id = ticket_id AND user_id = auth.uid()
      ))
      OR
      (sender_role = 'admin' AND EXISTS (
        SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE
      ))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Trigger: atualiza `updated_at` e `ultima_resposta_role` no ticket
--    quando uma resposta nova é inserida.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION suporte_resposta_bumpa_ticket()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE suporte_tickets
  SET
    updated_at = NOW(),
    ultima_resposta_role = NEW.sender_role,
    -- Se admin respondeu, ticket fica "aguardando_user". Se user respondeu,
    -- volta pra "aberto" pra equipe ver.
    status = CASE
      WHEN NEW.sender_role = 'admin' THEN 'aguardando_user'
      WHEN NEW.sender_role = 'user'  THEN 'aberto'
      ELSE status
    END
  WHERE id = NEW.ticket_id
    -- Não reabre ticket já marcado como resolvido/fechado
    AND status IN ('aberto', 'aguardando_user');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suporte_resposta_bumpa ON suporte_respostas;
CREATE TRIGGER trg_suporte_resposta_bumpa
  AFTER INSERT ON suporte_respostas
  FOR EACH ROW EXECUTE FUNCTION suporte_resposta_bumpa_ticket();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC pública: count de usuários online (5 min)
-- Usuário comum pode usar — não revela QUEM está online, só quantos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION usuarios_online_count()
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM user_profiles
  WHERE last_activity_at > NOW() - INTERVAL '5 minutes';
$$;
GRANT EXECUTE ON FUNCTION usuarios_online_count() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC admin: dashboard de stats (só admin executa)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_stats()
RETURNS TABLE (
  total_usuarios   INTEGER,
  online_agora     INTEGER,
  novos_hoje       INTEGER,
  novos_semana     INTEGER,
  tickets_abertos  INTEGER,
  diarias_ativas   INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;

  RETURN QUERY SELECT
    (SELECT COUNT(*)::INTEGER FROM user_profiles),
    (SELECT COUNT(*)::INTEGER FROM user_profiles WHERE last_activity_at > NOW() - INTERVAL '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM auth.users WHERE created_at::date = CURRENT_DATE),
    (SELECT COUNT(*)::INTEGER FROM auth.users WHERE created_at > NOW() - INTERVAL '7 days'),
    (SELECT COUNT(*)::INTEGER FROM suporte_tickets WHERE status IN ('aberto', 'aguardando_user')),
    (SELECT COUNT(*)::INTEGER FROM diarias WHERE status IN ('aberta', 'aceita', 'em_andamento'));
END;
$$;
GRANT EXECUTE ON FUNCTION admin_stats() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Confirma resultado
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='last_activity_at') AS col_last_activity,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name='suporte_tickets')   AS tab_tickets,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name='suporte_respostas') AS tab_respostas,
  (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('admin_stats','usuarios_online_count','suporte_resposta_bumpa_ticket')) AS funcs;
-- Resultado esperado: 1 | 1 | 1 | 3
