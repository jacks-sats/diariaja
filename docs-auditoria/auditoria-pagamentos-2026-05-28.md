# Auditoria Crítica — Pagamentos Mercado Pago
Data: 2026-05-28
Auditor: Claude (Opus 4.7 1M)
Branch: claude/project-review-restoration-XBkFf

---

## ROOT CAUSE 401 (mais provável)

**O webhook está sendo bloqueado pelo gateway do Supabase ANTES de chegar à
sua função `mp-webhook` — porque o projeto deploya as Edge Functions sem
desabilitar `verify_jwt`.** Esse é o motivo de:

1. retornar 401 mesmo com `MP_WEBHOOK_SECRET` correto;
2. **os logs detalhados do commit b5fdbdb não aparecerem no Dashboard** —
   o handler nunca executa, então `console.log(...)` nunca é emitido.

### Por quê
Não existe `supabase/config.toml` no repositório (verificado: `find /home/user/diariaja -name "config.toml"` retorna vazio). Sem ele, ao rodar `supabase functions deploy mp-webhook` o CLI usa o default `verify_jwt = true`. Isso instala um **filtro de gateway** que exige header `Authorization: Bearer <JWT>` em TODA requisição. O Mercado Pago **não envia** Authorization no webhook — só `x-signature` e `x-request-id`. Resultado: 401 do gateway, antes mesmo do Deno.serve do `mp-webhook` ser invocado.

Sintomas que batem 1-pra-1 com essa causa:

| Sintoma | Confirma JWT-gate? |
|---|---|
| 401 imediato e determinístico, independente do conteúdo | ✅ |
| `console.log` no início do handler nunca aparece no Dashboard | ✅ |
| Trocar `MP_WEBHOOK_SECRET` não muda nada | ✅ |
| `mp-health-check` (que aceita admin JWT) responde normalmente | ✅ |
| Hit em `https://...supabase.co/functions/v1/mp-webhook` direto via curl sem Authorization também dá 401 | ✅ |

### Como confirmar em 30s
```bash
# Sem Authorization (igual o MP envia):
curl -i -X POST https://rpszebrrrasoijfdvner.supabase.co/functions/v1/mp-webhook \
  -H 'content-type: application/json' \
  -d '{"type":"payment","data":{"id":"123"}}'
# Esperado se for JWT-gate: HTTP/2 401 e body = {"code":401,"message":"Missing authorization header"}
# (note: a mensagem é do GATEWAY do Supabase, NÃO do seu código — você nunca retornaria essa string)
```

Se a resposta vier com `{"code":401,"message":"Missing authorization header"}` (ou equivalente, em JSON), é 100% gateway, não seu HMAC.

### Como CORRIGIR (única correção real)

Criar `supabase/config.toml` (ou usar a flag no deploy) e desabilitar JWT verify nas 3 funções de webhook que MP/payment usam.

**Fix definitivo no repo** (vide seção "Fix pronto" abaixo) — depois redeployar:

```bash
supabase functions deploy mp-webhook --no-verify-jwt
supabase functions deploy mp-oauth   --no-verify-jwt   # (idem — MP redireciona sem JWT)
```

**Não tem como o MP enviar JWT.** É obrigatório isto pra qualquer webhook público.

---

## Achados por severidade

### 🔴 Críticos

#### C-1. `verify_jwt` ligado em `mp-webhook` (RAIZ DO 401)
- **Arquivo**: ausência de `supabase/config.toml` no projeto inteiro.
- **Evidência**: comando `find /home/user/diariaja -name "config.toml"` retorna vazio.
- **Impacto**: 100% dos webhooks do MP morrem no gateway. Pagamentos de diária ficam parados em `aguardando` perpetuamente; R$1 unlock fica preso em `pending`; assinaturas nunca viram `ativo` no banco; `user_profiles.plano_ativo` nunca é atualizado; `contatos_desbloqueios` nunca recebe linha → `contatosLiberados` no client fica vazio mesmo após pagamento.
- **Severidade**: bloqueador total. **Esta correção sozinha resolve o sintoma 401 e a invisibilidade dos logs.**

