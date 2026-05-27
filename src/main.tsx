import React from "react";
import ReactDOM from "react-dom/client";
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
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: "24px", fontFamily: "monospace", background: "#fff0f0",
          color: "#b00", minHeight: "100vh", whiteSpace: "pre-wrap", fontSize: 13
        }}>
          <strong>❌ Erro no App:</strong>{"\n\n"}
          {this.state.error.message}{"\n\n"}
          {this.state.error.stack}
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
