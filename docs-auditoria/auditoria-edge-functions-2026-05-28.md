# Auditoria — Edge Functions (não-pagamento)

Data: 2026-05-28
Branch: `claude/project-review-restoration-XBkFf`
Auditor: Claude (Opus 4.7)
Escopo: `ai-support`, `send-push`, `delete-user`, `export-user-data`,
`lookup-by-cpf`, `mp-health-check`, `purge-antecedentes-storage`,
`_shared/rate-limit.ts`.

## Sumário

- **7 funções auditadas** + 1 helper compartilhado.
- **3 críticos**, **8 altos**, **9 médios**, **5 baixos / smell**.
- Maior risco: `delete-user` engole erros em cadeia e prossegue até
  `auth.admin.deleteUser`, podendo deixar registros órfãos no banco e
  ainda assim retornar 200/sucesso (LGPD descumprida silenciosamente).
- Segundo maior: `send-push` aceita `title`/`body` `undefined` sem
  validação — push real é entregue ao dispositivo com o literal
  "undefined", e o `catch` final vaza `String(err)` cru.
- `export-user-data`, `mp-health-check`, `purge-antecedentes-storage` e
  `delete-user` não têm rate-limit.

---

## Achados por função

### ai-support

`supabase/functions/ai-support/index.ts`

#### MED-1 — Falta timeout no fetch para Groq

`supabase/functions/ai-support/index.ts:412-427`

`fetch(GROQ_URL, …)` sem `AbortController`/`signal`. Se a Groq travar
(networking, rate-limit upstream), a Edge Function fica aguardando até o
limite do Supabase (~150s), queimando faturamento e prendendo a conexão
do usuário no spinner.

- **Fix:**

```ts
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 25_000);
let response: Response;
try {
  response = await fetch(GROQ_URL, { ..., signal: ctrl.signal });
} finally {
  clearTimeout(t);
}
```

E mapeia `AbortError` para `503` com a mesma mensagem genérica.

#### MED-2 — JSON.parse sem catch dedicado

`supabase/functions/ai-support/index.ts:381`

```ts
const { messages } = await req.json() as { messages: UserMessage[] };
```

Cliente enviando body não-JSON cai no `catch` externo da linha 453, que
retorna **500** "Erro inesperado. Entre em contato". O correto é **400
Bad Request** ("body inválido"). Não é exploit, é UX/log noise.

- **Fix:** envolver em try-catch local e retornar 400.

#### BAIXO-1 — CORS `*` em endpoint autenticado

`supabase/functions/ai-support/index.ts:323`

`Access-Control-Allow-Origin: *` é amplo. Como exige JWT, o risco real é
limitado, mas qualquer site malicioso pode chamar o endpoint usando
token vazado (XSS em outra origem). Aceitável; recomenda-se fixar em
`https://diariaja.vercel.app` quando o app web for o único cliente
(Capacitor faz fetch com Origin `https://localhost` no Android — checar
antes).

---

### send-push

`supabase/functions/send-push/index.ts`

#### CRÍTICO-1 — Erro 500 vaza mensagem crua

`supabase/functions/send-push/index.ts:305-310`

```ts
} catch (err) {
  return new Response(JSON.stringify({ error: String(err) }), {
    status: 500, ...
  });
}
```

`String(err)` para um erro do Supabase ou DOM pode incluir trecho de
query SQL, nome de tabela, IDs de registros e até stack. Quem chamar a
função do client recebe isso.

- **Fix:**

