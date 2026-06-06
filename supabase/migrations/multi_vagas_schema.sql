-- ═══════════════════════════════════════════════════════════════════════════
-- Multi-vagas: anunciante define quantas vagas a diária oferece (1–5) e pode
-- selecionar VÁRIOS candidatos até preencher. Reusa `candidaturas` como fonte
-- da verdade de quem foi selecionado (status 'selecionado'/'confirmado').
-- ═══════════════════════════════════════════════════════════════════════════
-- Aditivo e idempotente. SEGURO de aplicar a qualquer hora — com vagas=1
-- (default de toda diária existente) o comportamento é idêntico ao de hoje.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Quantas vagas a diária oferece (1–5; default 1 = comportamento atual).
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS vagas INTEGER NOT NULL DEFAULT 1;

-- 2. Contador denormalizado de vagas preenchidas (mantido pela app).
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS vagas_preenchidas INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diarias_vagas_range_chk') THEN
    ALTER TABLE diarias ADD CONSTRAINT diarias_vagas_range_chk CHECK (vagas BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diarias_vagas_preench_chk') THEN
    ALTER TABLE diarias ADD CONSTRAINT diarias_vagas_preench_chk
      CHECK (vagas_preenchidas >= 0 AND vagas_preenchidas <= vagas);
  END IF;
END $$;

-- 3. Quando o candidato foi SELECIONADO (≠ created_at, que é quando se candidatou).
--    Necessário para a cobrança contar "cada vaga = 1 contato" por mês.
ALTER TABLE candidaturas
  ADD COLUMN IF NOT EXISTS selecionado_em TIMESTAMPTZ;

-- 4. Cobrança R$1 por contato passa a contar CADA seleção (cada vaga), não cada
--    diária. Reescreve a RPC consultiva `pode_selecionar_candidato` mantendo a
--    regra do dono: plano grátis cota 0 (paga R$1 por contato), pago = ilimitado;
--    desbloqueios avulsos (contatos_desbloqueios) abatem a cota.
CREATE OR REPLACE FUNCTION pode_selecionar_candidato(
  p_diaria_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_empregador       UUID;
  v_plano            TEXT;
  v_selecoes_mes     INTEGER;
  v_extras           INTEGER;
  v_limite_gratis    INTEGER;
  v_limite_efetivo   INTEGER;
  v_permitido_gratis BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT empregador_id INTO v_empregador
    FROM diarias WHERE id = p_diaria_id;
  IF v_empregador IS NULL THEN
    RAISE EXCEPTION 'Diária não encontrada.';
  END IF;
  IF v_empregador <> v_uid THEN
    RAISE EXCEPTION 'Você não é o empregador desta diária.';
  END IF;

  v_plano := plano_ativo_role(v_uid, 'empregador');

  -- Seleções do mês = cada candidato selecionado/confirmado (cada vaga conta).
  -- NÃO conta no-show (diária 'expirada'): crédito interno preservado.
  SELECT COUNT(*) INTO v_selecoes_mes
    FROM candidaturas c
    JOIN diarias d ON d.id = c.diaria_id
   WHERE d.empregador_id   = v_uid
     AND c.status IN ('selecionado','confirmado')
     AND d.status <> 'expirada'
     AND c.selecionado_em >= date_trunc('month', NOW());

  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = v_uid
     AND created_at >= date_trunc('month', NOW());

  IF v_plano IN ('essencial','plus') THEN
    v_limite_gratis  := 2147483647;  -- "ilimitado" (int max)
    v_limite_efetivo := 2147483647;
  ELSE
    -- Cota grátis = 0. Cada contato no plano grátis exige R$1 (abatido pelos extras).
    v_limite_gratis  := 0;
    v_limite_efetivo := 0 + COALESCE(v_extras, 0);
  END IF;

  v_permitido_gratis := v_selecoes_mes < v_limite_efetivo;

  RETURN jsonb_build_object(
    'permitido_gratis',  v_permitido_gratis,
    'plano',             v_plano,
    'selecoes_mes',      v_selecoes_mes,
    'limite_gratis_mes', v_limite_gratis,
    'contatos_extras',   COALESCE(v_extras, 0),
    'limite_efetivo',    v_limite_efetivo,
    'exige_cobranca_r1', NOT v_permitido_gratis AND v_plano = 'gratis'
  );
END $$;

REVOKE ALL ON FUNCTION pode_selecionar_candidato(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pode_selecionar_candidato(UUID) TO authenticated;

SELECT 'Multi-vagas instalado: colunas vagas/vagas_preenchidas + candidaturas.selecionado_em + cobrança por vaga.' AS resultado;
