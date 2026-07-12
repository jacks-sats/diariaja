-- ═══════════════════════════════════════════════════════════════════════════
-- vaga_publica — leitura PÚBLICA (anon) de UMA vaga p/ Open Graph (/vaga/[id])
-- ═══════════════════════════════════════════════════════════════════════════
-- O robô de prévia do WhatsApp/Facebook não roda JS e a policy diarias_leitura
-- exige auth.uid() IS NOT NULL → anon não lê a tabela. Esta RPC SECURITY
-- DEFINER expõe SOMENTE campos públicos e SÓ de vaga ATIVA (oculto=false E
-- status='aberta'); qualquer outro caso retorna 0 linhas (rota devolve 404).
-- NUNCA retorna: endereço, lat/lng, empregador_id, nome do anunciante, contato.
-- data/horários declarados TEXT com cast explícito (no schema real são texto —
-- ver fix_horario_text.sql; declarar DATE/TIME dava erro 42P13).
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.vaga_publica(UUID);

CREATE FUNCTION public.vaga_publica(p_id UUID)
RETURNS TABLE (
  id                 UUID,
  tipo_oferta        TEXT,
  funcao             TEXT,
  segmento           TEXT,
  descricao          TEXT,
  valor              NUMERIC,
  salario_texto      TEXT,
  tempo_estimado_min INTEGER,
  tipo_contrato      TEXT,
  regime             TEXT,
  bairro             TEXT,
  data               TEXT,
  horario_inicio     TEXT,
  horario_fim        TEXT,
  status             TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.tipo_oferta::text,
    d.funcao::text,
    d.segmento::text,
    LEFT(COALESCE(d.descricao, ''), 300)::text AS descricao,  -- corta textão
    d.valor::numeric,
    d.salario_texto::text,
    d.tempo_estimado_min::integer,
    d.tipo_contrato::text,
    d.regime::text,
    d.bairro::text,
    d.data::text,
    d.horario_inicio::text,
    d.horario_fim::text,
    d.status::text
  FROM public.diarias d
  WHERE d.id = p_id
    AND COALESCE(d.oculto, false) = false
    AND d.status = 'aberta';
$$;

REVOKE ALL ON FUNCTION public.vaga_publica(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vaga_publica(UUID) TO anon, authenticated;

SELECT 'RPC vaga_publica instalada (anon, só campos públicos de vaga aberta).' AS resultado;
