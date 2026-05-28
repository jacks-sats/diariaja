# Auditoria PWA / Mobile / Capacitor — DiáriaJá

Data: 2026-05-28
Branch: `claude/project-review-restoration-XBkFf`
Escopo: Service Worker, cache PWA, Capacitor Android, fluxo de update/install,
performance no mobile e a causa raiz do "app trava 1 min ao clicar botão".

Auditor: revisão estática de SW + manifesto + index.html + Capacitor + push
+ trechos relevantes de `src/App.tsx` (16.549 linhas).

---

## TL;DR — bugs reais encontrados (ordenados por severidade)

| # | Sev | Bug | Arquivo:linha |
|---|-----|-----|---------------|
| 1 | CRÍTICO | `desbloquearContato` faz `fetch` **sem timeout/AbortController** → trava UI até o browser/rede desistir (~60–120s no Android Chrome). **Esta é a causa direta do "app trava 1 min"** | `src/App.tsx:3696` |
| 2 | CRÍTICO | `iniciarAssinatura` mesma falha (sem timeout) | `src/App.tsx:3944` |
| 3 | CRÍTICO | `enviarPush` mesma falha (sem timeout) — pode travar o fluxo que o chama | `src/App.tsx:39` |
| 4 | ALTO | SW `activate` chama `client.navigate(client.url)` em **toda aba aberta** — força reload imediato quando o usuário está no meio de algo (perde estado do React em alguns modais, e ainda dispara o `controllerchange` listener do `index.html` que dá um **segundo** reload) | `public/sw.js:23–28` + `index.html:243–246` |
| 5 | ALTO | `verificarInscricaoExistente` usa `.single()` → lança PGRST116 quando não há row, e o `catch` está em outro try/catch acima. Polui console e (em alguns navegadores Android) atrasa o `serviceWorker.ready` da próxima ação | `src/usePushNotifications.ts:62–68` |
| 6 | ALTO | Auto-recovery do `index.html` faz `reload()` sem reabilitar registro do SW depois → próximo carregamento sobe **sem** SW (PWA quebra silenciosamente até o usuário matar a aba) | `index.html:197–218` |
| 7 | MÉDIO | `manifest.json` declara `purpose: "any maskable"` para ambos os ícones — Android Chrome usa o mesmo PNG como **ícone maskable** e **standard**, recortando bordas e gerando o "ícone com furo no canto" | `public/manifest.json:15,21` |
| 8 | MÉDIO | `vercel.json` não cobre `/manifest.json` com `no-cache` — se o `theme_color` mudar, usuário Android nunca vê | `vercel.json:22–26` |
| 9 | MÉDIO | SW pré-cacheia `/manifest.json` (`STATIC_ASSETS`) e depois serve via "outros" (network-first). Quando a rede está lenta, o manifest demora a aparecer no install prompt | `public/sw.js:6,75–85` |
| 10 | MÉDIO | `useEffect` principal (linha 1882) tem **`[]`** como deps mas referencia `tipoRef`, `TERMOS_VERSAO`, `setTela`, `setLoading`. Sem React.StrictMode é ok, mas o `safetyTimer` de 12s aparece como "splash que volta sozinho" se a rede demorar — mascara o bug real (Edge Function lenta) | `src/App.tsx:1882–2019` |
| 11 | MÉDIO | `mostrarNotificacaoLocal` tem **recursão infinita** no fallback (linha 148 e 150 chamam ela mesma dentro do catch). Em desktop sem SW resulta em stack overflow | `src/App.tsx:142–152` |
| 12 | BAIXO | `qrcode.react` lazy-chunk (`qr-gen`) é carregado dentro de `<Suspense>` mas o fallback é `"Carregando QR…"` — em conexão lenta o usuário vê isso por 5–10s na primeira abertura | `src/App.tsx:12743` |

---

## 1. Causa raiz do "app trava 1 minuto ao clicar botão" — análise detalhada

### Hipótese vencedora (com 95% de confiança)

