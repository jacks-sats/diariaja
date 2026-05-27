-- ═══════════════════════════════════════════════════════════════════════════
-- Segurança Hardening — múltiplos fixes da auditoria 2026-05-27
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Combina 4 fixes priorizados pela auditoria:
--   1. IMP-S3: REVOKE UPDATE em colunas de convites (fraude de valor R$100→R$10k)
--   2. Tabela kyc_acessos_log (LGPD Art. 37 — registro de operações em KYC)
--   3. Tabela usuarios_bloqueados (exigência das app stores pra UGC)
--   4. Rotina pg_cron pra purgar antecedentes criminais > 90 dias (LGPD Art. 16)
--
-- Idempotente. Re-executável.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. IMP-S3: protege colunas sensíveis de `convites` contra UPDATE pelo diarista
--    Bug: o diarista podia aceitar um convite e simultaneamente alterar
--    `valor`, `data_servico`, etc. num único PATCH REST. Fraude direta.
--    Fix: REVOKE UPDATE em tudo, GRANT UPDATE só nas colunas que o diarista
--    pode legitimamente mudar (status, respondido_em).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON convites FROM authenticated;
GRANT  UPDATE (status) ON convites TO authenticated;
-- Se houver coluna respondido_em / atualizado_em no schema, libera também.
-- Tolerante a colunas faltantes (não bloqueia a migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'convites' AND column_name = 'respondido_em') THEN
    GRANT UPDATE (respondido_em) ON convites TO authenticated;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trilha de auditoria de acesso admin a KYC / antecedentes (LGPD Art. 37)
