-- ═══════════════════════════════════════════════════════════════════════════
-- RLS hardening: fecha leitura ampla de `candidaturas` + lat/lng exatos
-- ═══════════════════════════════════════════════════════════════════════════
-- Dois vazamentos fechados (auditoria pré-lançamento, item 1a):
--
-- 1) candidaturas: o SELECT era `USING (true)` → QUALQUER logado lia TODAS as
--    candidaturas (incluindo diarista_info com nome/foto, lat/lng EXATOS, carta e
--    o caminho do currículo). Escrita já era restrita; só o SELECT estava aberto.
--    → Restringe SELECT ao DONO (diarista) e ao ANUNCIANTE daquela vaga.
--    → O feed do prestador (que contava candidaturas de vagas de terceiros pra
--      esconder vaga lotada) passa a contar via RPC SECURITY DEFINER que devolve
--      SÓ a contagem (sem PII): contagem_candidaturas_pendentes().
--
-- 2) user_profiles: lat/lng EXATOS ainda eram legíveis por authenticated (o REVOKE
--    de PII anterior não os cobria). Terceiros já usam prestadores_publicos/
--    perfis_publicos (arredondado, SECURITY DEFINER) e o próprio via meu_perfil.
--    → Revoga SELECT(lat,lng) de anon/authenticated. (Save do perfil usa
--      update/upsert sem .select(), então não quebra.)
--
-- ORDEM DE APLICAÇÃO (pra não ter janela quebrada no feed):
--   A) contagem_candidaturas_pendentes  → ANTES do deploy do app
--   B) REVOKE SELECT(lat,lng)           → a qualquer momento (seguro)
--   C) policy candidaturas_select       → DEPOIS do deploy do app (quando o feed
--                                          já usa a RPC, não o SELECT direto)
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- A) RPC de contagem (sem PII) para o feed ───────────────────────────────────
CREATE OR REPLACE FUNCTION contagem_candidaturas_pendentes(p_diaria_ids uuid[])
RETURNS TABLE(diaria_id uuid, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.diaria_id, count(*)::bigint
  FROM candidaturas c
  WHERE c.diaria_id = ANY(p_diaria_ids) AND c.status = 'pendente'
  GROUP BY c.diaria_id;
$$;
REVOKE ALL ON FUNCTION contagem_candidaturas_pendentes(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contagem_candidaturas_pendentes(uuid[]) TO authenticated;

-- B) lat/lng exatos: fora do alcance de anon/authenticated ───────────────────
REVOKE SELECT (lat, lng) ON user_profiles FROM anon, authenticated;

-- C) candidaturas: leitura só do dono e do anunciante daquela vaga ───────────
DROP POLICY IF EXISTS candidaturas_select ON candidaturas;
CREATE POLICY candidaturas_select ON candidaturas
  FOR SELECT TO authenticated
  USING (
    diarista_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM diarias d
      WHERE d.id = candidaturas.diaria_id AND d.empregador_id = auth.uid()
    )
  );

SELECT 'RLS hardening (candidaturas SELECT + lat/lng + RPC de contagem) instalado.' AS resultado;