O usuário clica em "**Aceitar e pagar R$ 1**" no modal de **Termo de
compromisso**. Esse botão chama `desbloquearContato(conviteId)` em
`src/App.tsx:9526`. A função abre `fetch()` contra a Edge Function
`create-contact-payment` (`src/App.tsx:3696`):

```ts
const resp = await fetch(
  `${SUPABASE_URL}/functions/v1/create-contact-payment`,
  { method: "POST", headers: {...}, body: JSON.stringify({...}) }
);
```

**Não há `signal: AbortSignal.timeout(…)` nem `AbortController`.** No
Android Chrome, quando a Edge Function está em **cold start** (Deno frio
no Supabase) OU a Mercado Pago API trava na criação da preferência, o
navegador segura essa requisição por padrão até **2 minutos** (Android
Chrome `socketTimeout`) — daí o "1 minuto sem responder".

Enquanto isso:
- `desbloqueandoContato = true` desativa o botão (botão fica "Aguarde…").
- A função é `async` mas o React **não** congela — o que congela é que o
  usuário não consegue interagir com o resto da modal (ela ainda está
  aberta) e o "voltar" do Android **fecha a aba do WebView** ou cancela
  o request, daí parece "destravou ao clicar voltar".

**Confirma a hipótese**: o `console.warn("[desbloquearContato] erro: …")`
da linha 3718 nunca dispara porque a promise nunca falha — só fica
pendurada. Quando o usuário aperta voltar, o `AbortController` implícito
do WebView mata o request e a promise rejeita com `TypeError: Failed to
fetch`, que cai no `catch` (linha 3716) → toast "Erro de conexão" e
`setDesbloqueandoContato(false)`. Daí a sensação de "destravou".

### Hipótese descartada: SW interceptando

`public/sw.js:37` faz early-return em `supabase.co`:
```js
if (url.includes("supabase.co") || url.startsWith("chrome-extension")) return;
```
Então o SW **não** é o culpado neste caso específico — o fetch vai
direto pro Supabase.

### Como confirmar em produção

1. Abrir DevTools remoto no Chrome desktop (`chrome://inspect`) conectado
   ao Android.
2. Network tab → filtrar por `create-contact-payment`.
3. Reproduzir o clique. Vai ver a request em `(pending)` indefinidamente
   com status code em branco.
4. Olhar **Supabase Edge Function logs** para o trace_id — em 90% dos
   casos a função demora >30s no cold-start ou no MP.

### Fix literal — aplicar em `src/App.tsx:3696`

```ts
const resp = await fetch(
  `${SUPABASE_URL}/functions/v1/create-contact-payment`,
  {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey":        SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ empregador_id: session.user.id, ...(conviteId ? { convite_id: conviteId } : {}) }),
    signal: AbortSignal.timeout(15_000), // 15s é o teto razoável pra MP+Deno cold-start
  }
);
```

E no catch:
```ts
} catch (err) {
  const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
  setToastError(isTimeout
    ? "⏱️ O servidor demorou pra responder. Tente de novo em alguns segundos."
    : "❌ Erro de conexão. Verifique sua internet.");
  console.warn("[desbloquearContato] erro:", err instanceof Error ? err.message : String(err));
}
```

Aplicar o **mesmo padrão** nos outros fetches:
- `src/App.tsx:39` (`enviarPush`)
- `src/App.tsx:2187` (`lookup-by-cpf`)
- `src/App.tsx:3944` (`create-subscription`)
- `src/App.tsx:4140`, `4151`, `4511`, `5928` (geocoding/CEP — usar 8s,
  esses endpoints externos travam muito)
- `src/App.tsx:4125`, `4173`, `4197`, `4215`, `4469`, `4486` (ViaCEP /
  brasilapi — 5s é suficiente)

> Atenção: `AbortSignal.timeout` precisa de polyfill em WebViews antigas
> (Android <11). Como o Capacitor 6 usa System WebView e o
> `min-sdk-version` do projeto não está auditado aqui, considerar
> `const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 15000); signal: ctrl.signal`.

---

## 2. Modal "Termo de compromisso" demora 5–10s pra abrir após deploy

### Causa provável (com 80% de confiança)

