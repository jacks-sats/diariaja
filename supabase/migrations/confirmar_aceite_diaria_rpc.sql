-- ═══════════════════════════════════════════════════════════════════════════
-- Aceite de diária ATÔMICO: diarias→'aceita' + candidatura→'confirmado' (1 tx)
-- ═══════════════════════════════════════════════════════════════════════════
-- Problema (item 3 da auditoria 15/07): o executarConfirmarPresenca do App
-- fazia 2 UPDATEs em SÉRIE (diarias.status='aceita' e depois
-- candidaturas.status='confirmado'). Se o 2º falhasse (rede, RLS), a diária
-- ficava 'aceita' sem candidatura confirmada: o anunciante não via o
-- prestador como confirmado e o chat (RLS por candidatura) travava — e a
-- re-tentativa do usuário refazia a transição de status já feita.
--
-- Solução: esta RPC roda os dois UPDATEs na MESMA transação. Qualquer RAISE
-- (trigger da cota grátis do prestador, campos imutáveis, conflito de agenda)
-- aborta TUDO — nunca fica meio estado.
--
-- Regras espelhadas do fluxo atual (SECURITY DEFINER não passa pela RLS,
-- então as condições da policy `diarista_aceite_pode_confirmar` são
-- re-validadas aqui dentro):
--   • diária/serviço: só o prestador selecionado (diarista_aceite_id) e só
--     com status 'pendente' → vira 'aceita' + candidatura dele 'confirmado'.
--   • EMPREGO: a vaga continua ABERTA (a empresa chama vários) — NÃO mexe em
--     diarias; só a candidatura do chamador vira 'confirmado' (libera o chat
--     daquele par pela RLS; dispara o trigger da mensagem automática).
--   • Candidatura ausente (ex.: diaria privada nascida de convite direto) não
--     é erro — comportamento idêntico ao UPDATE de 0 linhas de hoje; o total
--     vai em 'candidaturas_confirmadas' pra diagnóstico.
--
-- Os triggers de `diarias` e `candidaturas` disparam normalmente (o JWT do
-- chamador segue authenticated — enforce_cota_gratis_diarista continua
-- mordendo; service_role continua isento).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirmar_aceite_diaria(p_diaria_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  d      public.diarias%ROWTYPE;
  v_cand INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  -- FOR UPDATE: serializa 2 aceites simultâneos da mesma diária.
  SELECT * INTO d FROM public.diarias WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;

  IF d.tipo_oferta IS DISTINCT FROM 'emprego' THEN
    -- Espelho da policy diarista_aceite_pode_confirmar (RLS não se aplica em
    -- SECURITY DEFINER): só o selecionado, só a partir de 'pendente'.
    IF d.diarista_aceite_id IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_o_prestador');
    END IF;
    IF d.status IS DISTINCT FROM 'pendente' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido', 'status', d.status);
    END IF;

    UPDATE public.diarias SET status = 'aceita' WHERE id = p_diaria_id;
  END IF;

  UPDATE public.candidaturas
     SET status = 'confirmado'
   WHERE diaria_id = p_diaria_id
     AND diarista_id = v_uid;
  GET DIAGNOSTICS v_cand = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'emprego', d.tipo_oferta = 'emprego',
    'candidaturas_confirmadas', v_cand
  );
END $$;

REVOKE ALL ON FUNCTION public.confirmar_aceite_diaria(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_aceite_diaria(UUID) TO authenticated;

SELECT 'RPC confirmar_aceite_diaria instalada (aceite + candidatura em 1 transação).' AS resultado;
