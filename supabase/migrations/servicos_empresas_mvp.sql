-- DiáriaJá — Serviços para Empresas (MVP)
-- Aplicar manualmente no Supabase SQL Editor.
-- Idempotente: seguro para reexecutar.

-- 1) Novo tipo de oferta: diária com camada de execução empresarial.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'diarias'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%tipo_oferta%'
  LOOP
    EXECUTE format('ALTER TABLE diarias DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE diarias
  ADD CONSTRAINT diarias_tipo_oferta_check
  CHECK (tipo_oferta IN ('diaria', 'servico', 'emprego', 'servico_empresa'));

-- Serviços empresariais podem precisar de equipes maiores; demais fluxos ficam em 1-5.
ALTER TABLE diarias DROP CONSTRAINT IF EXISTS diarias_vagas_range_chk;
ALTER TABLE diarias
  ADD CONSTRAINT diarias_vagas_range_chk
  CHECK (
    (tipo_oferta = 'servico_empresa' AND vagas BETWEEN 1 AND 20)
    OR
    (tipo_oferta <> 'servico_empresa' AND vagas BETWEEN 1 AND 5)
  );

-- 2) Perfil trade do prestador.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS habilidades_trade TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experiencia_trade TEXT,
  ADD COLUMN IF NOT EXISTS aceita_servico_empresa BOOLEAN DEFAULT true;

-- 3) Detalhes do serviço empresarial.
CREATE TABLE IF NOT EXISTS servico_empresa_detalhes (
  diaria_id             UUID PRIMARY KEY REFERENCES diarias(id) ON DELETE CASCADE,
  tipo_servico          TEXT NOT NULL,
  marca                 TEXT,
  produto               TEXT,
  atividades            TEXT[] NOT NULL DEFAULT '{}',
  exige_fotos           BOOLEAN NOT NULL DEFAULT true,
  exige_relatorio       BOOLEAN NOT NULL DEFAULT true,
  exige_checkin         BOOLEAN NOT NULL DEFAULT true,
  material_fornecido    TEXT,
  uniforme              TEXT,
  treinamento_necessario BOOLEAN NOT NULL DEFAULT false,
  treinamento_texto     TEXT,
  instrucoes            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) Roteiro de lojas.
CREATE TABLE IF NOT EXISTS servico_lojas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id       UUID NOT NULL REFERENCES diarias(id) ON DELETE CASCADE,
  ordem           INTEGER NOT NULL DEFAULT 1,
  nome_loja       TEXT NOT NULL,
  cep             TEXT,
  endereco        TEXT NOT NULL,
  bairro          TEXT,
  cidade          TEXT,
  estado          TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  geo_preciso     BOOLEAN NOT NULL DEFAULT false,
  janela_inicio   TIME,
  janela_fim      TIME,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servico_lojas_diaria_ordem
  ON servico_lojas(diaria_id, ordem);

-- 5) Checklist definido pela empresa.
CREATE TABLE IF NOT EXISTS servico_checklist_itens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id    UUID NOT NULL REFERENCES diarias(id) ON DELETE CASCADE,
  ordem        INTEGER NOT NULL DEFAULT 1,
  pergunta     TEXT NOT NULL,
  tipo         TEXT NOT NULL DEFAULT 'sim_nao'
               CHECK (tipo IN ('sim_nao', 'texto', 'numero', 'foto')),
  obrigatorio  BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servico_checklist_diaria_ordem
  ON servico_checklist_itens(diaria_id, ordem);

-- 6) Execução: uma linha por loja x profissional.
CREATE TABLE IF NOT EXISTS servico_execucoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id           UUID NOT NULL REFERENCES diarias(id) ON DELETE CASCADE,
  loja_id             UUID NOT NULL REFERENCES servico_lojas(id) ON DELETE CASCADE,
  candidatura_id      UUID REFERENCES candidaturas(id) ON DELETE SET NULL,
  prestador_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'nao_realizada')),
  checkin_em          TIMESTAMPTZ,
  checkin_lat         DOUBLE PRECISION,
  checkin_lng         DOUBLE PRECISION,
  checkin_metodo      TEXT,
  checkin_distancia_m INTEGER,
  checkout_em         TIMESTAMPTZ,
  observacoes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loja_id, prestador_id)
);

CREATE INDEX IF NOT EXISTS idx_servico_execucoes_diaria
  ON servico_execucoes(diaria_id);
CREATE INDEX IF NOT EXISTS idx_servico_execucoes_prestador_status
  ON servico_execucoes(prestador_id, status);

-- 7) Fotos e respostas.
CREATE TABLE IF NOT EXISTS servico_fotos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id  UUID NOT NULL REFERENCES servico_execucoes(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('antes', 'depois', 'ruptura', 'extra')),
  storage_path TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servico_fotos_execucao
  ON servico_fotos(execucao_id);

