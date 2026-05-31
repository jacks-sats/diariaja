-- ═══════════════════════════════════════════════════════════════════════════
-- Convite confirmado VIRA diária real (chat/agenda/avaliações de verdade)
-- ═══════════════════════════════════════════════════════════════════════════
-- Problema histórico (hotfix_mensagens_fk_2026-05-28): o chat de convite usava
-- mensagens.diaria_id = convite.id, mas convite não criava diária. Resultado:
-- chat frágil, sem agenda nem avaliação, e mensagens órfãs.
--
-- Solução robusta (opção (a) do TODO do hotfix): quando o convite está pago
-- (anunciante) E com presença confirmada (prestador), criamos uma diária real
-- com status 'aceita' já ligando os dois. O chat passa a ser o chat normal de
-- diária; agenda e avaliações funcionam sem gambiarra.
--
-- A RPC é SECURITY DEFINER (o diarista não tem INSERT em diarias por RLS, mas
-- pode disparar a criação ao confirmar presença). Idempotente: se a diária já
-- existe pro convite, devolve a mesma. Não dispara cobrança (o R$1 já foi pago
-- no convite, e o trigger de cota é BEFORE UPDATE — INSERT não conta).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Liga convite ↔ diária criada (idempotência + abrir o chat certo dos 2 lados)
ALTER TABLE convites ADD COLUMN IF NOT EXISTS diaria_id UUID;
-- O authenticated precisa poder gravar diaria_id (REVOKE de segurança anterior):
GRANT UPDATE (diaria_id) ON convites TO authenticated;

-- 2. RPC: cria (ou devolve) a diária de um convite pago + confirmado
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
    v_hora,
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

SELECT 'Convite→diária instalado (chat/agenda reais para convites).' AS resultado;