#### C-2. `mp-oauth` também precisa de `--no-verify-jwt`
- **Arquivo**: `/home/user/diariaja/supabase/functions/mp-oauth/index.ts:33`.
- **Evidência**: a função é chamada via redirect 302 do MP, não há JWT no browser nesse momento. Mesma classe de bug do webhook.
- **Impacto**: a flow de "Conectar Mercado Pago" do diarista quebra silenciosamente — usuário vê tela do MP, autoriza, é redirecionado, e nada acontece (apenas 401 no gateway). O `user_profiles.mp_access_token` nunca é populado.
- **Severidade**: bloqueador da feature OAuth, mas dummy hoje porque os Edge Functions não dependem desse token (pagamento é centralizado na conta da plataforma — não há split). Mesmo assim, a tela mente pro usuário.

#### C-3. Migration `webhook_eventos_processados` provavelmente NÃO foi aplicada
- **Arquivo de origem**: `/home/user/diariaja/supabase/migrations/_PENDENTES_SUPABASE.sql:56-66` e `/home/user/diariaja/supabase/migrations/auditoria_26_05_fixes.sql`.
- **Uso em runtime**: `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:149-164`.
- **Evidência**: o nome do arquivo (`_PENDENTES_*`) e o cabeçalho ("Migrations pendentes consolidadas") fortemente sugerem que ainda não foram aplicadas no Supabase. O código webhook já tem fallback fail-open pra esse caso (linha 159: `if (!/relation .* does not exist/i.test(...))`), mas é silencioso → você perde idempotência sem perceber.
- **Impacto**: quando finalmente C-1 for resolvido e o webhook começar a executar, retentativas do MP vão **duplicar** inserts em `contatos_desbloqueios` (mas tem UNIQUE em `mp_payment_id`, então 23505 contorna — OK), e atualizar 2x o status de diárias (sem efeito real, idempotente por natureza no UPDATE). Risco real é se MP retentar `preapproval` aprovado e o webhook re-disparar `update plano_ativo` no meio de um cancelamento — race condition de UI.
- **Severidade**: alto, mas só vira visível depois de resolver C-1.

#### C-4. Bug no fluxo de hidratação de `contatosLiberados` por convite
- **Arquivo**: `/home/user/diariaja/src/App.tsx:1554-1586` (hidratação) e `/home/user/diariaja/supabase/functions/create-contact-payment/index.ts:132-134` (criação do external_reference).
- **Evidência**: o cliente parseia `mp_external_reference` esperando 3 partes (`contact_unlock::USER_ID::CONVITE_ID`). Mas o webhook em `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:237-238` faz:
  ```ts
  if (String(payment.external_reference).startsWith("contact_unlock::")) {
    const userId = String(payment.external_reference).split("::")[1] ?? "";
  ```
  e ignora a 3ª parte completamente. Ele insere `mp_external_reference: String(payment.external_reference)` (linha 245), o que está CORRETO — a string original é salva inteira. O cliente recupera o `convite_id` parseando essa string. ✅ Funciona.
- **Porém**, se o pagamento foi criado SEM `convite_id` (linha 134: `${empregador_id}` puro), o split gera só 2 partes. Cliente em `App.tsx:1566` ignora (`if (parts.length >= 3 && parts[2])`). Result: o pagamento é registrado mas não libera nenhum convite específico — usuário pagou e não recebeu nada visível.
- **Impacto**: se o front em algum ponto chamar `desbloquearContato()` SEM `conviteId`, o R$1 vira despesa "fantasma" — contador `contatosDesbloqueados` incrementa (linha 1581), mas `contatosLiberados` Set não. UI mostra "Confirmar diária por R$ 1" no botão de novo, e usuário paga 2x.
- **Severidade**: crítico se ocorrer; verificar todas as chamadas de `desbloquearContato`.

#### C-5. `mp-webhook` não converte `data.id` para lowercase no template HMAC
- **Arquivo**: `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:100`.
- **Evidência**:
  ```ts
  const template = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  ```
  A documentação do MP **explicita que `data.id` deve ser convertido para lowercase quando for alfanumérico**. Para `topic=payment` o ID é puramente numérico (sem efeito), mas para `topic=preapproval` o ID é alfanumérico (ex.: `2c9380847abc...`). Se vier maiúsculo na URL `?data.id=2C9380...`, o HMAC computed nunca bate com o received.
- **Impacto**: após resolver C-1, **assinaturas vão dar 401** mesmo com tudo certo. Já estamos aqui pra evitar uma 2ª rodada de debug.
- **Severidade**: crítico (latente, ainda escondido atrás do C-1).

---

### 🟠 Altos