```ts
} catch (err) {
  console.error("[send-push] erro:", err instanceof Error ? err.message : err);
  return new Response(JSON.stringify({ error: "Erro interno." }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

#### ALTO-1 — `title`/`body` sem validação → push entrega "undefined"

`supabase/functions/send-push/index.ts:236-246`

```ts
const { user_ids, title, body: msgBody, url = "/", tipo = "default" } = await req.json() as {...};
if (!Array.isArray(userIdsRaw) || !userIdsRaw.length) {
  return new Response(JSON.stringify({ sent: 0 }), ...);
}
```

Não há verificação de `title`/`body`. Caller que esquece um campo manda
push contendo literal `"undefined"`. Pior: caller malicioso pode injetar
`title` enorme (> 4KB) e estourar o payload Web Push (FCM/Apple cortam
silenciosamente).

- **Fix:** validar/truncar:

```ts
const titleSafe = String(title ?? "DiáriaJá").slice(0, 80);
const bodySafe  = String(msgBody ?? "").slice(0, 240);
if (!titleSafe || !bodySafe) {
  return new Response(JSON.stringify({ error: "title e body são obrigatórios." }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

#### ALTO-2 — fetch para push endpoint sem timeout

`supabase/functions/send-push/index.ts:278-289`

`fetch(sub.endpoint, …)` no `Promise.all` sem `AbortController`. Um
endpoint FCM/Mozilla travado deixa o Promise pendurado e segura toda a
função até o limite global do Deno isolate. Em fan-out de 100 assinaturas
basta uma travar.

- **Fix:** adicionar `signal` com timeout de 8-10s por endpoint, e
  contabilizar como falha individual no `catch`.

#### MED-3 — `payload` sem limite efetivo

`supabase/functions/send-push/index.ts:270`

`JSON.stringify({...})` pode passar de 4KB se `title`/`body` forem
grandes. RFC 8291 limita a 4096 bytes em providers comuns. Após o
fix do ALTO-1, o cap por campo cobre isso, mas vale assert
`encBody.length <= 4096`.

#### MED-4 — Authorization usado pra rate-limit RPC

`supabase/functions/send-push/index.ts:232-234`

Rate-limit usa `supabaseUser` (com JWT do user) para chamar a RPC. Se a
RPC `check_rate_limit` tiver políticas de RLS mais restritas (alguma
mudança futura), o rate-limit começa a falhar com `fail-open` —
desligando proteção sem aviso. Usar `supabaseAdmin` aqui seria mais
correto.

#### BAIXO-2 — `eq("endpoint", sub.endpoint)` em delete por 410/404

`supabase/functions/send-push/index.ts:294-296`

Quando o provider retorna 410 (gone), apaga a subscription por
`endpoint`. Funciona, mas se duas linhas tiverem o mesmo endpoint (race
ao salvar do client), apaga ambas. Aceitável — endpoint é único por
device. Não é bug.

---

### delete-user

`supabase/functions/delete-user/index.ts`

#### CRÍTICO-2 — Swallow generalizado: usuário some do auth mesmo com erros parciais

`supabase/functions/delete-user/index.ts:71-105`

Toda a cadeia de deletes auxiliares usa:

```ts
await supabaseAdmin.from("X").delete().eq(...).then(undefined as any, () => {});
```

Isso transforma qualquer erro (FK violation, tabela existir mas com
política nova, timeout) em sucesso silencioso. Logo abaixo (linha 131) o
auth.users é removido. Resultado em falha parcial:

- `auth.users` apagado → usuário não loga mais, não pode reabrir
  reclamação.
- Linhas residuais em `convites`, `denuncias`, `mensagens` permanecem
  com `user_id` apontando pra UUID inexistente.
- LGPD Art. 18 VI (eliminação) **não é cumprida**; auditoria externa
  flagra orfanização.

- **Fix:** Coletar erros e abortar antes do `auth.admin.deleteUser` se
  houver falhas:

```ts
const erros: string[] = [];
async function safeDelete(tabela: string, q: () => Promise<{ error: any }>) {
  const { error } = await q();
  if (error && !/does not exist|relation .* does not exist/i.test(error.message)) {
    erros.push(`${tabela}: ${error.message}`);
  }
}

await safeDelete("convites", () =>
  supabaseAdmin.from("convites").delete()
    .or(`contratante_id.eq.${userId},diarista_id.eq.${userId},empregador_id.eq.${userId}`));
// ...idem para todas as tabelas

if (erros.length > 0) {
  console.error("[delete-user] falhas parciais para", userId.slice(0, 8), erros);
  return new Response(
    JSON.stringify({ error: "Falha ao apagar dados associados. Suporte foi notificado." }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
// Só agora delete auth.users
```

E adicionar uma tabela de "deleção pendente" + retry/cron para
robustez.

#### ALTO-3 — Sem rate-limit em endpoint destrutivo

`supabase/functions/delete-user/index.ts`

Não usa `rateLimitOrReject`. Token comprometido + curl repetido →
endpoint absorve N chamadas (a partir da 2ª devolve "user not found",
mas a 1ª já deletou tudo). Mais relevante: protege contra "desistência
no meio do clique" duplo.

- **Fix:** `rateLimitOrReject({ key: 'delete-user:user:${user.id}', max: 2, windowSeconds: 60 })`.

#### ALTO-4 — Sem reautenticação / confirmação de senha

`supabase/functions/delete-user/index.ts:39-47`

Stolen JWT = irreversible account wipe. Boas práticas LGPD/UX exigem
reautenticação (reentrar a senha) antes de delete definitivo.

- **Fix (server-side):** receber `{ password }` no body e revalidar com
  `supabaseUser.auth.signInWithPassword({ email: user.email, password })`
  antes de prosseguir. Ou exigir um `confirmation_code` recém-emitido por
  email/SMS.

#### ALTO-5 — Mensagem de erro do Supabase devolvida crua

`supabase/functions/delete-user/index.ts:131-137`

```ts
return new Response(JSON.stringify({ error: deleteError.message }), ...);
```

`deleteError.message` pode citar nome de tabela/coluna interna. Trocar
por mensagem genérica e logar a real.

#### ALTO-6 — Catch externo (linha 144) também vaza `String(err)`

`supabase/functions/delete-user/index.ts:144-148`

Mesmo bug do `send-push`. Trocar por mensagem fixa + console.error.

#### MED-5 — `.or(...)` com `userId` cru em filtro PostgREST

`supabase/functions/delete-user/index.ts:61,67-74`

```ts
.or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`)
```

Aqui `userId` vem do JWT validado (UUID v4), então não há injection
real. Mas o padrão é frágil — caso alguém propague `userId` cru de
outro lugar (ex: body de request), abre vetor PostgREST filter injection.

- **Fix preventivo:** usar `.or(...)` só com identificadores
  pré-validados via `crypto.randomUUID()` regex ou
  `if (!/^[0-9a-f-]{36}$/i.test(userId)) return 400`.

#### MED-6 — Ordem de delete em `diarias` pode quebrar FK

`supabase/functions/delete-user/index.ts:109-110`

```ts
await supabaseAdmin.from("diarias").update({ diarista_aceite_id: null }).eq("diarista_aceite_id", userId);
await supabaseAdmin.from("diarias").delete().eq("empregador_id", userId);
```

`candidaturas` foi deletada em linha 64 apenas por `diarista_id =
userId`. Mas há candidaturas de **outros diaristas** em diárias do
**user-empregador** que vai ter `diarias` deletada na linha 110 — se a FK
`candidaturas → diarias` for `RESTRICT`, isso explode. O `.then(undefined
as any, () => {})` esconde o erro (ver CRÍTICO-2). Verificar FK e/ou
deletar candidaturas das diárias do empregador antes:

```ts
await supabaseAdmin.from("candidaturas").delete()
  .in("diaria_id", (await supabaseAdmin.from("diarias").select("id").eq("empregador_id", userId)).data?.map(d => d.id) || []);
```

(Ou confiar em `ON DELETE CASCADE` se já existir — confirmar na
migration.)

---

### export-user-data

`supabase/functions/export-user-data/index.ts`

#### ALTO-7 — Sem rate-limit em endpoint caro (LGPD)

`supabase/functions/export-user-data/index.ts:47`

15 queries paralelas + service_role + JSON grande. Caller logado pode
disparar 1000x/min → Supabase tier estoura. Mais importante: token
roubado → DSAR não autorizado de todos os dados do usuário.

- **Fix:** `rateLimitOrReject({ key: 'export-user-data:user:${uid}', max: 3, windowSeconds: 3600 })`.

#### MED-7 — Race condition no merge de avaliações (linhas 93-102)

`supabase/functions/export-user-data/index.ts:93-102`

```ts
supabase.from("avaliacoes_diarista").select("*").eq("empregador_id", uid)
  .then(async (a) => {
    const b = await supabase.from("avaliacoes_empregador").select("*").eq("diarista_id", uid);
    return { data: [...(a.data || []), ...(b.data || [])] };
  }),
```

Esse `.then` é executado dentro do `Promise.all`. O `await` interno
sequencializa — perde o paralelismo. Não é bug funcional, mas dois
queries que poderiam ser separados no array do `Promise.all` viraram
serial. Bug pequeno: se `a.data` der erro, ele é convertido em `[]`
silenciosamente e `b` é executado mesmo assim, mascarando falha.

- **Fix:** desempacotar como 4 entradas separadas no `Promise.all`:

```ts
const [a1, a2, b1, b2] = await Promise.all([
  supabase.from("avaliacoes_diarista").select("*").eq("empregador_id", uid),
  supabase.from("avaliacoes_diarista").select("*").eq("diarista_id", uid),
  supabase.from("avaliacoes_empregador").select("*").eq("diarista_id", uid),
  supabase.from("avaliacoes_empregador").select("*").eq("empregador_id", uid),
]);
```

#### MED-8 — Service-role lê tudo, qualquer falha silenciosa devolve `[]`

`supabase/functions/export-user-data/index.ts:125-139`

`diariasComoContratante.data || []` etc. Se qualquer query retornar
`error`, devolve array vazio sem sinalizar. Para LGPD, exportação
incompleta sem aviso é violação.

- **Fix:** colecionar `error`s e devolver `partial_failures: [...]` no
  dump, ou 500 se alguma essencial (profile) falhar.

#### BAIXO-3 — Filename pode colidir

`supabase/functions/export-user-data/index.ts:148`

`diariaja-export-${uid.slice(0,8)}-${Date.now()}.json` — `slice(0,8)`
do UUID pode colidir (chance baixa mas real). Aceitável.

---

### lookup-by-cpf

`supabase/functions/lookup-by-cpf/index.ts`

#### ALTO-8 — Rate-limit usa chave por IP atrás de NAT/Vercel

`supabase/functions/lookup-by-cpf/index.ts:131-137`

`x-forwarded-for` no Vercel pode ser confiável, mas redes corporativas /
NAT carrier (4G de operadora) → 5 logins legítimos do mesmo IP em 60s
retornam 429. Falha aberta no fail-open de `rate-limit.ts` (linhas 55,
71) **passa requisições** se RPC falhar — combinando os dois, o
rate-limit é pouco efetivo.

- **Fix:** usar chave composta (IP + hash do digits enviado) — limita
  brute-force do mesmo CPF sem punir IPs grandes:

```ts
const key = `lookup-by-cpf:ip:${ip}:cpf:${digits.slice(-4)}`;
```

E elevar `max` pra 10/min.

#### MED-9 — Rate-limit antes da validação do método HTTP

`supabase/functions/lookup-by-cpf/index.ts:124-148`

GET request consome rate-limit budget. Atacante pode esgotar o limite de
uma vítima enviando GETs (que vão falhar mais adiante). Validar
`req.method === "POST"` antes do rate-limit.

#### BAIXO-4 — Rate-limit chamado com SERVICE_ROLE

`supabase/functions/lookup-by-cpf/index.ts:132-137`

Não tem JWT pra invocar rate-limit com cliente user. Usar
`supabaseRL` (service_role) está OK aqui mas inconsistente com a
documentação do `_shared/rate-limit.ts`. Tudo bem — endpoint é público.

#### BAIXO-5 — `tempo mínimo` pode ser percebido por benchmarking

`supabase/functions/lookup-by-cpf/index.ts:67`

450ms é constante. Atacante mede e diferencia "respondeu em 450ms exato"
(cached / inválido) vs "respondeu em 455ms" (caminho longo). Variância
~5ms na rede mascara, mas em testes locais isso vaza. Vale jitter:

```ts
const TEMPO_MIN_RESPOSTA_MS = 450 + Math.floor(Math.random() * 80);
```

---

### mp-health-check

`supabase/functions/mp-health-check/index.ts`

#### ALTO-9 — Vaza prefixo de 8 chars de cada secret

`supabase/functions/mp-health-check/index.ts:38-43`

```ts
detalhe: `presente (${value!.length} chars, prefixo ${value!.slice(0, 8)}...)`,
```

Quem chamar com `x-health-check-secret` ou JWT admin recebe 8 chars de
`MP_ACCESS_TOKEN`, `MP_SUBSCRIPTION_TOKEN`, `MP_WEBHOOK_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`. Combinado com vazamento do secret de admin
ou conta admin comprometida → 8 chars revelam env (PROD/TEST) e podem
ajudar em ataques de pattern-matching (MP tokens têm formato
previsível). É access-gated mas é PII de credencial.

- **Fix:** trocar por `detalhe: ok ? "presente (${len} chars)" : "ausente"`.

#### MED-10 — `checkMpCheckoutPro` cria preference REAL

`supabase/functions/mp-health-check/index.ts:84-132`

A cada call de health-check, **uma preference de R$1,00 é criada na conta
MP**. Polui o painel, conta pra rate-limit do MP, e gera external_reference
`healthcheck::<ts>` no histórico. Se o cron rodar a cada 5 min: 288
preferences/dia, ~100k/ano.

- **Fix:** trocar por `GET /checkout/preferences/search?limit=1` (lista),
  ou usar uma flag `?dry_run=1` para o caller decidir.

#### MED-11 — Sem timeout em fetch para MP

`supabase/functions/mp-health-check/index.ts:51-54, 89-107, 141-144`

`fetch` ao MP sem `AbortController`. Health-check pode pendurar minutos
em queda de DNS. Adicionar `signal: AbortSignal.timeout(10_000)`.

#### MED-12 — Sem rate-limit

Permite admin/secret holder invocar repetidamente. Pequeno risco; ainda
assim cada chamada faz 4 fetches reais ao MP.

#### BAIXO-6 — Mensagem de network leak

`supabase/functions/mp-health-check/index.ts:78, 124, 160`

```ts
detalhe: `network error: ${err instanceof Error ? err.message : String(err)}`,
```

Para admin é ok (debug); para quem entrar com `x-health-check-secret` é
informação interna. Aceitável dado o gate.

---

### purge-antecedentes-storage

`supabase/functions/purge-antecedentes-storage/index.ts`

#### ALTO-10 — Paginação ausente em `list("")` e `list(userIdPrefix)`

`supabase/functions/purge-antecedentes-storage/index.ts:86-87, 95-97`

```ts
.list("", { limit: 1000 })   // só primeiros 1000 user_ids
.list(userIdPrefix, { limit: 100 })  // só primeiros 100 arquivos por user
```

Não há `offset`/loop. Em produção, após ~1000 usuários com upload, o
1001º nunca é purgado → LGPD/retenção quebrada silenciosamente. Cron
acha que está OK porque `purgados` retorna número positivo.

- **Fix:** loop com offset:

```ts
let offset = 0;
while (true) {
  const { data: pastas } = await supabase.storage.from("antecedentes")
    .list("", { limit: 1000, offset });
  if (!pastas || pastas.length === 0) break;
  for (const p of pastas) { /* ... */ }
  if (pastas.length < 1000) break;
  offset += 1000;
}
```

E mesma coisa pra `list(userIdPrefix)`.

#### MED-13 — Carrega todas URLs ativas na memória

`supabase/functions/purge-antecedentes-storage/index.ts:78-82`

`select("antecedentes_url")` sem paginação. Em 1M users isso vira ~100MB
no isolate. Aceitável agora, marca pra refatorar antes de escalar.

#### MED-14 — Sem rate-limit, sem idempotência explícita

Cron multi-instância pode rodar em paralelo (Vercel + GitHub Action ao
mesmo tempo) → dois loops tentando `remove` os mesmos paths → segunda
chamada vê 0 a apagar mas conta como sucesso. Não causa dano, mas
sobrecarrega Storage.

- **Fix:** mutex via RPC (`pg_try_advisory_lock`) ou tabela
  `purge_runs` com `INSERT ... ON CONFLICT DO NOTHING RETURNING id`.

#### BAIXO-7 — `arq.created_at` pode ser `null`

`supabase/functions/purge-antecedentes-storage/index.ts:106-107`

```ts
const created = arq.created_at ? new Date(arq.created_at).getTime() : 0;
if (created > 0 && created > cutoffMs) { ignorados++; continue; }
```

Se `created_at` for `null`/`undefined`, `created = 0`, NÃO entra no `if`,
e arquivo cai no `aDeletar`. Estado raro, mas significa "se Storage não
sabe a idade, apagamos por garantia". Documentar como decisão consciente.

---

### _shared/rate-limit.ts

`supabase/functions/_shared/rate-limit.ts`

#### MED-15 — Fail-open silencioso é decisão arriscada

`supabase/functions/_shared/rate-limit.ts:53-72`

Se a RPC falhar (tabela `rate_limits` apagada, migration revertida,
permissão removida), TODO o sistema passa a aceitar tráfego ilimitado em
TODOS os endpoints — incluindo `ai-support` (gasto Groq), `send-push`
(pode ser usado pra phishing) e `lookup-by-cpf` (enumeração).

`console.warn` é o único sinal. Em produção sem alerta no log, ninguém
sabe.

- **Fix mínimo:** emitir métrica/contador via tabela
  `rate_limit_failures` ou um eventer. Idealmente: variável de ambiente
  `RATE_LIMIT_FAIL_MODE=closed|open` e default `closed` para endpoints
  públicos (`lookup-by-cpf`).

#### BAIXO-8 — `getClientIp` confia em `x-forwarded-for` sem assinatura

`supabase/functions/_shared/rate-limit.ts:19-26`

Cliente pode injetar `x-forwarded-for: 1.2.3.4` no curl. Em Edge
Functions do Supabase, o gateway substitui antes do isolate (parecido com
Vercel). Verificar e documentar essa premissa. Se for falso, atacante
varia `x-forwarded-for` e escapa do limite.

---

## Padrões a evitar (template)

Recapitulação do que vi repetido entre as funções — vale fazer revisão em
todas as Edge Functions, inclusive as do auditor de pagamentos.

### 1. `catch (err) { return new Response(JSON.stringify({ error: String(err) })) }`

Vaza stack, nome de tabela, query. Sempre retornar mensagem genérica e
logar a real via `console.error` (com pseudonimização — só
`user.id.slice(0, 8)`, nada de email/CPF).

### 2. `.then(undefined as any, () => {})`

Engole erros para o catch externo nunca disparar. Compromete LGPD em
fluxos destrutivos (delete-user). Substituir por `safeDelete` que
coleciona erros.

### 3. `fetch(externo, ...)` sem `AbortController`

Toda chamada externa (Groq, MP, Push provider) deve ter
`signal: AbortSignal.timeout(N_MS)`. Caso contrário, Edge Function pode
ficar paga por minutos travada num upstream lento.

### 4. Authorization header validado mas `getUser()` resultado não checado

Verifiquei que ai-support, send-push, delete-user, export-user-data,
mp-health-check, purge-antecedentes-storage fazem `getUser()` e bouncam
401 em erro. Isso é OK. Mas confiar em `authHeader` truthy sem
`getUser()` (não vi em nenhuma das auditadas) seria um bug — deixar
nota para futuras funções.

### 5. `console.log` com `user.id`/`email`/`cpf`

LGPD pede pseudonimização. Use `user.id.slice(0, 8)` ou hash.
**Não vi vazamento desse tipo nas funções auditadas** — `export-user-data`
e `purge-antecedentes-storage` já usam mensagens neutras. Mas
`mp-health-check` loga prefixos de secrets (ALTO-9).

### 6. CORS `*` por padrão

OK para `lookup-by-cpf` (público pra login) e `mp-health-check`
(admin-gated). Para endpoints autenticados que só servem o web app,
fixar em `https://diariaja.vercel.app` reduz a janela de exploração de
JWT vazado por XSS de terceiro.

### 7. Rate-limit ausente

Falta em: `delete-user`, `export-user-data`, `mp-health-check`,
`purge-antecedentes-storage`. Aplicar `rateLimitOrReject` em todos, com
budget proporcional ao custo da operação.

---

## Fix pronto (diffs literais — não aplicados, só sugeridos)

### Fix CRÍTICO-1 (send-push: vazamento no catch)

```diff
- } catch (err) {
-   return new Response(JSON.stringify({ error: String(err) }), {
-     status: 500,
-     headers: { ...corsHeaders, "Content-Type": "application/json" },
-   });
- }
+ } catch (err) {
+   console.error("[send-push] erro:", err instanceof Error ? err.message : String(err));
+   return new Response(JSON.stringify({ error: "Erro interno." }), {
+     status: 500,
+     headers: { ...corsHeaders, "Content-Type": "application/json" },
+   });
+ }
```

### Fix ALTO-1 (send-push: validação de title/body)

```diff
  const { user_ids: userIdsRaw, title, body: msgBody, url = "/", tipo = "default" } = await req.json() as {
    user_ids: string[];
    title: string;
    body: string;
    url?: string;
    tipo?: string;
  };

  if (!Array.isArray(userIdsRaw) || !userIdsRaw.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
+ const titleSafe = (typeof title === "string" ? title : "").trim().slice(0, 80);
+ const bodySafe  = (typeof msgBody === "string" ? msgBody : "").trim().slice(0, 240);
+ if (!titleSafe || !bodySafe) {
+   return new Response(
+     JSON.stringify({ error: "title e body são obrigatórios e devem ser strings." }),
+     { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
+   );
+ }
  // ...
- const payload = JSON.stringify({ title, body: msgBody, url, tipo, icon: "/icon-192.png", badge: "/icon-192.png" });
+ const payload = JSON.stringify({ title: titleSafe, body: bodySafe, url, tipo, icon: "/icon-192.png", badge: "/icon-192.png" });
```

### Fix ALTO-2 (send-push: timeout no fetch do push endpoint)

```diff
  await Promise.all(subs.map(async (sub) => {
    try {
      const auth = await buildVapidAuth(sub.endpoint, vapidPublic, vapidPrivate, vapidSubject);
      const { body: encBody, salt } = await encrypt(payload, sub);

+     const ctrl = new AbortController();
+     const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: { ... },
        body: encBody,
+       signal: ctrl.signal,
-     });
+     }).finally(() => clearTimeout(t));

      if (res.ok || res.status === 201) {
        sent++;
      } else if (res.status === 410 || res.status === 404) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    } catch {
      // Falha individual (incluindo AbortError) não cancela as outras
    }
  }));
```

### Fix CRÍTICO-2 (delete-user: parar antes do auth.users em falha parcial)

```diff
+ const erros: string[] = [];
+ async function safeDelete(tabela: string, q: () => any) {
+   try {
+     const { error } = await q();
+     if (error && !/does not exist|relation .* does not exist/i.test(error.message)) {
+       erros.push(`${tabela}: ${error.message}`);
+     }
+   } catch (e) {
+     erros.push(`${tabela}: ${e instanceof Error ? e.message : String(e)}`);
+   }
+ }
+
- await supabaseAdmin.from("mensagens").delete().or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`);
- await supabaseAdmin.from("candidaturas").delete().eq("diarista_id", userId);
- await supabaseAdmin.from("avaliacoes_diarista").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
- // ... etc, todos os await com .then(undefined as any, () => {})
+ await safeDelete("mensagens", () => supabaseAdmin.from("mensagens").delete().or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`));
+ await safeDelete("candidaturas", () => supabaseAdmin.from("candidaturas").delete().eq("diarista_id", userId));
+ await safeDelete("avaliacoes_diarista", () => supabaseAdmin.from("avaliacoes_diarista").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`));
+ // ... todos os outros via safeDelete
+
+ if (erros.length > 0) {
+   console.error("[delete-user] falhas parciais", userId.slice(0, 8), erros);
+   return new Response(
+     JSON.stringify({ error: "Falha ao apagar dados associados. Tente novamente ou contate suporte." }),
+     { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
+   );
+ }
+
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
```

### Fix ALTO-9 (mp-health-check: parar de vazar prefixo do secret)

```diff
- detalhe: ok
-   ? `presente (${value!.length} chars, prefixo ${value!.slice(0, 8)}...)`
-   : "ausente ou vazio",
+ detalhe: ok ? `presente (${value!.length} chars)` : "ausente ou vazio",
```

### Fix ALTO-10 (purge-antecedentes: paginação)

```diff
- const { data: pastas, error: errPastas } = await supabase.storage
-   .from("antecedentes")
-   .list("", { limit: 1000 });
- if (errPastas) throw errPastas;
-
- for (const p of pastas ?? []) { /* ... */ }
+ let offsetUsers = 0;
+ while (true) {
+   const { data: pastas, error: errPastas } = await supabase.storage
+     .from("antecedentes")
+     .list("", { limit: 1000, offset: offsetUsers });
+   if (errPastas) throw errPastas;
+   if (!pastas || pastas.length === 0) break;
+
+   for (const p of pastas) {
+     // ... loop interno também com paginação por offset
+     let offsetArq = 0;
+     while (true) {
+       const { data: arquivos, error: errArq } = await supabase.storage
+         .from("antecedentes").list(p.name, { limit: 100, offset: offsetArq });
+       if (errArq || !arquivos || arquivos.length === 0) break;
+       /* processa arquivos */
+       if (arquivos.length < 100) break;
+       offsetArq += 100;
+     }
+   }
+
+   if (pastas.length < 1000) break;
+   offsetUsers += 1000;
+ }
```

### Fix ALTO-7 (export-user-data: rate-limit)

```diff
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user?.id) return json({ error: "Token inválido ou expirado." }, 401);

