-- ═══════════════════════════════════════════════════════════════════════════
-- FIX (2026-06-14): fuso horário na janela de check-in (registrar_checkin)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BUG: `v_inicio`/`v_fim` eram `TIMESTAMP` (sem fuso), montados a partir de
-- `data || ' ' || horario` (ex.: "2026-06-14 19:30"). Ao comparar com `now()`
-- (que é UTC no Supabase), o "19:30" era lido como 19:30 UTC. Campo Grande/MS é
-- UTC−4, então às 19:43 LOCAL (= 23:43 UTC) a janela [19:00, 21:30] já tinha
-- "passado" em UTC → o servidor devolvia `fora_da_janela` mesmo o prestador
-- estando no horário certo. (O app, que checa em horário LOCAL, mostrava o botão
-- "Cheguei"; o servidor recusava — exatamente o sintoma relatado.)
--
-- FIX: `v_inicio`/`v_fim` viram `TIMESTAMPTZ` e o horário é interpretado como
-- horário de Campo Grande via `AT TIME ZONE 'America/Campo_Grande'`. Assim a
-- comparação com `now()` passa a ser absoluta (instante × instante), correta.
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.
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
  v_inicio TIMESTAMPTZ;   -- FIX fuso: era TIMESTAMP (sem fuso)
  v_fim    TIMESTAMPTZ;   -- FIX fuso: era TIMESTAMP (sem fuso)
  v_dist   INTEGER := NULL;
  v_uid    UUID := auth.uid();
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
  -- FIX fuso: interpreta o horário da diária como horário LOCAL de Campo Grande
  -- (UTC−4) e converte pra timestamptz, pra comparar corretamente com now() (UTC).
  v_inicio := (d.data || ' ' || COALESCE(NULLIF(d.horario_inicio, ''), '00:00'))::timestamp
                AT TIME ZONE 'America/Campo_Grande';
  v_fim    := (d.data || ' ' || COALESCE(NULLIF(d.horario_fim, ''), d.horario_inicio))::timestamp
                AT TIME ZONE 'America/Campo_Grande';
  IF now() < (v_inicio - interval '30 minutes')
     OR now() > (v_fim + interval '2 hours') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_da_janela');
  END IF;

  -- Anti-fraude leve: se GPS e a diária tem coordenada, exige proximidade (≤300m)
  IF p_metodo = 'gps' AND p_lat IS NOT NULL AND p_lng IS NOT NULL
     AND d.lat IS NOT NULL AND d.lng IS NOT NULL THEN
    v_dist := round(
      6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - d.lat) / 2), 2) +
        cos(radians(d.lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - d.lng) / 2), 2)
      ))
    );
    IF v_dist > 300 THEN
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