#### A-1. `WEBHOOK_SECRET` não tem `.trim()`
- **Arquivo**: `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:19`.
- **Evidência**: `const WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";`. Quando se cola um secret no Supabase Dashboard, é comum vir com `\n` ou espaço no final — especialmente em "regenerar e copiar várias vezes" como você fez.
- **Impacto**: HMAC computed difere por byte invisível. Ficaria 401 mesmo com C-1 resolvido.
- **Severidade**: alto (causa silenciosa muito comum no pipeline humano).

#### A-2. `xRequestId` e `xSignature` também precisam `.trim()`
- **Arquivo**: mesmo. Linhas 54-55.
- **Evidência**: headers HTTP normalmente não trazem whitespace, mas alguns proxies (Cloudflare, CDN) injetam. Defensive trim.
- **Severidade**: médio, mas trivial de corrigir.

#### A-3. Janela de ±5min para `ts` é restrita demais e não tolera clock skew
- **Arquivo**: `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:91-95`.
- **Evidência**: o relógio do MP e do Supabase Edge devem estar muito sincronizados. NTP normalmente dá <100ms de skew, mas se o secret for trocado e o MP enviar retentativa atrasada (já vi MP retentando até 24h depois), tudo expira.
- **Impacto**: retentativas legítimas em pagamento `pending → approved` perdidas. Eleve pra 10min ou pula a checagem (o HMAC já garante autenticidade) — o `ts` da signature é replay protection. Aceitar até 1h é razoável; >24h é ruim.
- **Severidade**: alto pra retentativas; médio pro happy path.

#### A-4. `mercadopago_tables.sql` cria UNIQUE(user_id) em `assinaturas`, mas `monetizacao_dual_track.sql` troca pra `UNIQUE(user_id, user_type)`
- **Arquivos**: `mercadopago_tables.sql:40`, `fix_assinaturas_status_constraint.sql:25-27`, `monetizacao_dual_track.sql:39-81`.
- **Evidência**: 3 migrations alterando a mesma constraint em sequência. Aplicação manual (CLAUDE.md confirma "Migrations são não numeradas — apply them by hand") pode ter pulado a `monetizacao_dual_track`. Se isso ocorreu, `create-subscription` falha no upsert porque `onConflict: "user_id,user_type"` (linha 227) procura a UNIQUE composta que não existe — Postgres devolve "no unique or exclusion constraint matching the ON CONFLICT specification".
- **Impacto**: `create-subscription` retorna 502 silencioso (catch genérico) ou pior, dá 200 sem gravar.
- **Severidade**: alto. Confirmar com `\d assinaturas` no Supabase.

#### A-5. `create-payment` não tem rate limit independente de `create-contact-payment`
- **Arquivos**: `/home/user/diariaja/supabase/functions/create-payment/index.ts:78`, `/home/user/diariaja/supabase/functions/create-contact-payment/index.ts:111`.
- **Evidência**: `create-payment` usa key `create-payment:user:` (5/min), `create-contact-payment` usa `contact-unlock:user:` (3/min). Mas a tabela `rate_limits` é compartilhada — se um user enche o quota de uma, NÃO afeta a outra. ✅ Correto. Só ressalvar: este NÃO é bug.

---

### 🟡 Médios

#### M-1. Logs `SIG]` em produção vão floodar o painel
- **Arquivo**: `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:60-70, 113-115`.
- **Evidência**: cada webhook gera 2 console.log gordos com o template inteiro (PII numérico do pagamento). Após resolver C-1, remover.
- **Severidade**: médio (custo + PII em log retido 7d).

#### M-2. `pseudo()` é assíncrono e usado em string template literal — performance
- **Arquivo**: `/home/user/diariaja/supabase/functions/mp-webhook/index.ts:216, 254, 297`.
- **Evidência**: `console.log(\`...${await pseudo(subId)}...\`)`. Cada log dispara um SHA-256 — não é caro, mas no fluxo de assinatura ainda awaita pseudo 2x sequencialmente.
- **Severidade**: cosmético.

#### M-3. `back_urls.success` aponta pra `?contato_desbloqueado=sucesso` mas o cliente espera webhook real
- **Arquivo**: `/home/user/diariaja/supabase/functions/create-contact-payment/index.ts:136`, e tratamento no client em `App.tsx:1906-1921`.
- **Evidência**: o cliente faz `setTimeout(..., 1200)` esperando o webhook chegar. Se o webhook está em 401, esse setTimeout nunca encontra a linha — usuário vê "Pagou" mas chat continua trancado. Confirma cenário do C-1.
- **Severidade**: revela o C-1 pra o usuário final.

