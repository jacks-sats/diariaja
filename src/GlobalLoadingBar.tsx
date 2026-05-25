// ── GlobalLoadingBar ──────────────────────────────────────────────────────────
// Barra fina no topo do viewport que aparece durante qualquer operação assíncrona.
// Usa um portal para renderizar fora da árvore React normal (sem afetar layouts).
//
// Uso: <GlobalLoadingBar visible={salvandoPerfil || authLoading || ...} />

import { useEffect } from "react";

const BAR_ID = "trampoja-loading-bar";

const BAR_CSS = `
#${BAR_ID} {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, #FF6B35, #fbbf24, #FF6B35);
  background-size: 200% 100%;
  z-index: 99999;
  transition: width 0.3s ease, opacity 0.4s ease;
  pointer-events: none;
  border-radius: 0 2px 2px 0;
}
@keyframes loadingSlide {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}
#${BAR_ID}.visible {
  animation: loadingSlide 1.4s linear infinite;
}

/* ── Skeleton loader compartilhado ─────────────────────────────────────── */
@keyframes diariaja-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.dj-skel {
  background: linear-gradient(90deg,
    var(--bg-subtle,#f1f5f9) 0%,
    var(--bg-card,#fff) 50%,
    var(--bg-subtle,#f1f5f9) 100%);
  background-size: 200% 100%;
  animation: diariaja-shimmer 1.4s linear infinite;
  border-radius: 8px;
}
`;

function ensureBar(): HTMLElement {
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    // Injeta CSS
    const style = document.createElement("style");
    style.textContent = BAR_CSS;
    document.head.appendChild(style);
    // Cria elemento
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.style.width = "0%";
    bar.style.opacity = "0";
    document.body.appendChild(bar);
  }
  return bar;
}

/** Mostra a barra de loading (pode ser chamada de fora do React) */
export function showLoadingBar() {
  if (typeof document === "undefined") return;
  const bar = ensureBar();
  bar.style.width = "85%";
  bar.style.opacity = "1";
  bar.classList.add("visible");
}

/** Esconde a barra de loading (pode ser chamada de fora do React) */
export function hideLoadingBar() {
  if (typeof document === "undefined") return;
  const bar = ensureBar();
  bar.style.width = "100%";
  setTimeout(() => {
    bar.style.opacity = "0";
    bar.style.width = "0%";
    bar.classList.remove("visible");
  }, 350);
}

interface Props {
  visible: boolean;
}

export function GlobalLoadingBar({ visible }: Props) {
  useEffect(() => {
    const bar = ensureBar();
    if (visible) {
      bar.style.width = "85%";
      bar.style.opacity = "1";
      bar.classList.add("visible");
    } else {
      bar.style.width = "100%";
      setTimeout(() => {
        bar.style.opacity = "0";
        bar.style.width = "0%";
        bar.classList.remove("visible");
      }, 350);
    }
  }, [visible]);

  return null; // Renderiza nada — a barra é um elemento DOM puro
}
