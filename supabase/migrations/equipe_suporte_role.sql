-- ============================================================================
-- EQUIPE DE SUPORTE — flag is_suporte em user_profiles
-- ============================================================================
-- Adiciona role "agente de suporte" sem precisar mexer em is_admin. Admin
-- (proprietário) continua sendo único com acesso total (analytics, KYC,
-- gestão de usuários). is_suporte só destrava o painel-suporte (tickets).
--
-- Quem pode atender ticket?  is_admin OR is_suporte
-- Quem pode promover/despromover?  só is_admin
-- Quem vê analytics/KYC?  só is_admin
--
-- Idempotente — pode rodar quantas vezes quiser.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_suporte BOOLEAN NOT NULL DEFAULT FALSE;

-- Index parcial — admin search lista só os agentes, filtrar fica mais rápido.
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_suporte
  ON user_profiles(id)
  WHERE is_suporte = TRUE;

-- ── RLS: tickets agora visíveis pra suporte também ──────────────────────────
-- Recria as policies de suporte_tickets pra incluir is_suporte. Mantém o
-- comportamento atual (admin vê tudo, user vê só os seus) e adiciona
-- (is_suporte vê tudo como admin pra responder/fechar).
--
-- ATENÇÃO: se as policies existentes têm nomes diferentes, ajuste antes
-- de rodar. Verifique com:
--   SELECT policyname FROM pg_policies WHERE tablename = 'suporte_tickets';

DO $$
BEGIN
  -- Drop policies antigas se existirem (idempotente)
  DROP POLICY IF EXISTS suporte_tickets_admin_all ON suporte_tickets;
  DROP POLICY IF EXISTS suporte_tickets_owner_select ON suporte_tickets;
  DROP POLICY IF EXISTS suporte_tickets_owner_insert ON suporte_tickets;

  -- Admin OU suporte: acesso total
  CREATE POLICY suporte_tickets_admin_all ON suporte_tickets
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND (up.is_admin = TRUE OR up.is_suporte = TRUE)
      )
    );

  -- Dono do ticket: vê e cria
  CREATE POLICY suporte_tickets_owner_select ON suporte_tickets
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

  CREATE POLICY suporte_tickets_owner_insert ON suporte_tickets
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN OTHERS THEN
  -- Tabela pode não ter RLS habilitado ou policies podem ter outros nomes.
  -- Não bloqueia a migration — admin aplica manualmente se necessário.
  RAISE NOTICE 'RLS de suporte_tickets não aplicado: %', SQLERRM;
END$$;

-- Mesma coisa pra suporte_respostas
DO $$
BEGIN
  DROP POLICY IF EXISTS suporte_respostas_admin_all ON suporte_respostas;
  DROP POLICY IF EXISTS suporte_respostas_thread_select ON suporte_respostas;
  DROP POLICY IF EXISTS suporte_respostas_thread_insert ON suporte_respostas;

  CREATE POLICY suporte_respostas_admin_all ON suporte_respostas
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND (up.is_admin = TRUE OR up.is_suporte = TRUE)
      )
    );

  CREATE POLICY suporte_respostas_thread_select ON suporte_respostas
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM suporte_tickets t
        WHERE t.id = ticket_id AND t.user_id = auth.uid()
      )
    );

  CREATE POLICY suporte_respostas_thread_insert ON suporte_respostas
    FOR INSERT TO authenticated
    WITH CHECK (
      sender_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM suporte_tickets t
        WHERE t.id = ticket_id AND t.user_id = auth.uid()
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'RLS de suporte_respostas não aplicado: %', SQLERRM;
END$$;

-- ── RPC: promover/despromover (admin-only) ──────────────────────────────────
-- Centraliza a operação numa função SECURITY DEFINER que verifica is_admin
-- do caller antes de fazer o UPDATE. Cliente não pode dar UPDATE direto em
-- user_profiles.is_suporte (RLS bloqueia — só admin via RPC).

CREATE OR REPLACE FUNCTION promover_suporte(alvo_user_id UUID, ativar BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_caller_admin BOOLEAN;
BEGIN
  -- Só admin pode promover/despromover
  SELECT COALESCE(is_admin, FALSE) INTO is_caller_admin
    FROM user_profiles WHERE id = auth.uid();

  IF NOT COALESCE(is_caller_admin, FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar a equipe de suporte';
  END IF;

  -- Não permite admin se despromover sozinho (defesa contra lockout)
  IF alvo_user_id = auth.uid() AND ativar = FALSE THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio acesso de suporte por aqui';
  END IF;

  UPDATE user_profiles
    SET is_suporte = ativar,
        updated_at = NOW()
    WHERE id = alvo_user_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION promover_suporte(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promover_suporte(UUID, BOOLEAN) TO authenticated;

-- ── VALIDAÇÃO ──────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'user_profiles' AND column_name = 'is_suporte';
--
-- SELECT id, nome, is_admin, is_suporte FROM user_profiles
-- WHERE is_admin = TRUE OR is_suporte = TRUE;