#### M-4. `create-subscription` usa `MP_SUBSCRIPTION_TOKEN` como token preferencial — mas `mp-webhook` ainda usa `MP_ACCESS_TOKEN`
- **Arquivos**: `create-subscription/index.ts:18` vs `mp-webhook/index.ts:18`.
- **Evidência**: assinaturas são criadas com TOKEN A (Subscription). Quando MP webhook dispara `preapproval`, o webhook chama `GET /preapproval/{id}` com TOKEN B (Access). Se as 2 apps no MP têm permissões distintas (e geralmente têm — o erro `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` é exatamente isso), esse GET retorna 401/403 e `sub.status` vira `undefined`, mapeado pra `"pendente"`.
- **Impacto**: após resolver C-1, assinaturas vão ficar perpetuamente "pendente" no banco mesmo quando ativadas. `plano_ativo` no perfil nunca atualiza.
- **Severidade**: alto-médio (depende de a app de Subscription ter ou não o token).

#### M-5. `external_reference` de subscription = `${user_id}::${plano}` — `user_type` perdido
- **Arquivo**: `/home/user/diariaja/supabase/functions/create-subscription/index.ts:167`.
- **Evidência**: dual track (linha 192 do webhook) confirma que o webhook lê só o user_id e o plano, e usa `mp_subscription_id` pra escopar UPDATE. OK. Mas se algum dia precisar reconciliar pelo external_reference (ex: webhook orfão sem `mp_subscription_id` no banco), não dá pra saber se era assinatura de diarista ou empregador.
- **Severidade**: médio (tecnicalidade futura).

#### M-6. `mp-webhook` chama Supabase com `service_role` MAS a RLS policy em `webhook_eventos_processados` (no `_PENDENTES_*`) usa `TO service_role` — OK
- **Confirmação positiva**: linha 64-65 do `_PENDENTES_SUPABASE.sql` está correto.

---

## Fix pronto (texto literal pra colar)

### Fix #1 — Criar `supabase/config.toml` desabilitando JWT nos webhooks (RAIZ DO 401)

Criar arquivo `/home/user/diariaja/supabase/config.toml`:

```toml
# DiáriaJá — Supabase config
# Documenta opções de deploy das Edge Functions. Sem este arquivo, o CLI usa
# verify_jwt=true por padrão, o que bloqueia webhooks externos (MP/Vercel/etc)
# no gateway antes do código rodar.

project_id = "rpszebrrrasoijfdvner"

# ── Edge Functions ────────────────────────────────────────────────────────────
# verify_jwt=false aceita requests sem header Authorization (Mercado Pago não
# manda JWT no webhook; OAuth callback também vem via 302 sem JWT).
# A AUTENTICIDADE é garantida em código:
#   - mp-webhook valida HMAC-SHA256 com MP_WEBHOOK_SECRET
#   - mp-oauth consome um nonce single-use de oauth_states

[functions.mp-webhook]
verify_jwt = false

[functions.mp-oauth]
verify_jwt = false

# Demais funções MANTÊM verify_jwt=true (default) — são chamadas
# autenticadas do app:
#   create-payment, create-contact-payment, create-subscription, delete-user,
#   ai-support, send-push, mp-health-check, etc.
```

E redeploy:

```bash
supabase functions deploy mp-webhook --no-verify-jwt
supabase functions deploy mp-oauth --no-verify-jwt
```

(O flag `--no-verify-jwt` é o cinto-suspensório — o config.toml já cobre.)

### Fix #2 — Hardening da validação HMAC em `mp-webhook`

Substituir o trecho de validação na `validarAssinatura` em `/home/user/diariaja/supabase/functions/mp-webhook/index.ts` (linhas 19, 48-118):