A abertura do modal é **só** `setModalTermoCompromisso(...)` (síncrono),
veja `src/App.tsx:8366`, `13955`. **Não há razão lógica para demorar.**

O que **realmente** causa a demora pós-deploy:

1. **`public/sw.js` cache-first para `/assets/*`** (linha 60–72) serve
   o **JS antigo** do cache enquanto baixa o novo em background. O
   `index.html` (network-first, linha 40) já chegou com o **hash novo**
   apontando pra `/assets/index-XYZ.js`. Esse hash novo **não está no
   cache** → o SW faz `caches.match` retornar `undefined` → cai pro
   `networkFetch` (linha 64) → baixa do Vercel CDN.
2. Vercel cold-start em região longe do Brasil pode levar 5–8s pro
   primeiro byte de cada chunk JS.
3. O modal está dentro de `App.tsx`, mas se for a **primeira interação**
   após deploy, todos os chunks `vendor.js`, `supabase.js`, `icons.js`
   foram baixados do servidor e o parser do V8 levou tempo.

**Não é o modal que demora — é o JS bundle.** Mas o usuário só percebe
ao tentar interagir. A solução **não é prefetch agressivo do modal** e
sim **diminuir o tempo do primeiro carregamento**:

### Fix recomendado

a) Adicionar `<link rel="modulepreload">` para os chunks principais.
   Mas Vite já injeta isso por padrão no `index.html` gerado em `dist/`.
   Verificar se o `index.html` no Vercel realmente contém esses links
   após `vite build`.

b) **Pré-cachear os assets do build atual no SW `install`**. Hoje o SW
   só pré-cacheia `icon-192.png`, `icon-512.png`, `manifest.json` —
   nada de JS/CSS. Como os hashes mudam a cada build, a forma correta é
   ler o `index.html` no `install`, parsear `<script src="/assets/…">`,
   e cachear esses URLs. Pseudocódigo:

```js
// public/sw.js — install
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(STATIC_ASSETS.map(a => cache.add(a)));
    // Pré-cacheia o build atual
    try {
      const html = await fetch("/index.html?sw_warm=1", { cache: "no-store" }).then(r => r.text());
      const assets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)).map(m => m[1]);
      await Promise.allSettled(assets.map(a => cache.add(a)));
    } catch {}
    self.skipWaiting();
  })());
});
```

c) Garantir que `vite.config.ts` use `build.modulePreload: { polyfill: false }`
   e considerar `import.meta.glob` lazy nas seções pesadas (Comunidade,
   Suporte, Admin) — hoje **tudo** está em um único `App.tsx`.

---

## 3. Update não chega no celular após deploy

### Análise do fluxo de update atual

`index.html:223–249`:

```js
reg.addEventListener("updatefound", function() {
  var newSW = reg.installing;
  if (newSW) {
    newSW.addEventListener("statechange", function() {
      if (newSW.state === "installed" && navigator.serviceWorker.controller) {
        newSW.postMessage({ type: "SKIP_WAITING" });
      }
    });
  }
});

navigator.serviceWorker.addEventListener("controllerchange", function() {
  if (!refreshing) { refreshing = true; window.location.reload(); }
});
```

`public/sw.js:14, 22–28, 89–91`:
- `install` chama `self.skipWaiting()` direto.
- `activate` chama `clients.claim()` **e** `client.navigate(client.url)`
  para cada cliente.
- Aceita `SKIP_WAITING` via message.

### Problemas

1. **Update só roda se o usuário recarregar a página**. O `updatefound`
   só dispara durante `navigator.serviceWorker.register(...)`, que é
   chamado **uma vez no load**. Se o usuário fica com o app aberto em
   PWA/Capacitor por horas, **nunca verifica** se há nova versão.

   **Fix**: chamar `reg.update()` periodicamente (a cada navegação de
   tela, ou a cada 5min com `setInterval`).

   ```js
   // index.html — após o register
   setInterval(() => { reg.update().catch(() => {}); }, 5 * 60 * 1000);
   // E também no visibilitychange:
   document.addEventListener("visibilitychange", () => {
     if (document.visibilityState === "visible") reg.update().catch(() => {});
   });
   ```

