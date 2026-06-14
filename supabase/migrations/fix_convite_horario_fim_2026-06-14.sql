-- ═══════════════════════════════════════════════════════════════════════════
-- FIX (2026-06-14): convite vira diária com horario_fim = início (perdia a carga)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BUG: `criar_diaria_de_convite` extraía só o horário de INÍCIO (HH:MM) de
-- `horario_servico` (ex.: "19:30 (4h de trabalho)") e gravava `horario_inicio`
-- E `horario_fim` iguais → a diária aparecia como "19:30–19:30" e a janela de
-- check-in ficava curta demais (fim + 2h = 21:30 em vez de 01:30).
--
-- FIX: extrai a carga horária ("(4h ...)") e calcula `horario_fim = início +
-- carga`. Sem carga reconhecível, mantém o comportamento antigo (fim = início).
-- (Edge case: turno cruzando a meia-noite faz o TIME "dar a volta"; aceitável
-- pro caso comum — a maioria dos turnos termina no mesmo dia.)
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
-- NÃO corrige diárias JÁ criadas (idempotente devolve a existente) — vale só
-- pra convites convertidos DEPOIS de rodar este SQL.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION criar_diaria_de_convite(p_convite_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_conv     convites%ROWTYPE;
  v_diaria   UUID;
  v_hora     TIME;
  v_carga    INTEGER;
  v_hora_fim TIME;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO v_conv FROM convites WHERE id = p_convite_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  IF v_uid <> v_conv.contratante_id AND v_uid <> v_conv.diarista_id THEN
    RAISE EXCEPTION 'Você não participa deste convite.';
  END IF;

  IF v_conv.pago_em IS NULL OR v_conv.presenca_confirmada_em IS NULL THEN
    RAISE EXCEPTION 'Convite ainda não está pago e confirmado.';
  END IF;

  IF v_conv.diaria_id IS NOT NULL THEN
    RETURN v_conv.diaria_id;
  END IF;

  -- Horário de INÍCIO: extrai HH:MM de horario_servico (ex.: "19:30 (4h ...)").
  v_hora := COALESCE(
    (SELECT (regexp_match(v_conv.horario_servico, '(\d{1,2}:\d{2})'))[1]),
    '00:00'
  )::time;

  -- FIX: carga horária ("(4h de trabalho)") → horario_fim = início + carga.
  -- Antes fim = início (perdia a duração) → "19:30–19:30" em vez de "19:30–23:30".
  v_carga := COALESCE((regexp_match(v_conv.horario_servico, '\((\d+)\s*h'))[1]::int, 0);
  v_hora_fim := CASE WHEN v_carga > 0
                     THEN v_hora + (v_carga || ' hours')::interval
                     ELSE v_hora END;

  INSERT INTO diarias (
    empregador_id, diarista_aceite_id, nome_negocio, segmento, funcao,
    descricao, data, horario_inicio, horario_fim, valor, status, endereco
  ) VALUES (
    v_conv.contratante_id,
    v_conv.diarista_id,
    COALESCE(NULLIF(v_conv.contratante_nome, ''), v_conv.local_servico, 'Anunciante'),
    '',
    COALESCE(v_conv.funcao, 'Serviço'),
    COALESCE(NULLIF(v_conv.observacoes, ''), 'Contratação via convite direto.'),
    v_conv.data_servico,
    v_hora,
    v_hora_fim,
    COALESCE(v_conv.valor, 0),
    'aceita',
    v_conv.local_servico
  )
  RETURNING id INTO v_diaria;

  UPDATE convites SET diaria_id = v_diaria WHERE id = p_convite_id;

  RETURN v_diaria;
END $$;

REVOKE ALL ON FUNCTION criar_diaria_de_convite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION criar_diaria_de_convite(UUID) TO authenticated;
