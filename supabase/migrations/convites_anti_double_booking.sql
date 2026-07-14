-- ═══════════════════════════════════════════════════════════════════════════
-- Anti double-booking de convites (decisão do dono, 2026-07-13)
-- ═══════════════════════════════════════════════════════════════════════════
-- Regras:
--   1. DUPLICATA: um anunciante NÃO pode ter 2 convites PENDENTES para a mesma
--      diarista na mesma data (UNIQUE parcial). Recusado/aceito/cancelado
--      libera para convidar de novo.
--   2. AGENDA: a diarista NÃO é bloqueada por "mesma data" — pode ter 2
--      serviços no mesmo dia. O que se exige é FOLGA DE 1 HORA entre o
--      término de um compromisso e o início do outro.
--
-- Fontes de horário (fail-open: sem dado interpretável, NÃO bloqueia —
-- horario_servico é texto livre; nunca travamos o fluxo por palpite):
--   - convites: início extraído de horario_servico (regex HH:MM, mesmo padrão
--     de criar_diaria_de_convite); fim = início + carga_horaria (coluna
--     estruturada, com fallback no texto "(Xh"). Sem carga → fim = início.
--   - diarias: horario_inicio/horario_fim (TIME estruturados); fim < início =
--     turno cruza a meia-noite (mesma convenção de checkin_turno_meia_noite).
--
-- Onde enforça (autoridade no servidor):
--   - convites BEFORE UPDATE: transição p/ 'aceito' (diarista aceita convite);
--   - diarias  BEFORE UPDATE: transição p/ 'aceita'  (diarista aceita serviço).
--   service_role bypassa (detecção pelos DOIS paths do PostgREST — padrão de
--   fix_triggers_service_role_claims_2026-07-13.sql).
--
-- Erros têm mensagem própria pro usuário; o app repassa via traduzirErroBanco
-- (padrões "uq_convite_pendente" e "Conflito de agenda" adicionados junto).
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Duplicatas pendentes existentes: mantém a MAIS RECENTE de cada
--    (anunciante, diarista, data) e recusa as anteriores — senão o CREATE
--    UNIQUE INDEX abaixo falharia. Esperado: 0 linhas afetadas.
-- ─────────────────────────────────────────────────────────────────────────────
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY contratante_id, diarista_id, data_servico
           ORDER BY created_at DESC
         ) AS rn
    FROM convites
   WHERE status = 'pendente'
)
UPDATE convites SET status = 'recusado'
 WHERE id IN (SELECT id FROM dups WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_convite_pendente
  ON convites (contratante_id, diarista_id, data_servico)
  WHERE status = 'pendente';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: existe conflito de agenda (folga < 1h) para a diarista no
--    intervalo [p_ini, p_fim]? Retorna descrição do compromisso em conflito
--    ("às HH:MM de DD/MM") ou NULL se livre. Fail-open por compromisso:
--    horário não interpretável = ignora aquele registro (não bloqueia).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION agenda_conflito_diarista(
  p_diarista       UUID,
  p_ini            TIMESTAMP,
  p_fim            TIMESTAMP,
  p_ignora_convite UUID DEFAULT NULL,
  p_ignora_diaria  UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_ini2  TIMESTAMP;
  v_fim2  TIMESTAMP;
  v_carga NUMERIC;
BEGIN
  -- Convites já aceitos/confirmados da diarista (janela de ±1 dia cobre turnos
  -- que cruzam a meia-noite). Convite que já VIROU diária (diaria_id) é
  -- coberto pela varredura de diárias abaixo — evita contar 2x.
  FOR r IN
    SELECT c.id, c.data_servico, c.horario_servico, c.carga_horaria
      FROM convites c
     WHERE c.diarista_id = p_diarista
       AND c.status IN ('aceito', 'confirmado')
       AND c.diaria_id IS NULL
       AND (p_ignora_convite IS NULL OR c.id <> p_ignora_convite)
       AND c.data_servico BETWEEN (p_ini::date - 1) AND (p_fim::date + 1)
  LOOP
    BEGIN
      v_ini2 := r.data_servico
        + (SELECT (regexp_match(r.horario_servico, '(\d{1,2}:\d{2})'))[1])::time;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;  -- horário não interpretável — não bloqueia por palpite
    END;
    IF v_ini2 IS NULL THEN CONTINUE; END IF;
    BEGIN
      v_carga := COALESCE(
        r.carga_horaria,
        replace((SELECT (regexp_match(r.horario_servico, '\((\d+(?:[.,]\d+)?)\s*h'))[1]), ',', '.')::numeric
      );
    EXCEPTION WHEN OTHERS THEN
      v_carga := NULL;
    END;
    IF v_carga IS NOT NULL AND v_carga > 0 AND v_carga <= 24 THEN
      v_fim2 := v_ini2 + make_interval(mins => round(v_carga * 60)::int);
    ELSE
      v_fim2 := v_ini2;  -- sem carga: usa só o início (não inventa dado)
    END IF;
    IF NOT (p_ini >= v_fim2 + INTERVAL '1 hour' OR v_ini2 >= p_fim + INTERVAL '1 hour') THEN
      RETURN format('às %s de %s', to_char(v_ini2, 'HH24:MI'), to_char(v_ini2, 'DD/MM'));
    END IF;
  END LOOP;

  -- Diárias aceitas/em andamento da diarista (horários estruturados).
  FOR r IN
    SELECT d.id, d.data, d.horario_inicio, d.horario_fim
      FROM diarias d
     WHERE d.diarista_aceite_id = p_diarista
       AND d.status IN ('aceita', 'em_andamento')
       AND (p_ignora_diaria IS NULL OR d.id <> p_ignora_diaria)
       AND d.data BETWEEN (p_ini::date - 1) AND (p_fim::date + 1)
  LOOP
    BEGIN
      v_ini2 := r.data + r.horario_inicio;
      v_fim2 := r.data + r.horario_fim
        + (CASE WHEN r.horario_fim < r.horario_inicio THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
    IF v_ini2 IS NULL THEN CONTINUE; END IF;
    IF NOT (p_ini >= v_fim2 + INTERVAL '1 hour' OR v_ini2 >= p_fim + INTERVAL '1 hour') THEN
      RETURN format('às %s de %s', to_char(v_ini2, 'HH24:MI'), to_char(v_ini2, 'DD/MM'));
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION agenda_conflito_diarista(UUID, TIMESTAMP, TIMESTAMP, UUID, UUID) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger em CONVITES: diarista aceitando convite (pendente → aceito)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_agenda_convite()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ini      TIMESTAMP;
  v_fim      TIMESTAMP;
  v_carga    NUMERIC;
  v_conflito TEXT;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só na transição PARA 'aceito' (aceite da diarista).
  IF NEW.status IS DISTINCT FROM 'aceito' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Início/fim do convite sendo aceito (fail-open se não interpretável).
  BEGIN
    v_ini := NEW.data_servico
      + (SELECT (regexp_match(NEW.horario_servico, '(\d{1,2}:\d{2})'))[1])::time;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF v_ini IS NULL THEN RETURN NEW; END IF;
  BEGIN
    v_carga := COALESCE(
      NEW.carga_horaria,
      replace((SELECT (regexp_match(NEW.horario_servico, '\((\d+(?:[.,]\d+)?)\s*h'))[1]), ',', '.')::numeric
    );
  EXCEPTION WHEN OTHERS THEN
    v_carga := NULL;
  END;
  IF v_carga IS NOT NULL AND v_carga > 0 AND v_carga <= 24 THEN
    v_fim := v_ini + make_interval(mins => round(v_carga * 60)::int);
  ELSE
    v_fim := v_ini;
  END IF;

  v_conflito := agenda_conflito_diarista(NEW.diarista_id, v_ini, v_fim, NEW.id, NULL);
  IF v_conflito IS NOT NULL THEN
    RAISE EXCEPTION 'Conflito de agenda: você já tem um serviço %. Deixe pelo menos 1 hora entre o término de um serviço e o início do outro.', v_conflito
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_agenda_convite ON convites;
CREATE TRIGGER trg_enforce_agenda_convite
  BEFORE UPDATE ON convites
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agenda_convite();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger em DIARIAS: diarista aceitando serviço (transição → 'aceita')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_agenda_diaria()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ini      TIMESTAMP;
  v_fim      TIMESTAMP;
  v_conflito TEXT;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só na transição PARA 'aceita' com diarista definida.
  IF NEW.status IS DISTINCT FROM 'aceita'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR NEW.diarista_aceite_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_ini := NEW.data + NEW.horario_inicio;
    v_fim := NEW.data + NEW.horario_fim
      + (CASE WHEN NEW.horario_fim < NEW.horario_inicio THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;  -- sem horário interpretável, não bloqueia
  END;
  IF v_ini IS NULL THEN RETURN NEW; END IF;
  IF v_fim IS NULL THEN v_fim := v_ini; END IF;

  v_conflito := agenda_conflito_diarista(NEW.diarista_aceite_id, v_ini, v_fim, NULL, NEW.id);
  IF v_conflito IS NOT NULL THEN
    RAISE EXCEPTION 'Conflito de agenda: você já tem um serviço %. Deixe pelo menos 1 hora entre o término de um serviço e o início do outro.', v_conflito
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_agenda_diaria ON diarias;
CREATE TRIGGER trg_enforce_agenda_diaria
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agenda_diaria();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar após aplicar):
--   SELECT indexname FROM pg_indexes WHERE tablename='convites'
--      AND indexname='uq_convite_pendente';                       -- 1 linha
--   SELECT tgname FROM pg_trigger WHERE tgrelid='convites'::regclass
--      AND tgname='trg_enforce_agenda_convite';                   -- 1 linha
--   SELECT tgname FROM pg_trigger WHERE tgrelid='diarias'::regclass
--      AND tgname='trg_enforce_agenda_diaria';                    -- 1 linha
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Anti double-booking instalado: convite pendente único + folga de 1h na agenda.' AS resultado;
