import { describe, it, expect } from "vitest";
import {
  validarCPF,
  validarNome,
  nivelDiarista,
  calcScore,
  verificarFraudeDescricao,
  detectarContatoExterno,
  maskCPF,
  maskCNPJ,
  haversineKm,
  validarEmail,
  validarTelefone,
  vagaExpirou,
  formatarDistancia,
  tempoEstimadoMin,
  formatarTempo,
} from "../helpers";

// ── validarCPF ────────────────────────────────────────────────────────────────
describe("validarCPF", () => {
  it("aceita CPF válido - 529.982.247-25", () => {
    expect(validarCPF("529.982.247-25")).toBe(true);
  });

  it("aceita CPF válido sem formatação", () => {
    expect(validarCPF("52998224725")).toBe(true);
  });

  it("aceita CPF válido - 111.444.777-35", () => {
    expect(validarCPF("111.444.777-35")).toBe(true);
  });

  it("rejeita CPF com dígitos repetidos - 111.111.111-11", () => {
    expect(validarCPF("111.111.111-11")).toBe(false);
  });

  it("rejeita CPF com dígitos repetidos - 000.000.000-00", () => {
    expect(validarCPF("000.000.000-00")).toBe(false);
  });

  it("rejeita CPF com dígitos repetidos - 999.999.999-99", () => {
    expect(validarCPF("999.999.999-99")).toBe(false);
  });

  it("rejeita CPF com dígito verificador errado", () => {
    expect(validarCPF("529.982.247-26")).toBe(false);
  });

  it("rejeita CPF com menos de 11 dígitos", () => {
    expect(validarCPF("123.456.789")).toBe(false);
  });

  it("rejeita CPF vazio", () => {
    expect(validarCPF("")).toBe(false);
  });

  it("rejeita CPF com letras", () => {
    expect(validarCPF("abc.def.ghi-jk")).toBe(false);
  });
});

// ── validarNome ────────────────────────────────────────────────────────────────
describe("validarNome", () => {
  it("aceita nome completo válido", () => {
    expect(validarNome("João Silva")).toBeNull();
  });

  it("aceita nome com três partes", () => {
    expect(validarNome("Maria das Graças")).toBeNull();
  });

  it("rejeita nome com apenas uma palavra", () => {
    expect(validarNome("João")).not.toBeNull();
  });

  it("rejeita nome com números", () => {
    expect(validarNome("João 123")).not.toBeNull();
  });

  it("rejeita nome muito curto", () => {
    expect(validarNome("Jo")).not.toBeNull();
  });

  it("rejeita nome com símbolos especiais", () => {
    expect(validarNome("João @Silva")).not.toBeNull();
  });

  it("rejeita string vazia", () => {
    expect(validarNome("")).not.toBeNull();
  });

  it("aceita nome com espaços extras (trim)", () => {
    expect(validarNome("  João Silva  ")).toBeNull();
  });
});

// ── nivelDiarista ──────────────────────────────────────────────────────────────
describe("nivelDiarista", () => {
  it("retorna Bronze para 0 diárias", () => {
    expect(nivelDiarista(0).nome).toBe("Bronze");
  });

  it("retorna Bronze para 4 diárias", () => {
    expect(nivelDiarista(4).nome).toBe("Bronze");
  });

  it("retorna Prata para 5 diárias", () => {
    expect(nivelDiarista(5).nome).toBe("Prata");
  });

  it("retorna Prata para 14 diárias", () => {
    expect(nivelDiarista(14).nome).toBe("Prata");
  });

  it("retorna Ouro para 15 diárias", () => {
    expect(nivelDiarista(15).nome).toBe("Ouro");
  });

  it("retorna Ouro para 29 diárias", () => {
    expect(nivelDiarista(29).nome).toBe("Ouro");
  });

  it("retorna Elite para 30 diárias", () => {
    expect(nivelDiarista(30).nome).toBe("Elite");
  });

  it("retorna Elite para 100 diárias", () => {
    expect(nivelDiarista(100).nome).toBe("Elite");
  });

  it("Elite tem proximo = 0 (topo máximo)", () => {
    expect(nivelDiarista(30).proximo).toBe(0);
  });

  it("Bronze tem cor correta", () => {
    expect(nivelDiarista(0).cor).toBe("#b45309");
  });

  it("Elite tem ícone 💎", () => {
    expect(nivelDiarista(30).icone).toBe("💎");
  });
});

