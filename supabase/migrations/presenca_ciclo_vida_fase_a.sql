-- ═══════════════════════════════════════════════════════════════════════════
-- Migração: Sistema de Presença e Ciclo de Vida da Diária — FASE A
-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicar manualmente: Supabase Dashboard → SQL Editor → New Query → Run.
-- Idempotente / re-executável (IF NOT EXISTS / CREATE OR REPLACE).
--
-- O que esta fase entrega:
--   1. Colunas de auditoria de presença em `diarias` (check-in/out + lembrete).
--   2. RPC `registrar_checkin` — check-in autoritativo no servidor (QR/GPS/código).
--   3. RPC `registrar_checkout` — encerramento com horário.
--   4. `expirar_e_encerrar_diarias()` — expira vencidas, detecta no-show e
--      auto-encerra diárias travadas em andamento (substitui a antiga, que só
--      expirava 'aberta'/'pendente' — origem do bug "expirada ainda pede QR").
--
-- ⚠️ Fuso: segue a MESMA convenção do código existente (`cron_expirar_vagas.sql`)
--    — compara `(data || ' ' || horario_fim)::timestamp` com `now()`. As diárias
--    são tratadas como horário local; a tolerância de janela absorve o desvio.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas de presença/auditoria (aditivas — nenhuma obrigatória)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS checkin_em          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_metodo      TEXT,             -- 'qr' | 'gps' | 'codigo'
  ADD COLUMN IF NOT EXISTS checkin_lat         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_lng         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_distancia_m INTEGER,          -- distância do endereço no check-in (m)
  ADD COLUMN IF NOT EXISTS checkout_em         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ;      -- dedup do push de lembrete (Fase C)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diarias_checkin_metodo_chk'
  ) THEN
    ALTER TABLE diarias ADD CONSTRAINT diarias_checkin_metodo_chk
      CHECK (checkin_metodo IS NULL OR checkin_metodo IN ('qr','gps','codigo'));
  END IF;
END $$;

-- Índice para o cron varrer diárias vencidas sem check-in de forma barata
CREATE INDEX IF NOT EXISTS idx_diarias_status_checkin
  ON diarias (status, checkin_em);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: registrar_checkin — porta ÚNICA de check-in (QR / GPS / código)
--    Valida status + janela no servidor → um QR de diária morta é recusado.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_inicio TIMESTAMP;
  v_fim    TIMESTAMP;
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
  v_inicio := (d.data || ' ' || COALESCE(NULLIF(d.horario_inicio, ''), '00:00'))::timestamp;
  v_fim    := (d.data || ' ' || COALESCE(NULLIF(d.horario_fim, ''), d.horario_inicio))::timestamp;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: registrar_checkout — encerra a diária gravando o horário de saída
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_checkout(
  p_diaria_id UUID,
  p_lat       DOUBLE PRECISION DEFAULT NULL,
  p_lng       DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d     diarias%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  SELECT * INTO d FROM diarias WHERE id = p_diaria_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;

  IF v_uid <> d.empregador_id
     AND (d.diarista_aceite_id IS NULL OR v_uid <> d.diarista_aceite_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;

  IF d.status = 'concluida' THEN
    RETURN jsonb_build_object('ok', true, 'ja_feito', true, 'checkout_em', d.checkout_em);
  END IF;
  IF d.status <> 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido', 'status', d.status);
  END IF;

  UPDATE diarias
     SET status      = 'concluida',
         checkout_em = now()
   WHERE id = p_diaria_id;

  RETURN jsonb_build_object('ok', true, 'checkout_em', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_checkout(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. expirar_e_encerrar_diarias() — substitui expirar_vagas_vencidas()
--    Garante o estado final SEM depender de ninguém abrir o app.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expirar_e_encerrar_diarias()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q_exp    INTEGER;
  q_noshow INTEGER;
  q_auto   INTEGER;
BEGIN
  -- (a) aberta/pendente vencidas → expirada (ninguém pegou)
  UPDATE diarias
     SET status = 'expirada'
   WHERE status IN ('aberta', 'pendente')
     AND (data || ' ' || COALESCE(NULLIF(horario_fim, ''), horario_inicio))::timestamp < now();
  GET DIAGNOSTICS q_exp = ROW_COUNT;

  -- (b) aceita + passou da janela (fim+2h) + SEM check-in → expirada (no-show)
  --     Continua identificável como não-comparecimento: status='expirada'
  --     com diarista_aceite_id preenchido e checkin_em NULL.
  UPDATE diarias
     SET status = 'expirada'
   WHERE status = 'aceita'
     AND checkin_em IS NULL
     AND (data || ' ' || COALESCE(NULLIF(horario_fim, ''), horario_inicio))::timestamp
         + interval '2 hours' < now();
  GET DIAGNOSTICS q_noshow = ROW_COUNT;

  -- (c) em_andamento vencida há >6h sem checkout → auto-conclui (destrava)
  UPDATE diarias
     SET status      = 'concluida',
         checkout_em = COALESCE(checkout_em, now())
   WHERE status = 'em_andamento'
     AND checkout_em IS NULL
     AND (data || ' ' || COALESCE(NULLIF(horario_fim, ''), horario_inicio))::timestamp
         + interval '6 hours' < now();
  GET DIAGNOSTICS q_auto = ROW_COUNT;

  RETURN jsonb_build_object(
    'expiradas',       q_exp,
    'no_show',         q_noshow,
    'auto_concluidas', q_auto
  );
END;
$$;

-- Execução manual:
--   SELECT public.expirar_e_encerrar_diarias();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. (RECOMENDADO) Agendamento via pg_cron — substitui o job antigo
-- ─────────────────────────────────────────────────────────────────────────────
-- Descomentar quando o pg_cron estiver disponível (Supabase Pro/self-hosted):
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   -- remove o job antigo, se existir:
--   SELECT cron.unschedule('expirar-vagas-15min')
--     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expirar-vagas-15min');
--   SELECT cron.schedule(
--     'presenca-ciclo-15min',
--     '*/15 * * * *',
--     $$ SELECT public.expirar_e_encerrar_diarias(); $$
--   );
--
-- Para desfazer:
--   SELECT cron.unschedule('presenca-ciclo-15min');

SELECT 'Fase A (presença/ciclo de vida) instalada.' AS resultado;
