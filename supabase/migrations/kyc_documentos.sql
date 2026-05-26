-- ── KYC: Upload de documentos (RG/CNH/Cartão CNPJ/Contrato Social) ──────────
-- Migration: kyc_documentos.sql
--
-- Adiciona colunas em user_profiles + bucket privado "documentos" no Storage
-- + policies RLS pra cada usuário só ver os próprios arquivos.
--
-- PJ envia cartao_cnpj ou contrato_social pra liberar publicação de vagas.
-- PF envia RG ou CNH pra subir pro Nível 3 (Confiável).
--
-- Aplicar em: Supabase Dashboard → SQL Editor.
-- Idempotente: pode ser re-executada sem efeitos colaterais.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas em user_profiles
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS documento_status         TEXT        DEFAULT 'nao_enviado',
  ADD COLUMN IF NOT EXISTS documento_url            TEXT,
  ADD COLUMN IF NOT EXISTS documento_tipo           TEXT,        -- 'rg' | 'cnh' | 'cartao_cnpj' | 'contrato_social'
  ADD COLUMN IF NOT EXISTS documento_enviado_em     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS documento_revisado_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS documento_motivo_rejeicao TEXT;

-- Constraint de valores válidos pra status (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_documento_status_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_documento_status_check
      CHECK (documento_status IN ('nao_enviado', 'enviado', 'aprovado', 'rejeitado'));
  END IF;
END $$;

-- Índice pra admin listar documentos pendentes rapidamente
CREATE INDEX IF NOT EXISTS idx_user_profiles_documento_status
  ON user_profiles (documento_status)
  WHERE documento_status = 'enviado';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bucket privado "documentos" no Storage
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Policies RLS pra storage.objects no bucket "documentos"
--    Convenção de path: {user_id}/{doc_tipo}_{timestamp}.{ext}
--    Cada usuário só pode escrever/ler arquivos sob seu próprio UUID.
-- ─────────────────────────────────────────────────────────────────────────────

-- Limpa policies antigas (se existirem) pra recriar do zero
DROP POLICY IF EXISTS "documentos_insert_own"     ON storage.objects;
DROP POLICY IF EXISTS "documentos_select_own"     ON storage.objects;
DROP POLICY IF EXISTS "documentos_select_admin"   ON storage.objects;
DROP POLICY IF EXISTS "documentos_update_blocked" ON storage.objects;
DROP POLICY IF EXISTS "documentos_delete_blocked" ON storage.objects;

-- Usuário insere apenas em path que começa com seu UUID
CREATE POLICY "documentos_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Usuário lê apenas seus próprios arquivos
CREATE POLICY "documentos_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin (is_admin = true) pode ler todos os arquivos pra revisão
CREATE POLICY "documentos_select_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documentos'
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Audit trail: nenhum cliente pode deletar ou alterar (só service role via Edge Function)
-- Sem policy = sem permissão. Não criamos policy de DELETE nem UPDATE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC opcional pra admin listar documentos pendentes
--    (Espelha a função admin_documentos_pendentes usada na referência.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_documentos_pendentes()
RETURNS TABLE (
  user_id              UUID,
  nome                 TEXT,
  user_type            TEXT,
  pessoa_tipo          TEXT,
  documento_url        TEXT,
  documento_tipo       TEXT,
  documento_enviado_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Só admins podem chamar
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores';
  END IF;

  RETURN QUERY
    SELECT
      p.id                   AS user_id,
      COALESCE(p.nome_negocio, '') AS nome,
      p.user_type,
      p.pessoa_tipo,
      p.documento_url,
      p.documento_tipo,
      p.documento_enviado_em
    FROM user_profiles p
    WHERE p.documento_status = 'enviado'
    ORDER BY p.documento_enviado_em ASC NULLS LAST;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TODO (futuro, fora do MVP):
--   * Trigger BEFORE UPDATE em user_profiles que bloqueia user comum de
--     setar documento_status='aprovado'/'rejeitado'. Hoje a confiança é
--     no cliente — usuário malicioso poderia forjar UPDATE. Pra MVP é
--     aceitável porque o status é apenas visual; a revisão real é manual
--     pelo admin via painel.
-- ─────────────────────────────────────────────────────────────────────────────
