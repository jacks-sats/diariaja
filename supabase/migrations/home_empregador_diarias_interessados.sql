-- Home do anunciante: diárias + interessados + perfis públicos em uma chamada.
-- Reduz a espera no app móvel quando o WebSocket volta do segundo plano ou em
-- redes lentas. Segurança: retorna somente diárias do usuário autenticado e
-- perfis via perfis_publicos(), que já remove telefone/CPF/CNPJ/PIX.

CREATE OR REPLACE FUNCTION home_empregador_diarias_interessados()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
WITH minhas_diarias AS (
  SELECT d.*
  FROM diarias d
  WHERE d.empregador_id = auth.uid()
    AND d.status <> 'cancelada'
  ORDER BY d.created_at DESC
),
candidaturas_filtradas AS (
  SELECT c.id, c.diaria_id, c.diarista_id, c.status, c.diarista_info
  FROM candidaturas c
  JOIN minhas_diarias d ON d.id = c.diaria_id
  WHERE c.status IN ('pendente', 'selecionado', 'confirmado')
),
ids_diaristas AS (
  SELECT ARRAY_AGG(DISTINCT diarista_id) AS ids
  FROM candidaturas_filtradas
),
perfis AS (
  SELECT perfil
  FROM perfis_publicos(
    COALESCE((SELECT ids FROM ids_diaristas), ARRAY[]::uuid[])
  ) AS p(perfil)
)
SELECT jsonb_build_object(
  'diarias',
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(md) ORDER BY md.created_at DESC) FROM minhas_diarias md),
      '[]'::jsonb
    ),
  'candidaturas',
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(cf)) FROM candidaturas_filtradas cf),
      '[]'::jsonb
    ),
  'perfis',
    COALESCE(
      (SELECT jsonb_agg(perfil) FROM perfis),
      '[]'::jsonb
    )
);
$$;

REVOKE ALL ON FUNCTION home_empregador_diarias_interessados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION home_empregador_diarias_interessados() TO authenticated;
