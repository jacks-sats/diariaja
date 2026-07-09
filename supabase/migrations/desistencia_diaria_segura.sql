-- ═══════════════════════════════════════════════════════════════════════════════
-- Desistência segura de diária/serviço/serviço para empresas
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Problema: o front tentava fazer UPDATE direto em `diarias` para devolver a
-- vaga para `aberta`. A RLS bloqueia esse UPDATE em alguns estados/colunas e o
-- Supabase pode responder com 0 linhas alteradas sem erro. Resultado: para o
-- prestador a diária sumia, mas para o anunciante continuava como confirmada.
--
-- Solução: uma RPC SECURITY DEFINER faz a desistência de forma atômica:
--   - valida se quem chamou é o prestador selecionado;
--   - bloqueia desistência depois do check-in;
--   - limpa a candidatura do prestador;
--   - recalcula vagas preenchidas;
--   - devolve anúncio público para `aberta`;
--   - em convite direto, cancela a diária privada em vez de publicar no feed;
--   - garante Realtime com status anterior completo em `diarias`.
--
-- Aplicar manualmente no Supabase SQL Editor. Idempotente / reexecutável.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
         FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'diarias'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.diarias;
  END IF;
END $$;

ALTER TABLE public.diarias REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.desistir_diaria(
  p_diaria_id UUID,
  p_motivo    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid                 UUID := auth.uid();
  d                     public.diarias%ROWTYPE;
  v_candidatura_status  TEXT;
  v_tem_convite         BOOLEAN := FALSE;
  v_restantes           INTEGER := 0;
  v_vagas               INTEGER := 1;
  v_proximo             UUID;
  v_tem_confirmado      BOOLEAN := FALSE;
  v_novo_status         TEXT := 'aberta';
  v_motivo              TEXT := NULLIF(BTRIM(COALESCE(p_motivo, '')), '');
  v_convites_recusados  INTEGER := 0;
  v_execucoes_canceladas INTEGER := 0;
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

  IF d.tipo_oferta = 'emprego' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fluxo_emprego');
  END IF;

  SELECT c.status INTO v_candidatura_status
    FROM public.candidaturas c
   WHERE c.diaria_id = p_diaria_id
     AND c.diarista_id = v_uid
     AND c.status IN ('selecionado', 'confirmado')
   ORDER BY CASE c.status WHEN 'confirmado' THEN 0 ELSE 1 END,
            c.selecionado_em NULLS LAST,
            c.created_at
   LIMIT 1;

  IF d.diarista_aceite_id IS DISTINCT FROM v_uid
     AND v_candidatura_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;

  IF d.checkin_em IS NOT NULL OR d.status = 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_iniciada', 'status', d.status);
  END IF;

  IF d.status NOT IN ('aberta', 'pendente', 'aceita') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido', 'status', d.status);
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.convites c
     WHERE c.diaria_id = p_diaria_id
       AND c.diarista_id = v_uid
  ) INTO v_tem_convite;

  DELETE FROM public.candidaturas
   WHERE diaria_id = p_diaria_id
     AND diarista_id = v_uid;

  UPDATE public.convites
     SET status = 'recusado'
   WHERE diaria_id = p_diaria_id
     AND diarista_id = v_uid
     AND status IN ('aceito', 'confirmado');
  GET DIAGNOSTICS v_convites_recusados = ROW_COUNT;

  IF d.tipo_oferta = 'servico_empresa' THEN
    UPDATE public.servico_execucoes
       SET status = 'nao_realizada'
     WHERE diaria_id = p_diaria_id
       AND prestador_id = v_uid
       AND status = 'pendente';
    GET DIAGNOSTICS v_execucoes_canceladas = ROW_COUNT;
  END IF;

  SELECT COUNT(*) INTO v_restantes
    FROM public.candidaturas c
   WHERE c.diaria_id = p_diaria_id
     AND c.status IN ('selecionado', 'confirmado');

  SELECT EXISTS (
    SELECT 1
      FROM public.candidaturas c
     WHERE c.diaria_id = p_diaria_id
       AND c.status = 'confirmado'
  ) INTO v_tem_confirmado;

  SELECT c.diarista_id INTO v_proximo
    FROM public.candidaturas c
   WHERE c.diaria_id = p_diaria_id
     AND c.status IN ('confirmado', 'selecionado')
   ORDER BY CASE c.status WHEN 'confirmado' THEN 0 ELSE 1 END,
            c.selecionado_em NULLS LAST,
            c.created_at
   LIMIT 1;

  v_vagas := GREATEST(COALESCE(d.vagas, 1), 1);

  IF v_tem_convite THEN
    -- Convite direto virou diária privada. Não publica no feed público.
    v_novo_status := 'cancelada';
    v_proximo := NULL;
  ELSIF v_restantes = 0 THEN
    -- Caso comum: uma pessoa selecionada desistiu; anúncio volta para o feed.
    v_novo_status := 'aberta';
    v_proximo := NULL;
  ELSIF v_tem_confirmado THEN
    -- Há outro prestador confirmado; mantém o compromisso dele.
    v_novo_status := 'aceita';
  ELSE
    -- Há outro prestador selecionado, aguardando aceite.
    v_novo_status := 'pendente';
  END IF;

  UPDATE public.diarias
     SET status = v_novo_status,
         diarista_aceite_id = v_proximo,
         vagas_preenchidas = LEAST(v_restantes, v_vagas),
         motivo_cancelamento = CASE
           WHEN v_novo_status = 'cancelada' THEN v_motivo
           ELSE NULL
         END
   WHERE id = p_diaria_id;

  RETURN jsonb_build_object(
    'ok', true,
    'diaria_id', p_diaria_id,
    'empregador_id', d.empregador_id,
    'tipo_oferta', d.tipo_oferta,
    'funcao', COALESCE(NULLIF(d.funcao, ''), NULLIF(d.segmento, ''), 'serviço'),
    'status_anterior', d.status,
    'status_novo', v_novo_status,
    'voltou_feed', v_novo_status = 'aberta',
    'convite_recusado', v_convites_recusados > 0,
    'execucoes_canceladas', v_execucoes_canceladas,
    'vagas_preenchidas', LEAST(v_restantes, v_vagas)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.desistir_diaria(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desistir_diaria(UUID, TEXT) TO authenticated;

SELECT 'Desistência de diária instalada: RPC desistir_diaria + realtime completo em diarias.' AS resultado;