CREATE TABLE IF NOT EXISTS servico_respostas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id  UUID NOT NULL REFERENCES servico_execucoes(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES servico_checklist_itens(id) ON DELETE CASCADE,
  resposta     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execucao_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_servico_respostas_execucao
  ON servico_respostas(execucao_id);

-- 8) Helper de participação para RLS.
CREATE OR REPLACE FUNCTION participa_servico_empresa(
  p_diaria_id UUID,
  p_user_id   UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM diarias d
     WHERE d.id = p_diaria_id
       AND d.empregador_id = p_user_id
  )
  OR EXISTS (
    SELECT 1
      FROM candidaturas c
     WHERE c.diaria_id = p_diaria_id
       AND c.diarista_id = p_user_id
       AND c.status IN ('selecionado', 'confirmado')
  )
  OR EXISTS (
    SELECT 1
      FROM servico_execucoes e
     WHERE e.diaria_id = p_diaria_id
       AND e.prestador_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION participa_servico_empresa(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION participa_servico_empresa(UUID, UUID) TO authenticated;

-- 9) RLS das tabelas novas.
ALTER TABLE servico_empresa_detalhes ENABLE ROW LEVEL SECURITY;
ALTER TABLE servico_lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE servico_checklist_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE servico_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE servico_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE servico_respostas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servico_detalhes_select ON servico_empresa_detalhes;
CREATE POLICY servico_detalhes_select ON servico_empresa_detalhes
  FOR SELECT USING (participa_servico_empresa(diaria_id, auth.uid()));

DROP POLICY IF EXISTS servico_detalhes_owner_write ON servico_empresa_detalhes;
CREATE POLICY servico_detalhes_owner_write ON servico_empresa_detalhes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  );

DROP POLICY IF EXISTS servico_lojas_select ON servico_lojas;
CREATE POLICY servico_lojas_select ON servico_lojas
  FOR SELECT USING (participa_servico_empresa(diaria_id, auth.uid()));

DROP POLICY IF EXISTS servico_lojas_owner_write ON servico_lojas;
CREATE POLICY servico_lojas_owner_write ON servico_lojas
  FOR ALL USING (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  );

DROP POLICY IF EXISTS servico_checklist_select ON servico_checklist_itens;
CREATE POLICY servico_checklist_select ON servico_checklist_itens
  FOR SELECT USING (participa_servico_empresa(diaria_id, auth.uid()));

DROP POLICY IF EXISTS servico_checklist_owner_write ON servico_checklist_itens;
CREATE POLICY servico_checklist_owner_write ON servico_checklist_itens
  FOR ALL USING (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  );

DROP POLICY IF EXISTS servico_execucoes_select ON servico_execucoes;
CREATE POLICY servico_execucoes_select ON servico_execucoes
  FOR SELECT USING (
    prestador_id = auth.uid()
    OR EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  );

DROP POLICY IF EXISTS servico_execucoes_owner_write ON servico_execucoes;
CREATE POLICY servico_execucoes_owner_write ON servico_execucoes
  FOR ALL USING (
    prestador_id = auth.uid()
    OR EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  )
  WITH CHECK (
    prestador_id = auth.uid()
    OR EXISTS (SELECT 1 FROM diarias d WHERE d.id = diaria_id AND d.empregador_id = auth.uid())
  );

DROP POLICY IF EXISTS servico_fotos_select ON servico_fotos;
CREATE POLICY servico_fotos_select ON servico_fotos
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM servico_execucoes e
        JOIN diarias d ON d.id = e.diaria_id
       WHERE e.id = execucao_id
         AND (e.prestador_id = auth.uid() OR d.empregador_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS servico_fotos_prestador_write ON servico_fotos;
CREATE POLICY servico_fotos_prestador_write ON servico_fotos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM servico_execucoes e WHERE e.id = execucao_id AND e.prestador_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM servico_execucoes e WHERE e.id = execucao_id AND e.prestador_id = auth.uid())
  );

DROP POLICY IF EXISTS servico_respostas_select ON servico_respostas;
CREATE POLICY servico_respostas_select ON servico_respostas
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM servico_execucoes e
        JOIN diarias d ON d.id = e.diaria_id
       WHERE e.id = execucao_id
         AND (e.prestador_id = auth.uid() OR d.empregador_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS servico_respostas_prestador_write ON servico_respostas;
CREATE POLICY servico_respostas_prestador_write ON servico_respostas
  FOR ALL USING (
    EXISTS (SELECT 1 FROM servico_execucoes e WHERE e.id = execucao_id AND e.prestador_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM servico_execucoes e WHERE e.id = execucao_id AND e.prestador_id = auth.uid())
  );

-- 10) Bucket privado para fotos de execução.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'execucoes-servicos',
  'execucoes-servicos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS execucoes_servicos_select ON storage.objects;
