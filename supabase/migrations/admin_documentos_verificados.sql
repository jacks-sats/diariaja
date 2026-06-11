-- ═══════════════════════════════════════════════════════════════════════════
-- Admin: lista de usuários com DOCUMENTO VERIFICADO (KYC aprovado)
-- ═══════════════════════════════════════════════════════════════════════════
-- Espelha admin_documentos_pendentes(), mas traz quem já passou no KYC
-- (documento_status = 'aprovado'). Usado pra "separar os verificados" no
-- painel do admin. Inclui documento_revisado_em (quando foi aprovado).
--
-- Segurança: SECURITY DEFINER + checagem is_admin (mesma da fila pendente).
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_documentos_verificados()
RETURNS TABLE (
  user_id               UUID,
  nome                  TEXT,
  user_type             TEXT,
  documento_url         TEXT,
  documento_revisado_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores.';
  END IF;

  RETURN QUERY
    SELECT
      up.id,
      up.nome,
      up.user_type,
      up.documento_url,
      up.documento_revisado_em
    FROM user_profiles up
    WHERE up.documento_status = 'aprovado'
    ORDER BY up.documento_revisado_em DESC NULLS LAST
    LIMIT 500;
END $$;
GRANT EXECUTE ON FUNCTION admin_documentos_verificados() TO authenticated;

SELECT 'RPC admin_documentos_verificados instalada.' AS resultado;
