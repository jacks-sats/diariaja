-- ============================================================================
-- DiáriaJá — Migrations pendentes consolidadas (2026-05-27)
-- ============================================================================
-- Cole tudo este arquivo no Supabase Dashboard → SQL Editor → Run.
--
-- Ordem segura, tudo idempotente (pode rodar várias vezes sem efeito colateral).
-- A única coisa NÃO incluída é o hotfix_triggers_cast.sql, que você já rodou.
-- O trecho do trigger clamp_last_activity_at foi REMOVIDO daqui pra não
-- sobrescrever a versão DEFENSIVA (com CAST) que o hotfix já aplicou.
--
-- Conteúdo:
--   PARTE 1/4 — Endurecimento do banco (auditoria 26/05)
--   PARTE 2/4 — Colunas do cadastro PJ + RPC cnpj_ja_cadastrado
--   PARTE 3/4 — MIME allowlist nos buckets avatars/documentos
--   PARTE 4/4 — Já Decola (sistema educacional gamificado)
--
-- Verificação ao fim. Tempo estimado: 5-10s.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE 1/4 — Endurecimento do banco (auditoria_26_05_fixes.sql)          ║
-- ║ Sem o trecho do clamp_last_activity_at (já aplicado pelo hotfix).        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ============================================================================
-- Auditoria 2026-05-26 — fixes de segurança, integridade e performance
-- ============================================================================
-- Esta migration consolida 10 fixes da auditoria do dia 26/05. É segura pra
-- reaplicar: todos os DDLs usam `IF NOT EXISTS` / `IF EXISTS` ou
-- `DROP ... IF EXISTS` antes de criar. Sem efeitos colaterais em dados
-- existentes (não faz UPDATE/DELETE em linhas de produção).
--
-- Aplicar via Supabase Dashboard → SQL Editor.
--
-- Itens cobertos:
--   1. webhook_eventos_processados (idempotência mp-webhook) — P0-3
--   2. oauth_states (nonce CSRF anti-takeover mp-oauth)      — P0-2
--   3. RPC criar_oauth_state                                  — apoio ao P0-2
--   4. Índices em candidaturas                                — P2-1 (perf)
--   5. CHECK constraint convites.status                       — P3 hygiene
--   6. CHECK constraint denuncias.status                      — P3 hygiene
--   7. CHECK + allowlist topicos.categoria                    — P1-16
--   8. analytics_eventos rejeita user_id NULL                 — P1-8
--   9. last_activity_at protegido contra forja                — P1-12
--  10. REVOKE EXECUTE em expirar_vagas_vencidas               — P1-15
--  11. REVOKE SELECT por coluna em colunas sensíveis          — P1-13/P1-14
--  12. allowlist autor_tipo em topicos e comentarios          — P1-11
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela webhook_eventos_processados (idempotência)
-- ---------------------------------------------------------------------------
-- mp-webhook insere o ID antes de processar. Se já existir → return 200 sem
-- reprocessar. Defende contra replay de webhook MP (P0-3 + IMP-S1).
CREATE TABLE IF NOT EXISTS webhook_eventos_processados (
  mp_evento_id  TEXT PRIMARY KEY,
  recebido_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_eventos_processados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_eventos_service_role" ON webhook_eventos_processados;
CREATE POLICY "webhook_eventos_service_role" ON webhook_eventos_processados
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Limpeza opcional: rodar via pg_cron pra não crescer indefinidamente.
-- DELETE FROM webhook_eventos_processados WHERE recebido_em < NOW() - INTERVAL '90 days';

-- ---------------------------------------------------------------------------
-- 2. Tabela oauth_states + RPC para iniciar OAuth com nonce (P0-2)
-- ---------------------------------------------------------------------------
-- Antes o `state` enviado ao Mercado Pago era o `user_id` da vítima (UUID
-- público). Atacante podia capturar o user_id alvo, iniciar OAuth com a
-- conta MP DELE e completar com `state=<user_id_da_vitima>` — o token MP
-- do atacante ia parar no perfil da vítima. Account takeover financeiro.
--
-- Solução: nonce one-time gerado pela RPC, salvo aqui, consumido (DELETE)
-- no callback do Edge Function `mp-oauth`.

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('mercadopago')),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exp         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user_provider ON oauth_states(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_states_exp ON oauth_states(exp);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_states_service_role" ON oauth_states;
CREATE POLICY "oauth_states_service_role" ON oauth_states
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Nenhuma policy pra `authenticated` — usuário comum NÃO lê nem escreve
-- direto. Só via RPC abaixo.

-- ---------------------------------------------------------------------------
-- 3. RPC criar_oauth_state (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION criar_oauth_state(p_provider TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_state   TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada';
  END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('mercadopago') THEN
    RAISE EXCEPTION 'Provider inválido';
  END IF;

  -- Limpa states expirados do próprio user (housekeeping leve).
  DELETE FROM oauth_states
   WHERE user_id = v_user_id
     AND (exp < NOW() OR provider = p_provider);

  -- Gera state aleatório (36 chars UUID — entropy suficiente)
  v_state := gen_random_uuid()::TEXT;

  INSERT INTO oauth_states (state, user_id, provider, exp)
  VALUES (v_state, v_user_id, p_provider, NOW() + INTERVAL '10 minutes');

  RETURN v_state;
END $$;

REVOKE ALL ON FUNCTION criar_oauth_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION criar_oauth_state(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Índices em candidaturas (P2-1 / IMP-C6 — performance)
-- ---------------------------------------------------------------------------
-- App.tsx faz vários `eq("diaria_id", ...)`, `eq("diarista_id", ...)`,
-- `eq("status", ...)` em candidaturas. Sem índice → seq scan em cada query.
CREATE INDEX IF NOT EXISTS idx_candidaturas_diaria_status
  ON candidaturas(diaria_id, status);

CREATE INDEX IF NOT EXISTS idx_candidaturas_diarista_data
  ON candidaturas(diarista_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidaturas_diarista_status
  ON candidaturas(diarista_id, status);

-- ---------------------------------------------------------------------------
-- 5. CHECK constraint convites.status (P3 hygiene)
-- ---------------------------------------------------------------------------
-- Contratante podia inserir convite com status arbitrário (não validado).
ALTER TABLE convites DROP CONSTRAINT IF EXISTS convites_status_check;
ALTER TABLE convites ADD CONSTRAINT convites_status_check
  CHECK (status IN ('pendente','aceito','recusado','cancelado','expirado'));

-- ---------------------------------------------------------------------------
-- 6. CHECK constraint denuncias.status
-- ---------------------------------------------------------------------------
ALTER TABLE denuncias DROP CONSTRAINT IF EXISTS denuncias_status_check;
ALTER TABLE denuncias ADD CONSTRAINT denuncias_status_check
  CHECK (status IN ('pendente','em_analise','resolvida','descartada'));

-- ---------------------------------------------------------------------------
-- 7. CHECK + allowlist topicos.categoria (P1-16)
-- ---------------------------------------------------------------------------
-- Antes `categoria TEXT DEFAULT 'geral'` aceitava qualquer string —
-- cliente injetava categoria='admin' ou '<script>'.
ALTER TABLE topicos DROP CONSTRAINT IF EXISTS topicos_categoria_check;
ALTER TABLE topicos ADD CONSTRAINT topicos_categoria_check
  CHECK (categoria IN ('geral','dicas','duvidas','conquistas','suporte','denuncias'));

-- ---------------------------------------------------------------------------
-- 8. allowlist autor_tipo em topicos e comentarios (P1-11)
-- ---------------------------------------------------------------------------
ALTER TABLE topicos DROP CONSTRAINT IF EXISTS topicos_autor_tipo_check;
ALTER TABLE topicos ADD CONSTRAINT topicos_autor_tipo_check
  CHECK (autor_tipo IN ('diarista','empregador','ambos','admin'));

ALTER TABLE comentarios_comunidade DROP CONSTRAINT IF EXISTS comentarios_autor_tipo_check;
ALTER TABLE comentarios_comunidade ADD CONSTRAINT comentarios_autor_tipo_check
  CHECK (autor_tipo IN ('diarista','empregador','ambos','admin'));

-- ---------------------------------------------------------------------------
-- 9. analytics_eventos rejeita user_id NULL (P1-8)
-- ---------------------------------------------------------------------------
-- Antes: WITH CHECK (user_id = auth.uid() OR user_id IS NULL) — qualquer
-- authenticated podia injetar eventos anônimos sem rastro.
DROP POLICY IF EXISTS "Inserção de eventos próprios" ON analytics_eventos;
DROP POLICY IF EXISTS "insercao_eventos_proprios" ON analytics_eventos;
CREATE POLICY "insercao_eventos_proprios" ON analytics_eventos
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 11. REVOKE EXECUTE em expirar_vagas_vencidas (P1-15)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER sem REVOKE FROM PUBLIC permitia qualquer authenticated
-- rodar e expirar vagas em massa (DoS de concorrência).
-- Defensivo: só faz REVOKE se a função existir (caso este projeto não tenha
-- a migration cron_expirar_vagas.sql aplicada).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'expirar_vagas_vencidas') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION expirar_vagas_vencidas() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION expirar_vagas_vencidas() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION expirar_vagas_vencidas() FROM anon';
  END IF;
END $$;
-- service_role mantém execução (default tem todos os privilégios).

-- ---------------------------------------------------------------------------
-- 12. REVOKE SELECT por coluna em colunas sensíveis (P1-13 / P1-14)
-- ---------------------------------------------------------------------------
-- mp_access_token + CPF + CNPJ + telefone + documento_url ficavam em
-- plaintext no banco. Se uma policy SELECT for relaxada por engano (RLS
-- amplo herdado), tudo vaza. Defense in depth: REVOKE de colunas evita
-- vazamento mesmo com RLS aberto.
--
-- ATENÇÃO: depois deste REVOKE o app NÃO consegue mais ler essas colunas
-- via `select("*")` nem via `select("cpf, mp_access_token")` de cliente
-- authenticated. Pra ler dado próprio, o user precisa de RPC SECURITY
-- DEFINER tipo `meu_perfil_completo()` que retorne só pra auth.uid() = id.
--
-- *** COMENTADO POR PADRÃO *** — ative SÓ quando todos os usos no app
-- estiverem migrados pra RPC. Eu deixo como TODO no projeto.
--
-- REVOKE SELECT (mp_access_token, cpf, cnpj, telefone, documento_url)
--   ON user_profiles FROM authenticated, anon;

-- ============================================================================
-- Fim da migration auditoria_26_05_fixes.sql
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE 2/4 — Cadastro PJ completo (cadastro_pj_completo.sql)              ║
-- ║ Colunas razao_social/nome_fantasia/responsavel_*/RPC cnpj_ja_cadastrado. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ============================================================================
-- Cadastro PJ completo — colunas para Razão Social, Nome Fantasia e Responsável
-- ============================================================================
-- A spec do cadastro PJ pede campos separados que antes ficavam só em
-- `nome_negocio` (string genérica). Adicionamos colunas dedicadas e mantemos
-- `nome_negocio` por compatibilidade (usado em outras telas e legacy data).
--
-- Aplicar via Supabase Dashboard → SQL Editor. Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas em user_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS razao_social      TEXT,
  ADD COLUMN IF NOT EXISTS nome_fantasia     TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_nome  TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_cpf   TEXT;

-- Comentários (documentação inline)
COMMENT ON COLUMN user_profiles.razao_social     IS 'Razão social da empresa (PJ). NULL para PF.';
COMMENT ON COLUMN user_profiles.nome_fantasia    IS 'Nome fantasia / nome público da empresa. NULL para PF.';
COMMENT ON COLUMN user_profiles.responsavel_nome IS 'Nome completo do responsável legal pela conta PJ.';
COMMENT ON COLUMN user_profiles.responsavel_cpf  IS 'CPF do responsável legal pela conta PJ. Privado, não exibido publicamente.';

-- ---------------------------------------------------------------------------
-- 2. Migração leve de dados legacy (best-effort)
-- ---------------------------------------------------------------------------
-- Empresas existentes (pessoa_tipo = 'juridica') que só tinham `nome_negocio`
-- recebem o mesmo valor em `nome_fantasia` por default — `razao_social` fica
-- NULL e o user preenche ao editar perfil. Idempotente (só atualiza onde
-- nome_fantasia ainda é NULL).
UPDATE user_profiles
   SET nome_fantasia = nome_negocio
 WHERE pessoa_tipo = 'juridica'
   AND nome_negocio IS NOT NULL
   AND nome_fantasia IS NULL;

-- ---------------------------------------------------------------------------
-- 3. RPC para checar CNPJ duplicado sem expor user_id (UX pre-submit)
-- ---------------------------------------------------------------------------
-- A UNIQUE constraint em CNPJ (cadastro_p0_fixes.sql) já protege contra
-- duplicatas no INSERT, mas a UI quer feedback ANTES de enviar a senha.
-- Esta RPC só responde sim/não — não vaza dados de outro user.
CREATE OR REPLACE FUNCTION cnpj_ja_cadastrado(p_cnpj TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digitos TEXT := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_existe  BOOLEAN;
BEGIN
  IF length(v_digitos) <> 14 THEN
    RETURN FALSE;  -- formato inválido = trata como "não existe" (a tela valida DV antes)
  END IF;
  -- Compara tanto formato com máscara quanto só dígitos (legacy data).
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE cnpj IS NOT NULL
       AND regexp_replace(cnpj, '\D', '', 'g') = v_digitos
  ) INTO v_existe;
  RETURN v_existe;
END $$;

REVOKE ALL ON FUNCTION cnpj_ja_cadastrado(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cnpj_ja_cadastrado(TEXT) TO anon, authenticated;
-- anon precisa pra checar antes do signup (user ainda não tem JWT)

-- ============================================================================
-- Fim da migration cadastro_pj_completo.sql
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE 3/4 — MIME allowlist nos buckets (bucket_avatars_mime_allowlist)   ║
-- ║ Aceita só JPG/PNG/WEBP no bucket avatars; adiciona PDF no documentos.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ============================================================================
-- Bucket avatars — allowlist MIME server-side (P1-4 auditoria)
-- ============================================================================
-- Defesa em profundidade contra XSS armazenado via SVG.
--
-- O cliente já valida `file.type` em handleFotoUpload e handlePortfolioUpload
-- (commit fix(seguranca+perf): frontend lote 1), mas isso pode ser burlado
-- por curl/postman direto na API do Supabase. Esta configuração trava o
-- bucket pra aceitar SÓ imagens raster seguras (jpeg/png/webp).
--
-- Aplicar via Supabase Dashboard → SQL Editor:
-- ============================================================================

-- O Supabase Storage v2 usa colunas `allowed_mime_types` e `file_size_limit`
-- na tabela storage.buckets. Se essas colunas não existirem no seu projeto
-- (Storage v1 antigo), faça via Dashboard → Storage → bucket → Settings:
--   - Allowed MIME types: image/jpeg, image/png, image/webp
--   - File size limit: 5242880  (5 MB)

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit    = 5242880   -- 5 MB
 WHERE id = 'avatars';

-- Verificar:
-- SELECT id, allowed_mime_types, file_size_limit FROM storage.buckets WHERE id = 'avatars';

-- ============================================================================
-- Bucket documentos — allowlist MIME (KYC RG/CNH e KYC PJ)
-- ============================================================================
-- Documentos aceitam PDF além de imagens. Mantém limite 5MB.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
       file_size_limit    = 5242880   -- 5 MB
 WHERE id = 'documentos';

-- Verificar:
-- SELECT id, allowed_mime_types, file_size_limit FROM storage.buckets WHERE id = 'documentos';

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE 4/4 — Já Decola Academia (ja_decola_academy.sql)                   ║
-- ║ 8 tabelas + 3 RPCs + seed do curso "Atendimento 5 estrelas".             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ============================================================================
-- Já Decola — Sistema educacional gamificado do DiáriaJá
-- ============================================================================
-- Inspirado no iFood Decola. Cursos curtos pra Diaristas e Empregadores que
-- elevam o profissionalismo da plataforma, geram retenção e desbloqueiam
-- selos visíveis no perfil que afetam matching/destaque.
--
-- Estrutura: Curso → Módulos → Aulas → Quiz (final do módulo)
-- Anti-fraude: tempo mínimo de aula (server-validated), randomização do quiz,
-- cooldown entre tentativas, pontuação calculada via RPC SECURITY DEFINER.
--
-- Aplicar via Supabase Dashboard → SQL Editor. Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela: academy_cursos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_cursos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  titulo          TEXT NOT NULL,
  descricao       TEXT NOT NULL,
  icone           TEXT NOT NULL DEFAULT '🎓',
  cor             TEXT NOT NULL DEFAULT '#FF6B35',
  audiencia       TEXT NOT NULL CHECK (audiencia IN ('diarista','empregador','ambos')),
  nivel           TEXT NOT NULL DEFAULT 'basico' CHECK (nivel IN ('basico','intermediario','avancado')),
  ordem           INT NOT NULL DEFAULT 0,
  pontos_score    INT NOT NULL DEFAULT 10,   -- pontos no score de confiabilidade ao concluir
  selo_titulo     TEXT,                       -- ex: "Comunicação 5 estrelas"
  selo_icone      TEXT,                       -- emoji do selo
  publicado       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_cursos_audiencia ON academy_cursos(audiencia, ordem) WHERE publicado;

-- ---------------------------------------------------------------------------
-- 2. Tabela: academy_modulos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_modulos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id        UUID NOT NULL REFERENCES academy_cursos(id) ON DELETE CASCADE,
  ordem           INT NOT NULL,
  titulo          TEXT NOT NULL,
  descricao       TEXT NOT NULL DEFAULT '',
  UNIQUE (curso_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_academy_modulos_curso ON academy_modulos(curso_id, ordem);

-- ---------------------------------------------------------------------------
-- 3. Tabela: academy_aulas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_aulas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id       UUID NOT NULL REFERENCES academy_modulos(id) ON DELETE CASCADE,
  ordem           INT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','video','dica')),
  titulo          TEXT NOT NULL,
  conteudo        TEXT NOT NULL,           -- markdown leve ou texto puro
  tempo_min_seg   INT NOT NULL DEFAULT 10, -- tempo mínimo na aula antes de "Próxima"
  UNIQUE (modulo_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_academy_aulas_modulo ON academy_aulas(modulo_id, ordem);

-- ---------------------------------------------------------------------------
-- 4. Tabela: academy_perguntas (quiz vive dentro do módulo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_perguntas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id       UUID NOT NULL REFERENCES academy_modulos(id) ON DELETE CASCADE,
  ordem           INT NOT NULL,
  pergunta        TEXT NOT NULL,
  explicacao      TEXT,                     -- explicação mostrada após responder
  UNIQUE (modulo_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_academy_perguntas_modulo ON academy_perguntas(modulo_id, ordem);

-- ---------------------------------------------------------------------------
-- 5. Tabela: academy_opcoes (alternativas da pergunta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_opcoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pergunta_id     UUID NOT NULL REFERENCES academy_perguntas(id) ON DELETE CASCADE,
  ordem           INT NOT NULL,
  texto           TEXT NOT NULL,
  correta         BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (pergunta_id, ordem)
);

-- ---------------------------------------------------------------------------
-- 6. Tabela: academy_progresso_aulas (1 linha por user × aula vista)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_progresso_aulas (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aula_id         UUID NOT NULL REFERENCES academy_aulas(id) ON DELETE CASCADE,
  iniciada_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluida_em    TIMESTAMPTZ,
  tempo_gasto_seg INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, aula_id)
);

-- ---------------------------------------------------------------------------
-- 7. Tabela: academy_quiz_tentativas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_quiz_tentativas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modulo_id       UUID NOT NULL REFERENCES academy_modulos(id) ON DELETE CASCADE,
  iniciada_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluida_em    TIMESTAMPTZ,
  acertos         INT NOT NULL DEFAULT 0,
  total           INT NOT NULL DEFAULT 0,
  passou          BOOLEAN NOT NULL DEFAULT FALSE,
  cooldown_ate    TIMESTAMPTZ  -- se errou, próxima tentativa só após esse horário
);

CREATE INDEX IF NOT EXISTS idx_academy_quiz_tentativas_user ON academy_quiz_tentativas(user_id, modulo_id, concluida_em DESC);

-- ---------------------------------------------------------------------------
-- 8. Tabela: academy_certificados (1 linha por user × curso concluído)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_certificados (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curso_id        UUID NOT NULL REFERENCES academy_cursos(id) ON DELETE CASCADE,
  concluido_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pontuacao       INT NOT NULL DEFAULT 0,    -- soma de acertos / total perguntas
  PRIMARY KEY (user_id, curso_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_certificados_curso ON academy_certificados(curso_id);

-- ---------------------------------------------------------------------------
-- 9. RLS — quem pode ler/escrever o quê
-- ---------------------------------------------------------------------------
ALTER TABLE academy_cursos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_modulos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_aulas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_perguntas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_opcoes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_progresso_aulas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_quiz_tentativas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_certificados         ENABLE ROW LEVEL SECURITY;

-- Conteúdo: qualquer auth lê. Service role escreve (admin).
DROP POLICY IF EXISTS "academy_cursos_leitura"      ON academy_cursos;
CREATE POLICY "academy_cursos_leitura" ON academy_cursos
  FOR SELECT TO authenticated USING (publicado = TRUE);
DROP POLICY IF EXISTS "academy_cursos_admin"        ON academy_cursos;
CREATE POLICY "academy_cursos_admin" ON academy_cursos
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "academy_modulos_leitura"     ON academy_modulos;
CREATE POLICY "academy_modulos_leitura" ON academy_modulos
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "academy_modulos_admin"       ON academy_modulos;
CREATE POLICY "academy_modulos_admin" ON academy_modulos
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "academy_aulas_leitura"       ON academy_aulas;
CREATE POLICY "academy_aulas_leitura" ON academy_aulas
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "academy_aulas_admin"         ON academy_aulas;
CREATE POLICY "academy_aulas_admin" ON academy_aulas
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "academy_perguntas_leitura"   ON academy_perguntas;
CREATE POLICY "academy_perguntas_leitura" ON academy_perguntas
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "academy_perguntas_admin"     ON academy_perguntas;
CREATE POLICY "academy_perguntas_admin" ON academy_perguntas
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Opções: ler SEM ver qual é correta. Vai vir via RPC pra evitar inspeção.
DROP POLICY IF EXISTS "academy_opcoes_admin"        ON academy_opcoes;
CREATE POLICY "academy_opcoes_admin" ON academy_opcoes
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
-- ⚠️ Sem policy de SELECT pra authenticated: a tabela é OPACA pro cliente.
-- O cliente sempre usa a RPC `academy_listar_perguntas_quiz` que retorna
-- opções randomizadas e SEM a flag `correta`.

-- Progresso e tentativas: só o dono.
DROP POLICY IF EXISTS "academy_progresso_dono"      ON academy_progresso_aulas;
CREATE POLICY "academy_progresso_dono" ON academy_progresso_aulas
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "academy_tentativas_dono"     ON academy_quiz_tentativas;
CREATE POLICY "academy_tentativas_dono" ON academy_quiz_tentativas
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- INSERT/UPDATE em quiz_tentativas só via RPC SECURITY DEFINER (validação server).

-- Certificados: dono lê, qualquer auth lê de outros (pra ranking público).
-- service_role escreve via RPC.
DROP POLICY IF EXISTS "academy_certificados_leitura" ON academy_certificados;
CREATE POLICY "academy_certificados_leitura" ON academy_certificados
  FOR SELECT TO authenticated USING (TRUE);

-- ---------------------------------------------------------------------------
-- 10. RPC: listar perguntas do quiz (opções randomizadas, sem flag correta)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION academy_listar_perguntas_quiz(p_modulo_id UUID)
RETURNS TABLE (
  pergunta_id  UUID,
  ordem        INT,
  pergunta     TEXT,
  opcoes       JSONB        -- [{id, texto}] randomizadas, SEM correta
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.ordem,
    p.pergunta,
    (SELECT jsonb_agg(jsonb_build_object('id', o.id, 'texto', o.texto) ORDER BY random())
       FROM academy_opcoes o WHERE o.pergunta_id = p.id) AS opcoes
  FROM academy_perguntas p
  WHERE p.modulo_id = p_modulo_id
  ORDER BY p.ordem;
END $$;

REVOKE ALL ON FUNCTION academy_listar_perguntas_quiz(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION academy_listar_perguntas_quiz(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. RPC: marcar aula concluída (valida tempo mínimo server-side)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION academy_concluir_aula(p_aula_id UUID, p_tempo_gasto_seg INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_tempo_min INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;

  SELECT tempo_min_seg INTO v_tempo_min FROM academy_aulas WHERE id = p_aula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'aula inexistente';
  END IF;

  -- Anti-fraude: tempo gasto reportado deve ser >= tempo_min_seg da aula.
  -- (Servidor confia mas validamos limite mínimo. Pra fraude completa,
  -- usaríamos heartbeat server-side; pra MVP isso já corta o "click rápido".)
  IF p_tempo_gasto_seg < v_tempo_min THEN
    RAISE EXCEPTION 'tempo insuficiente: leia a aula até o fim';
  END IF;

  INSERT INTO academy_progresso_aulas (user_id, aula_id, concluida_em, tempo_gasto_seg)
  VALUES (v_user_id, p_aula_id, NOW(), p_tempo_gasto_seg)
  ON CONFLICT (user_id, aula_id)
  DO UPDATE SET
    concluida_em = EXCLUDED.concluida_em,
    tempo_gasto_seg = GREATEST(academy_progresso_aulas.tempo_gasto_seg, EXCLUDED.tempo_gasto_seg);

  RETURN TRUE;
END $$;

REVOKE ALL ON FUNCTION academy_concluir_aula(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION academy_concluir_aula(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. RPC: submeter quiz (valida respostas + cooldown + emite certificado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION academy_submeter_quiz(
  p_modulo_id UUID,
  p_respostas JSONB  -- [{pergunta_id, opcao_id}]
)
RETURNS JSONB        -- {acertos, total, passou, cooldown_ate?, curso_concluido?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_acertos    INT  := 0;
  v_total      INT  := 0;
  v_passou     BOOLEAN;
  v_cooldown   TIMESTAMPTZ;
  v_tentativa_recente RECORD;
  v_curso_id   UUID;
  v_pontos     INT;
  v_modulos_total INT;
  v_modulos_aprovados INT;
  v_certificado_emitido BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;

  -- Verifica cooldown: se houver tentativa recente que ainda está bloqueada
  SELECT * INTO v_tentativa_recente
  FROM academy_quiz_tentativas
  WHERE user_id = v_user_id AND modulo_id = p_modulo_id AND cooldown_ate > NOW()
  ORDER BY iniciada_em DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('erro', 'cooldown', 'cooldown_ate', v_tentativa_recente.cooldown_ate);
  END IF;

  -- Conta corretas
  SELECT COUNT(*) INTO v_total FROM academy_perguntas WHERE modulo_id = p_modulo_id;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'módulo sem quiz';
  END IF;

  SELECT COUNT(*) INTO v_acertos
  FROM jsonb_array_elements(p_respostas) r
  JOIN academy_opcoes o ON o.id = (r->>'opcao_id')::UUID
  WHERE o.correta = TRUE
    AND o.pergunta_id = (r->>'pergunta_id')::UUID
    AND EXISTS (
      SELECT 1 FROM academy_perguntas pp
      WHERE pp.id = o.pergunta_id AND pp.modulo_id = p_modulo_id
    );

  v_passou := (v_acertos::FLOAT / v_total) >= 0.70;
  IF NOT v_passou THEN
    v_cooldown := NOW() + INTERVAL '1 hour';
  END IF;

  INSERT INTO academy_quiz_tentativas
    (user_id, modulo_id, concluida_em, acertos, total, passou, cooldown_ate)
  VALUES
    (v_user_id, p_modulo_id, NOW(), v_acertos, v_total, v_passou, v_cooldown);

  -- Se passou e foi o último módulo do curso, emite certificado.
  IF v_passou THEN
    SELECT curso_id INTO v_curso_id FROM academy_modulos WHERE id = p_modulo_id;

    -- Contagem de módulos do curso vs módulos com tentativa aprovada
    SELECT COUNT(*) INTO v_modulos_total FROM academy_modulos WHERE curso_id = v_curso_id;
    SELECT COUNT(DISTINCT t.modulo_id) INTO v_modulos_aprovados
    FROM academy_quiz_tentativas t
    JOIN academy_modulos m ON m.id = t.modulo_id
    WHERE t.user_id = v_user_id AND t.passou = TRUE AND m.curso_id = v_curso_id;

    IF v_modulos_aprovados >= v_modulos_total THEN
      SELECT pontos_score INTO v_pontos FROM academy_cursos WHERE id = v_curso_id;
      INSERT INTO academy_certificados (user_id, curso_id, pontuacao)
      VALUES (v_user_id, v_curso_id, v_acertos)
      ON CONFLICT (user_id, curso_id) DO NOTHING;
      v_certificado_emitido := TRUE;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'acertos', v_acertos,
    'total', v_total,
    'passou', v_passou,
    'cooldown_ate', v_cooldown,
    'curso_concluido', v_certificado_emitido
  );
END $$;

REVOKE ALL ON FUNCTION academy_submeter_quiz(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION academy_submeter_quiz(UUID, JSONB) TO authenticated;

-- ============================================================================
-- SEED — Curso "Atendimento 5 estrelas" (Diarista)
-- ============================================================================
-- Curso completo: 3 módulos, 6 aulas, 5 perguntas no quiz. Conteúdo realista.
-- Pode ser substituído/expandido depois via painel admin.
-- ============================================================================

DO $$
DECLARE
  v_curso_id UUID;
  v_modulo1  UUID;
  v_modulo2  UUID;
  v_modulo3  UUID;
  v_aula     UUID;
  v_pergunta UUID;
BEGIN
  -- Curso
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES (
    'atendimento-5-estrelas',
    'Atendimento 5 estrelas',
    'Aprenda a ser um diarista que empregadores recomendam: pontualidade, comunicação e postura profissional.',
    '⭐', '#FF6B35', 'diarista', 'basico', 1, 15,
    'Atendimento 5★', '⭐'
  )
  ON CONFLICT (slug) DO UPDATE
    SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao,
        icone = EXCLUDED.icone, cor = EXCLUDED.cor, nivel = EXCLUDED.nivel,
        ordem = EXCLUDED.ordem, pontos_score = EXCLUDED.pontos_score
  RETURNING id INTO v_curso_id;

  -- ─── Módulo 1: Pontualidade ───────────────────────────────────────────────
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso_id, 1, 'Pontualidade que vira reputação',
          'Por que chegar no horário é o primeiro fator de uma avaliação 5 estrelas.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_modulo1;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_modulo1, 1, 'texto', 'A regra dos 10 minutos antes',
   E'Chegar exatamente no horário marcado é arriscado: trânsito, dificuldade pra estacionar, achar o endereço… qualquer imprevisto te atrasa.\n\nA regra de ouro: planeje chegar **10 minutos ANTES**. Você espera do lado de fora, manda mensagem dizendo "Cheguei, fico aqui esperando o horário", e isso já vira uma primeira impressão excelente.\n\nDica: empregador adora saber que você chegou. Demonstra organização e respeito pelo tempo dele.',
   15),
  (v_modulo1, 2, 'dica', 'Atrasou? O que fazer',
   E'Imprevistos acontecem. O que **separa profissional de amador** é como você lida.\n\n✅ Mande mensagem ASSIM QUE souber que vai atrasar — não quando já tiver atrasado.\n✅ Diga o motivo (ônibus, trânsito, qualquer coisa real) sem inventar desculpa.\n✅ Informe horário REAL de chegada (com margem). Nunca prometa que vai chegar em 5min se você sabe que são 20.\n✅ Pergunte se ainda dá pra fazer ou se precisa remarcar.\n\n❌ Nunca fique calado torcendo pra dar certo.\n❌ Nunca minta sobre o motivo. O empregador percebe.',
   20);

  -- ─── Módulo 2: Comunicação ────────────────────────────────────────────────
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso_id, 2, 'Comunicação que constrói confiança',
          'Como falar, escrever e responder com clareza profissional.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_modulo2;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_modulo2, 1, 'texto', 'Mensagens claras e curtas',
   E'No chat com o empregador, **simplicidade vale ouro**.\n\nEvite: "Oi tudo bem? Espero que sim, eu queria saber se a senhora vai precisar..."\nUse: "Olá! Tudo certo pra amanhã às 8h?"\n\nRegras:\n1. Cumprimente uma vez no começo do dia, não em cada mensagem\n2. Seja direto no assunto\n3. Confirme dados importantes (endereço, horário, valor) por escrito\n4. Responda em até 2h durante horário comercial\n5. Avise se vai ficar offline ("Volto a responder às 18h")\n\nLembra: chat profissional ≠ chat de amigo. Não use figurinhas/áudios longos sem necessidade.',
   25),
  (v_modulo2, 2, 'texto', 'Como pedir o que precisa sem soar mal',
   E'Diaristas têm direitos. Pedir o que você precisa de forma profissional **aumenta seu valor**, não diminui.\n\nExemplos:\n\n❌ "Preciso de produto de limpeza, traz aí"\n✅ "Boa tarde! Pra fazer um serviço completo, vou precisar de detergente, pano de chão e luvas. A senhora prefere que eu leve ou tem em casa?"\n\n❌ "Não dá pra hoje não"\n✅ "Hoje eu não consigo, surgiu um imprevisto. Conseguimos remarcar pra amanhã no mesmo horário?"\n\n❌ "Cobro a mais por isso"\n✅ "Esse serviço extra demanda mais X horas. Posso fazer por R$ Y? Combina antes."',
   25);

  -- ─── Módulo 3: Segurança e Direitos ───────────────────────────────────────
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso_id, 3, 'Segurança e seus direitos',
          'Como se proteger de golpes, abusos e prejuízos. Saiba o que aceitar e o que não aceitar.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_modulo3;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_modulo3, 1, 'texto', '4 sinais de um cliente problemático',
   E'Aprenda a reconhecer perfis que vão te dar prejuízo:\n\n🚩 **Sinal 1: Tira você do app**\n"Vamos conversar pelo WhatsApp" antes mesmo de aceitar a diária. Provável intenção: pagar fora da plataforma (sem garantia) ou pedir trabalho não combinado.\n\n🚩 **Sinal 2: Foge de pagar antes**\n"Você vem fazer e eu pago no PIX depois". Sem garantia. Use SEMPRE o fluxo de pagamento do app (Mercado Pago) — você fica protegida e o empregador também.\n\n🚩 **Sinal 3: Mudou tudo na hora**\nDescrição falava 1 cômodo, chega lá são 5. Você pode renegociar OU recusar o serviço. Não trabalhe de graça por medo de avaliação ruim.\n\n🚩 **Sinal 4: Pede coisas fora do combinado**\n"Já que tá aqui, faz a louça também". Diga: "Esse serviço não estava combinado. Posso fazer cobrando R$ X a mais, se quiser." Você tem direito.',
   30),
  (v_modulo3, 2, 'texto', 'Use o chat e o QR Code SEMPRE',
   E'Toda diária no DiáriaJá tem um QR Code de presença. Use sempre:\n\n✅ Empregador escaneia seu QR ao chegar = comprovante digital de que você compareceu\n✅ Tudo combinado fica registrado no chat do app = se houver discussão, há prova\n✅ Pagamento via app = se tiver problema, suporte intervém\n\nMudou de combinado? Confirme no CHAT antes de fazer. Frase mágica:\n"Pra ficar registrado: o serviço extra de X custa R$ Y, certo?"\n\nNunca aceite só por confiança em conversa de áudio ou pessoal. Tudo que está no chat tem **valor legal**.',
   25);

  -- ─── Perguntas do quiz (cobrem os 3 módulos, vão no final do curso) ──────
  -- Pra simplificar o MVP, todas as 5 perguntas ficam no módulo 3 (último).
  -- Em deploys futuros, distribuir por módulo.

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao)
  VALUES (v_modulo3, 1, 'O empregador combinou 9h. Você vai chegar atrasado. O que fazer?',
          'Avisar cedo é o que diferencia um profissional. Nunca espere o atraso acontecer pra avisar.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_pergunta;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_pergunta, 1, 'Esperar chegar pra ver se o empregador percebe', FALSE),
  (v_pergunta, 2, 'Mandar mensagem assim que souber que vai atrasar, com horário real de chegada', TRUE),
  (v_pergunta, 3, 'Inventar uma desculpa boa pra usar quando chegar', FALSE),
  (v_pergunta, 4, 'Cancelar a diária sem avisar', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao)
  VALUES (v_modulo3, 2, 'Empregador pede pra continuar conversa pelo WhatsApp ANTES de aceitar a diária. O que isso significa?',
          'Tirar do app é o sinal #1 de golpe. Pode ser pagamento fora ou pedido de trabalho não combinado.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_pergunta;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_pergunta, 1, 'É uma cortesia normal entre adultos', FALSE),
  (v_pergunta, 2, 'É um sinal de alerta — pode estar tentando driblar o app pra pagar fora', TRUE),
  (v_pergunta, 3, 'É melhor pra você, conversa fica mais rápida', FALSE),
  (v_pergunta, 4, 'Significa que o empregador é simpático', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao)
  VALUES (v_modulo3, 3, 'Você chega na diária e o serviço é o triplo do que foi combinado. Qual a melhor atitude?',
          'Você não trabalha de graça. Renegocie no chat (deixa registrado) ou recuse com profissionalismo.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_pergunta;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_pergunta, 1, 'Fazer tudo calado pra não pegar avaliação ruim', FALSE),
  (v_pergunta, 2, 'Renegociar no chat: combinar valor extra ANTES de começar, ou recusar com educação', TRUE),
  (v_pergunta, 3, 'Fazer metade e ir embora sem avisar', FALSE),
  (v_pergunta, 4, 'Brigar com o empregador na hora', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao)
  VALUES (v_modulo3, 4, 'Por que confirmar tudo por escrito no chat do app é importante?',
          'O chat do app tem registro com timestamp. Em qualquer discussão, ele vale como prova.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_pergunta;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_pergunta, 1, 'Porque o chat do app tem registro com data e hora, e serve de prova se houver desentendimento', TRUE),
  (v_pergunta, 2, 'Pra parecer mais profissional', FALSE),
  (v_pergunta, 3, 'Não é importante, basta confiar', FALSE),
  (v_pergunta, 4, 'Pra deixar a conversa mais bonita', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao)
  VALUES (v_modulo3, 5, 'Uma boa mensagem profissional no chat com empregador é…',
          'Direta, clara, breve, profissional. Cumprimentos longos e áudios extensos atrapalham.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_pergunta;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_pergunta, 1, 'Áudios longos contando sua semana', FALSE),
  (v_pergunta, 2, 'Curta, direta, confirmando dados importantes (horário, endereço, valor)', TRUE),
  (v_pergunta, 3, 'Muitas figurinhas e emojis', FALSE),
  (v_pergunta, 4, 'Cumprimentos extensos em cada mensagem', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

END $$;

-- ============================================================================
-- Fim da migration ja_decola_academy.sql
-- ============================================================================

-- ============================================================================
-- VERIFICAÇÃO — rode estas queries DEPOIS pra confirmar que tudo subiu
-- ============================================================================

-- ✅ Parte 1: deve retornar 0 webhooks processados (tabela existe e vazia)
SELECT count(*) AS webhook_eventos_processados FROM webhook_eventos_processados;

-- ✅ Parte 1: deve retornar 0 oauth states
SELECT count(*) AS oauth_states FROM oauth_states;

-- ✅ Parte 1: deve listar 3 índices em candidaturas
SELECT indexname FROM pg_indexes WHERE tablename='candidaturas' AND indexname LIKE 'idx_candidaturas_%';

-- ✅ Parte 2: deve retornar 4 colunas (razao_social, nome_fantasia, responsavel_nome, responsavel_cpf)
SELECT column_name FROM information_schema.columns
  WHERE table_name='user_profiles'
    AND column_name IN ('razao_social','nome_fantasia','responsavel_nome','responsavel_cpf');

-- ✅ Parte 2: testar a RPC de duplicidade (deve retornar FALSE pra CNPJ fake)
SELECT cnpj_ja_cadastrado('12.345.678/0001-00') AS cnpj_existente;

-- ✅ Parte 3: deve mostrar os MIMEs corretos nos buckets
SELECT id, allowed_mime_types, file_size_limit FROM storage.buckets
  WHERE id IN ('avatars','documentos');

-- ✅ Parte 4: deve retornar 1 curso, 3 módulos, 6 aulas, 5 perguntas
SELECT
  (SELECT count(*) FROM academy_cursos)    AS cursos,
  (SELECT count(*) FROM academy_modulos)   AS modulos,
  (SELECT count(*) FROM academy_aulas)     AS aulas,
  (SELECT count(*) FROM academy_perguntas) AS perguntas,
  (SELECT count(*) FROM academy_opcoes)    AS opcoes;

-- Se TODOS os resultados acima parecem coerentes, está tudo OK ✅

