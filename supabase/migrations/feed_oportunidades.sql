-- Migração: Bairro + índices para o feed de oportunidades
-- A FEATURE "Feed de Oportunidades na Região" exige:
--  - Bairro no card pra diarista identificar onde fica a vaga sem precisar
--    abrir o detalhe.
--  - Índice em (lat, lng, status) pra ordenação por distância ser rápida.
--  - Índice em (status, created_at desc) pro contador "novas hoje" e o sort
--    por recência.
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Coluna bairro
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS bairro TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices que cobrem as queries do feed
-- ─────────────────────────────────────────────────────────────────────────────
-- Feed do diarista: WHERE status='aberta' ORDER BY created_at DESC + filtros
CREATE INDEX IF NOT EXISTS idx_diarias_aberta_recente
  ON diarias (status, created_at DESC)
  WHERE status = 'aberta';

-- Busca por proximidade via lat/lng (haversine no client; cliente já filtra)
CREATE INDEX IF NOT EXISTS idx_diarias_lat_lng
  ON diarias (lat, lng)
  WHERE status = 'aberta' AND lat IS NOT NULL AND lng IS NOT NULL;

-- Diários de um empregador específico (já usado na home-empregador)
CREATE INDEX IF NOT EXISTS idx_diarias_empregador
  ON diarias (empregador_id, status);

SELECT 'Coluna bairro + índices do feed instalados.' AS resultado;
