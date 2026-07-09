-- ═══════════════════════════════════════════════════════════════════════════
-- FIX (auditoria Codex 09/07/2026) — convite direto: fim do turno + policy
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) criar_diaria_de_convite gravava horario_fim = horario_inicio: o app podia
--    tratar o serviço como terminado no minuto em que começou (check-out/
--    no-show/lembretes). Agora o fim = início + carga_horaria do convite
--    (TIME + interval dá a volta na meia-noite sozinho). Sem carga válida,
--    mantém o comportamento antigo (fim = início).
-- 2) A policy "diarista_responde_status" permitia status='confirmado' SEM
--    pago_em — o gate real era só a RPC de criar a diária. Endurece: confirmar
--    exige contato liberado (pago_em IS NOT NULL). aceito/recusado seguem
--    livres. pago_em continua gravado só pelo service_role (webhook/função).
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Fim do turno correto na diária criada do convite
CREATE OR REPLACE FUNCTION criar_diaria_de_convite(p_convite_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_conv   convites%ROWTYPE;
  v_diaria UUID;
  v_hora   TIME;
  v_fim    TIME;
  v_carga  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO v_conv FROM convites WHERE id = p_convite_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  -- Só as duas partes do convite podem disparar a criação.
  IF v_uid <> v_conv.contratante_id AND v_uid <> v_conv.diarista_id THEN
    RAISE EXCEPTION 'Você não participa deste convite.';
  END IF;

  -- Precisa estar pago E com presença confirmada (o gate do chat).
  IF v_conv.pago_em IS NULL OR v_conv.presenca_confirmada_em IS NULL THEN
    RAISE EXCEPTION 'Convite ainda não está pago e confirmado.';
  END IF;

  -- Idempotente: já criada? devolve a mesma.
  IF v_conv.diaria_id IS NOT NULL THEN
    RETURN v_conv.diaria_id;
  END IF;

  -- horario_inicio/fim são TIME NOT NULL. O convite guarda horario_servico como
  -- texto (ex.: "06:00"); extraímos o padrão HH:MM e damos cast pra time, com
  -- fallback '00:00' se vier vazio/inválido (não dá pra inserir '' num time).
  v_hora := COALESCE(
    (SELECT (regexp_match(v_conv.horario_servico, '(\d{1,2}:\d{2})'))[1]),
    '00:00'
  )::time;

  -- FIX: fim = início + carga horária (coluna estruturada; convites antigos
  -- guardam só o texto "(Xh de trabalho)" — tenta extrair). TIME + interval
  -- cruza a meia-noite sozinho (22:00 + 6h = 04:00). Sem carga → fim = início
  -- (comportamento anterior, não inventa dado).
  v_carga := COALESCE(
    v_conv.carga_horaria,
    (SELECT (regexp_match(v_conv.horario_servico, '\((\d+(?:[.,]\d+)?)\s*h'))[1])::numeric
  );
  IF v_carga IS NOT NULL AND v_carga > 0 AND v_carga <= 24 THEN
    v_fim := v_hora + make_interval(mins => round(v_carga * 60)::int);
  ELSE
    v_fim := v_hora;
  END IF;

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
    v_fim,
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

-- 2) Policy: 'confirmado' só com contato liberado (pago_em)
DROP POLICY IF EXISTS "diarista_responde_status" ON convites;
CREATE POLICY "diarista_responde_status" ON convites
  FOR UPDATE
  USING (auth.uid() = diarista_id)
  WITH CHECK (
    auth.uid() = diarista_id
    AND (
      status IN ('aceito', 'recusado')
      OR (status = 'confirmado' AND pago_em IS NOT NULL)
    )
  );

SELECT 'Convite: fim do turno pela carga horária + confirmado exige pago_em.' AS resultado;
