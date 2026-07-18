-- ═══════════════════════════════════════════════════════════════════════════
-- Painel admin — PULSO: drill-down do bloco "Onde agir hoje".
-- O Pulso já mostra os CONTADORES (vagas sem candidato, empresas esperando
-- resposta, candidatos aguardando). Aqui vem o DETALHE acionavel: QUAIS sao +
-- o CONTATO, pro fundador ligar e destravar na hora.
-- ═══════════════════════════════════════════════════════════════════════════
-- Tres RPCs, todas so-admin (assert_admin_caller) e idempotentes:
--   1. admin_pulso_vagas_sem_candidato — vagas abertas sem interessado.
--   2. admin_pulso_empresas_esperando  — empresas com candidato nao respondido.
--   3. admin_pulso_candidatos_aguardando — prestadores esperando a empresa.
--
-- "Sem resposta" / "aguardando" = candidatura com selecionado_em NULL e
-- status <> 'rejeitado' (a empresa nem selecionou nem recusou aquele candidato).
-- Ordena por urgencia (mais antigo primeiro). Telefone vem de user_profiles —
-- exposicao OK porque a funcao e SECURITY DEFINER travada em admin.
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Vagas abertas SEM nenhum candidato — ligue para a empresa e ajude a girar.
CREATE OR REPLACE FUNCTION public.admin_pulso_vagas_sem_candidato(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  titulo TEXT,
  bairro TEXT,
  valor NUMERIC,
  criada_em TIMESTAMPTZ,
  empresa TEXT,
  telefone TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY
    SELECT
      d.id,
      COALESCE(NULLIF(BTRIM(d.funcao), ''), NULLIF(BTRIM(d.segmento), ''), 'Sem título') AS titulo,
      NULLIF(BTRIM(d.bairro), '') AS bairro,
      d.valor,
      d.created_at,
      COALESCE(NULLIF(BTRIM(up.nome_negocio), ''), NULLIF(BTRIM(up.nome), ''), 'Empresa') AS empresa,
      NULLIF(BTRIM(up.telefone), '') AS telefone
    FROM public.diarias d
    LEFT JOIN public.user_profiles up ON up.id = d.empregador_id
    WHERE d.status = 'aberta'
      AND (d.tipo_oferta = 'emprego'
           OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)
      AND NOT EXISTS (
        SELECT 1 FROM public.candidaturas c
         WHERE c.diaria_id = d.id AND c.status <> 'rejeitado')
    ORDER BY d.created_at ASC  -- as que estao ha mais tempo no ar sem ninguem
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pulso_vagas_sem_candidato(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_pulso_vagas_sem_candidato(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_pulso_vagas_sem_candidato(INTEGER) TO authenticated;

-- 2) Empresas que RECEBERAM candidato e ainda nao responderam — agrupadas, com
--    quantos aguardam e ha quanto tempo o mais antigo espera.
CREATE OR REPLACE FUNCTION public.admin_pulso_empresas_esperando(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  empregador_id UUID,
  empresa TEXT,
  telefone TEXT,
  aguardando INTEGER,
  espera_desde TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY
    SELECT
      d.empregador_id,
      COALESCE(NULLIF(BTRIM(up.nome_negocio), ''), NULLIF(BTRIM(up.nome), ''), 'Empresa') AS empresa,
      NULLIF(BTRIM(up.telefone), '') AS telefone,
      COUNT(c.id)::INTEGER AS aguardando,
      MIN(c.created_at) AS espera_desde
    FROM public.diarias d
    JOIN public.candidaturas c
      ON c.diaria_id = d.id AND c.selecionado_em IS NULL AND c.status <> 'rejeitado'
    LEFT JOIN public.user_profiles up ON up.id = d.empregador_id
    WHERE d.status = 'aberta'
      AND (d.tipo_oferta = 'emprego'
           OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)
    GROUP BY d.empregador_id, up.nome_negocio, up.nome, up.telefone
    ORDER BY espera_desde ASC  -- quem faz o candidato esperar ha mais tempo
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pulso_empresas_esperando(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_pulso_empresas_esperando(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_pulso_empresas_esperando(INTEGER) TO authenticated;

-- 3) Prestadores que se candidataram e seguem esperando resposta da empresa.
CREATE OR REPLACE FUNCTION public.admin_pulso_candidatos_aguardando(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  candidatura_id UUID,
  prestador TEXT,
  telefone TEXT,
  vaga TEXT,
  empresa TEXT,
  desde TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin_caller();
  RETURN QUERY
    SELECT
      c.id,
      COALESCE(NULLIF(BTRIM(pp.nome), ''), 'Prestador') AS prestador,
      NULLIF(BTRIM(pp.telefone), '') AS telefone,
      COALESCE(NULLIF(BTRIM(d.funcao), ''), NULLIF(BTRIM(d.segmento), ''), 'Sem título') AS vaga,
      COALESCE(NULLIF(BTRIM(emp.nome_negocio), ''), NULLIF(BTRIM(emp.nome), ''), 'Empresa') AS empresa,
      c.created_at
    FROM public.candidaturas c
    JOIN public.diarias d ON d.id = c.diaria_id
    LEFT JOIN public.user_profiles pp  ON pp.id  = c.diarista_id
    LEFT JOIN public.user_profiles emp ON emp.id = d.empregador_id
    WHERE d.status = 'aberta'
      AND (d.tipo_oferta = 'emprego'
           OR COALESCE(NULLIF(d.data::text, ''), '1900-01-01')::date >= CURRENT_DATE)
      AND c.selecionado_em IS NULL AND c.status <> 'rejeitado'
    ORDER BY c.created_at ASC  -- quem espera ha mais tempo primeiro
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pulso_candidatos_aguardando(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_pulso_candidatos_aguardando(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_pulso_candidatos_aguardando(INTEGER) TO authenticated;

SELECT 'Drill-down do Pulso instalado (vagas sem candidato + esperando + aguardando).' AS resultado;
