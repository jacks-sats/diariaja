# Auditoria — Banco, RPCs e Migrations

**Data:** 2026-05-28
**Escopo:** `src/App.tsx`, `supabase/functions/*/index.ts`, `supabase/migrations/*.sql`
**Modo:** análise estática (sem rodar contra Supabase).

> ⚠️ Notas de contexto: o schema real de produção **não** tem `user_profiles.created_at`
> (descoberta interna 2026-05-28). A view `rebrand_juridico_fase1_views.sql` já tomou
> conhecimento disso e omitiu a coluna — mas há **outras 4 funções/queries** que ainda
> assumem essa coluna. Os achados desse tipo estão sinalizados 🔴 abaixo.

---

## Sumário quantitativo

| Métrica                                       | Valor |
| --------------------------------------------- | ----: |
| RPCs distintas chamadas em `App.tsx`          |    19 |
| RPCs distintas definidas em migrations        |    25 |
| RPCs chamadas no client SEM definição válida  |     0 |
| RPCs com mismatch de assinatura/args          |     0 |
| Tabelas/views distintas chamadas em `App.tsx` |    17 |
| Tabelas referenciadas e NÃO criadas explicitamente em migrations | 6 (legacy — confiamos no schema vivo) |
| Edge functions que tocam Supabase             |     8 |
| Inconsistências de coluna críticas (🔴)       |     4 |
| Inconsistências altas (🟠)                    |     8 |
| Inconsistências médias (🟡)                   |     7 |

---

## 1. RPCs no client vs migrations

| RPC (chamada)                          | App.tsx (linha) | Migration definitiva                                                       | Args batem? | OK? |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------- | ----------- | --- |
| `contar_contatos_desbloqueados_mes`    | 1911, 2041      | `contatos_desbloqueios.sql:58`, `_APLICAR_TUDO_PENDENTE.sql:369`           | ✅ sem args  | ✅   |
| `aceitar_termos(p_versao TEXT)`        | 1962, 2438      | `auditoria_final_fixes.sql:78`                                             | ✅            | ⚠️ ver A-2  |
| `contar_diarias_concluidas_diarista`   | 2053            | `monetizacao_dual_track.sql:161`                                           | ✅            | ✅   |
| `academy_concluir_aula(p_aula_id, p_tempo_gasto_seg)` | 2304 | `ja_decola_academy.sql:240`, `_PENDENTES_SUPABASE.sql:609`             | ✅            | ✅   |
| `academy_listar_perguntas_quiz(p_modulo_id)` | 2327      | `ja_decola_academy.sql:206`, `_PENDENTES_SUPABASE.sql:575`                | ✅            | ✅   |
| `academy_submeter_quiz(p_modulo_id, p_respostas)` | 2343 | `ja_decola_academy.sql:282`, `_PENDENTES_SUPABASE.sql:651`                  | ✅            | ✅   |
| `criar_oauth_state(p_provider)`        | 2500            | `auditoria_26_05_fixes.sql:81`, `_PENDENTES_SUPABASE.sql:106`              | ✅            | ✅   |
| `admin_stats()`                        | 2895            | `painel_admin.sql:171`                                                      | ✅            | ✅   |
| `admin_metricas_extras()`              | 2899            | `admin_metricas_avancadas.sql:216`                                          | ✅            | 🟠 A-3 |
| `admin_metricas_serie(p_metrica, p_dias)` | 2900, 2901   | `admin_metricas_avancadas.sql:38`                                           | ✅            | ✅   |
| `admin_drill_lista(p_tipo, p_limit)`   | 2917            | `admin_metricas_avancadas.sql:84`                                           | ✅            | 🔴 C-1 |
| `promover_suporte(alvo_user_id, ativar)` | 3123          | `equipe_suporte_role.sql:108`                                               | ✅            | 🔴 C-2 |
| `admin_documentos_pendentes()`         | 3271            | `kyc_documentos.sql:134`                                                    | ✅            | ✅   |
| `revisar_documento(p_user_id, p_decisao, p_motivo)` | 3311 | `kyc_documentos.sql:82`, `seguranca_hardening.sql:91`                      | ✅            | 🟠 A-4 |
| `admin_antecedentes_pendentes()`       | 3339            | `antecedentes_criminais.sql:151`                                            | ✅            | ✅   |
| `revisar_antecedentes(p_user_id, p_decisao, p_motivo)` | 3361 | `antecedentes_criminais.sql:109`, `seguranca_hardening.sql:120`         | ✅            | 🟠 A-4 |
| `pode_selecionar_candidato(p_diaria_id)` | 3774          | `monetizacao_dual_track.sql:203`                                            | ✅            | ✅   |
| `cnpj_ja_cadastrado(p_cnpj)`           | 4246            | `cadastro_pj_completo.sql:45`, `_PENDENTES_SUPABASE.sql:290`                | ✅            | ✅   |
| `confirmar_telefone_verificado(p_telefone)` | 6176       | `auditoria_final_fixes.sql:20`                                              | ✅            | ✅   |

### RPCs em Edge Functions

| RPC                  | Função              | Linha | OK? |
| -------------------- | ------------------- | ----: | --- |
| `check_rate_limit(p_key, p_max, p_window_seconds)` | `_shared/rate-limit.ts` | 48 | ✅ (matches `rate_limits.sql:40`) |
| `check_rate_limit`   | `create-payment/index.ts` | 25 | ✅ |
| `check_rate_limit`   | `create-contact-payment/index.ts` | 27 | ✅ |
| `check_rate_limit` / `pode_selecionar_candidato` | `mp-health-check/index.ts` | 270, 271 | ✅ |

**Conclusão RPCs:** todas as chamadas batem com as definições. **Os problemas estão nas
queries que as RPCs fazem internamente** (ver achados 🔴 C-1, C-2 abaixo).

---

## 2. Tabela: `from()` no client vs schema

### App.tsx — resumo por tabela

