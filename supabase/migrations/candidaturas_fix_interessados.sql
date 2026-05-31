-- ═══════════════════════════════════════════════════════════════════════════
-- Candidaturas: garante coluna diarista_info + Realtime (interessados aparecem)
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma (teste real): candidatos demonstram interesse mas o anúncio segue como
-- "Aguardando interessados…" — o anunciante não vê ninguém.
--
-- Duas causas possíveis cobertas aqui:
-- 1) A coluna `diarista_info` (jsonb) pode não existir no banco. O app insere a
--    candidatura COM esse campo — se a coluna não existe, o INSERT FALHA e a
--    candidatura nunca é gravada. ADD COLUMN IF NOT EXISTS resolve.
-- 2) `candidaturas` pode não estar na publicação de Realtime — então o anunciante
--    não recebe o INSERT ao vivo (só veria recarregando). Adiciona à publicação.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Coluna usada pelo app no INSERT da candidatura (snapshot do diarista).
ALTER TABLE candidaturas ADD COLUMN IF NOT EXISTS diarista_info JSONB;

-- 2) Realtime: anunciante recebe novos interessados na hora.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'candidaturas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE candidaturas;
    RAISE NOTICE 'candidaturas adicionada à publicação supabase_realtime.';
  ELSE
    RAISE NOTICE 'candidaturas já estava na publicação.';
  END IF;
END $$;

ALTER TABLE candidaturas REPLICA IDENTITY FULL;

-- Diagnóstico: quantas candidaturas existem hoje (pra ver se o INSERT vinha
-- falhando — se vier 0 mas há interesse, era a coluna faltando).
SELECT COUNT(*) AS total_candidaturas,
       COUNT(*) FILTER (WHERE status = 'pendente') AS pendentes
  FROM candidaturas;

-- Diagnóstico RLS: confirma que a policy de SELECT permite o anunciante ler.
-- Deve listar 'candidaturas_select' (FOR SELECT). Se só houver 'cands_all' ou
-- nada, a migração fix_candidaturas_rls_cands_all.sql não foi aplicada.
SELECT policyname, cmd, roles::text
  FROM pg_policies
 WHERE tablename = 'candidaturas'
 ORDER BY cmd;

SELECT 'Candidaturas: coluna diarista_info + Realtime garantidos.' AS resultado;
