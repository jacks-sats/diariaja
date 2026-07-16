-- ============================================================================
-- DiariaJa - pedidos de orcamento sem semantica de diaria
-- ============================================================================
-- Mantem convites como fonte unica do fluxo (aceite -> contato -> chat -> servico)
-- e acrescenta somente os dados proprios da porta de entrada de orcamento.

ALTER TABLE convites
  ADD COLUMN IF NOT EXISTS descricao_pedido text,
  ADD COLUMN IF NOT EXISTS preferencia_data text,
  ADD COLUMN IF NOT EXISTS fotos_paths text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE convites
  DROP CONSTRAINT IF EXISTS convites_preferencia_data_check,
  DROP CONSTRAINT IF EXISTS convites_descricao_pedido_tamanho_check,
  DROP CONSTRAINT IF EXISTS convites_fotos_paths_max3_check;

ALTER TABLE convites
  ADD CONSTRAINT convites_preferencia_data_check
    CHECK (preferencia_data IS NULL OR preferencia_data IN ('hoje', 'amanha', 'esta_semana', 'data')),
  ADD CONSTRAINT convites_descricao_pedido_tamanho_check
    CHECK (descricao_pedido IS NULL OR char_length(descricao_pedido) BETWEEN 10 AND 2000),
  ADD CONSTRAINT convites_fotos_paths_max3_check
    CHECK (COALESCE(array_length(fotos_paths, 1), 0) <= 3);

COMMENT ON COLUMN convites.descricao_pedido IS
  'Problema ou necessidade descrita pelo cliente ao solicitar um orcamento.';
COMMENT ON COLUMN convites.preferencia_data IS
  'Janela desejada pelo cliente; data_servico continua como compatibilidade do motor.';
COMMENT ON COLUMN convites.fotos_paths IS
  'Ate tres caminhos privados no bucket orcamentos, visiveis apenas pelas partes.';

-- Fotos de problema podem revelar ambientes privados. Por isso este bucket nao
-- e publico; cliente e profissional recebem URLs temporarias no aplicativo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'orcamentos',
  'orcamentos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS orcamentos_owner_insert ON storage.objects;
CREATE POLICY orcamentos_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'orcamentos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS orcamentos_partes_select ON storage.objects;
CREATE POLICY orcamentos_partes_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'orcamentos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM convites c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND auth.uid() IN (c.contratante_id, c.diarista_id)
      )
    )
  );

DROP POLICY IF EXISTS orcamentos_owner_delete ON storage.objects;
CREATE POLICY orcamentos_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'orcamentos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- A diaria tecnica criada depois do contato usa uma janela neutra de duracao
-- zero para orcamentos sem horario. Uma janela de dia inteiro bloquearia toda a
-- agenda do profissional; o horario real continua sendo combinado no chat.
CREATE OR REPLACE FUNCTION criar_diaria_de_convite(p_convite_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_conv          convites%ROWTYPE;
  v_diaria        uuid;
  v_hora          time;
  v_fim           time;
  v_carga         numeric;
  v_eh_orcamento  boolean;
  v_descricao     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  -- Serializa duas tentativas simultaneas de liberar o mesmo contato. Sem o
  -- lock, ambas podiam ler diaria_id nulo e criar duas diarias tecnicas.
  SELECT * INTO v_conv FROM convites WHERE id = p_convite_id FOR UPDATE;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Convite nao encontrado.';
  END IF;
  IF v_uid <> v_conv.contratante_id AND v_uid <> v_conv.diarista_id THEN
    RAISE EXCEPTION 'Voce nao participa deste convite.';
  END IF;
  IF v_conv.pago_em IS NULL OR v_conv.presenca_confirmada_em IS NULL THEN
    RAISE EXCEPTION 'Convite ainda nao esta pago e confirmado.';
  END IF;
  IF v_conv.diaria_id IS NOT NULL THEN
    RETURN v_conv.diaria_id;
  END IF;

  v_eh_orcamento := v_conv.tipo_solicitacao = 'orcamento';
  IF v_eh_orcamento THEN
    v_hora := time '00:00';
    v_fim := v_hora;
  ELSE
    v_hora := COALESCE(
      (SELECT (regexp_match(v_conv.horario_servico, '(\d{1,2}:\d{2})'))[1]),
      '00:00'
    )::time;
    BEGIN
      v_carga := COALESCE(
        v_conv.carga_horaria,
        (SELECT (regexp_match(v_conv.horario_servico, '\((\d+(?:[.,]\d+)?)\s*h'))[1])::numeric
      );
    EXCEPTION WHEN OTHERS THEN
      v_carga := NULL;
    END;
    IF v_carga IS NOT NULL AND v_carga > 0 AND v_carga <= 24 THEN
      v_fim := v_hora + make_interval(mins => round(v_carga * 60)::int);
    ELSE
      v_fim := v_hora;
    END IF;
  END IF;

  v_descricao := CASE
    WHEN v_eh_orcamento THEN concat_ws(
      E'\n\n',
      NULLIF(btrim(v_conv.descricao_pedido), ''),
      NULLIF(btrim(v_conv.observacoes), '')
    )
    ELSE COALESCE(NULLIF(v_conv.observacoes, ''), 'Contratacao via convite direto.')
  END;

  INSERT INTO diarias (
    empregador_id, diarista_aceite_id, nome_negocio, segmento, funcao,
    descricao, data, horario_inicio, horario_fim, valor, status, endereco,
    tipo_oferta
  ) VALUES (
    v_conv.contratante_id,
    v_conv.diarista_id,
    COALESCE(NULLIF(v_conv.contratante_nome, ''), v_conv.local_servico, 'Cliente'),
    '',
    COALESCE(v_conv.funcao, 'Servico'),
    COALESCE(NULLIF(v_descricao, ''), 'Contratacao via pedido de orcamento.'),
    v_conv.data_servico,
    v_hora,
    v_fim,
    COALESCE(v_conv.valor, 0),
    'aceita',
    v_conv.local_servico,
    CASE WHEN v_eh_orcamento THEN 'servico' ELSE 'diaria' END
  )
  RETURNING id INTO v_diaria;

  UPDATE convites SET diaria_id = v_diaria WHERE id = p_convite_id;
  RETURN v_diaria;
END;
$$;

REVOKE ALL ON FUNCTION criar_diaria_de_convite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION criar_diaria_de_convite(uuid) TO authenticated;

SELECT 'Pedidos de orcamento flexiveis e fotos privadas instalados.' AS resultado;