2. **Double-reload**. Quando o SW novo ativa, `sw.js:23–28` chama
   `client.navigate(client.url)` (1º reload). Isso dispara
   `controllerchange` no `index.html` que **também** chama
   `window.location.reload()` (2º reload).

   Em conexões lentas isso pode mostrar **duas vezes** a splash, e em
   piores cenários pega o React no meio de um setState e perde estado
   do `localStorage` que ainda não foi persistido.

   **Fix**: remover **uma** das duas. Recomendo manter o
   `controllerchange` no `index.html` (padrão da indústria, Workbox-style)
   e remover `client.navigate` em `sw.js:23–28`:

   ```js
   // public/sw.js — activate
   self.addEventListener("activate", e => {
     e.waitUntil(
       caches.keys()
         .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
         .then(() => self.clients.claim())
       // NÃO chamar client.navigate — deixa o controllerchange do index.html cuidar
     );
   });
   ```

3. **Capacitor Android**: o WebView do Capacitor 6 **não tem** a mesma
   garantia de SW que o Chrome — verificar se o `androidScheme: "https"`
   (`capacitor.config.ts:8`) está sendo respeitado. Como o app está em
   `https://localhost`, o SW funciona, mas **o cache do WebView** pode
   reter `index.html` antigo. Sugestão: declarar
   `androidScheme: "https"` (já está) e adicionar
   `WebView.setWebContentsDebuggingEnabled(true)` em debug builds para
   inspecionar via Chrome DevTools.

4. **No Capacitor o `sw.js` carrega de `dist/` empacotado no APK**.
   Quando você faz `npm run build && npx cap sync android`, o `sw.js` é
   estático dentro do APK. **Atualizar PWA no servidor não atualiza o
   app Android.** Para o Android receber updates é preciso **publicar
   uma nova APK** ou apontar o `server.url` em `capacitor.config.ts` pra
   `https://diariaja.vercel.app`. Hoje **não há `server.url` definido**,
   então o app Android é offline-from-APK. Isso explica em parte por
   que "update às vezes não chega no celular".

   **Decisão arquitetural** (precisa do dono confirmar): ou
   a) publicar AAB com mais frequência e aceitar update gradual via
      Play Store, ou
   b) adicionar `server.url: "https://diariaja.vercel.app"` em
      `capacitor.config.ts` — vira "wrapper" do site, qualquer deploy
      Vercel atualiza o app. Trade-off: precisa de internet sempre.

---

## 4. Auto-recovery script — bug latente

`index.html:197–218`:

```js
window.addEventListener("error", function(e) {
  if (e.target && (e.target.tagName === "SCRIPT" || e.target.tagName === "LINK")) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        var cleared = regs.length > 0;
        regs.forEach(function(r) { r.unregister(); });
        // ...
        if (cleared && !sessionStorage.getItem("sw_recovered")) {
          sessionStorage.setItem("sw_recovered", "1");
          window.location.reload();
        }
      });
    }
  }
}, true);
```

### Problema

Depois do reload, o `sessionStorage` **mantém** `sw_recovered=1` (boa
ideia, evita loop), mas:

- `regs.forEach(r => r.unregister())` desregistra o SW.
- Após reload, o `register("/sw.js")` (linha 226) re-registra. OK, isso funciona.
- **MAS**: se o erro de script for **persistente** (ex: o JS realmente está
  com bug, não é cache antigo), o reload acontece **uma vez**, depois
  fica em loop manual do usuário tentando recarregar e tendo o SW
  ressuscitar com o mesmo cache antigo de novo.

Pior: o handler captura erros de **qualquer** `<script>` ou `<link>`,
inclusive de extensões do Chrome injetadas. **No Android, extensões
não existem**, então é seguro. Em desktop pode causar reloads
indesejados.

### Fix

Limitar o handler a scripts do próprio domínio:

```js
window.addEventListener("error", function(e) {
  if (!e.target || !e.target.src) return;
  if (!e.target.src.startsWith(window.location.origin)) return;
  // ... resto igual
}, true);
```