+ // LGPD DSAR é operação cara — 3 exportações por hora é generoso e
+ // limita abuso de token comprometido.
+ const blocked = await rateLimitOrReject(
+   { key: `export-user-data:user:${user.id}`, max: 3, windowSeconds: 3600, corsHeaders: CORS },
+   userClient,
+ );
+ if (blocked) return blocked;
+
  // Daqui pra frente usa service_role pra ler tudo sem barreira de RLS
```

(E `import { rateLimitOrReject } from "../_shared/rate-limit.ts";` no
topo.)

### Fix ALTO-3 (delete-user: rate-limit)

```diff
+ import { rateLimitOrReject } from "../_shared/rate-limit.ts";
+
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(...);
  }
+
+ const blocked = await rateLimitOrReject(
+   { key: `delete-user:user:${user.id}`, max: 2, windowSeconds: 60, corsHeaders },
+   supabaseUser,
+ );
+ if (blocked) return blocked;
+
  const userId = user.id;
```

### Fix MED-1 (ai-support: timeout no Groq)

```diff
+ const ctrl = new AbortController();
+ const t = setTimeout(() => ctrl.abort(), 25_000);
- const response = await fetch(GROQ_URL, {
+ const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: { ... },
    body: JSON.stringify({ ... }),
+   signal: ctrl.signal,
- });
+ }).finally(() => clearTimeout(t));
```

---

## Resumo executivo (ordem de fix sugerida)

1. **CRÍTICO-2** (delete-user swallow) — risco LGPD imediato. ~1h.
2. **CRÍTICO-1** (send-push catch leak) — risco vazamento. ~10min.
3. **ALTO-1** (send-push undef payload) — bug visível ao usuário. ~10min.
4. **ALTO-3** + **ALTO-4** (delete-user sem RL/reauth) — segurança. ~30min.
5. **ALTO-7** (export-user-data sem RL) — custo + LGPD abuse. ~5min.
6. **ALTO-9** (mp-health-check vaza prefixos) — credencial. ~3min.
7. **ALTO-10** (purge paginação) — LGPD eventual. ~30min.
8. **ALTO-2** (send-push timeout) — robustez. ~15min.
9. Demais médios em uma única PR de "hardening Edge Functions".

Tempo total estimado: 3-4h de trabalho para fechar todos os altos +
críticos.
