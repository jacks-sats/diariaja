-- ============================================================================
-- Bucket avatars — allowlist MIME server-side (P1-4 auditoria)
-- ============================================================================
-- Defesa em profundidade contra XSS armazenado via SVG.
--
-- O cliente já valida `file.type` em handleFotoUpload e handlePortfolioUpload
-- (commit fix(seguranca+perf): frontend lote 1), mas isso pode ser burlado
-- por curl/postman direto na API do Supabase. Esta configuração trava o
-- bucket pra aceitar SÓ imagens raster seguras (jpeg/png/webp).
--
-- Aplicar via Supabase Dashboard → SQL Editor:
-- ============================================================================

-- O Supabase Storage v2 usa colunas `allowed_mime_types` e `file_size_limit`
-- na tabela storage.buckets. Se essas colunas não existirem no seu projeto
-- (Storage v1 antigo), faça via Dashboard → Storage → bucket → Settings:
--   - Allowed MIME types: image/jpeg, image/png, image/webp
--   - File size limit: 5242880  (5 MB)

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit    = 5242880   -- 5 MB
 WHERE id = 'avatars';

-- Verificar:
-- SELECT id, allowed_mime_types, file_size_limit FROM storage.buckets WHERE id = 'avatars';

-- ============================================================================
-- Bucket documentos — allowlist MIME (KYC RG/CNH e KYC PJ)
-- ============================================================================
-- Documentos aceitam PDF além de imagens. Mantém limite 5MB.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
       file_size_limit    = 5242880   -- 5 MB
 WHERE id = 'documentos';

-- Verificar:
-- SELECT id, allowed_mime_types, file_size_limit FROM storage.buckets WHERE id = 'documentos';