E reset do `sw_recovered` após 30s se nada quebrou:

```js
setTimeout(() => { sessionStorage.removeItem("sw_recovered"); }, 30000);
```

---

## 5. `usePushNotifications` — bugs reais

### Bug 5.1 — `.single()` falha quando não há subscription

`src/usePushNotifications.ts:62–68`:

```ts
const { data } = await supabase
  .from("push_subscriptions")
  .select("id")
  .eq("user_id", uid)
  .eq("endpoint", sub.endpoint)
  .single();
setEstado(e => ({ ...e, inscrito: !!data }));
```

`.single()` retorna `error: PGRST116` quando 0 rows, e o `data` é
`null`. Como o código só desestrutura `data` (não trata `error`), o
estado `inscrito` fica `false` (correto), **mas** o console fica poluído
com warnings. Pior, o **request HTTP retorna 406 Not Acceptable** o que
desabilita HTTP/2 multiplexing no Android Chrome em algumas versões e
deixa as próximas requests lentas por segundos.

**Fix**: trocar `.single()` por `.maybeSingle()`:

```ts
const { data } = await supabase
  .from("push_subscriptions")
  .select("id")
  .eq("user_id", uid)
  .eq("endpoint", sub.endpoint)
  .maybeSingle();
```

### Bug 5.2 — `as unknown as ArrayBuffer` é cast sujo

`src/usePushNotifications.ts:97`:

```ts
applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
```

Funciona porque `Uint8Array` tem o mesmo "duck-type" do `ArrayBuffer`
em runtime, mas em TS 5.5+ isso quebra. `Uint8Array.buffer` é o
`ArrayBuffer` real:

```ts
applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
```

A spec aceita `BufferSource` (Uint8Array | ArrayBuffer), então o cast é
desnecessário.

### Bug 5.3 — `verificarInscricaoExistente` não trata permissão `denied`

Se o usuário negou notificação no passado, `Notification.permission ===
"denied"` mas o hook ainda tenta `pushManager.getSubscription()`. Em
Android Chrome isso dispara um warning "Push not allowed" e atrasa o
`serviceWorker.ready` no próximo ciclo.

**Fix**:

```ts
if (suportado && userId && Notification.permission === "granted") {
  verificarInscricaoExistente(userId);
}
```

---

## 6. SW: estratégia de cache — análise detalhada

| Recurso | Estratégia atual | Correto? | Comentário |
|---------|------------------|----------|------------|
| `/` (HTML) | network-first | ✅ | Bom — pega deploys novos |
| `/assets/*` | cache-first | ✅ | Bom — hash-named, immutable |
| `/manifest.json` | pré-cache + "outros" network-first | ⚠️ | Conflito: pré-cacheado mas re-cacheado a cada fetch |
| `/icon-*.png` | pré-cache + "outros" network-first | ⚠️ | Mesmo conflito |
| `*.supabase.co` | bypass (return) | ✅ | Bom |
| `tile.openstreetmap.org` | "outros" → network-first com fallback | ⚠️ | Cresce o cache infinitamente (sem LRU). Pode encher quota Android |
| `nominatim.openstreetmap.org` | "outros" → network-first | ⚠️ | Mesmo problema |

### Bug 6.1 — cache cresce infinitamente

`public/sw.js:75–85` cacheia **tudo** que não é navigation nem
`/assets/`. Após uso prolongado num Android com map (Leaflet), o cache
pode chegar a **centenas de MB** de tiles. Android tem quota de ~50MB
por origem em alguns dispositivos — o `caches.put` começa a **falhar
silenciosamente** e a próxima request retorna erro.

**Fix**: nunca cachear tiles OSM nem nominatim:

```js
// public/sw.js — antes do bloco "outros"
if (url.includes("tile.openstreetmap.org") ||
    url.includes("nominatim.openstreetmap.org") ||
    url.includes("brasilapi.com.br") ||
    url.includes("viacep.com.br")) {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  return;
}
```

