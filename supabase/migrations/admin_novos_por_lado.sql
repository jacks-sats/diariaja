-- ============================================================================
-- Painel Admin — novos usuários SEPARADOS por lado (diarista x contratante)
-- ============================================================================
-- O painel já tinha "novos hoje" (total de auth.users), mas misturava os dois
-- lados. Aqui contamos, por user_type, quantos se cadastraram hoje e em 7 dias.
-- Só LEITURA — não cria, altera nem apaga nenhum dado.
--
-- Aplicar via Supabase Dashboard → SQL Editor. Idempotente (pode re-rodar).
-- "Hoje" no fuso de Campo Grande (America/Campo_Grande), igual às outras RPCs.
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_novos_por_lado()
RETURNS TABLE (
  diaristas_hoje    INTEGER,
  empregadores_hoje INTEGER,
  diaristas_7d      INTEGER,
  empregadores_7d   INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (NOW() AT TIME ZONE 'America/Campo_Grande')::DATE;
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY SELECT
    (SELECT COUNT(*)::INT FROM user_profiles
      WHERE user_type = 'diarista'
        AND (created_at AT TIME ZONE 'America/Campo_Grande')::DATE = v_hoje),
    (SELECT COUNT(*)::INT FROM user_profiles
      WHERE user_type = 'empregador'
        AND (created_at AT TIME ZONE 'America/Campo_Grande')::DATE = v_hoje),
    (SELECT COUNT(*)::INT FROM user_profiles
      WHERE user_type = 'diarista' AND created_at > NOW() - INTERVAL '7 days'),
    (SELECT COUNT(*)::INT FROM user_profiles
      WHERE user_type = 'empregador' AND created_at > NOW() - INTERVAL '7 days');
END $$;
REVOKE ALL ON FUNCTION admin_novos_por_lado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_novos_por_lado() TO authenticated;

-- Confirma (deve retornar 1)
SELECT COUNT(*) AS func_criada FROM pg_proc WHERE proname = 'admin_novos_por_lado';