// ── calcScore ──────────────────────────────────────────────────────────────────
describe("calcScore", () => {
  it("retorna 0 para perfil vazio sem diárias", () => {
    expect(calcScore({}, 0, null)).toBe(0);
  });

  it("retorna 25 para perfil só com foto", () => {
    expect(calcScore({ foto_url: "url" }, 0, null)).toBe(25);
  });

  it("retorna 50 para perfil com foto e CPF", () => {
    expect(calcScore({ foto_url: "url", cpf: "123" }, 0, null)).toBe(50);
  });

  it("retorna 100 para perfil completo com boa avaliação e 15+ diárias", () => {
    const p = { foto_url: "url", cpf: "123", telefone: "67999", bio: "Boa bio com mais de 20 chars" };
    expect(calcScore(p, 15, 4.5)).toBe(100);
  });

  it("não ultrapassa 100", () => {
    const p = { foto_url: "url", cpf: "123", telefone: "67999", bio: "Boa bio com mais de 20 chars" };
    expect(calcScore(p, 100, 5)).toBeLessThanOrEqual(100);
  });

  it("bio curta (<= 20 chars) não pontua", () => {
    const com = calcScore({ bio: "Bio longa mesmo sim" }, 0, null);  // 19 chars, não pontua
    const sem = calcScore({}, 0, null);
    expect(com).toBe(sem);
  });

  it("bio longa (> 20 chars) pontua +10", () => {
    const com = calcScore({ bio: "Esta bio tem mais de vinte caracteres" }, 0, null);
    const sem = calcScore({}, 0, null);
    expect(com - sem).toBe(10);
  });
});

// ── verificarFraudeDescricao ───────────────────────────────────────────────────
describe("verificarFraudeDescricao", () => {
  it("retorna null para descrição limpa", () => {
    expect(verificarFraudeDescricao("Preciso de faxineira para apartamento de 3 quartos")).toBeNull();
  });

  it("detecta número de telefone na descrição", () => {
    expect(verificarFraudeDescricao("Ligue 67999999999 para mais info")).not.toBeNull();
  });

  it("detecta WhatsApp na descrição", () => {
    expect(verificarFraudeDescricao("Me chame no whatsapp")).not.toBeNull();
  });

  it("detecta Telegram na descrição", () => {
    expect(verificarFraudeDescricao("Acesse meu telegram")).not.toBeNull();
  });

  it("detecta pedido de pagamento antecipado", () => {
    expect(verificarFraudeDescricao("pague antes de começar")).not.toBeNull();
  });

  it("detecta descrição muito curta", () => {
    expect(verificarFraudeDescricao("ok")).not.toBeNull();
  });

  it("retorna null para string vazia / null", () => {
    expect(verificarFraudeDescricao("")).toBeNull();
  });

  it("detecta instagram na descrição", () => {
    expect(verificarFraudeDescricao("meu insta é @joao")).not.toBeNull();
  });
});

// ── detectarContatoExterno ────────────────────────────────────────────────────
describe("detectarContatoExterno", () => {
  it("detecta número de telefone em mensagem", () => {
    expect(detectarContatoExterno("meu número é 67999887766")).toBe(true);
  });

  it("detecta whatsapp em mensagem", () => {
    expect(detectarContatoExterno("me chama no whatsapp")).toBe(true);
  });

  it("detecta 'fora do app' em mensagem", () => {
    expect(detectarContatoExterno("vamos conversar fora do app")).toBe(true);
  });

  it("não bloqueia mensagem normal", () => {
    expect(detectarContatoExterno("Posso ir amanhã às 8h!")).toBe(false);
  });

  it("não bloqueia mensagem com endereço (sem número longo)", () => {
    expect(detectarContatoExterno("Rua das Flores, 123, Campo Grande")).toBe(false);
  });

  it("detecta 'me liga' em mensagem", () => {
    expect(detectarContatoExterno("pode me liga depois?")).toBe(true);
  });
});

