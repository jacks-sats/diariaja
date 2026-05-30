import { describe, it, expect } from "vitest";
import {
  transicaoDiariaPermitida,
  statusTerminal,
  contatoLiberado,
  contaNaCotaSelecao,
  respostaConviteValida,
  STATUS_DIARIA,
} from "../helpers";

// ════════════════════════════════════════════════════════════════════════════
// Spec executável dos fluxos de contratação da DiáriaJá.
// Modela os dois caminhos como máquina de estados e verifica os invariantes:
//   • transições de status permitidas
//   • liberação de chat/endereço só após confirmação (proteção do R$1)
//   • crédito interno (no-show não consome cota)
// ════════════════════════════════════════════════════════════════════════════

// ── Fluxo 1: Candidatura (prestador marca interesse) ────────────────────────
describe("Fluxo 1 — Candidatura (caminho feliz)", () => {
  // aberta → pendente → aceita → em_andamento → concluida
  const caminho = ["aberta", "pendente", "aceita", "em_andamento", "concluida"];

  it("cada passo do caminho feliz é uma transição válida", () => {
    for (let i = 0; i < caminho.length - 1; i++) {
      expect(transicaoDiariaPermitida(caminho[i], caminho[i + 1])).toBe(true);
    }
  });

  it("o anunciante seleciona: aberta → pendente", () => {
    expect(transicaoDiariaPermitida("aberta", "pendente")).toBe(true);
  });

  it("o prestador confirma presença: pendente → aceita", () => {
    expect(transicaoDiariaPermitida("pendente", "aceita")).toBe(true);
  });

  it("check-in: aceita → em_andamento; check-out: em_andamento → concluida", () => {
    expect(transicaoDiariaPermitida("aceita", "em_andamento")).toBe(true);
    expect(transicaoDiariaPermitida("em_andamento", "concluida")).toBe(true);
  });
});

describe("Fluxo 1 — chat e endereço (proteção do R$1)", () => {
  it("FECHADOS antes da confirmação (aberta/pendente)", () => {
    expect(contatoLiberado("aberta")).toBe(false);
    expect(contatoLiberado("pendente")).toBe(false);
  });
  it("ABREM quando o prestador confirma (aceita) e seguem abertos", () => {
    expect(contatoLiberado("aceita")).toBe(true);
    expect(contatoLiberado("em_andamento")).toBe(true);
    expect(contatoLiberado("concluida")).toBe(true);
  });
  it("FECHADOS em estados de falha (expirada/cancelada)", () => {
    expect(contatoLiberado("expirada")).toBe(false);
    expect(contatoLiberado("cancelada")).toBe(false);
  });
});

describe("Fluxo 1 — ramos de saída", () => {
  it("desistência: pendente|aceita → aberta (volta pro feed)", () => {
    expect(transicaoDiariaPermitida("pendente", "aberta")).toBe(true);
    expect(transicaoDiariaPermitida("aceita", "aberta")).toBe(true);
  });
  it("no-show: pendente|aceita → expirada", () => {
    expect(transicaoDiariaPermitida("pendente", "expirada")).toBe(true);
    expect(transicaoDiariaPermitida("aceita", "expirada")).toBe(true);
  });
  it("aberta sem ninguém também expira", () => {
    expect(transicaoDiariaPermitida("aberta", "expirada")).toBe(true);
  });
});

describe("Fluxo 1 — transições inválidas são rejeitadas", () => {
  it("não pula etapas: aberta → aceita / em_andamento / concluida", () => {
    expect(transicaoDiariaPermitida("aberta", "aceita")).toBe(false);
    expect(transicaoDiariaPermitida("aberta", "em_andamento")).toBe(false);
    expect(transicaoDiariaPermitida("aberta", "concluida")).toBe(false);
  });
  it("não volta no tempo: aceita → pendente, em_andamento → aceita", () => {
    expect(transicaoDiariaPermitida("aceita", "pendente")).toBe(false);
    expect(transicaoDiariaPermitida("em_andamento", "aceita")).toBe(false);
  });
  it("estados terminais não transicionam", () => {
    for (const t of ["concluida", "cancelada", "expirada"]) {
      expect(statusTerminal(t)).toBe(true);
      for (const alvo of STATUS_DIARIA) {
        expect(transicaoDiariaPermitida(t, alvo)).toBe(false);
      }
    }
  });
  it("status igual nunca é transição", () => {
    for (const s of STATUS_DIARIA) expect(transicaoDiariaPermitida(s, s)).toBe(false);
  });
});

// ── Crédito interno (cota de seleção do mês) ────────────────────────────────
describe("Crédito interno — cota de seleção", () => {
  it("conta quando há prestador selecionado e a diária está ativa", () => {
    expect(contaNaCotaSelecao({ diarista_aceite_id: "p1", status: "pendente" })).toBe(true);
    expect(contaNaCotaSelecao({ diarista_aceite_id: "p1", status: "aceita" })).toBe(true);
    expect(contaNaCotaSelecao({ diarista_aceite_id: "p1", status: "em_andamento" })).toBe(true);
    expect(contaNaCotaSelecao({ diarista_aceite_id: "p1", status: "concluida" })).toBe(true);
  });
  it("NÃO conta no no-show (expirada) — crédito devolvido", () => {
    expect(contaNaCotaSelecao({ diarista_aceite_id: "p1", status: "expirada" })).toBe(false);
  });
  it("NÃO conta sem prestador selecionado (ex.: após desistência → aberta)", () => {
    expect(contaNaCotaSelecao({ diarista_aceite_id: null, status: "aberta" })).toBe(false);
    expect(contaNaCotaSelecao({ status: "aberta" })).toBe(false);
  });
  it("cancelada com prestador AINDA conta (anti-abuso — contato já pôde abrir)", () => {
    expect(contaNaCotaSelecao({ diarista_aceite_id: "p1", status: "cancelada" })).toBe(true);
  });
});

// ── Fluxo 2: Convite (anunciante chama o prestador) ─────────────────────────
describe("Fluxo 2 — Convite", () => {
  it("o prestador só pode aceitar ou recusar", () => {
    expect(respostaConviteValida("aceito")).toBe(true);
    expect(respostaConviteValida("recusado")).toBe(true);
    expect(respostaConviteValida("talvez")).toBe(false);
    expect(respostaConviteValida("")).toBe(false);
  });
});
