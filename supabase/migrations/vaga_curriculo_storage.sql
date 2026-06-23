-- ═══════════════════════════════════════════════════════════════════════════
-- Currículo de candidato a VAGA DE EMPREGO — bucket privado + RLS estrita
-- ═══════════════════════════════════════════════════════════════════════════
-- O candidato anexa um PDF ao se candidatar a uma vaga. O arquivo vai pro bucket
-- PRIVADO `curriculos` (mesmo padrão do KYC). O anunciante abre por URL ASSINADA
-- (temporária) — NUNCA público.
--
-- Caminho do arquivo: {diaria_id}/{diarista_id}/cv.pdf
--   foldername[1] = diaria_id   ·   foldername[2] = diarista_id
--
-- RLS (quem acessa cada arquivo):
--   • DONO (candidato): só a própria pasta (foldername[2] = auth.uid) — upload/ler.
--   • ANUNCIANTE: só o dono DAQUELA vaga (a diária do foldername[1] é dele) E que
--     tenha recebido a candidatura desse diarista. Ninguém mais lê.
--   → Um terceiro qualquer (outro prestador, outro anunciante) NÃO consegue puxar
--     o currículo de ninguém: a RLS barra no servidor e o createSignedUrl falha.
--
-- Validação de tipo/tamanho também no servidor: o bucket só aceita application/pdf
-- até 5 MB (além da checagem no app).
--
-- ADITIVA E SEGURA: cria um bucket NOVO + policies NOVAS. Não toca em dados
-- existentes nem em outros buckets. Idempotente.
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Bucket privado, só PDF, máx. 5 MB (validação server-side)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('curriculos', 'curriculos', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['application/pdf'];

-- 2) DONO (candidato) — envia o próprio currículo (INSERT) na sua pasta
DROP POLICY IF EXISTS "curriculo_dono_insert" ON storage.objects;
CREATE POLICY "curriculo_dono_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'curriculos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- 3) DONO — sobrescrever o próprio (upsert precisa de UPDATE)
DROP POLICY IF EXISTS "curriculo_dono_update" ON storage.objects;
CREATE POLICY "curriculo_dono_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'curriculos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'curriculos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- 4) DONO — ler o próprio currículo
DROP POLICY IF EXISTS "curriculo_dono_select" ON storage.objects;
CREATE POLICY "curriculo_dono_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'curriculos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- 5) ANUNCIANTE DAQUELA VAGA — ler o currículo de quem se candidatou à vaga dele
DROP POLICY IF EXISTS "curriculo_empregador_select" ON storage.objects;
CREATE POLICY "curriculo_empregador_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'curriculos'
    AND EXISTS (
      SELECT 1
        FROM diarias d
        JOIN candidaturas c ON c.diaria_id = d.id
       WHERE d.id::text          = (storage.foldername(name))[1]   -- a vaga é dele
         AND d.empregador_id      = auth.uid()
         AND c.diarista_id::text  = (storage.foldername(name))[2]   -- e esse diarista se candidatou
    )
  );

SELECT 'Bucket curriculos (privado, PDF, 5MB) + RLS instalados.' AS resultado;