```ts
// (linha 19) ── trim defensivo no secret colado no Dashboard
const WEBHOOK_SECRET   = (Deno.env.get("MP_WEBHOOK_SECRET") ?? "").trim();

// ... resto igual até a função ...

async function validarAssinatura(req: Request, _body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.error("[mp-webhook][SIG] MP_WEBHOOK_SECRET não configurado");
    return false;
  }

  const xSignature = (req.headers.get("x-signature") ?? "").trim();
  const xRequestId = (req.headers.get("x-request-id") ?? "").trim();
  const url        = new URL(req.url);
  // MP documenta: data.id deve ser lowercase no template HMAC.
  // Pra payments é numérico (no-op), pra preapproval é alfanumérico.
  const dataId     = (url.searchParams.get("data.id") ?? "").toLowerCase();

  // Formato MP: "ts=<timestamp>,v1=<hash>"
  const parts: Record<string, string> = {};
  xSignature.split(",").forEach(p => {
    const idx = p.indexOf("=");
    if (idx > 0) {
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      if (k && v) parts[k] = v;
    }
  });

  const ts   = parts["ts"] ?? "";
  const hash = (parts["v1"] ?? "").toLowerCase();
  if (!ts || !hash) {
    console.warn("[mp-webhook][SIG] ts ou v1 faltando");
    return false;
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    console.warn("[mp-webhook][SIG] ts inválido");
    return false;
  }
  // Janela elástica (MP retenta até ~24h). HMAC já garante autenticidade;
  // o ts protege replay — 1h é compromisso saudável.
  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - tsNum) > 3600) {
    console.warn("[mp-webhook][SIG] ts fora da janela ±1h", { diff_s: agora - tsNum });
    return false;
  }

  const template = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(template));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  const match = timingSafeEqualHex(computed, hash);
  if (!match) {
    // Log mínimo SEM expor o secret. Só os primeiros 8 chars do hash recebido
    // e do computado pra correlação visual em troubleshooting.
    console.warn("[mp-webhook][SIG] HMAC não bate", {
      received_prefix: hash.slice(0, 8),
      computed_prefix: computed.slice(0, 8),
      data_id: dataId,
      ts_diff_s: agora - tsNum,
    });
  }
  return match;
}
```

### Fix #3 — Garantir que migration de idempotência rode

No Supabase Dashboard → SQL Editor, rodar (idempotente):

```sql
-- Cria a tabela de idempotência que o mp-webhook espera.
CREATE TABLE IF NOT EXISTS webhook_eventos_processados (
  mp_evento_id  TEXT PRIMARY KEY,
  recebido_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_eventos_processados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_eventos_service_role" ON webhook_eventos_processados;
CREATE POLICY "webhook_eventos_service_role" ON webhook_eventos_processados
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Confirma:
SELECT count(*) FROM webhook_eventos_processados;  -- deve dar 0
```

### Fix #4 — Garantir a UNIQUE composta em `assinaturas` (caso `monetizacao_dual_track` não tenha rodado)

```sql
-- Verifica primeiro
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'assinaturas'::regclass AND contype = 'u';

-- Se NÃO aparecer 'uq_assinaturas_user_role' rodar:
ALTER TABLE assinaturas DROP CONSTRAINT IF EXISTS assinaturas_user_id_key;
ALTER TABLE assinaturas
  ADD CONSTRAINT uq_assinaturas_user_role UNIQUE (user_id, user_type);
```

### Fix #5 — Garantir paridade de token no webhook quando lendo preapproval

Editar `/home/user/diariaja/supabase/functions/mp-webhook/index.ts` linha 18:

```ts
const MP_TOKEN            = Deno.env.get("MP_ACCESS_TOKEN")!;
const MP_SUBSCRIPTION_TOK = Deno.env.get("MP_SUBSCRIPTION_TOKEN") ?? MP_TOKEN;
```

E nas linhas 174-176 (consulta de preapproval) usar `MP_SUBSCRIPTION_TOK`:

```ts
const mpResp = await fetch(`https://api.mercadopago.com/preapproval/${subId}`, {
  headers: { "Authorization": `Bearer ${MP_SUBSCRIPTION_TOK}` },
});
```

Mantém `MP_TOKEN` (CheckoutPro) na consulta de `payment` (linha 226-228), que continua certa.

### Fix #6 — Endpoint público de debug pra confirmar que webhook está vivo

Após Fix #1, adicionar ao TOPO de `Deno.serve` em `mp-webhook/index.ts`, antes da validação de assinatura:

```ts
// GET /functions/v1/mp-webhook?ping=1 — confirma que o gateway aceita
// requisições sem JWT (responde 200 sem fazer nada). Remover após teste.
if (req.method === "GET" && new URL(req.url).searchParams.get("ping") === "1") {
  return new Response(JSON.stringify({ alive: true, ts: Date.now() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
```

Teste: `curl 'https://rpszebrrrasoijfdvner.supabase.co/functions/v1/mp-webhook?ping=1'`
- Se retornar 200 `{alive:true,...}` → JWT-gate FOI desligado. Bom.
- Se retornar 401 com `Missing authorization header` → config.toml não foi aplicado no deploy.

---

## Checklist de teste manual após fix

- [ ] **Antes de qualquer coisa**: rodar `curl 'https://rpszebrrrasoijfdvner.supabase.co/functions/v1/mp-webhook?ping=1'` — esperar 200 com `{alive:true}`. Se ainda 401, o `config.toml` não pegou no deploy. **Não prossiga até este teste passar.**
- [ ] Confirmar no Supabase Dashboard → Edge Functions → mp-webhook → Settings que "Verify JWT" está OFF (interface ou via CLI).
- [ ] Rodar `mp-health-check` (curl com `x-health-check-secret`) — todos os checks `ok=true`, especialmente `secret_MP_WEBHOOK_SECRET`, `tabela_webhook_eventos_processados`, `tabela_contatos_desbloqueios`, `tabela_assinaturas`.
- [ ] **R$1 unlock end-to-end**:
  - [ ] Fazer login como empregador no app prod.
  - [ ] Convidar diarista, esperar aceite.
  - [ ] Tocar "Confirmar diária por R$ 1", pagar com PIX no MP.
  - [ ] Voltar ao app, sem reload, confirmar que botão muda pra "Ver contato" via toast "Chat liberado!" (vem do realtime channel em App.tsx:1574-1583).
  - [ ] Reload da página — botão deve continuar como "Ver contato" (vem da hidratação App.tsx:1554-1569 lendo `contatos_desbloqueios`).
  - [ ] Verificar no SQL: `SELECT * FROM contatos_desbloqueios ORDER BY created_at DESC LIMIT 1;` — deve mostrar a linha com `mp_external_reference = contact_unlock::<UID>::<CONVITE_ID>`.
- [ ] **Pagamento de diária**:
  - [ ] Empregador cria diária, seleciona prestador, paga total.
  - [ ] Após pagamento, abrir o chat — deve aparecer mensagem automática "✅ Pagamento de R$ X confirmado via Mercado Pago!".
  - [ ] SQL: `SELECT pagamento_status, pagamento_mp_id FROM diarias WHERE id = '<DIARIA_ID>';` → `pago`.
- [ ] **Assinatura recorrente** (POR PAPEL — diarista e empregador separados):
  - [ ] Como diarista grátis, contratar plano Essencial via UI.
  - [ ] No MP, aprovar o cartão de teste.
  - [ ] SQL: `SELECT user_id, user_type, plano, status FROM assinaturas WHERE user_id='<UID>';` → deve aparecer linha com `status='ativo'` (não `pendente`).
  - [ ] SQL: `SELECT plano_ativo FROM user_profiles WHERE id='<UID>';` → atualizado para `essencial`. **Se ficou `gratis`, M-4 acertou — confirmar paridade de tokens.**
- [ ] **OAuth de diarista** (opcional, se a feature está exposta):
  - [ ] Como diarista, tocar "Conectar Mercado Pago".
  - [ ] Após autorização, confirmar que `user_profiles.mp_access_token` é populado.
- [ ] Após 30min em prod, abrir Supabase Dashboard → Logs Explorer e confirmar que `[mp-webhook][SIG]` aparece. Antes, era invisível.
- [ ] **Limpar debug**: remover os `console.log` verbosos de SIG (linhas 60-70, 113-115) e o endpoint `?ping=1` antes de fechar o ticket.

---

## Resumo executivo

1 problema causa 100% do sintoma reportado: **falta de `supabase/config.toml` com `verify_jwt=false` em `mp-webhook`**. O 401 vem do gateway do Supabase, não do seu HMAC. Por isso seus logs nunca aparecem — a função não roda. Aplica Fix #1, redeploya com `--no-verify-jwt`, testa o `?ping=1`. Em paralelo, aplica Fix #2 (trim + lowercase + janela 1h) pra não cair na 2ª rodada de debug quando assinaturas vierem.

Existem 4 bombas-relógio latentes (C-3, C-5, A-4, M-4) que só vão acordar depois que o webhook começar a executar — fica todas em uma janela de manutenção curta após Fix #1.

Próximo gargalo provável após resolver tudo isto: comportamento de retries do MP em pagamentos `pending → approved` (atraso típico de PIX é 1-3s; comprador que demora 5min cai em `expirado` e o `back_url` redireciona pro app com `?pagamento=falha`, mas o `contatosLiberados` Set não foi atualizado — usuário vê "pagar de novo"). Vale um quick-fix em `App.tsx:1906` mostrando "Estamos confirmando seu pagamento... isso pode levar até 1 minuto" em vez do current toast otimista.
