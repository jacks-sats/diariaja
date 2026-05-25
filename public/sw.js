// Service Worker — DiáriaJá PWA
// v2 — estratégia network-first para HTML (evita tela branca após deploy)
const CACHE = "diariajaV3";

// Só pré-cacheia assets estáticos imutáveis (nunca o index.html)
const STATIC_ASSETS = ["/icon-192.png", "/icon-512.png", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(STATIC_ASSETS.map(a => c.add(a)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  // Remove todos os caches antigos (versões anteriores)
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ includeUncontrolled: true, type: "window" }))
      .then(clients => {
        // Força reload de todas as abas abertas para sair da tela branca
        clients.forEach(client => {
          try { client.navigate(client.url); } catch {}
        });
      })
  );
});

self.addEventListener("fetch", e => {
  const url = e.request.url;

  // Nunca intercepta chamadas Supabase, analytics, extensões do browser
  if (url.includes("supabase.co") || url.startsWith("chrome-extension")) return;

  // NAVEGAÇÃO (HTML) → sempre busca na rede; cache só como último recurso
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Atualiza o cache com a versão mais recente
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(async () => {
          // Offline: tenta servir do cache
          const cached = await caches.match(e.request);
          return cached || caches.match("/");
        })
    );
    return;
  }

  // ASSETS com hash (JS, CSS) → cache-first; atualiza em background
  if (url.includes("/assets/")) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // OUTROS (fontes, imagens públicas) → network-first com fallback ao cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Responde ao SKIP_WAITING enviado pelo index.html quando nova versão está disponível
self.addEventListener("message", e => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ── Push notifications ───────────────────────────────────────────────────────
// Padrão de vibração por tipo de evento. Mensagens curtas vibram leve,
// confirmações de diária mais firmes — o usuário aprende o "ritmo" do app.
const VIBRATE_BY_TYPE = {
  mensagem:        [80, 40, 80],            // 2 toques curtos
  vaga_proxima:    [120, 60, 120, 60, 120], // 3 toques médios
  candidatura:     [200, 100, 200],         // 2 toques fortes (importante!)
  selecionado:     [300, 100, 300, 100, 300], // 3 toques fortes (VOCÊ FOI ESCOLHIDO)
  confirmacao:     [200],                   // 1 toque médio
  default:         [150, 80, 150],
};

self.addEventListener("push", e => {
  const data = e.data?.json() || {};
  const tipo = data.tipo || "default";
  e.waitUntil(
    self.registration.showNotification(data.title || "DiáriaJá", {
      body: data.body || "Você tem uma nova notificação!",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || tipo,           // substitui a anterior do mesmo tipo
      renotify: !!data.renotify,        // re-zumba mesmo se já tinha uma do tipo
      requireInteraction: tipo === "selecionado" || tipo === "candidatura",
      vibrate: VIBRATE_BY_TYPE[tipo] || VIBRATE_BY_TYPE.default,
      data: { url: data.url || "/", tipo },
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  // Foca a janela aberta se já existir, senão abre nova
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
