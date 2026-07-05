import React, { useMemo } from "react";
import { gerarHorarios } from "../helpers";

// ── CampoHora: lista rolável de horários, sem relógio circular ───────────────
// Abre um dropdown com horários de `passoMin` em `passoMin` minutos. Guarda/emite
// "HH:MM". Se o valor atual não estiver na lista (ex.: legado tipo "08:15"), ele
// é incluído no topo pra não sumir.
export function CampoHora({ valor, onChange, estilo, passoMin = 30, placeholder = "Selecione", disabled }: {
  valor: string;
  onChange: (hhmm: string) => void;
  estilo?: React.CSSProperties;
  passoMin?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const horarios = useMemo(() => {
    const base = gerarHorarios(passoMin);
    return valor && !base.includes(valor) ? [valor, ...base] : base;
  }, [passoMin, valor]);
  return (
    <select
      value={valor || ""}
      disabled={disabled}
      style={{ ...estilo, appearance: "none" as const, WebkitAppearance: "none" as const, backgroundImage: "none" }}
      onChange={e => onChange(e.target.value)}
    >
      <option value="" disabled>{placeholder}</option>
      {horarios.map(h => <option key={h} value={h}>{h}</option>)}
    </select>
  );
}