| Tabela.Coluna referenciada           | Linha   | Existe no schema? | Nota                                    |
| ------------------------------------ | ------- | ----------------- | --------------------------------------- |
| `analytics_eventos.user_id`          | 84      | ✅                 | RLS atualizada exige `user_id = auth.uid()` — `trackEvento` passa `null` quando sem sessão → INSERT falha silencioso (silenciado por try/catch) — ver M-7 |
| `assinaturas.user_id, status`        | 830, 2050 | ✅              | OK |
| `candidaturas.diaria_id, status, diarista_id` | 925, 1080, 2737… | ✅       | OK |
| `user_profiles.id, *`                | 929, 1028, 1458… | ✅       | OK |
| `feedback_vaga_expirada` (insert)    | 948     | ✅ (`vagas_expiradas_feedback.sql:23`) | OK |
| `feedback_pos_conclusao` (insert)    | 972     | ✅ (`vagas_expiradas_feedback.sql:53`) | OK |
| `avaliacoes_empregador` (insert)     | 1192, 2635 | ✅ (legacy, schema vivo) | Vide A-5 (delete-user usa colunas erradas) |
| `mensagens.lida_em` (update)         | 1811    | ✅ (`chat_v2_read_receipts.sql:11`) | OK |
| `user_profiles` (upsert full)        | 1990, 2130 | ✅              | upsert ataca o trigger anti-escalada — A-1 |
| `usuarios_bloqueados.alvo_id, bloqueador_id` | 2057, 3733, 3757 | ✅ (`seguranca_hardening.sql:153`) | OK |
| `denuncias` (insert: denunciante_id, tipo, alvo_id, alvo_nome, motivo) | 2771 | ✅ | OK |
| `nao_interesse.diarista_id, diaria_id` | 2795  | ✅ (`nao_interesse.sql:5`) | OK |
| `convites` (select + insert)         | 2823, 2828, 2846 | ✅ (`convites.sql:4`) | Schema usa `contratante_id` (ver A-6 — edge function diverge) |
| `suporte_respostas` (insert)         | 2991, 3023 | ✅ (`painel_admin.sql:46`) | OK |
| `topicos`, `comentarios_comunidade`  | 3388, 3395… | ✅ (`comunidade.sql:5`) | OK |
| `diarias` (delete, update, select)   | 1746, 2745, 3495, 4052 | ✅      | INSERT em 4052 usa `diarias.bairro`, `tipo_oferta`, `tempo_estimado_min`, `tipo_preco`, `valor_encostada`, `valor_por_entrega`, `ganho_estimado_dia` — todas adicionadas via ALTER TABLE em diferentes migrations. Se a migration `tipo_oferta_diaria_vs_servico.sql` **não** rodou, INSERT com `tipo_oferta` falha. M-1. |
| `avaliacoes_diarista.diarista_id, empregador_id, diaria_id, nota, comentario` | 2655, 3555 | ✅ legacy | OK |
| `diarias_dislikes` (view)            | ~      | ✅ (`nao_interesse.sql:21`) | View sem `security_invoker` → roda como dono. OK por design (não expõe PII). |

### Edge Functions — cross-check

#### 🔴 `supabase/functions/export-user-data/index.ts:91`

```ts
supabase.from("convites").select("*").eq("empregador_id", uid),
```

Coluna correta na tabela convites é `contratante_id` (`supabase/migrations/convites.sql:6`).
Nenhuma migration renomeia. **Query retorna sempre 0 rows** ou 400 dependendo do PostgREST.

Veja achado **🔴 C-3**.

#### 🔴 `supabase/functions/delete-user/index.ts:67-68`

```ts
.from("avaliacoes_diarista").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
.from("avaliacoes_empregador").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
```

As tabelas `avaliacoes_diarista` e `avaliacoes_empregador` usam colunas
`diarista_id` e `empregador_id` (confirmado em `reputacao_empregador.sql:23`,
`avaliacoes_diarista.eq("diarista_id", ...)` em App.tsx:3555). `avaliado_id`
e `avaliador_id` não existem.

Resultado: na exclusão LGPD da conta, **avaliações não são apagadas**.
Achado **🔴 C-4**.

#### 🔴 `supabase/functions/delete-user/index.ts:74`

```ts
.from("denuncias").delete().or(`denunciante_id.eq.${userId},denunciado_id.eq.${userId}`)
```

`denuncias` não tem `denunciado_id` — usa `alvo_id` (`denuncias.sql:8`,
App.tsx:2771). Linha falha mas é silenciada pelo `.then(undefined, ()=>{})`.

Resultado: denúncias do user ficam órfãs após delete. Achado **🟠 A-5**.

#### 🟠 `supabase/functions/delete-user/index.ts:71`

```ts
.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId},empregador_id.eq.${userId}`)
```

O `empregador_id` no `or` é fictício, mas o `.then(undefined, () => {})` engole o erro.
Tecnicamente PostgREST aceita a string e tenta `empregador_id=eq.${userId}` → 400.
A consulta inteira falha (lado `OR` com coluna inexistente quebra a query toda),
então `contratante_id` e `diarista_id` *também* não são processadas.
**Convites do user não são apagados**. Achado **🔴 C-3**.

#### 🟡 `supabase/functions/delete-user/index.ts:`

Não apaga: `usuarios_bloqueados` (qualquer ponta), `kyc_acessos_log` (target_user_id),
`oauth_states` (user_id), `webhook_eventos_processados` (não tem user_id, ok),
`contatos_desbloqueios` (empregador_id), `rate_limits` (não tem user_id), e
view não-existente `score_events` é tratada (já criada em
`auditoria_final_fixes.sql:50`). LGPD pede expurgo completo — falta limpar
`usuarios_bloqueados`, `oauth_states`, `kyc_acessos_log`,
`contatos_desbloqueios`. Achado **M-2**.

---

## 3. Achados por severidade

### 🔴 Críticos

#### C-1. `admin_drill_lista` lê `user_profiles.created_at` (não existe em prod)

**Arquivo:** `supabase/migrations/admin_metricas_avancadas.sql:115,117,137,164`
(e duplicado em `_APLICAR_TUDO_PENDENTE.sql:137,139,200,203`).

Os blocos `WHEN p_tipo = 'usuarios_total'` e `WHEN p_tipo = 'diarias_ativas'`
fazem `SELECT up.created_at`/`di.created_at` e `ORDER BY ... created_at`.
**`user_profiles.created_at` não existe em produção.**

Em produção a RPC vai retornar:

```
ERROR: column up.created_at does not exist
LINE …: up.created_at
        ^
```

Disparada quando admin abre o painel **e clica em qualquer card que dispara
`p_tipo='usuarios_total'`**. Quebra a UI do admin nesse drill.

`diarias.created_at` existe e está OK — só o `up.created_at` é a falha.

**Fix proposto:**

```sql
-- Substituir em admin_drill_lista, branches 'usuarios_total':
--   up.created_at   →   (SELECT au.created_at FROM auth.users au WHERE au.id = up.id)
-- Ou:
--   ORDER BY up.last_activity_at DESC NULLS LAST  -- proxy aceitável