// ── maskCPF ───────────────────────────────────────────────────────────────────
describe("maskCPF", () => {
  it("formata CPF completo corretamente", () => {
    expect(maskCPF("52998224725")).toBe("529.982.247-25");
  });

  it("ignora caracteres não numéricos", () => {
    expect(maskCPF("529.982.247-25")).toBe("529.982.247-25");
  });

  it("limita a 11 dígitos", () => {
    expect(maskCPF("529982247251234")).toBe("529.982.247-25");
  });

  it("formata parcialmente (4 dígitos)", () => {
    expect(maskCPF("5299")).toBe("529.9");
  });

  it("retorna vazio para entrada vazia", () => {
    expect(maskCPF("")).toBe("");
  });
});

// ── maskCNPJ ──────────────────────────────────────────────────────────────────
describe("maskCNPJ", () => {
  it("formata CNPJ completo corretamente", () => {
    expect(maskCNPJ("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("ignora caracteres não numéricos", () => {
    expect(maskCNPJ("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });
});

// ── haversineKm ───────────────────────────────────────────────────────────────
describe("haversineKm", () => {
  it("retorna ~0 para mesma localização", () => {
    expect(haversineKm(-20.4697, -54.6201, -20.4697, -54.6201)).toBeCloseTo(0, 1);
  });

  it("calcula distância Campo Grande ↔ Dourados (~196 km em linha reta)", () => {
    // Campo Grande: -20.4697, -54.6201 | Dourados: -22.2233, -54.8057
    // Distância haversine (linha reta) ≈ 196 km
    const dist = haversineKm(-20.4697, -54.6201, -22.2233, -54.8057);
    expect(dist).toBeGreaterThan(150);
    expect(dist).toBeLessThan(230);
  });

  it("calcula distância dentro da cidade (~0-5 km)", () => {
    // Dois pontos em Campo Grande
    const dist = haversineKm(-20.4697, -54.6201, -20.4800, -54.6300);
    expect(dist).toBeLessThan(5);
  });
});

// ── validarEmail ──────────────────────────────────────────────────────────────
describe("validarEmail", () => {
  it("aceita email válido", () => {
    expect(validarEmail("joao@example.com")).toBe(true);
  });

  it("aceita email com subdomínio", () => {
    expect(validarEmail("joao.silva@mail.example.com.br")).toBe(true);
  });

  it("aceita email com + tag", () => {
    expect(validarEmail("joao+filtro@example.com")).toBe(true);
  });

  it("rejeita string sem @", () => {
    expect(validarEmail("joao.example.com")).toBe(false);
  });

  it("rejeita string sem domínio", () => {
    expect(validarEmail("joao@")).toBe(false);
  });

  it("rejeita string sem TLD", () => {
    expect(validarEmail("joao@example")).toBe(false);
  });

  it("rejeita email com espaços", () => {
    expect(validarEmail("joao @example.com")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(validarEmail("")).toBe(false);
  });

  it("ignora espaços no início e fim (trim)", () => {
    expect(validarEmail("  joao@example.com  ")).toBe(true);
  });
});

// ── validarTelefone ───────────────────────────────────────────────────────────
describe("validarTelefone", () => {
  it("aceita celular válido (11 dígitos)", () => {
    expect(validarTelefone("67999887766")).toBe(true);
  });

  it("aceita celular válido com máscara", () => {
    expect(validarTelefone("(67) 99988-7766")).toBe(true);
  });

  it("aceita fixo válido (10 dígitos)", () => {
    expect(validarTelefone("6733332222")).toBe(true);
  });

  it("rejeita celular com 11 dígitos sem 9 no início", () => {
    expect(validarTelefone("67899887766")).toBe(false);
  });

  it("rejeita telefone com 9 dígitos (curto)", () => {
    expect(validarTelefone("799887766")).toBe(false);
  });

  it("rejeita telefone com 12 dígitos (longo)", () => {
    expect(validarTelefone("679998877661")).toBe(false);
  });

  it("rejeita DDD inválido (00)", () => {
    expect(validarTelefone("00999887766")).toBe(false);
  });

  it("rejeita DDD inválido (10)", () => {
    expect(validarTelefone("10999887766")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(validarTelefone("")).toBe(false);
  });

  it("rejeita string com letras", () => {
    expect(validarTelefone("abcdefghijk")).toBe(false);
  });
});

// ── vagaExpirou ───────────────────────────────────────────────────────────────
describe("vagaExpirou", () => {
  const agora = new Date("2026-05-25T15:00:00");

  it("expirou: data anterior, status aberta", () => {
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "18:00", status: "aberta" }, agora)).toBe(true);
  });

  it("expirou: mesmo dia, horário_fim antes de agora", () => {
    expect(vagaExpirou({ data: "2026-05-25", horario_fim: "12:00", status: "aberta" }, agora)).toBe(true);
  });

  it("não expirou: mesmo dia, horário_fim depois de agora", () => {
    expect(vagaExpirou({ data: "2026-05-25", horario_fim: "18:00", status: "aberta" }, agora)).toBe(false);
  });

  it("não expirou: data futura", () => {
    expect(vagaExpirou({ data: "2026-05-26", horario_fim: "08:00", status: "aberta" }, agora)).toBe(false);
  });

  it("não expirou: status já é concluida (não deve expirar)", () => {
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "18:00", status: "concluida" }, agora)).toBe(false);
  });

  it("não expirou: status é cancelada", () => {
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "18:00", status: "cancelada" }, agora)).toBe(false);
  });

  it("não expirou: status é em_andamento (já começou, não pode expirar)", () => {
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "18:00", status: "em_andamento" }, agora)).toBe(false);
  });

  it("expirou: status pendente também caduca", () => {
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "18:00", status: "pendente" }, agora)).toBe(true);
  });

  it("aceita horario_fim com segundos (HH:MM:SS)", () => {
    expect(vagaExpirou({ data: "2026-05-25", horario_fim: "12:00:00", status: "aberta" }, agora)).toBe(true);
  });

  it("retorna false se data está vazia", () => {
    expect(vagaExpirou({ data: "", horario_fim: "18:00", status: "aberta" }, agora)).toBe(false);
  });
});

