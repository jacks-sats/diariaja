// ── Utilitários de device (haptics + notificação local) ─────────────────────
// Efeitos de plataforma isolados do App.tsx. Degradam em silêncio quando a API
// não existe (desktop sem vibração, browser sem Notification, etc.).

// Vibração curta nos toques importantes.
export const hapticTick = () => { try { navigator.vibrate?.(8); } catch {} };
// Vibração mais forte para confirmações importantes (verificação, aceite, etc.)
export const hapticConfirm = () => { try { navigator.vibrate?.([100, 50, 200]); } catch {} };

// Mostra notificação local compatível com mobile/PWA.
// Em Android Chrome/PWA, `new Notification(...)` é PROIBIDO — só funciona via
// ServiceWorkerRegistration.showNotification(). Em desktop, ambos funcionam.
// Esta função tenta SW primeiro (robusto pra mobile) e cai pro `new Notification`
// no fallback (que funciona em desktop e em alguns browsers antigos).
export const mostrarNotificacaoLocal = (titulo: string, options?: NotificationOptions): void => {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // FIX 2026-05-28: o fallback recursivo causava RECURSÃO INFINITA — chamava
  // a própria função em vez de `new Notification(...)`. Em browser sem SW
  // travava o thread JS.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(titulo, options))
      .catch(() => { try { new Notification(titulo, options); } catch { /* sem permissão: ignorar */ } });
  } else {
    try { new Notification(titulo, options); } catch { /* ignore */ }
  }
};