CREATE OR REPLACE FUNCTION admin_drill_lista(p_tipo TEXT, p_limit INT DEFAULT 30)
RETURNS TABLE (id TEXT, titulo TEXT, subtitulo TEXT, badge TEXT, badge_cor TEXT, criado_em TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin_caller();
  IF p_tipo = 'usuarios_total' THEN
    RETURN QUERY
    SELECT up.id::TEXT, COALESCE(up.nome, 'Sem nome')::TEXT,
           (COALESCE(up.user_type, 'sem tipo') ||
            CASE WHEN up.cpf IS NOT NULL OR up.cnpj IS NOT NULL THEN ' · doc ok' ELSE '' END)::TEXT,
           CASE WHEN up.documento_status='aprovado' THEN 'KYC ✓' WHEN up.documento_status='enviado' THEN 'em análise' ELSE COALESCE(up.user_type,'—') END::TEXT,
           CASE WHEN up.documento_status='aprovado' THEN '#16a34a' WHEN up.documento_status='enviado' THEN '#f59e0b' ELSE '#3A86FF' END::TEXT,
           au.created_at                       -- ← lê de auth.users
      FROM user_profiles up
      LEFT JOIN auth.users au ON au.id = up.id
     ORDER BY au.created_at DESC NULLS LAST
     LIMIT p_limit;
  -- … resto inalterado …
  END IF;
END $$;
```

#### C-2. `promover_suporte` faz `UPDATE user_profiles SET updated_at = NOW()` (coluna não existe)

**Arquivo:** `supabase/migrations/equipe_suporte_role.sql:130-133`

```sql
UPDATE user_profiles
  SET is_suporte = ativar,
      updated_at = NOW()                 -- ← user_profiles não tem updated_at
  WHERE id = alvo_user_id;
```

`user_profiles.updated_at` **não foi adicionado em nenhuma migration**.
Tabelas que têm `updated_at`: `assinaturas` (`fix_assinaturas_status_constraint.sql:13`),
`suporte_tickets`, `academy_cursos`, `push_subscriptions`. **`user_profiles` não.**

Em produção a chamada `supabase.rpc("promover_suporte", ...)` falha com:

```
ERROR: column "updated_at" of relation "user_profiles" does not exist
```

UI: botão "Promover a Suporte" no painel admin não funciona, mostra toast com a mensagem do Postgres.

**Fix proposto:**

```sql
-- Opção A (preferida, idempotente): adicionar a coluna
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- + trigger pra manter atualizada (BEFORE UPDATE SET updated_at = NOW())

-- Opção B (mínimo invasivo): remover o SET updated_at da RPC
CREATE OR REPLACE FUNCTION promover_suporte(alvo_user_id UUID, ativar BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_caller_admin BOOLEAN;
BEGIN
  SELECT COALESCE(is_admin, FALSE) INTO is_caller_admin
    FROM user_profiles WHERE id = auth.uid();
  IF NOT COALESCE(is_caller_admin, FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar a equipe de suporte';
  END IF;
  IF alvo_user_id = auth.uid() AND ativar = FALSE THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio acesso de suporte por aqui';
  END IF;
  UPDATE user_profiles SET is_suporte = ativar WHERE id = alvo_user_id;
  RETURN FOUND;
END $$;
```

Recomendo **A** porque várias outras queries esperam timestamps; ter `updated_at` em
`user_profiles` é o padrão das outras tabelas.

#### C-3. `export-user-data` + `delete-user` usam `convites.empregador_id`/`convites.diarista_id` mas convites tem `contratante_id`

**Arquivos:**
- `supabase/functions/export-user-data/index.ts:91`
- `supabase/functions/delete-user/index.ts:71`

Schema real (`convites.sql:6`):

```sql
contratante_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
diarista_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
```

`empregador_id` **não existe**. PostgREST retorna 400/42703.

**Impacto:**
- LGPD: exportação de dados não inclui convites enviados (Art. 18 V).
- LGPD: exclusão de conta deixa convites do usuário no banco (Art. 18 VI).
  Como `contratante_id` está com `ON DELETE CASCADE`, o cascade do `auth.users`
  vai limpar — então o efeito real é só na export.

**Fix:**

```diff
- supabase.from("convites").select("*").eq("empregador_id", uid),
+ supabase.from("convites").select("*").eq("contratante_id", uid),
```

```diff
- await supabaseAdmin.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId},empregador_id.eq.${userId}`).then(undefined as any, () => {});
+ await supabaseAdmin.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId}`).then(undefined as any, () => {});
```

#### C-4. `delete-user` apaga avaliações usando colunas inexistentes (`avaliado_id`, `avaliador_id`)

**Arquivo:** `supabase/functions/delete-user/index.ts:67-68`

Schema real (`reputacao_empregador.sql:23`, App.tsx:1192,2635,2655,3555):
- `avaliacoes_empregador`: `empregador_id`, `diarista_id`, `diaria_id`
- `avaliacoes_diarista`: `empregador_id`, `diarista_id`, `diaria_id`

Erro PostgREST silenciado por `.then(undefined as any, () => {})`.

**Impacto LGPD:** ao excluir conta, **as avaliações ficam no banco** com
`diarista_id`/`empregador_id` apontando para um usuário que não existe mais
no `auth.users`. Como as FKs são `ON DELETE SET NULL` ou `CASCADE` (depende
da migration original — esse schema não está checkado), pode ser que sobrevivam
com NULL na FK do user excluído.

**Fix:**

```ts
// avaliações que ESSE user fez (a remover na exclusão):
await supabaseAdmin.from("avaliacoes_empregador")
  .delete().eq("diarista_id", userId);   // diarista avaliou o empregador → autor = diarista_id
await supabaseAdmin.from("avaliacoes_diarista")
  .delete().eq("empregador_id", userId); // empregador avaliou o diarista → autor = empregador_id

// avaliações RECEBIDAS pelo user permanecem (são propriedade do avaliador,
// não do avaliado). Decisão LGPD: pode ser revista, mas remover quebra
// reputação histórica de outros usuários.
```

---

### 🟠 Altos

#### A-1. Trigger anti-escalada bloqueia UPDATE direto via REST mesmo em colunas legítimas

**Arquivo:** `supabase/migrations/hotfix_protect_trigger_columns.sql:63-65`

```sql
IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
  RAISE EXCEPTION 'documento_status só via revisão KYC do admin';
END IF;
```

Sem carve-out pro user enviar (`nao_enviado → enviado`). Migrations *posteriores*
(`kyc_documentos.sql:21`, `antecedentes_criminais.sql:42`) já fizeram esse carve-out,
**mas** `hotfix_protect_trigger_columns.sql` é tipicamente o último a rodar (porque é
chamado "hotfix"). Como `CREATE OR REPLACE FUNCTION` sobrescreve, **a versão final
em produção depende da ORDEM de execução manual**.

Se o admin tiver rodado o hotfix por último → user comum não consegue subir documento.

**Como verificar em prod:**

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'protect_user_profile_privileged_columns';
```

Procurar pela string `'enviado'` — se NÃO estiver lá, é a versão sem carve-out.

**Fix:** consolidar em **uma** migration que seja a versão definitiva (com carve-outs
para `documento_status` e `antecedentes_status`). Recomendo descrever explicitamente
a ordem no README de migrations, ou criar `protect_user_profile_FINAL.sql` que é o
último a rodar.

#### A-2. `aceitar_termos` faz INSERT em user_profiles com colunas mínimas

**Arquivo:** `auditoria_final_fixes.sql:88-92`

```sql
INSERT INTO user_profiles (id, termos_aceitos_em, termos_versao)
VALUES (v_caller, NOW(), p_versao)
ON CONFLICT (id) DO UPDATE …
```

Se o schema vivo em prod tem colunas NOT NULL sem default (ex.: `user_type`,
`nome`), esse INSERT falha. Como a RPC é chamada via try/catch no client
(linha 2438), o erro é silenciado, mas o registro de aceite **nunca é gravado**.

**Quando ocorre:** primeiro login após signup (sem perfil ainda criado).
**Sintoma:** modal de termos reabre toda sessão.

**Fix:** verificar se há colunas NOT NULL em user_profiles que não tenham
default. Se sim, ou adicionar default ou só fazer UPDATE quando o perfil
já existir (`UPSERT` falha; `UPDATE … RETURNING …` + se 0 rows não insere).

```sql
-- Opção: só registrar aceite se o perfil JÁ existir.
-- Quem ainda não tem perfil aceita no fluxo de setup-* (que faz UPSERT completo).
CREATE OR REPLACE FUNCTION aceitar_termos(p_versao TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  UPDATE user_profiles
     SET termos_aceitos_em = COALESCE(termos_aceitos_em, NOW()),
         termos_versao     = COALESCE(termos_versao, p_versao)
   WHERE id = v_caller;
  -- Se 0 rows, perfil não existe ainda — ok, será criado em setup com aceite.
END $$;
```

#### A-3. `admin_metricas_extras` `EXCEPTION WHEN undefined_table` engole TODAS as queries de user_profiles também

**Arquivo:** `admin_metricas_avancadas.sql:265-278`

```sql
EXCEPTION WHEN undefined_table THEN
  RETURN QUERY SELECT
    (SELECT COUNT(*)::INT FROM user_profiles WHERE user_type = 'diarista'),
    -- … 3 outros COUNTs em user_profiles …
    0, 0, 0::NUMERIC, 0;
```

Se UMA das tabelas finais (`academy_certificados`, `candidaturas`,
`avaliacoes_diarista`, `assinaturas`) faltar, o bloco volta os 4 contadores
de `user_profiles` **com sucesso**, mas substitui os 4 últimos por zero.

**Se** a tabela inexistente for `user_profiles` (cenário improvável mas
defensivo), o EXCEPTION reexecuta a query e RE-LANÇA o mesmo erro — loop ou crash.

Achado leve, mas o EXCEPTION mascarando ajuda zero diagnóstico se algo der errado.

**Fix:** usar checks individuais via `to_regclass` em vez de exception handler:

```sql
CASE WHEN to_regclass('public.candidaturas') IS NULL THEN 0
     ELSE (SELECT COUNT(*)::INT FROM candidaturas) END
```

#### A-4. `revisar_documento` e `revisar_antecedentes` (SECURITY DEFINER) batem no trigger anti-escalada

**Arquivos:**
- `seguranca_hardening.sql:91` (revisar_documento)
- `seguranca_hardening.sql:120`, `antecedentes_criminais.sql:109` (revisar_antecedentes)

Essas RPCs são `SECURITY DEFINER`, mas o trigger
`protect_user_profile_privileged_columns` checa
`current_setting('request.jwt.claim.role') = 'service_role'`. **SECURITY DEFINER
não muda o role do JWT** — quando admin chama via JWT 'authenticated', a RPC
roda com permissão do owner, mas o trigger ainda vê 'authenticated' e BLOQUEIA
o UPDATE em `documento_revisado_em` / `antecedentes_revisado_em` /
`documento_status` / `antecedentes_status`.

**Resultado em prod:**

```
ERROR: documento_status só via revisão KYC do admin
```

Quando admin clica em "Aprovar/Rejeitar" no painel KYC.

**Como mitigar de fato:** ou o trigger precisa detectar "está sendo chamado de
dentro de uma RPC SECURITY DEFINER" (não é trivial em pg), ou o trigger
precisa ser DROP→re-CREATE temporariamente dentro da RPC, ou usar:

```sql
-- Dentro da RPC, antes do UPDATE:
SET LOCAL session_replication_role = 'replica';
-- Triggers de regra "origin" não disparam em replica.
UPDATE user_profiles SET …;
SET LOCAL session_replication_role = 'origin';
```

**Verificar se está acontecendo agora:** pedir pro admin abrir o painel KYC e
clicar em Aprovar/Rejeitar. Se o toast mostrar "documento_status só via revisão…",
é o trigger.

**Alternativa cirúrgica (recomendada):** adicionar uma exception no trigger
quando o admin é o caller:

```sql
-- No trigger, antes dos checks de documento_status / antecedentes_status:
IF EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
  RETURN NEW;   -- admin pode tudo (a RPC já validou)
END IF;
```

> ⚠️ Observação: o trigger `kyc_documentos.sql:21` checa
> `v_role = 'service_role'` e a RPC `revisar_documento` é SECURITY DEFINER mas
> NÃO troca o role. Esse mesmo bug existe nas 3 versões do trigger.

#### A-5. `delete-user` deixa denúncias do usuário no banco

**Arquivo:** `supabase/functions/delete-user/index.ts:74`

Tenta `denunciado_id` que não existe (a tabela usa `alvo_id TEXT`).
Linha é silenciada por `.then(undefined as any, () => {})`.

LGPD: denúncias feitas pelo usuário sobrevivem; denúncias contra ele
permanecem (alvo_id apontando pra `user_profiles.id` que não existe mais).

**Fix:**

```ts
await supabaseAdmin.from("denuncias").delete()
  .or(`denunciante_id.eq.${userId},alvo_id.eq.${userId}`)
  .then(undefined as any, () => {});
```

#### A-6. RLS de `analytics_eventos` exige `user_id = auth.uid()` mas `trackEvento` passa `null`

**Arquivo:** `_PENDENTES_SUPABASE.sql:196` (vs `analytics_eventos.sql:22-24` antigo)

```sql
-- Antiga:
WITH CHECK (user_id = auth.uid() or user_id is null)
-- Nova:
WITH CHECK (user_id = auth.uid())
```

`App.tsx:84` faz `user_id: userId ?? null`. Sem sessão, `userId` é undefined →
`null` → bloqueado pela policy nova. **Tudo silenciado pelo try/catch**.

**Impacto:** eventos de pré-login (ex.: `login_sucesso` chamado com `loginData?.user?.id`
que está disponível, ok; mas qualquer track de tela pública vira lacuna nos
dados de analytics).

**Fix:** o ideal é tornar `user_id` opcional via policy `OR user_id IS NULL`
mas com `WITH CHECK ((user_id = auth.uid()) OR (user_id IS NULL AND auth.uid() IS NULL))`
para evitar forjar eventos atribuídos a outros. Ou simplesmente não chamar
`trackEvento` quando não há `userId`.

#### A-7. Views da rebrand jurídica **sem `security_invoker`** — bypassam RLS

**Arquivo:** `rebrand_juridico_fase1_views.sql:24,61,79,103`

Views `anuncios`, `interesses`, `conexoes_diretas`, `usuarios_publicos`
são criadas com `CREATE OR REPLACE VIEW` simples. **No PostgreSQL ≤14 e padrão
no 15+, views rodam como o OWNER, bypassando RLS das tabelas-fonte.**

Hoje **nenhum código no projeto usa essas views** (confirmado por
`grep -rn "from(\"anuncios\|from(\"interesses\|from(\"conexoes_diretas\|from(\"usuarios_publicos\"")` = vazio),
mas se um dia o frontend migrar pra elas, a RLS pode ser silenciosamente
furada.

**Fix (preventivo):**

```sql
ALTER VIEW anuncios          SET (security_invoker = true);
ALTER VIEW interesses        SET (security_invoker = true);
ALTER VIEW conexoes_diretas  SET (security_invoker = true);
ALTER VIEW usuarios_publicos SET (security_invoker = true);
```

(Requer Postgres ≥ 15, que Supabase usa.)

#### A-8. `assinaturas` user_type CHECK rejeita `'ambos'` mas user_profiles aceita

**Arquivo:** `monetizacao_dual_track.sql:124-126`

```sql
ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_user_type_check
  CHECK (user_type IN ('empregador', 'diarista'));
```

Combinado com:

- `create-subscription/index.ts:218`: passa `user_type` direto do request body.

Se o client mandar `user_type = 'ambos'` (acontece — vide cadastro_pj), o
UPSERT falha com 23514. A função Edge retorna 200 com `dbErr` logado,
**mas o checkout do MP já foi criado**. Resultado: usuário paga, mas
`assinaturas` fica sem linha → webhook não consegue casar via `mp_subscription_id`
(porque a linha não existe).

**Fix:** validar no Edge antes do upsert:

```ts
if (!["empregador","diarista"].includes(user_type)) {
  return json({ error: "user_type deve ser empregador|diarista" }, 400);
}
```

---

### 🟡 Médios

#### M-1. INSERT em `diarias` com `tipo_oferta` falha se migration não aplicada

**Arquivo:** `App.tsx:4042-4054`

A migration `tipo_oferta_diaria_vs_servico.sql` é recente (2026-05-28).
Se não foi aplicada em prod, o INSERT com `tipo_oferta` falha — App.tsx **não**
faz fallback. Sintoma: empregador não consegue criar diária.

**Fix:** garantir que a migration foi aplicada. (`tipo_oferta` é NOT NULL com
default 'diaria' — depois de aplicar, INSERTs antigos sem o campo continuam
funcionando.)

#### M-2. `delete-user` não apaga `usuarios_bloqueados`, `oauth_states`, `kyc_acessos_log`, `contatos_desbloqueios`, `webhook_eventos_processados`

**Arquivo:** `supabase/functions/delete-user/index.ts`

LGPD pede expurgo. Para 5 dessas tabelas, as FKs têm `ON DELETE CASCADE`
contra `auth.users`, então o `supabaseAdmin.auth.admin.deleteUser` no final
cuida do cascade. Mas vale documentar.

**Verificação manual em prod:**

```sql
SELECT conname, confdeltype
FROM pg_constraint
WHERE confrelid = 'auth.users'::regclass
  AND conrelid IN ('usuarios_bloqueados'::regclass,
                   'oauth_states'::regclass,
                   'kyc_acessos_log'::regclass,
                   'contatos_desbloqueios'::regclass);
-- confdeltype = 'c' significa CASCADE; 'a' = NO ACTION
```

#### M-3. Migrações duplicadas entre `_APLICAR_TUDO_PENDENTE.sql` / `_PENDENTES_SUPABASE.sql` e individuais

Várias funções são definidas em DOIS lugares (e até três):

- `admin_metricas_serie` / `admin_drill_lista` / `admin_metricas_extras`:
  `admin_metricas_avancadas.sql` + `_APLICAR_TUDO_PENDENTE.sql`
- `revisar_antecedentes`: `antecedentes_criminais.sql` + `seguranca_hardening.sql` + `_APLICAR_TUDO_PENDENTE.sql`
- `protect_user_profile_privileged_columns`: `cadastro_p0_fixes.sql` + `antecedentes_criminais.sql` + `kyc_documentos.sql` + `hotfix_protect_trigger_columns.sql` + `_APLICAR_TUDO_PENDENTE.sql` (**5 versões!**)
- `cnpj_ja_cadastrado`: `cadastro_pj_completo.sql` + `_PENDENTES_SUPABASE.sql`
- `criar_oauth_state`: `auditoria_26_05_fixes.sql` + `_PENDENTES_SUPABASE.sql`
- `clamp_last_activity_at`: `auditoria_26_05_fixes.sql` + `hotfix_triggers_cast.sql`
- `academy_*`: `ja_decola_academy.sql` + `_PENDENTES_SUPABASE.sql`

Como Postgres usa `CREATE OR REPLACE`, sempre vence a última a rodar. **Mas
o resultado depende da ORDEM em que o admin colou no SQL Editor**. Hoje não
há SemVer nem prefixo numérico nas migrations (`CLAUDE.md` confirma: "Migrations
não são numeradas — aplique manualmente.").

**Risco real:** A-1 já é exemplo concreto disso (hotfix sem carve-out
sobrescreve carve-out).

**Fix:** numerar prefixos (`0001_…`, `0002_…`) e padronizar que `_APLICAR_TUDO_PENDENTE.sql`
não é canonical — só é um "bundle" para apply-em-massa, e as fontes-fato são
os arquivos individuais. Documentar em `supabase/migrations/README.md`.

#### M-4. `cnpj_ja_cadastrado` confere apenas `cnpj` (não `responsavel_cpf` PJ)

**Arquivo:** `cadastro_pj_completo.sql:45-58`

Hoje só evita CNPJ duplicado. Não impede CPF duplicado do responsável PJ
(quando alguém abre 2 empresas com o mesmo responsável). Pode ser
intencional, mas vale revisar.

#### M-5. `score_events` criada por `auditoria_final_fixes.sql:50` mas não populada por nada

A tabela existe pra `delete-user` apagar referências. Hoje **nenhuma
edge function ou App.tsx escreve nela** (grep vazio em todo o projeto).
Pode virar dead code — manter como "futuro" é OK, mas comentar isso.

#### M-6. `niveis_confiabilidade.sql:21` declara `documento_status NOT NULL DEFAULT 'nao_enviado'` mas `hotfix_protect_trigger_columns.sql:32` não tem `NOT NULL`

```sql
-- niveis_confiabilidade.sql:21
ADD COLUMN IF NOT EXISTS documento_status TEXT NOT NULL DEFAULT 'nao_enviado'
  CHECK (...)

-- hotfix_protect_trigger_columns.sql:32
ADD COLUMN IF NOT EXISTS documento_status      TEXT
  CHECK (documento_status IS NULL OR documento_status IN (...))
```

`IF NOT EXISTS` significa que a SEGUNDA migration vira no-op se a primeira
rodou (e vice-versa). Mas se foi a segunda primeiro, a coluna fica NULL-able
e usuários velhos têm `documento_status IS NULL` — `kyc_documentos.sql:110-115`
checa `documento_status = 'enviado'`, que não bate. Inconsistência menor.

#### M-7. `trackEvento` insere com `user_id: null` → bloqueado pela RLS nova

Mesma issue do A-6. Tracking de eventos pré-login fica em modo "best effort
silencioso".

---

## 4. Inconsistências de naming detectadas

- `convites.contratante_id` ↔ Edge functions usam `empregador_id` (✗ — bug).
- `denuncias.alvo_id` ↔ `delete-user` usa `denunciado_id` (✗ — bug).
- `avaliacoes_*.diarista_id/empregador_id` ↔ `delete-user` usa `avaliado_id/avaliador_id` (✗ — bug).
- `user_profiles.user_type` aceita `ambos` ↔ `assinaturas.user_type` CHECK rejeita (✗ — bug A-8).
- Views da rebrand introduzem `anunciante_id/prestador_id` — corretas, mas
  hoje só na camada de view (✓).

---

## 5. Triggers — checagem rápida

| Trigger                                    | Tabela            | Função                                    | Issues? |
| ------------------------------------------ | ----------------- | ----------------------------------------- | ------- |
| `trg_protect_user_profile_privileged`      | user_profiles     | protect_user_profile_privileged_columns   | 🟠 A-4, A-1 |
| `trg_valida_idade_diarista`                | user_profiles     | valida_idade_diarista                     | OK      |
| `trg_clamp_last_activity_at`               | user_profiles     | clamp_last_activity_at                    | OK      |
| `trg_suporte_resposta_bumpa`               | suporte_respostas | suporte_resposta_bumpa_ticket             | OK      |
| `trg_bloqueia_contato_externo`             | mensagens         | bloqueia_contato_externo                  | OK      |
| `trg_log_bloqueio` / `trg_log_desbloqueio` / `trg_log_denuncia` | usuarios_bloqueados / denuncias | auditoria_acoes.sql | Não checados em detalhe |

Nenhum trigger órfão referenciando coluna inexistente foi achado.

---

## 6. RLS — tabelas com RLS mas sem policy esperada

| Tabela                       | RLS habilitada | Policies SELECT | Policies INSERT/UPDATE/DELETE | Comentário |
| ---------------------------- | -------------- | --------------- | ------------------------------ | ---------- |
| `convites`                   | ✅              | ✅ (`partes_podem_ver_convite`) | ✅ INSERT, UPDATE              | OK |
| `denuncias`                  | ✅              | ✅ (denunciante_le_proprias)    | ✅ INSERT                       | Admin lê via service_role |
| `score_events`               | ✅              | ✅                              | ✅ (FOR ALL TO service_role)   | OK |
| `nao_interesse`              | ✅              | ✅ FOR ALL (USING auth.uid())    | ✅                              | OK |
| `usuarios_bloqueados`        | ✅              | ✅                              | ✅                              | OK |
| `contatos_desbloqueios`      | ✅              | ✅                              | ✅ TO service_role             | OK |
| `webhook_eventos_processados`| Não habilitada explicitamente (vide `_PENDENTES_SUPABASE.sql:56` — só CREATE TABLE) | — | — | 🟡 sem RLS — qualquer authenticated pode ler/escrever. Vide M-8 |
| `rate_limits`                | ✅              | — sem policy SELECT — | ✅ TO service_role           | OK (todo acesso via RPC SECURITY DEFINER) |
| `oauth_states`               | ✅              | — sem policy SELECT pra auth — | ✅ TO service_role           | OK |

#### 🟡 M-8. `webhook_eventos_processados` sem RLS

**Arquivo:** `_PENDENTES_SUPABASE.sql:56-77` (e `auditoria_26_05_fixes.sql:31-50`)

```sql
CREATE TABLE IF NOT EXISTS webhook_eventos_processados (
  …
);
-- nenhum ALTER TABLE … ENABLE ROW LEVEL SECURITY
```

Qualquer authenticated pode dar SELECT/INSERT (vaza ids de eventos MP).
Impacto baixo (são UUIDs do MP), mas viola defesa em profundidade.

**Fix:**

```sql
ALTER TABLE webhook_eventos_processados ENABLE ROW LEVEL SECURITY;
-- (sem policies = bloqueado pra authenticated)
CREATE POLICY webhook_eventos_service_only ON webhook_eventos_processados
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

## 7. SQL pronto: bundle de fixes prioritários (🔴)

Bloco aplicável manualmente no SQL Editor. **Não-destrutivo.**

```sql
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIX BUNDLE — Auditoria Banco/RPCs 2026-05-28                             ║
-- ║ Atende achados C-1, C-2 (DB) e prepara terreno pra A-1, A-4.             ║
-- ║ Idempotente. Re-executável.                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ─── C-2 + A-1 fix: adicionar user_profiles.updated_at + reformatar trigger ──
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION trg_user_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_user_profiles_set_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION trg_user_profiles_updated_at();

-- ─── C-1 fix: admin_drill_lista usa auth.users.created_at em vez de up. ────
CREATE OR REPLACE FUNCTION admin_drill_lista(p_tipo TEXT, p_limit INT DEFAULT 30)
RETURNS TABLE (
  id          TEXT, titulo    TEXT, subtitulo TEXT,
  badge       TEXT, badge_cor TEXT, criado_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin_caller();

  IF p_tipo = 'usuarios_total' THEN
    RETURN QUERY
    SELECT up.id::TEXT,
           COALESCE(up.nome, 'Sem nome')::TEXT,
           (COALESCE(up.user_type, 'sem tipo') ||
            CASE WHEN up.cpf IS NOT NULL OR up.cnpj IS NOT NULL THEN ' · doc ok' ELSE '' END)::TEXT,
           CASE WHEN up.documento_status='aprovado' THEN 'KYC ✓'
                WHEN up.documento_status='enviado'  THEN 'em análise'
                ELSE COALESCE(up.user_type,'—') END::TEXT,
           CASE WHEN up.documento_status='aprovado' THEN '#16a34a'
                WHEN up.documento_status='enviado'  THEN '#f59e0b'
                ELSE '#3A86FF' END::TEXT,
           au.created_at
      FROM user_profiles up
      LEFT JOIN auth.users au ON au.id = up.id
     ORDER BY au.created_at DESC NULLS LAST
     LIMIT p_limit;

  ELSIF p_tipo = 'online_agora' THEN
    RETURN QUERY
    SELECT up.id::TEXT, COALESCE(up.nome, 'Sem nome')::TEXT,
           ('🟢 ativo ' || extract(epoch from (NOW() - up.last_activity_at))::INTEGER || 's atrás')::TEXT,
           COALESCE(up.user_type, '—')::TEXT, '#16a34a'::TEXT, up.last_activity_at
      FROM user_profiles up
     WHERE up.last_activity_at > NOW() - INTERVAL '5 minutes'
     ORDER BY up.last_activity_at DESC
     LIMIT p_limit;

  ELSIF p_tipo = 'novos_hoje' THEN
    RETURN QUERY
    SELECT au.id::TEXT, COALESCE(up.nome, au.email, 'Sem nome')::TEXT,
           ('Cadastrou às ' || to_char(au.created_at, 'HH24:MI'))::TEXT,
           COALESCE(up.user_type, 'sem perfil')::TEXT,
           CASE WHEN up.user_type IS NULL THEN '#94a3b8' ELSE '#FF6B35' END::TEXT,
           au.created_at
      FROM auth.users au
      LEFT JOIN user_profiles up ON up.id = au.id
     WHERE au.created_at::DATE = CURRENT_DATE
     ORDER BY au.created_at DESC LIMIT p_limit;

  ELSIF p_tipo = 'novos_semana' THEN
    RETURN QUERY
    SELECT au.id::TEXT, COALESCE(up.nome, au.email, 'Sem nome')::TEXT,
           ('Cadastrou em ' || to_char(au.created_at, 'DD/MM HH24:MI'))::TEXT,
           COALESCE(up.user_type, 'sem perfil')::TEXT,
           CASE WHEN up.user_type IS NULL THEN '#94a3b8' ELSE '#a855f7' END::TEXT,
           au.created_at
      FROM auth.users au
      LEFT JOIN user_profiles up ON up.id = au.id
     WHERE au.created_at > NOW() - INTERVAL '7 days'
     ORDER BY au.created_at DESC LIMIT p_limit;

  ELSIF p_tipo = 'diarias_ativas' THEN
    RETURN QUERY
    SELECT di.id::TEXT,
           (COALESCE(di.funcao, di.segmento, 'Diária') || ' · R$ ' || di.valor::TEXT)::TEXT,
           (COALESCE(di.nome_negocio, '—') || ' · ' || to_char(di.data, 'DD/MM'))::TEXT,
           di.status::TEXT,
           CASE di.status WHEN 'aberta' THEN '#3A86FF'
                          WHEN 'aceita' THEN '#16a34a'
                          WHEN 'em_andamento' THEN '#f59e0b'
                          ELSE '#94a3b8' END::TEXT,
           di.created_at
      FROM diarias di
     WHERE di.status IN ('aberta','aceita','em_andamento')
     ORDER BY di.created_at DESC LIMIT p_limit;

  ELSIF p_tipo = 'tickets_abertos' THEN
    RETURN QUERY
    SELECT st.id::TEXT, st.assunto::TEXT,
           ('Atualizado ' || to_char(st.updated_at, 'DD/MM HH24:MI'))::TEXT,
           st.status::TEXT,
           CASE st.status WHEN 'aberto' THEN '#ef4444'
                          WHEN 'aguardando_user' THEN '#f59e0b'
                          ELSE '#94a3b8' END::TEXT,
           st.updated_at
      FROM suporte_tickets st
     WHERE st.status IN ('aberto','aguardando_user')
     ORDER BY st.updated_at DESC LIMIT p_limit;

  ELSE RETURN;
  END IF;
END $$;

REVOKE ALL ON FUNCTION admin_drill_lista(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_drill_lista(TEXT, INT) TO authenticated;

-- ─── A-4 fix: trigger anti-escalada respeita admin (caller via JWT) ─────────
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB := to_jsonb(OLD);
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_caller_is_admin BOOLEAN;
BEGIN
  -- service_role (Edge Functions com SERVICE_ROLE_KEY) bypassa tudo
  IF v_role = 'service_role' THEN RETURN NEW; END IF;

  -- Admin bypassa também — RPCs como revisar_documento já validam is_admin
  SELECT COALESCE(is_admin, FALSE) INTO v_caller_is_admin
    FROM user_profiles WHERE id = auth.uid();
  IF v_caller_is_admin THEN RETURN NEW; END IF;

  -- Colunas absolutamente imutáveis pelo cliente (mesmo via RPC SECURITY DEFINER
  -- chamada por user comum). Admin já passou no early-return acima.
  IF (v_new->>'is_admin') IS DISTINCT FROM (v_old->>'is_admin') THEN
    RAISE EXCEPTION 'is_admin é gerenciado pelo servidor'; END IF;
  IF (v_new->>'plano_ativo') IS DISTINCT FROM (v_old->>'plano_ativo') THEN
    RAISE EXCEPTION 'plano_ativo só via webhook MP'; END IF;
  IF (v_new->>'mp_access_token') IS DISTINCT FROM (v_old->>'mp_access_token') THEN
    RAISE EXCEPTION 'mp_access_token só via callback OAuth'; END IF;
  IF (v_new->>'mp_user_id') IS DISTINCT FROM (v_old->>'mp_user_id') THEN
    RAISE EXCEPTION 'mp_user_id só via callback OAuth'; END IF;
  IF (v_new->>'telefone_verificado') IS DISTINCT FROM (v_old->>'telefone_verificado') THEN
    RAISE EXCEPTION 'telefone_verificado só após OTP'; END IF;
  IF (v_old->>'termos_aceitos_em') IS NOT NULL
     AND (v_new->>'termos_aceitos_em') IS DISTINCT FROM (v_old->>'termos_aceitos_em') THEN
    RAISE EXCEPTION 'termos_aceitos_em é imutável'; END IF;

  -- documento_status: user pode passar de (nao_enviado | rejeitado) → enviado.
  IF (v_new->>'documento_status') IS DISTINCT FROM (v_old->>'documento_status') THEN
    IF NOT (COALESCE(v_old->>'documento_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
            AND (v_new->>'documento_status') = 'enviado') THEN
      RAISE EXCEPTION 'documento_status só pode ser alterado via revisão KYC (admin)';
    END IF;
  END IF;
  IF (v_new->>'documento_revisado_em') IS DISTINCT FROM (v_old->>'documento_revisado_em') THEN
    RAISE EXCEPTION 'documento_revisado_em só via revisão KYC'; END IF;

  -- antecedentes_status: mesma regra do documento_status
  IF (v_new->>'antecedentes_status') IS DISTINCT FROM (v_old->>'antecedentes_status') THEN
    IF NOT (COALESCE(v_old->>'antecedentes_status', 'nao_enviado') IN ('nao_enviado','rejeitado')
            AND (v_new->>'antecedentes_status') = 'enviado') THEN
      RAISE EXCEPTION 'antecedentes_status só via revisão admin';
    END IF;
  END IF;
  IF (v_new->>'antecedentes_revisado_em') IS DISTINCT FROM (v_old->>'antecedentes_revisado_em') THEN
    RAISE EXCEPTION 'antecedentes_revisado_em só via revisão admin'; END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_user_profile_privileged ON user_profiles;
CREATE TRIGGER trg_protect_user_profile_privileged
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- ─── M-8 fix: webhook_eventos_processados sem RLS ──────────────────────────
ALTER TABLE webhook_eventos_processados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_eventos_service_only ON webhook_eventos_processados;
CREATE POLICY webhook_eventos_service_only ON webhook_eventos_processados
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── A-7 fix: views da rebrand jurídica com security_invoker ───────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='anuncios')          THEN
    EXECUTE 'ALTER VIEW anuncios          SET (security_invoker = true)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='interesses')        THEN
    EXECUTE 'ALTER VIEW interesses        SET (security_invoker = true)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='conexoes_diretas')  THEN
    EXECUTE 'ALTER VIEW conexoes_diretas  SET (security_invoker = true)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname='usuarios_publicos') THEN
    EXECUTE 'ALTER VIEW usuarios_publicos SET (security_invoker = true)'; END IF;
END $$;

-- ─── Verificação final ─────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='user_profiles' AND column_name='updated_at')          AS up_updated_at,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='admin_drill_lista')         AS rpc_drill_lista,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='protect_user_profile_privileged_columns') AS trg_proc,
  (SELECT relrowsecurity FROM pg_class WHERE relname='webhook_eventos_processados')      AS webhook_rls;
-- Esperado: 1 | 1 | 1 | t
```

---

## 8. Patches no client/edge (fora do banco)

### `supabase/functions/export-user-data/index.ts:91`

```diff
- supabase.from("convites").select("*").eq("empregador_id", uid),
+ supabase.from("convites").select("*").eq("contratante_id", uid),
```

### `supabase/functions/delete-user/index.ts:67-68`

```diff
- await supabaseAdmin.from("avaliacoes_diarista").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
- await supabaseAdmin.from("avaliacoes_empregador").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
+ await supabaseAdmin.from("avaliacoes_empregador").delete().eq("diarista_id", userId);
+ await supabaseAdmin.from("avaliacoes_diarista").delete().eq("empregador_id", userId);
+ // (Avaliações RECEBIDAS pelo user permanecem — pertencem ao avaliador. Decisão LGPD.)
```

### `supabase/functions/delete-user/index.ts:71`

```diff
- await supabaseAdmin.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId},empregador_id.eq.${userId}`).then(undefined as any, () => {});
+ await supabaseAdmin.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId}`).then(undefined as any, () => {});
```

### `supabase/functions/delete-user/index.ts:74`

```diff
- await supabaseAdmin.from("denuncias").delete().or(`denunciante_id.eq.${userId},denunciado_id.eq.${userId}`).then(undefined as any, () => {});
+ await supabaseAdmin.from("denuncias").delete().or(`denunciante_id.eq.${userId},alvo_id.eq.${userId}`).then(undefined as any, () => {});
```

### `supabase/functions/create-subscription/index.ts:218`

Adicionar validação **antes** do upsert (~linha 215):

```ts
if (!["empregador","diarista"].includes(user_type)) {
  log(traceId, "11_db_skip", { motivo: "user_type inválido" });
  return json({ error: "user_type deve ser empregador|diarista" }, 400);
}
```

### `supabase/functions/delete-user/index.ts` — adicionar (após linha 105)

```ts
// Bloqueios feitos pelo user (LGPD)
await supabaseAdmin.from("usuarios_bloqueados").delete()
  .or(`bloqueador_id.eq.${userId},alvo_id.eq.${userId}`).then(undefined as any, () => {});