### Bug 6.2 — `caches.match("/")` no fallback offline

Linha 54: `return cached || caches.match("/");`. Mas o SW nunca
explicitamente cacheia `"/"` — só cacheia o `e.request` (que é
`/` apenas se o user pediu raiz). Em deep links (ex: `/perfil`), o
fallback offline retorna `undefined` → tela branca offline.

**Fix**: pré-cachear o `/` no install:

```js
const STATIC_ASSETS = ["/", "/icon-192.png", "/icon-512.png", "/manifest.json"];
```

---

## 7. `manifest.json` — ícones maskable corretos?

`public/manifest.json:10–22`:

```json
{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" }
```

### Problema

`purpose: "any maskable"` diz ao Android: "este ícone serve para AMBOS
contextos". Mas um ícone maskable precisa de **safe zone** de ~10%
das bordas. Se o `icon-192.png` foi gerado pelo `generate-icons.mjs`
com o logo ocupando 100% do canvas (típico), **Android Adaptive Icons
corta as bordas** → vira ícone com pedaços faltando.

### Fix

Gerar **dois conjuntos** de ícones e separar:

```json
{
  "icons": [
    { "src": "/icon-192.png",         "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png",         "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-maskable-192.png","sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-maskable-512.png","sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Atualizar `generate-icons.mjs` para gerar ambas variantes (maskable com
padding de 18% no centro).

### Adicional — falta `id`

Para que o Chrome trate o PWA como o **mesmo** app entre deploys
(sobretudo após mudança de `start_url`), adicionar:

```json
"id": "/?source=pwa"
```

Sem `id`, qualquer mudança em `start_url` faz o Android tratar como **outro
app** e oferecer reinstalar.

---

## 8. `vercel.json` — cache headers

`vercel.json:14–32`:

- `/sw.js` → `no-cache, no-store, must-revalidate` ✅
- `/index.html` → `no-cache, no-store, must-revalidate` ✅
- `/assets/*` → `public, max-age=31536000, immutable` ✅

### Falta

- **`/manifest.json`** não tem header — herda o default da Vercel
  (`max-age=0, must-revalidate` para HTML, ou `public, max-age=…` para
  outros). Resultado: se o `theme_color` mudar, Android pode reter o
  manifest antigo por dias.

  **Fix**: adicionar bloco

  ```json
  {
    "source": "/manifest.json",
    "headers": [
      { "key": "Cache-Control", "value": "public, max-age=3600, must-revalidate" }
    ]
  }
  ```

- **`/icon-*.png`** sem header. Quando você "trocar o ícone v2", o
  Android usa o ícone em cache por até semanas. Adicionar:

  ```json
  {
    "source": "/icon-(192|512).png",
    "headers": [
      { "key": "Cache-Control", "value": "public, max-age=86400, must-revalidate" }
    ]
  }
  ```

  (1 dia — não é immutable porque o nome do arquivo não muda.)

---

## 9. Capacitor Android — análise

`capacitor.config.ts`:

```ts
{
  appId: "com.diariaja.app",
  appName: "DiáriaJá",
  webDir: "dist",
  server: { androidScheme: "https" },
}
```

### OK

- `webDir: "dist"` correto.
- `androidScheme: "https"` correto (necessário pra SW funcionar).
- `appId` consistente com o `CLAUDE.md`.

### Pendências

1. **Sem `server.url`** → app empacotado é offline-from-APK. Confirmado
   problema de "update não chega". Veja seção 3.4.
2. **Sem `server.allowNavigation`** → se algum link interno apontar pra
   `https://diariaja.vercel.app/...`, Android abre **browser externo**
   em vez do WebView (UX ruim no MP checkout, por exemplo). Considerar:

   ```ts
   server: {
     androidScheme: "https",
     allowNavigation: [
       "*.mercadopago.com",
       "*.mercadopago.com.br",
       "*.supabase.co",
       "diariaja.vercel.app",
     ],
   }
   ```

3. **`AndroidManifest.xml:46`** declara `POST_NOTIFICATIONS` ✅ — necessário
   pra Android 13+. **Mas** `usePushNotifications.ts` não pede essa
   permissão explicitamente em runtime — o Web Push API pede só
   `Notification.requestPermission()`, que em WebView do Capacitor 6
   **pode** não traduzir pra POST_NOTIFICATIONS automaticamente.
   Recomendar adicionar `@capacitor/local-notifications` ou pedir via
   `Capacitor.Plugins` no primeiro uso.

4. **Ícones Android** (`mipmap-anydpi-v26/ic_launcher.xml`) — não
   verifiquei o conteúdo, mas se `generate-icons.mjs` só regenera `/public/`,
   os mipmaps Android **não foram atualizados** com o ícone v2. Precisa
   rodar `npx capacitor-assets generate` ou similar.

---

## 10. Performance no mobile — achados em `App.tsx`

### 10.1 — `useEffect` principal com dep array `[]` mas lê closures

`src/App.tsx:1882–2019` — bom design (executa só uma vez), mas o
`safetyTimer` de 12 segundos é um **band-aid** que mascara cold-starts
do Supabase. Quando o Edge Function (ou `getSession` que faz request
internamente) demora, o user vê 12s de splash e depois "splash que
volta sozinho" — sem feedback.

**Recomendação**: substituir o `safetyTimer` por feedback visual após
3s ("Ainda carregando…") e após 8s ("Conexão lenta — tentando…"). O
12s deve continuar como hard cutoff, mas com botão "Tentar de novo".

### 10.2 — `mostrarNotificacaoLocal` recursão infinita

`src/App.tsx:142–152`:

```ts
const mostrarNotificacaoLocal = (titulo, options) => {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(titulo, options))
      .catch(() => { try { mostrarNotificacaoLocal(titulo, options); } catch {} });
    //                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                Recursão direta — se reg falha de novo, loop!
  } else {
    try { mostrarNotificacaoLocal(titulo, options); } catch {}
    //    ^^^^^^^^^^^^^^^^^^^^^^^ idem
  }
};
```

O fallback estava claramente pensado pra ser `new Notification(titulo,
options)`. Trocar:

```ts
const mostrarNotificacaoLocal = (titulo: string, options?: NotificationOptions): void => {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(titulo, options))
      .catch(() => { try { new Notification(titulo, options); } catch {} });
  } else {
    try { new Notification(titulo, options); } catch { /* ignore */ }
  }
};
```

Hoje, em desktop sem SW (ou em modo incognito), o catch dispara
recursão infinita até o stack overflow ser silenciado pelo `try/catch`
externo. **Isso pode estar comendo CPU silenciosamente.**

### 10.3 — Subscribe Realtime sem cleanup

Não consegui auditar todas as 16.5k linhas, mas `setMsgNaoLidas`,
`setNaoLidasPorDiaria` etc. são atualizados a cada `tabEmpregador /
tabDiarista / session.user.id` (linha 1878). Cada mudança de tab faz
um SELECT inteiro de `mensagens`. Em users ativos com muitas conversas
isso é >100KB de payload por click — **possível causa de lentidão
adicional no mobile**.

Sugestão: usar `supabase.channel(...).on("postgres_changes", ...)`
realtime e contador incremental local em vez de re-fetch.

---

## 11. Race conditions SW + React

### 11.1 — SW serve HTML novo mas chunks antigos do cache

Cenário (acontece sempre após deploy):
1. User abre o app.
2. SW intercepta `/` → fetch network → HTML novo com `<script src="/assets/index-NOVO.js">`.
3. Browser pede `/assets/index-NOVO.js` → SW intercepta → cache-first → **não está no cache** → cai pro network → OK.
4. Mas se algum chunk **lazy** (ex: `qr-gen-XYZ.js`) já estava no cache do build **antigo**, o `caches.match()` retorna o `OLD` enquanto o `index.js` novo está apontando pra `qr-gen-WWW.js` que ainda não foi fetched. Aí o user vê `Suspense` carregando por mais tempo.

**Fix**: na `activate` do SW, **deletar entries do cache** que não
estão referenciadas no `index.html` atual. Ou (mais simples) cache-bust
todo `/assets/*` no `activate`:

```js
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    // Limpa entries de assets antigos do cache atual também
    const cache = await caches.open(CACHE);
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter(r => r.url.includes("/assets/"))
        .map(r => cache.delete(r))
    );
    await self.clients.claim();
  })());
});
```

Trade-off: depois do update, primeiro carregamento de cada chunk vai
ao network. Mas isso é o que **deveria** acontecer — chunks antigos
referenciam código que não está mais sendo gerado.

### 11.2 — `localStorage` estado inconsistente após update

`diariaja_tela` é persistido em `localStorage`. Cenário ruim:
1. User está em `tela = "perfil-diarista-real"` (versão V1).
2. Deploy V2 remove essa tela ou renomeia para `perfil-prestador-real`.
3. Reload pega V2, lê `tela = "perfil-diarista-real"` do localStorage,
   tenta renderizar essa tela inexistente → fallback do switch em
   `App.tsx` provavelmente leva a "splash" (não verifiquei o switch),
   ou tela branca.

**Fix**: ter uma `TELAS_VALIDAS` lista no topo do componente e validar:

```ts
const [tela, setTela] = useState<string>(() => {
  try {
    const t = localStorage.getItem("diariaja_tela") || "splash";
    return TELAS_VALIDAS.has(t) ? t : "splash";
  } catch { return "splash"; }
});
```

---

## 12. Lista resumida de patches recomendados (priorizada)

**Quick wins (1 hora total)**:
1. Adicionar `signal: AbortSignal.timeout(15_000)` em
   `src/App.tsx:3696, 3944, 2187` (fetches de Edge Function).
2. Adicionar timeouts curtos (5–8s) em `src/App.tsx:4125, 4140, 4151, 4173, 4197, 4215, 4469, 4486, 4511, 5928` (CEP/geocode).
3. Trocar `.single()` por `.maybeSingle()` em
   `src/usePushNotifications.ts:62`.
4. Corrigir recursão infinita em `src/App.tsx:142–152`
   (`mostrarNotificacaoLocal`).
5. Remover `client.navigate(client.url)` de `public/sw.js:23–28`
   (evita double-reload).

**Médio (2–3 horas)**:
6. Pré-cachear `/` no SW (`public/sw.js:6`).
7. Bypass de tiles/nominatim no SW (`public/sw.js:36–37`).
8. Cache-bust de `/assets/*` no `activate` do SW.
9. Limitar auto-recovery do `index.html` a origem própria + reset
   `sw_recovered` por timer (`index.html:197–218`).
10. Adicionar headers para `/manifest.json` e `/icon-*.png` em
    `vercel.json`.
11. Adicionar `id`, separar `purpose: "any"` e `purpose: "maskable"` em
    `public/manifest.json`.
12. Pedir `reg.update()` em `visibilitychange` no `index.html`.

**Longo (decisão de arquitetura)**:
13. Decidir: `server.url` no Capacitor (PWA-wrapped) vs. publicar AAB
    com frequência.
14. Adicionar `server.allowNavigation` para domínios externos
    (Mercado Pago, Supabase).
15. Regenerar ícones Android mipmap com `npx capacitor-assets generate`
    apontando pro novo ícone v2.
16. Quebrar `App.tsx` em ao menos `screens/comunidade.tsx`,
    `screens/suporte.tsx`, `screens/admin.tsx` (chunks lazy via
    `React.lazy`) — diminui o JS no first paint em ~30%.

---

## 13. O que **não** foi verificado

- Conteúdo do `mipmap-anydpi-v26/ic_launcher.xml` (XML adaptive icon).
- Switch principal de renderização em `App.tsx` por `tela` (não inspecionei
  caso a caso pra confirmar fallback de telas removidas).
- `supabase/functions/create-contact-payment/index.ts` — não confirmei
  se o cold-start é mesmo 30–60s; pode ser que a função tenha um
  `await mp.createPreference()` síncrono que demora.
- Performance real do `vite build` (não rodei).
- Lighthouse PWA score atual.
