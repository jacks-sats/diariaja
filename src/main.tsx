import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
// App é pt-BR — só precisamos do subset latin + latin-ext (acentos PT/ES/FR).
// Antes importávamos `@fontsource/inter/{peso}.css` que puxa TODOS os subsets
// (cyrillic + greek + vietnamese + greek-ext + cyrillic-ext) = 33 arquivos /
// ~1 MB. Agora só latin + latin-ext = ~250 KB. (IMP-C2 / P1-19 da auditoria.)
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-900.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/inter/latin-ext-700.css";
import "@fontsource/inter/latin-ext-800.css";
import "@fontsource/inter/latin-ext-900.css";
import App from "./App";
import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

// ── Observabilidade (Sentry) ─────────────────────────────────────────────────
// DSN vem SÓ de env (nunca hardcode). Sem DSN, o Sentry simplesmente não
// inicializa e o app segue normal — captureException vira no-op seguro.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // beta vs prod: setar VITE_SENTRY_ENVIRONMENT="beta" no deploy beta.
    // Sem a env, cai no modo de build do Vite (production / development).
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ||
      import.meta.env.MODE,
    release: __APP_VERSION__,
    // Captura global de window.onerror + unhandledrejection é automática
    // (integração globalHandlers default do @sentry/react).
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}

// Capgo OTA: avisa que o bundle subiu OK. Sem isso, o Capgo presume que a
// atualização quebrou e faz rollback pro bundle anterior. Só roda no app
// nativo (Android) — na web é no-op. Silencioso: nunca deixa derrubar o boot.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady().catch((e) => {
    console.warn("[Capgo] notifyAppReady falhou:", e);
  });
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
    // Reporta ao Sentry com o component stack do React.
    // No-op seguro se o Sentry não foi inicializado (DSN ausente).
    Sentry.withScope((scope) => {
      scope.setContext("react", { componentStack: info.componentStack });
      Sentry.captureException(error);
    });
  }
  render() {
    if (this.state.error) {
      return (
        // Tela amigável — NUNCA expõe stack/mensagem técnica ao usuário.
        // Usa as variáveis de tema do index.html (funciona no claro e escuro).
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16, padding: 24,
          textAlign: "center", background: "var(--bg-app, #f0f2f5)",
          color: "var(--text-1, #0f172a)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Algo deu errado</h1>
          <p style={{ fontSize: 15, color: "var(--text-2, #64748b)", maxWidth: 360, margin: 0, lineHeight: 1.5 }}>
            Tivemos um problema inesperado e <strong>já fomos avisados</strong>.
            Tente recarregar — se continuar, volte daqui a pouco.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8, padding: "12px 28px", fontSize: 15, fontWeight: 600,
              color: "#fff", background: "#FF6B35", border: "none",
              borderRadius: 10, cursor: "pointer",
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