// OAuth states (CASCADE também cobre, mas defensivo)
await supabaseAdmin.from("oauth_states").delete().eq("user_id", userId).then(undefined as any, () => {});

// KYC audit log onde foi o target (mantém auditoria — pode ser removido OU mantido conforme posição jurídica)
// await supabaseAdmin.from("kyc_acessos_log").delete().eq("target_user_id", userId).then(undefined as any, () => {});

// Contatos desbloqueados (CASCADE também cobre)
await supabaseAdmin.from("contatos_desbloqueios").delete().eq("empregador_id", userId).then(undefined as any, () => {});
```

---

## 9. Resumo executivo (1 linha por achado)

🔴 **C-1** `admin_drill_lista` → `up.created_at` não existe — quebra painel admin.
🔴 **C-2** `promover_suporte` → `updated_at` em user_profiles não existe — quebra promoção.
🔴 **C-3** `convites.empregador_id` em 2 edge functions — coluna real é `contratante_id`.
🔴 **C-4** delete-user usa `avaliado_id`/`avaliador_id` — colunas reais são `diarista_id`/`empregador_id`.
🟠 **A-1** Hotfix do trigger removeu carve-out de documento_status (depende da ordem).
🟠 **A-2** `aceitar_termos` INSERT pode falhar se user_profiles tem NOT NULL sem default.
🟠 **A-3** `admin_metricas_extras` EXCEPTION mascara erros não relacionados.
🟠 **A-4** RPCs SECURITY DEFINER batem no trigger anti-escalada (não troca role).
🟠 **A-5** delete-user usa `denunciado_id` (real é `alvo_id`) — denúncias órfãs.
🟠 **A-6** RLS de analytics rejeita `user_id IS NULL` — track pré-login morre silenciosamente.
🟠 **A-7** Views da rebrand sem `security_invoker` — RLS pode ser furada se usadas.
🟠 **A-8** `assinaturas.user_type` CHECK não aceita `ambos` — upsert de cadastro PJ pode quebrar.
🟡 **M-1** INSERT em diarias com `tipo_oferta` falha se migration não aplicada.
🟡 **M-2** delete-user não toca em 4 tabelas com referência a user (CASCADE cobre, mas vale documentar).
🟡 **M-3** 7 RPCs/triggers definidos em 2+ migrations — última a rodar vence; ordem é manual.
🟡 **M-4** cnpj_ja_cadastrado não confere responsavel_cpf.
🟡 **M-5** Tabela `score_events` criada mas nenhuma escrita no projeto.
🟡 **M-6** Inconsistência NOT NULL em `user_profiles.documento_status` entre 2 migrations.
🟡 **M-7** Mesmo que A-6 — eventos pré-login bloqueados pela RLS.
🟡 **M-8** `webhook_eventos_processados` sem RLS habilitada — qualquer authenticated lê IDs.

---

**Fim da auditoria.**