// ── formatarDistancia ─────────────────────────────────────────────────────────
describe("formatarDistancia", () => {
  it("retorna string vazia para null/undefined/NaN", () => {
    expect(formatarDistancia(null)).toBe("");
    expect(formatarDistancia(undefined)).toBe("");
    expect(formatarDistancia(NaN)).toBe("");
  });

  it("menos de 1 km", () => {
    expect(formatarDistancia(0.3)).toBe("menos de 1 km");
    expect(formatarDistancia(0.99)).toBe("menos de 1 km");
  });

  it("entre 1 e 10 km: 1 casa decimal com vírgula", () => {
    expect(formatarDistancia(1)).toBe("1,0 km");
    expect(formatarDistancia(2.5)).toBe("2,5 km");
    expect(formatarDistancia(9.87)).toBe("9,9 km");
  });

  it(">= 10 km: inteiro", () => {
    expect(formatarDistancia(10)).toBe("10 km");
    expect(formatarDistancia(12.4)).toBe("12 km");
    expect(formatarDistancia(196)).toBe("196 km");
  });
});

// ── tempoEstimadoMin ──────────────────────────────────────────────────────────
describe("tempoEstimadoMin", () => {
  it("retorna null para 0/negativo/NaN", () => {
    expect(tempoEstimadoMin(0)).toBeNull();
    expect(tempoEstimadoMin(-5)).toBeNull();
    expect(tempoEstimadoMin(NaN)).toBeNull();
    expect(tempoEstimadoMin(null)).toBeNull();
  });

  it("retorna pelo menos 1 minuto mesmo para distância mínima", () => {
    expect(tempoEstimadoMin(0.1)).toBeGreaterThanOrEqual(1);
  });

  it("calcula ~13 min para 5 km (5×1.3/30×60 = 13)", () => {
    expect(tempoEstimadoMin(5)).toBe(13);
  });

  it("calcula ~26 min para 10 km", () => {
    expect(tempoEstimadoMin(10)).toBe(26);
  });
});

// ── formatarTempo ─────────────────────────────────────────────────────────────
describe("formatarTempo", () => {
  it("min < 60: \"X min\"", () => {
    expect(formatarTempo(15)).toBe("15 min");
    expect(formatarTempo(59)).toBe("59 min");
  });

  it("min === 60 exato: \"1h\"", () => {
    expect(formatarTempo(60)).toBe("1h");
    expect(formatarTempo(120)).toBe("2h");
  });

  it("min > 60 com resto: \"Xh0Y\"", () => {
    expect(formatarTempo(75)).toBe("1h15");
    expect(formatarTempo(150)).toBe("2h30");
  });

  it("retorna string vazia para null", () => {
    expect(formatarTempo(null)).toBe("");
  });
});
