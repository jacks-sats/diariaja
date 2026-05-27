-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria — log genérico de ações sensíveis (LGPD Art. 37)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Complementa `kyc_acessos_log` (específico de KYC) com um log mais amplo
-- que cobre ações sensíveis fora de KYC: bloqueios, denúncias, mudanças
-- de plano via webhook, deleções de conta, etc.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS auditoria_acoes (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID,                          -- quem fez (NULL para sistema)
  acao            TEXT NOT NULL,                 -- ex: 'bloqueio.criado', 'denuncia.criada', 'conta.deletada'
  alvo_tipo       TEXT,                          -- ex: 'usuario', 'diaria', 'denuncia'
  alvo_id         TEXT,                          -- string pra suportar UUIDs e IDs numéricos
  metadata        JSONB,                         -- payload livre (sem PII bruta — pseudonimizar antes)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_actor   ON auditoria_acoes(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_acao    ON auditoria_acoes(acao, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_alvo    ON auditoria_acoes(alvo_tipo, alvo_id, created_at DESC);

ALTER TABLE auditoria_acoes ENABLE ROW LEVEL SECURITY;

-- Admin lê tudo. Usuário comum lê só onde é o actor (próprio histórico).
DROP POLICY IF EXISTS auditoria_admin_read ON auditoria_acoes;
CREATE POLICY auditoria_admin_read ON auditoria_acoes
  FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Só service_role insere/altera/deleta.
DROP POLICY IF EXISTS auditoria_service ON auditoria_acoes;
CREATE POLICY auditoria_service ON auditoria_acoes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helper RPC: usuário comum loga ação própria (bloqueio, denúncia).
-- Limita a 1 log por segundo por user pra evitar abuso da tabela.
CREATE OR REPLACE FUNCTION registrar_acao(
  p_acao      TEXT,
  p_alvo_tipo TEXT DEFAULT NULL,
  p_alvo_id   TEXT DEFAULT NULL,
  p_metadata  JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whitelist de ações permitidas via client (evita poluição do log)
  IF p_acao NOT IN (
    'bloqueio.criado', 'bloqueio.removido',
    'denuncia.criada',
    'conta.exclusao_solicitada'
  ) THEN
    RAISE EXCEPTION 'Ação não autorizada: %', p_acao;
  END IF;
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id, metadata)
    VALUES (auth.uid(), p_acao, p_alvo_tipo, p_alvo_id, p_metadata);
END $$;
REVOKE ALL ON FUNCTION registrar_acao(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_acao(TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- Triggers automáticos: bloqueio e denúncia geram log mesmo se o client esquecer

-- Bloqueio criado
CREATE OR REPLACE FUNCTION trg_log_bloqueio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id, metadata)
    VALUES (NEW.bloqueador_id, 'bloqueio.criado', 'usuario', NEW.alvo_id::TEXT,
            jsonb_build_object('motivo', LEFT(COALESCE(NEW.motivo,''), 200)));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS log_bloqueio_insert ON usuarios_bloqueados;
CREATE TRIGGER log_bloqueio_insert AFTER INSERT ON usuarios_bloqueados
  FOR EACH ROW EXECUTE FUNCTION trg_log_bloqueio();

-- Bloqueio removido
CREATE OR REPLACE FUNCTION trg_log_desbloqueio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id)
    VALUES (OLD.bloqueador_id, 'bloqueio.removido', 'usuario', OLD.alvo_id::TEXT);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS log_bloqueio_delete ON usuarios_bloqueados;
CREATE TRIGGER log_bloqueio_delete AFTER DELETE ON usuarios_bloqueados
  FOR EACH ROW EXECUTE FUNCTION trg_log_desbloqueio();

-- Denúncia criada (loga automaticamente — não confia no client lembrar)
CREATE OR REPLACE FUNCTION trg_log_denuncia()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auditoria_acoes (actor_id, acao, alvo_tipo, alvo_id, metadata)
    VALUES (NEW.denunciante_id, 'denuncia.criada', NEW.tipo, NEW.alvo_id::TEXT,
            jsonb_build_object('motivo_resumo', LEFT(COALESCE(NEW.motivo,''), 100)));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS log_denuncia_insert ON denuncias;
-- Só cria trigger se a coluna denunciante_id existir (defensivo)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'denuncias' AND column_name = 'denunciante_id') THEN
    EXECUTE 'CREATE TRIGGER log_denuncia_insert AFTER INSERT ON denuncias
             FOR EACH ROW EXECUTE FUNCTION trg_log_denuncia()';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Verificação:
--   SELECT acao, COUNT(*) FROM auditoria_acoes GROUP BY 1 ORDER BY 2 DESC;