CREATE POLICY execucoes_servicos_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'execucoes-servicos'
    AND EXISTS (
      SELECT 1
        FROM servico_execucoes e
        JOIN diarias d ON d.id = e.diaria_id
       WHERE e.id::text = (storage.foldername(name))[2]
         AND (e.prestador_id = auth.uid() OR d.empregador_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS execucoes_servicos_insert ON storage.objects;
CREATE POLICY execucoes_servicos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'execucoes-servicos'
    AND EXISTS (
      SELECT 1
        FROM servico_execucoes e
       WHERE e.id::text = (storage.foldername(name))[2]
         AND e.prestador_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS execucoes_servicos_update ON storage.objects;
CREATE POLICY execucoes_servicos_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'execucoes-servicos'
    AND EXISTS (
      SELECT 1
        FROM servico_execucoes e
       WHERE e.id::text = (storage.foldername(name))[2]
         AND e.prestador_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'execucoes-servicos'
    AND EXISTS (
      SELECT 1
        FROM servico_execucoes e
       WHERE e.id::text = (storage.foldername(name))[2]
         AND e.prestador_id = auth.uid()
    )
  );

-- 11) Cria execuções para candidatos selecionados/confirmados.
CREATE OR REPLACE FUNCTION preparar_execucoes_servico_empresa(
  p_diaria_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM diarias
     WHERE id = p_diaria_id
       AND empregador_id = v_uid
       AND tipo_oferta = 'servico_empresa'
  ) THEN
    RAISE EXCEPTION 'Serviço empresarial não encontrado ou sem permissão.';
  END IF;

  INSERT INTO servico_execucoes (diaria_id, loja_id, candidatura_id, prestador_id)
  SELECT p_diaria_id, l.id, c.id, c.diarista_id
    FROM servico_lojas l
    JOIN candidaturas c ON c.diaria_id = p_diaria_id
   WHERE l.diaria_id = p_diaria_id
     AND c.status IN ('selecionado', 'confirmado')
  ON CONFLICT (loja_id, prestador_id) DO NOTHING;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE ALL ON FUNCTION preparar_execucoes_servico_empresa(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preparar_execucoes_servico_empresa(UUID) TO authenticated;

-- 12) Check-in/check-out por loja.
CREATE OR REPLACE FUNCTION registrar_checkin_servico_empresa(
  p_execucao_id UUID,
  p_lat         DOUBLE PRECISION DEFAULT NULL,
  p_lng         DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e servico_execucoes%ROWTYPE;
  l servico_lojas%ROWTYPE;
  d diarias%ROWTYPE;
  v_uid UUID := auth.uid();
  v_dist INTEGER := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  SELECT * INTO e FROM servico_execucoes WHERE id = p_execucao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;
  IF e.prestador_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;
  IF e.status = 'concluida' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_concluida');
  END IF;
  IF e.checkin_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_feito', true, 'checkin_em', e.checkin_em);
  END IF;

  SELECT * INTO l FROM servico_lojas WHERE id = e.loja_id;
  SELECT * INTO d FROM diarias WHERE id = e.diaria_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL THEN
    v_dist := round(
      6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - l.lat) / 2), 2) +
        cos(radians(l.lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - l.lng) / 2), 2)
      ))
    );
    IF v_dist > 300 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'muito_longe', 'distancia_m', v_dist);
    END IF;
  END IF;

  UPDATE servico_execucoes
     SET status = 'em_andamento',
         checkin_em = NOW(),
         checkin_lat = p_lat,
         checkin_lng = p_lng,
         checkin_metodo = 'gps',
         checkin_distancia_m = v_dist,
         updated_at = NOW()
   WHERE id = p_execucao_id;

  IF d.status = 'aceita' THEN
    UPDATE diarias SET status = 'em_andamento', checkin_em = COALESCE(checkin_em, NOW())
     WHERE id = d.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'checkin_em', NOW(), 'distancia_m', v_dist);
END;
$$;

REVOKE ALL ON FUNCTION registrar_checkin_servico_empresa(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_checkin_servico_empresa(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

CREATE OR REPLACE FUNCTION registrar_checkout_servico_empresa(
  p_execucao_id UUID,
  p_observacoes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e servico_execucoes%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  SELECT * INTO e FROM servico_execucoes WHERE id = p_execucao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  END IF;
  IF e.prestador_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;
  IF e.checkin_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_checkin');
  END IF;

  UPDATE servico_execucoes
     SET status = 'concluida',
         checkout_em = COALESCE(checkout_em, NOW()),
         observacoes = COALESCE(p_observacoes, observacoes),
         updated_at = NOW()
   WHERE id = p_execucao_id;

  RETURN jsonb_build_object('ok', true, 'checkout_em', NOW());
END;
$$;

REVOKE ALL ON FUNCTION registrar_checkout_servico_empresa(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_checkout_servico_empresa(UUID, TEXT) TO authenticated;

SELECT 'Serviços para Empresas: base MVP instalada.' AS resultado;
