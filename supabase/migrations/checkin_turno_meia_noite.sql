-- ═══════════════════════════════════════════════════════════════════════════
-- Check-in: turno que CRUZA A MEIA-NOITE + fuso de Campo Grande na janela
-- ═══════════════════════════════════════════════════════════════════════════
-- Diária que vira o dia (ex.: início 18:00, fim 02:00) não conseguia check-in:
-- `v_inicio` e `v_fim` eram montados na MESMA `d.data`, então com fim < início a
-- janela [início−30min, fim+2h] ficava invertida/colapsada e o servidor sempre
-- devolvia `fora_da_janela`. Esta migração:
--
--   1. REGRA "VIRA O DIA": depois de montar v_inicio/v_fim, se `v_fim < v_inicio`
--      o término é no DIA SEGUINTE → soma 1 dia ao v_fim. Aí a janela abre certo
--      na virada. (Usa `<` e NÃO `<=` de propósito — ver nota abaixo.)
--
--   2. FUSO (incorpora a intenção do PR #209, que pode ser aposentado): o horário
--      da diária é interpretado como horário LOCAL de Campo Grande (UTC−4) via
--      `AT TIME ZONE 'America/Campo_Grande'`, virando TIMESTAMPTZ. Sem isso, o
--      "19:30" era lido como 19:30 UTC e a janela "passava" 4h adiantada (o app,
--      que checa em horário local, mostrava "Cheguei"; o servidor recusava).
--
-- ⚠️  POR QUE `<` E NÃO `<=` (como sugerido):
--     Quando `horario_fim` é VAZIO (serviço) ou IGUAL ao início (diária legada de
--     convite "19:30–19:30"), o COALESCE faz `v_fim = v_inicio`. Com `<=` esses
--     casos ganhariam uma janela de +26h (1 dia + 2h) sem necessidade. Com `<`,
--     só turno REALMENTE noturno (fim estritamente antes do início) é adiado —
--     serviço/legado seguem com a janela atual. Mesma regra do client (helpers).
--
-- DESCENDÊNCIA: parte da função EM PRODUÇÃO (checkin_distancia_geo_precisa.sql):
-- mantém `geo_preciso` + raio de 100 m. NÃO descende da versão do #209 (que tinha
-- raio fixo de 300 m e sem geo_preciso) — assim não regride o fix do "~8km".
--
-- Aplicar manualmente: Supabase Dashboard → SQL Editor → New Query → Run.
-- Idempotente / re-executável (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_checkin(
  p_diaria_id UUID,
  p_metodo    TEXT,
  p_lat       DOUBLE PRECISION DEFAULT NULL,
  p_lng       DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d        diarias%ROWTYPE;
  v_inicio TIMESTAMPTZ;   -- fuso: horário local de Campo Grande (era TIMESTAMP naive)
  v_fim    TIMESTAMPTZ;   -- idem
  v_dist   INTEGER := NULL;
  v_uid    UUID := auth.uid();
  c_raio_m CONSTANT INTEGER := 100;    -- raio de proximidade (m); fora dele → usar QR/código
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;
  IF p_metodo IS NULL OR p_metodo NOT IN ('qr','gps','codigo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'metodo_invalido');
  END IF;

  SELECT * INTO d FROM diarias WHERE id = p_diaria_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;

  -- Quem chama precisa ser parte da diária (empregador OU diarista aceito)
  IF v_uid <> d.empregador_id
     AND (d.diarista_aceite_id IS NULL OR v_uid <> d.diarista_aceite_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;

  -- Idempotente: se já houve check-in, não sobrescreve
  IF d.checkin_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_feito', true, 'checkin_em', d.checkin_em);
  END IF;

  -- Precisa estar 'aceita' (diarista confirmado, ainda não iniciada)
  IF d.status <> 'aceita' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido', 'status', d.status);
  END IF;

  -- Janela de check-in: [horario_inicio − 30min, horario_fim + 2h]
  -- FUSO: interpreta o horário como horário LOCAL de Campo Grande (UTC−4) e
  -- converte pra timestamptz, pra comparar corretamente com now() (UTC).
  v_inicio := (d.data || ' ' || COALESCE(NULLIF(d.horario_inicio, ''), '00:00'))::timestamp
                AT TIME ZONE 'America/Campo_Grande';
  v_fim    := (d.data || ' ' || COALESCE(NULLIF(d.horario_fim, ''), d.horario_inicio))::timestamp
                AT TIME ZONE 'America/Campo_Grande';
  -- REGRA "VIRA O DIA": fim < início ⇒ turno cruza a meia-noite (fim no dia seguinte).
  IF v_fim < v_inicio THEN
    v_fim := v_fim + interval '1 day';
  END IF;
  IF now() < (v_inicio - interval '30 minutes')
     OR now() > (v_fim + interval '2 hours') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_da_janela');
  END IF;

  -- Anti-fraude leve por GPS. Calcula a distância (auditoria) quando há GPS +
  -- coordenada da diária. SÓ BLOQUEIA quando a coordenada é PRECISA
  -- (geo_preciso = endereço completo) e acima do raio tolerante — NUNCA contra
  -- centroide de CEP/cidade. QR/código entram com metodo <> 'gps' e não passam aqui.
  IF p_metodo = 'gps' AND p_lat IS NOT NULL AND p_lng IS NOT NULL
     AND d.lat IS NOT NULL AND d.lng IS NOT NULL THEN
    v_dist := round(
      6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - d.lat) / 2), 2) +
        cos(radians(d.lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - d.lng) / 2), 2)
      ))
    );
    IF COALESCE(d.geo_preciso, false) AND v_dist > c_raio_m THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'muito_longe', 'distancia_m', v_dist);
    END IF;
  END IF;

  UPDATE diarias
     SET status              = 'em_andamento',
         checkin_em          = now(),
         checkin_metodo      = p_metodo,
         checkin_lat         = p_lat,
         checkin_lng         = p_lng,
         checkin_distancia_m = v_dist
   WHERE id = p_diaria_id;

  RETURN jsonb_build_object('ok', true, 'checkin_em', now(), 'distancia_m', v_dist);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_checkin(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

SELECT 'Check-in: virada de meia-noite + fuso Campo Grande (geo_preciso/100m mantidos).' AS resultado;
