-- ============================================================================
-- DiariaJa - aceite de oportunidades direcionadas pela area Profissionais
-- ============================================================================
-- Uma oportunidade direcionada nasce em diarias com:
--   status = 'pendente' e diarista_aceite_id = profissional escolhido.
--
-- Diaria, servico e servico empresarial ja seguiam esse modelo. A excecao era
-- emprego: no fluxo publico a vaga continua aberta e somente a candidatura e
-- confirmada. Aqui distinguimos os dois casos sem alterar a vaga publica.

CREATE OR REPLACE FUNCTION public.confirmar_aceite_diaria(p_diaria_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               UUID := auth.uid();
  d                   public.diarias%ROWTYPE;
  v_cand              INTEGER := 0;
  v_emprego_direto    BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  SELECT * INTO d
    FROM public.diarias
   WHERE id = p_diaria_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;

  v_emprego_direto := d.tipo_oferta = 'emprego'
    AND d.diarista_aceite_id IS NOT NULL;

  IF d.tipo_oferta IS DISTINCT FROM 'emprego' OR v_emprego_direto THEN
    IF d.diarista_aceite_id IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_o_prestador');
    END IF;
    IF d.status IS DISTINCT FROM 'pendente' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido', 'status', d.status);
    END IF;

    UPDATE public.diarias
       SET status = 'aceita'
     WHERE id = p_diaria_id;
  END IF;

  -- Preserva o comportamento anterior para diaria/servico e emprego publico:
  -- se existir candidatura, ela e confirmada na mesma transacao. Oportunidades
  -- privadas podem nascer sem candidatura, por isso zero linhas so e erro no
  -- emprego publico, que depende dela para liberar o chat daquele candidato.
  UPDATE public.candidaturas
     SET status = 'confirmado'
   WHERE diaria_id = p_diaria_id
     AND diarista_id = v_uid;
  GET DIAGNOSTICS v_cand = ROW_COUNT;

  IF d.tipo_oferta = 'emprego' AND NOT v_emprego_direto AND v_cand = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'candidatura_nao_encontrada');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'emprego', d.tipo_oferta = 'emprego',
    'direcionada', d.diarista_aceite_id IS NOT NULL,
    'candidaturas_confirmadas', v_cand
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_aceite_diaria(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_aceite_diaria(UUID) TO authenticated;

SELECT 'Aceite de oportunidades direcionadas instalado.' AS resultado;
