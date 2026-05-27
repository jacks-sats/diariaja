-- ═══════════════════════════════════════════════════════════════════════════
-- Monetização Dual Track — consolida o modelo definitivo (2026-05-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mudanças:
--   1. assinaturas: UNIQUE(user_id) -> UNIQUE(user_id, user_type)
--      Permite usuário 'ambos' ter 2 assinaturas (1 diarista + 1 empregador).
--   2. Aceita planos: gratis | essencial | plus (mantém 'pro' e 'destaque'
--      como aliases legados — UPDATE renomeia pra 'plus' automaticamente).
--   3. user_profiles.plano_ativo deprecated como fonte da verdade.
--      A fonte agora é a tabela `assinaturas`. plano_ativo fica mantido
--      por retrocompat (lê de lá enquanto o client migra).
--
-- RPCs novas:
--   - plano_ativo_role(user_id, role) -> 'gratis' | 'essencial' | 'plus'
--   - contar_diarias_concluidas_diarista(user_id) -> integer (vitalício)
--   - pode_selecionar_candidato(diaria_id) -> jsonb com decisão
--
-- Idempotente. Re-executável. Não destrói dados existentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Renomeia planos legados em assinaturas e user_profiles
--    (idempotente — ignora se já está no novo nome)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE assinaturas
   SET plano = 'plus'
 WHERE plano IN ('pro', 'destaque');

UPDATE user_profiles
   SET plano_ativo = 'plus'
 WHERE plano_ativo IN ('pro', 'destaque');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Troca UNIQUE(user_id) -> UNIQUE(user_id, user_type)
--    Constraint name pode variar entre instalações; tenta drop por nome
--    padrão e por busca defensiva via pg_constraint.
-- ─────────────────────────────────────────────────────────────────────────────
DO $migration$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Tenta o nome padrão criado pelo CREATE TABLE original
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assinaturas_user_id_key'
       AND conrelid = 'assinaturas'::regclass
  ) THEN
    ALTER TABLE assinaturas DROP CONSTRAINT assinaturas_user_id_key;
  END IF;

  -- Busca defensiva: qualquer UNIQUE que cubra APENAS (user_id)
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'assinaturas'::regclass
     AND contype = 'u'
     AND array_length(conkey, 1) = 1
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'assinaturas'::regclass
                            AND attname = 'user_id')]
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assinaturas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

-- Cria a nova constraint composta (idempotente)
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_assinaturas_user_role'
       AND conrelid = 'assinaturas'::regclass
  ) THEN
    ALTER TABLE assinaturas
      ADD CONSTRAINT uq_assinaturas_user_role UNIQUE (user_id, user_type);
  END IF;
END
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atualiza CHECK em assinaturas.plano (aceita gratis|essencial|plus)
--    Drop e re-cria pra incluir todos os valores em uso histórico.
-- ─────────────────────────────────────────────────────────────────────────────
DO $migration$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'assinaturas'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%plano%IN%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assinaturas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_plano_check
  CHECK (plano IN ('gratis', 'essencial', 'plus'));

-- assinaturas.user_type sempre foi 'empregador' ou 'diarista'.
-- Garantia defensiva: bloqueia outros valores (user_profiles.user_type pode
-- ser 'ambos', mas assinatura é sempre por papel específico).
DO $migration$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'assinaturas'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%user_type%IN%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assinaturas DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END
$migration$;

ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_user_type_check
  CHECK (user_type IN ('empregador', 'diarista'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: retorna o plano ativo de um papel específico (ou 'gratis' default)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plano_ativo_role(
  p_user_id UUID,
  p_role    TEXT  -- 'diarista' | 'empregador'
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano TEXT;
BEGIN
  IF p_role NOT IN ('diarista','empregador') THEN
    RAISE EXCEPTION 'Papel inválido: use diarista ou empregador.';
  END IF;
  SELECT plano INTO v_plano
    FROM assinaturas
   WHERE user_id   = p_user_id
     AND user_type = p_role
     AND status    = 'ativo'
   LIMIT 1;
  RETURN COALESCE(v_plano, 'gratis');
END $$;

REVOKE ALL ON FUNCTION plano_ativo_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plano_ativo_role(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: conta diárias CONCLUÍDAS do diarista (vitalício, ignora canceladas)
--    Usado pra trigger do modal "primeiras diárias" no diarista grátis.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION contar_diarias_concluidas_diarista(
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := COALESCE(p_user_id, auth.uid());
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM diarias
   WHERE diarista_aceite_id = v_uid
     AND status = 'concluida';
  RETURN COALESCE(v_count, 0);
END $$;

REVOKE ALL ON FUNCTION contar_diarias_concluidas_diarista(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contar_diarias_concluidas_diarista(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC central: pode_selecionar_candidato(diaria_id)
--    Server-side gate. Retorna jsonb com decisão completa pra client decidir
--    o próximo passo: abrir modal de termo (permitido) OU modal de pagamento R$1.
--
--    Estrutura de retorno:
--    {
--      "permitido_gratis":  boolean,   -- pode selecionar sem pagar?
--      "plano":             text,      -- plano atual do empregador
--      "selecoes_mes":      integer,   -- já selecionados este mês
--      "limite_gratis_mes": integer,   -- 3 (grátis) ou Infinity (essencial/plus)
--      "contatos_extras":   integer,   -- unlocks R$1 deste mês
--      "limite_efetivo":    integer,   -- 3 + extras
--      "exige_cobranca_r1": boolean    -- precisa pagar R$1 pra liberar
--    }
--
--    Client deve confiar nesta resposta e usar o resultado pra rotear o fluxo.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Confere que a diária é dele
  SELECT empregador_id INTO v_empregador
    FROM diarias WHERE id = p_diaria_id;
  IF v_empregador IS NULL THEN
    RAISE EXCEPTION 'Diária não encontrada.';
  END IF;
  IF v_empregador <> v_uid THEN
    RAISE EXCEPTION 'Você não é o empregador desta diária.';
  END IF;

  v_plano := plano_ativo_role(v_uid, 'empregador');

  -- Conta seleções confirmadas neste mês
  SELECT COUNT(*) INTO v_selecoes_mes
    FROM diarias
   WHERE empregador_id      = v_uid
     AND diarista_aceite_id IS NOT NULL
     AND created_at >= date_trunc('month', NOW());

  -- Unlocks R$1 pagos este mês (server-side, não localStorage)
  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = v_uid
     AND created_at >= date_trunc('month', NOW());

  -- Limite efetivo varia por plano
  IF v_plano IN ('essencial','plus') THEN
    v_limite_gratis  := 2147483647;  -- "ilimitado" (int max)
    v_limite_efetivo := 2147483647;
  ELSE
    v_limite_gratis  := 3;
    v_limite_efetivo := 3 + COALESCE(v_extras, 0);
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Verificação (rodar manualmente após):
--   SELECT plano, user_type, COUNT(*) FROM assinaturas GROUP BY 1,2;
--   -- não deve haver 'pro' nem 'destaque' (renomeados pra 'plus')
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'assinaturas'::regclass AND contype = 'u';
--   -- deve ter 'uq_assinaturas_user_role'
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('plano_ativo_role',
--                      'contar_diarias_concluidas_diarista',
--                      'pode_selecionar_candidato');
--   -- deve retornar 3 linhas
-- ─────────────────────────────────────────────────────────────────────────────
