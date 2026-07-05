import React, { useState, useEffect, useRef } from "react";
import { isoParaBR, brParaIso, maskData } from "../helpers";

// ── CampoData: digita DD/MM/AAAA, sem calendário nativo ──────────────────────
// Guarda/emite no formato ISO (yyyy-mm-dd) que o app já usa. O usuário leigo se
// perde no calendário do Android — aqui é só digitar como ele já escreve datas.
// `inputMode="numeric"` abre o teclado numérico no celular.
export function CampoData({ valorISO, onChangeISO, estilo, placeholder = "DD/MM/AAAA", disabled, erro }: {
  valorISO: string;
  onChangeISO: (iso: string) => void;
  estilo?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  erro?: string; // erro externo (validação do submit) — exibido se não houver um mais específico
}) {
  // Texto digitado (BR). Semeado do ISO; re-sincroniza se o ISO mudar por fora.
  const [txt, setTxt] = useState<string>(isoParaBR(valorISO));
  const [tocado, setTocado] = useState(false); // virou true ao sair do campo (blur)
  const ultimoISO = useRef(valorISO);
  useEffect(() => {
    if (valorISO !== ultimoISO.current) { setTxt(isoParaBR(valorISO)); ultimoISO.current = valorISO; }
  }, [valorISO]);
  // Data com 8 dígitos digitados mas que NÃO converte pra ISO = inválida (ex.:
  // ano 2926, 31/02, etc.). Com 1–7 dígitos ao sair do campo = INCOMPLETA — era o
  // caso que falhava em silêncio (digitar o ano "26" parecia preenchido, mas a
  // data ia vazia e o botão não explicava nada).
  const digitos = txt.replace(/\D/g, "").length;
  const invalida = digitos === 8 && !brParaIso(txt);
  const incompleta = tocado && digitos > 0 && digitos < 8;
  const aviso = invalida
    ? "⚠ Data inválida. Use DD/MM/AAAA (ex.: 15/06/2026)."
    : incompleta
    ? "⚠ Data incompleta — use o ano com 4 dígitos (ex.: 15/06/2026)."
    : erro
    ? "⚠ " + erro
    : "";
  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={txt}
        disabled={disabled}
        style={{ ...estilo, ...(aviso ? { borderColor: "#ef4444" } : {}) }}
        onBlur={() => setTocado(true)}
        onChange={e => {
          setTocado(false); // enquanto digita, não fica acusando incompleta
          const masked = maskData(e.target.value);
          setTxt(masked);
          // Só emite ISO quando a data está completa E é válida (senão "").
          const iso = brParaIso(masked);
          ultimoISO.current = iso;
          onChangeISO(iso);
        }}
      />
      {aviso && (
        <p style={{ fontSize: 11.5, color: "#ef4444", fontWeight: 700, margin: "3px 0 0" }}>
          {aviso}
        </p>
      )}
    </>
  );
}
