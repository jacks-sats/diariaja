import React from "react";
import { faseCiclo, vezDoCiclo } from "../helpers";

// ── Stepper do ciclo de vida (Conexão → No dia → Concluído) ──────────────────
// Faixa de 4 fases mostrada no card da diária/serviço, em ambos os lados.
// Sempre escreve "de quem é a vez" embaixo — some na auditoria de UX a queixa de
// "não sei se estou esperando ou se a bola está comigo". Usa faseCiclo/vezDoCiclo
// (helpers puros + testados). Status fora do trilho (cancelada/expirada) → nada.
export function StepperCiclo({ status, perspectiva }: {
  status: string;
  perspectiva: "prestador" | "anunciante";
}) {
  const fase = faseCiclo(status);
  if (fase === null) return null;
  const passos = ["Selecionado", "Combinando", "No dia", "Concluído"];
  const vez = vezDoCiclo(status, perspectiva);
  const corOk = "#22c55e";
  const corAtual = "#FF6B35";
  return (
    <div style={{ marginTop: 12, marginBottom: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {passos.map((p, i) => {
          const n = i + 1;
          // Concluída é estado TERMINAL: o último passo também fica ✓ verde
          // (não "atual" laranja). Sem isso, o 4º círculo mostrava "4" laranja
          // mesmo com o serviço já concluído.
          const concluido = status === "concluida";
          const feito = n < fase || (concluido && n === fase);
          const atual = n === fase && !concluido;
          const cor = feito ? corOk : atual ? corAtual : "#e2e8f0";
          const corTxt = feito ? corOk : atual ? corAtual : "#94a3b8";
          return (
            <React.Fragment key={p}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: feito || atual ? cor : "transparent", border: `2px solid ${cor}`, color: feito || atual ? "#fff" : "#94a3b8", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                  {feito ? "✓" : n}
                </div>
                <span style={{ fontSize: 9, fontWeight: atual ? 800 : 600, color: corTxt, whiteSpace: "nowrap" as const }}>{p}</span>
              </div>
              {i < passos.length - 1 && (
                <div style={{ flex: 1, height: 2, background: n < fase ? corOk : "#e2e8f0", borderRadius: 2, marginBottom: 14 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {vez && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: status === "concluida" ? corOk : "var(--text-2,#64748b)", textAlign: "center" as const }}>
          {status === "pendente" && perspectiva === "prestador" ? "👉 " : ""}{vez}
        </div>
      )}
    </div>
  );
}