--    Quem viu o documento? quando? que ação tomou?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_acessos_log (
  id              BIGSERIAL PRIMARY KEY,
  admin_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id  UUID NOT NULL,
  doc_tipo        TEXT NOT NULL CHECK (doc_tipo IN ('rg_cnh','antecedentes')),
  acao            TEXT NOT NULL CHECK (acao IN ('visualizou','aprovou','rejeitou')),
  motivo          TEXT,  -- preenchido em rejeições
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_log_admin    ON kyc_acessos_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_log_target   ON kyc_acessos_log(target_user_id, created_at DESC);

ALTER TABLE kyc_acessos_log ENABLE ROW LEVEL SECURITY;

-- Admin lê tudo; usuário comum lê só os registros sobre ele próprio (direito de acesso LGPD)
DROP POLICY IF EXISTS kyc_log_admin_read ON kyc_acessos_log;
CREATE POLICY kyc_log_admin_read ON kyc_acessos_log
  FOR SELECT TO authenticated
  USING (
    target_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Só service_role escreve (via RPCs SECURITY DEFINER abaixo)
DROP POLICY IF EXISTS kyc_log_service_write ON kyc_acessos_log;
CREATE POLICY kyc_log_service_write ON kyc_acessos_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RPC que admin chama quando ABRE um documento pra revisar.
-- Loga ANTES de gerar a signed URL — assim mesmo se a request der erro
-- depois, o acesso fica registrado.
CREATE OR REPLACE FUNCTION log_acesso_kyc(
  p_target_user_id UUID,
  p_doc_tipo TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
  INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao)
    VALUES (auth.uid(), p_target_user_id, p_doc_tipo, 'visualizou');
END $$;
REVOKE ALL ON FUNCTION log_acesso_kyc(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_acesso_kyc(UUID, TEXT) TO authenticated;

-- As RPCs existentes `revisar_documento` e `revisar_antecedentes` também
-- logam (aprovou/rejeitou). Hook in via UPDATE em quem já as chama —
-- pra não duplicar a chamada client-side, atualizamos as RPCs aqui também.
CREATE OR REPLACE FUNCTION revisar_documento(
  p_user_id UUID, p_decisao TEXT, p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE (user_id UUID, documento_status TEXT, documento_revisado_em TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
  IF p_decisao NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida.';
  END IF;
  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 3 caracteres).';
  END IF;
  UPDATE user_profiles
     SET documento_status            = p_decisao,
         documento_revisado_em       = NOW(),
         documento_motivo_rejeicao   = CASE WHEN p_decisao = 'rejeitado' THEN p_motivo ELSE NULL END
   WHERE id = p_user_id;
  INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao, motivo)
    VALUES (auth.uid(), p_user_id, 'rg_cnh', p_decisao, p_motivo);
  RETURN QUERY
    SELECT up.id, up.documento_status, up.documento_revisado_em
      FROM user_profiles up WHERE up.id = p_user_id;
END $$;

CREATE OR REPLACE FUNCTION revisar_antecedentes(
  p_user_id UUID, p_decisao TEXT, p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE (user_id UUID, antecedentes_status TEXT, antecedentes_revisado_em TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;
  IF p_decisao NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida.';
  END IF;
  IF p_decisao = 'rejeitado' AND (p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 3) THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 3 caracteres).';
  END IF;
  UPDATE user_profiles
     SET antecedentes_status            = p_decisao,
         antecedentes_revisado_em       = NOW(),
         antecedentes_motivo_rejeicao   = CASE WHEN p_decisao = 'rejeitado' THEN p_motivo ELSE NULL END
   WHERE id = p_user_id;
  INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao, motivo)
    VALUES (auth.uid(), p_user_id, 'antecedentes', p_decisao, p_motivo);
  RETURN QUERY
    SELECT up.id, up.antecedentes_status, up.antecedentes_revisado_em
      FROM user_profiles up WHERE up.id = p_user_id;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bloqueio de usuário (exigência de UGC nas app stores)
--    Usuário A bloqueia B → B não aparece pra A em buscas/feeds/chat.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios_bloqueados (
  id            BIGSERIAL PRIMARY KEY,
  bloqueador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alvo_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motivo        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bloqueio UNIQUE (bloqueador_id, alvo_id),
  CONSTRAINT chk_self_block CHECK (bloqueador_id <> alvo_id)
);
CREATE INDEX IF NOT EXISTS idx_bloqueios_bloqueador ON usuarios_bloqueados(bloqueador_id);
CREATE INDEX IF NOT EXISTS idx_bloqueios_alvo       ON usuarios_bloqueados(alvo_id);

ALTER TABLE usuarios_bloqueados ENABLE ROW LEVEL SECURITY;

-- Dono lê / cria / deleta os próprios bloqueios. Alvo NÃO vê (anonimato do bloqueio).
DROP POLICY IF EXISTS bloqueio_owner_select ON usuarios_bloqueados;
CREATE POLICY bloqueio_owner_select ON usuarios_bloqueados
  FOR SELECT TO authenticated USING (bloqueador_id = auth.uid());

DROP POLICY IF EXISTS bloqueio_owner_insert ON usuarios_bloqueados;
CREATE POLICY bloqueio_owner_insert ON usuarios_bloqueados
  FOR INSERT TO authenticated WITH CHECK (bloqueador_id = auth.uid());

DROP POLICY IF EXISTS bloqueio_owner_delete ON usuarios_bloqueados;
CREATE POLICY bloqueio_owner_delete ON usuarios_bloqueados
  FOR DELETE TO authenticated USING (bloqueador_id = auth.uid());

-- RPC pra checar bloqueio bilateral (eu bloqueei X OU X me bloqueou)
CREATE OR REPLACE FUNCTION ha_bloqueio_entre(p_outro_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM usuarios_bloqueados
     WHERE (bloqueador_id = auth.uid() AND alvo_id = p_outro_user_id)
        OR (bloqueador_id = p_outro_user_id AND alvo_id = auth.uid())
  );
END $$;
REVOKE ALL ON FUNCTION ha_bloqueio_entre(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ha_bloqueio_entre(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Purga automática de antecedentes criminais > 90 dias (LGPD Art. 16)
--    A certidão negativa tem validade jurídica de ~90 dias. Manter no banco
--    indefinidamente é coleta excessiva de dado sensível.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purgar_antecedentes_expirados()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_user RECORD;
BEGIN
  -- Coleta os user_ids cujos antecedentes expiraram (>90 dias do envio)
  -- e ainda têm URL no bucket.
  FOR v_user IN
    SELECT id, antecedentes_url
      FROM user_profiles
     WHERE antecedentes_enviado_em IS NOT NULL
       AND antecedentes_enviado_em < (NOW() - INTERVAL '90 days')
       AND antecedentes_url IS NOT NULL
  LOOP
    -- Limpa metadados do profile. O arquivo no bucket deve ser apagado
    -- separadamente por job server-side (Edge Function ou script com
    -- service_role) — pg_cron não acessa storage diretamente.
    UPDATE user_profiles
       SET antecedentes_status      = 'nao_enviado',
           antecedentes_url         = NULL,
           antecedentes_enviado_em  = NULL,
           antecedentes_revisado_em = NULL,
           antecedentes_motivo_rejeicao = NULL
     WHERE id = v_user.id;
    -- Loga o expurgo
    INSERT INTO kyc_acessos_log (admin_id, target_user_id, doc_tipo, acao, motivo)
      VALUES (NULL, v_user.id, 'antecedentes', 'rejeitou', 'Expurgo automático: certidão >90 dias (LGPD Art. 16)');
  END LOOP;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END $$;
REVOKE ALL ON FUNCTION purgar_antecedentes_expirados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purgar_antecedentes_expirados() TO service_role;

-- Agendamento via pg_cron (extensão precisa estar habilitada no Dashboard:
-- Database → Extensions → pg_cron → enable).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Roda diariamente às 04:00 UTC (01:00 BRT)
    PERFORM cron.schedule(
      'purgar-antecedentes-90d',
      '0 4 * * *',
      $cron$SELECT public.purgar_antecedentes_expirados();$cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron não habilitada — habilite em Database → Extensions e rode a função manualmente.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Falha ao agendar cron (provavelmente já existe): %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verificação (rodar manualmente):
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('log_acesso_kyc','ha_bloqueio_entre','purgar_antecedentes_expirados');
--   -- deve retornar 3 linhas
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('kyc_acessos_log','usuarios_bloqueados');
--   -- deve retornar 2 linhas
--   -- Testa REVOKE em convites: como user comum, tente
--   --   UPDATE convites SET valor = 1 WHERE id = '<id>';  -- deve falhar
-- ─────────────────────────────────────────────────────────────────────────────
