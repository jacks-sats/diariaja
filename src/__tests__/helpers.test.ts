import { describe, it, expect } from "vitest";
import {
  validarCPF,
  validarCNPJ,
  validarNome,
  nivelDiarista,
  calcScore,
  verificarFraudeDescricao,
  detectarContatoExterno,
  maskCPF,
  maskCNPJ,
  maskTelefone,
  haversineKm,
  validarEmail,
  validarTelefone,
  vagaExpirou,
  formatarDistancia,
  tempoEstimadoMin,
  formatarTempo,
  calcularNivelConfiabilidade,
  formatTempoRelativo,
  calcularIdade,
  validarSenhaForte,
  validarPix,
  codigoPresenca,
  parseEnderecoEmpregador,
  verificarConteudoProibido,
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

// ── calcularNivelConfiabilidade ──────────────────────────────────────────────
describe("calcularNivelConfiabilidade", () => {
  it("Sem base (sem telefone nem email) cai num N1 com pendência", () => {
    const r = calcularNivelConfiabilidade({});
    expect(r.nivel).toBe(1);
    expect(r.pendencias[0]).toMatch(/telefone|email/i);
  });

  it("Nível 1: telefone verificado, sem CPF", () => {
    const r = calcularNivelConfiabilidade({ telefone_verificado: true });
    expect(r.nivel).toBe(1);
    expect(r.nome).toBe("Básico");
    expect(r.pendencias[0]).toMatch(/cpf/i);
    expect(r.proximo).toBe(2);
  });

  it("Nível 1: só email confirmado, sem CPF (caso grandfathered)", () => {
    const r = calcularNivelConfiabilidade({ email_confirmado: true });
    expect(r.nivel).toBe(1);
  });

  it("Nível 2: telefone + CPF → Verificado, falta documento", () => {
    const r = calcularNivelConfiabilidade({
      telefone_verificado: true,
      cpf: "529.982.247-25",
    });
    expect(r.nivel).toBe(2);
    expect(r.nome).toBe("Verificado");
    expect(r.pendencias[0]).toMatch(/documento/i);
    expect(r.proximo).toBe(3);
  });

  it("Nível 2: PJ usando CNPJ no lugar do CPF", () => {
    const r = calcularNivelConfiabilidade({
      email_confirmado: true,
      cnpj: "11.222.333/0001-81",
    });
    expect(r.nivel).toBe(2);
  });

  it("Nível 2 com documento enviado: mensagem específica", () => {
    const r = calcularNivelConfiabilidade({
      telefone_verificado: true, cpf: "x", documento_status: "enviado",
    });
    expect(r.nivel).toBe(2);
    expect(r.pendencias[0]).toMatch(/análise/i);
  });

  it("Nível 2 com documento rejeitado: pede reenvio", () => {
    const r = calcularNivelConfiabilidade({
      telefone_verificado: true, cpf: "x", documento_status: "rejeitado",
    });
    expect(r.nivel).toBe(2);
    expect(r.pendencias[0]).toMatch(/reenvie/i);
  });

  it("Nível 3: doc aprovado mas sem 2FA → Confiável", () => {
    const r = calcularNivelConfiabilidade({
      telefone_verificado: true, cpf: "x", documento_status: "aprovado",
    });
    expect(r.nivel).toBe(3);
    expect(r.nome).toBe("Confiável");
    expect(r.pendencias[0]).toMatch(/2FA/i);
    expect(r.proximo).toBe(4);
  });

  it("Nível 4: tudo verificado + 2FA → Premium", () => {
    const r = calcularNivelConfiabilidade({
      telefone_verificado: true, cpf: "x", documento_status: "aprovado", mfa_enabled: true,
    });
    expect(r.nivel).toBe(4);
    expect(r.nome).toBe("Premium");
    expect(r.pendencias.length).toBe(0);
    expect(r.proximo).toBeUndefined();
  });
});

// ── formatTempoRelativo ──────────────────────────────────────────────────────
describe("formatTempoRelativo", () => {
  const agora = new Date("2026-05-25T15:00:00");

  it("retorna vazio para null/undefined/data inválida", () => {
    expect(formatTempoRelativo(null, agora)).toBe("");
    expect(formatTempoRelativo(undefined, agora)).toBe("");
    expect(formatTempoRelativo("data-inválida", agora)).toBe("");
  });

  it("\"agora mesmo\" se < 1 min", () => {
    const d = new Date("2026-05-25T14:59:45");
    expect(formatTempoRelativo(d, agora)).toBe("agora mesmo");
  });

  it("\"há Xmin\" entre 1 e 59 minutos", () => {
    expect(formatTempoRelativo("2026-05-25T14:48:00", agora)).toBe("há 12min");
    expect(formatTempoRelativo("2026-05-25T14:01:00", agora)).toBe("há 59min");
  });

  it("\"há Xh\" entre 1 e 23 horas", () => {
    expect(formatTempoRelativo("2026-05-25T13:00:00", agora)).toBe("há 2h");
    expect(formatTempoRelativo("2026-05-24T16:00:00", agora)).toBe("há 23h");
  });

  it("\"ontem\" para 1 dia atrás", () => {
    expect(formatTempoRelativo("2026-05-24T10:00:00", agora)).toBe("ontem");
  });

  it("\"há X dias\" entre 2 e 6 dias", () => {
    expect(formatTempoRelativo("2026-05-22T15:00:00", agora)).toBe("há 3 dias");
  });

  it("data DD/MM acima de 7 dias", () => {
    expect(formatTempoRelativo("2026-04-10T10:00:00", agora)).toBe("10/04");
  });

  it("data no futuro retorna \"agora\"", () => {
    expect(formatTempoRelativo("2026-05-25T16:00:00", agora)).toBe("agora");
  });
});

// ── validarCNPJ ──────────────────────────────────────────────────────────────
describe("validarCNPJ", () => {
  it("aceita CNPJ válido (com máscara)", () => {
    // CNPJ válido conhecido da Receita: 11.222.333/0001-81
    expect(validarCNPJ("11.222.333/0001-81")).toBe(true);
  });
  it("aceita CNPJ válido sem formatação", () => {
    expect(validarCNPJ("11222333000181")).toBe(true);
  });
  it("rejeita CNPJ com dígito verificador errado", () => {
    expect(validarCNPJ("11.222.333/0001-99")).toBe(false);
  });
  it("rejeita sequência repetida", () => {
    expect(validarCNPJ("11.111.111/1111-11")).toBe(false);
    expect(validarCNPJ("00.000.000/0000-00")).toBe(false);
  });
  it("rejeita CNPJ com tamanho errado", () => {
    expect(validarCNPJ("11.222.333/0001-8")).toBe(false);
    expect(validarCNPJ("1122233300018111")).toBe(false);
  });
  it("rejeita string vazia ou só letras", () => {
    expect(validarCNPJ("")).toBe(false);
    expect(validarCNPJ("abcdefghijklmn")).toBe(false);
  });
});

// ── maskTelefone ─────────────────────────────────────────────────────────────
describe("maskTelefone", () => {
  it("formata progressivamente celular 11 dígitos", () => {
    expect(maskTelefone("6")).toBe("(6");
    expect(maskTelefone("67")).toBe("(67");
    expect(maskTelefone("6798")).toBe("(67) 98");
    expect(maskTelefone("67999998888")).toBe("(67) 99999-8888");
  });
  it("formata fixo 10 dígitos", () => {
    expect(maskTelefone("6733334444")).toBe("(67) 3333-4444");
  });
  it("trunca em 11 dígitos", () => {
    expect(maskTelefone("67999998888999")).toBe("(67) 99999-8888");
  });
  it("retorna vazio quando vazio", () => {
    expect(maskTelefone("")).toBe("");
  });
  it("aceita input com lixo (parênteses, traços)", () => {
    expect(maskTelefone("(67) 99999-8888")).toBe("(67) 99999-8888");
  });
});

// ── calcularIdade ────────────────────────────────────────────────────────────
describe("calcularIdade", () => {
  const hoje = new Date("2026-05-25");
  it("calcula idade exata quando aniversário já passou no ano", () => {
    expect(calcularIdade("2000-01-15", hoje)).toBe(26);
  });
  it("calcula idade -1 quando aniversário ainda não chegou", () => {
    expect(calcularIdade("2000-12-31", hoje)).toBe(25);
  });
  it("retorna 18 quando aniversário é exatamente hoje há 18 anos", () => {
    expect(calcularIdade("2008-05-25", hoje)).toBe(18);
  });
  it("retorna 17 quando faltou 1 dia para 18", () => {
    expect(calcularIdade("2008-05-26", hoje)).toBe(17);
  });
  it("retorna 0 para data vazia ou inválida", () => {
    expect(calcularIdade("", hoje)).toBe(0);
    expect(calcularIdade("não-é-data", hoje)).toBe(0);
  });
  it("nunca retorna idade negativa", () => {
    expect(calcularIdade("2099-01-01", hoje)).toBe(0);
  });
});

// ── validarSenhaForte ────────────────────────────────────────────────────────
describe("validarSenhaForte", () => {
  it("aceita senha boa", () => {
    expect(validarSenhaForte("Cabeca42!2026")).toBeNull();
  });
  it("rejeita senha vazia", () => {
    expect(validarSenhaForte("")).toContain("Informe");
  });
  it("rejeita senha curta", () => {
    expect(validarSenhaForte("ab12")).toContain("muito curta");
  });
  it("rejeita senha sem letras", () => {
    expect(validarSenhaForte("1234567890")).toMatch(/sequências|letra/);
  });
  it("rejeita senha sem números", () => {
    expect(validarSenhaForte("apenasletras")).toContain("número");
  });
  it("rejeita senha óbvia comum", () => {
    expect(validarSenhaForte("diariaja123")).toContain("comum");
    expect(validarSenhaForte("brasil2026")).toContain("comum");
  });
  it("rejeita repetição de caractere único", () => {
    expect(validarSenhaForte("aaaaaaaaaa")).toBeTruthy();
    expect(validarSenhaForte("1111111111")).toBeTruthy();
  });
  it("rejeita senha excessivamente longa (>72)", () => {
    expect(validarSenhaForte("a".repeat(73) + "1")).toContain("muito longa");
  });
});

// ── validarPix ───────────────────────────────────────────────────────────────
describe("validarPix", () => {
  it("PIX CPF válido", () => {
    expect(validarPix("52998224725", "cpf")).toBeNull();
  });
  it("PIX CPF inválido", () => {
    expect(validarPix("11111111111", "cpf")).toContain("CPF inválido");
  });
  it("PIX CNPJ válido", () => {
    expect(validarPix("11222333000181", "cnpj")).toBeNull();
  });
  it("PIX email válido", () => {
    expect(validarPix("contato@diariaja.com.br", "email")).toBeNull();
  });
  it("PIX email inválido", () => {
    expect(validarPix("não-é-email", "email")).toBeTruthy();
  });
  it("PIX telefone válido", () => {
    expect(validarPix("(67) 99999-8888", "telefone")).toBeNull();
  });
  it("PIX aleatória válida (UUID)", () => {
    expect(validarPix("550e8400-e29b-41d4-a716-446655440000", "aleatoria")).toBeNull();
    expect(validarPix("550e8400e29b41d4a716446655440000", "aleatoria")).toBeNull();
  });
  it("PIX aleatória inválida (não-hex)", () => {
    expect(validarPix("nao-eh-uuid-valido-aqui", "aleatoria")).toBeTruthy();
  });
  it("rejeita chave vazia", () => {
    expect(validarPix("", "cpf")).toContain("Informe");
  });
});

// ── codigoPresenca ────────────────────────────────────────────────────────────
describe("codigoPresenca", () => {
  it("retorna 4 dígitos", () => {
    expect(codigoPresenca("550e8400-e29b-41d4-a716-446655440000")).toMatch(/^\d{4}$/);
  });
  it("é determinístico — mesmo input, mesma saída", () => {
    const id = "9f8b2c10-aaaa-bbbb-cccc-ddddeeeeffff";
    expect(codigoPresenca(id)).toBe(codigoPresenca(id));
  });
  it("difere entre IDs diferentes", () => {
    const a = codigoPresenca("550e8400-e29b-41d4-a716-446655440000");
    const b = codigoPresenca("660e8400-e29b-41d4-a716-446655440000");
    expect(a).not.toBe(b);
  });
  it("preenche com zeros à esquerda se for menor que 1000", () => {
    // Procura um input qualquer que produza saída < 1000 e confere 4 dígitos
    for (let i = 0; i < 1000; i++) {
      const out = codigoPresenca(`teste-${i}`);
      expect(out.length).toBe(4);
    }
  });
});

describe("parseEnderecoEmpregador", () => {
  it("retorna campos vazios para entrada nula/indefinida/vazia", () => {
    const vazio = { cep:"", rua:"", numero:"", complemento:"", bairro:"", cidade:"", estado:"" };
    expect(parseEnderecoEmpregador(null)).toEqual(vazio);
    expect(parseEnderecoEmpregador(undefined)).toEqual(vazio);
    expect(parseEnderecoEmpregador("")).toEqual(vazio);
  });

  it("formato A (editar-perfil) sem complemento — espelha o screenshot do usuário", () => {
    const e = parseEnderecoEmpregador("Rua Conde do Pinhal, 1379 - Jardim Colibrí, Campo Grande/MS - CEP: 79071-160");
    expect(e.rua).toBe("Rua Conde do Pinhal");
    expect(e.numero).toBe("1379");
    expect(e.complemento).toBe("");
    expect(e.bairro).toBe("Jardim Colibrí");
    expect(e.cidade).toBe("Campo Grande");
    expect(e.estado).toBe("MS");
    expect(e.cep).toBe("79071-160");
  });

  it("formato A com complemento", () => {
    const e = parseEnderecoEmpregador("Av. Afonso Pena, 100, Apto 202 - Centro, Campo Grande/MS - CEP: 79002-070");
    expect(e.rua).toBe("Av. Afonso Pena");
    expect(e.numero).toBe("100");
    expect(e.complemento).toBe("Apto 202");
    expect(e.bairro).toBe("Centro");
    expect(e.cidade).toBe("Campo Grande");
    expect(e.estado).toBe("MS");
    expect(e.cep).toBe("79002-070");
  });

  it("formato B (cadastro) sem complemento — travessão e CEP sem dois-pontos", () => {
    const e = parseEnderecoEmpregador("Rua das Flores, 45, Vila Nova, Dourados/MS — CEP 79800-000");
    expect(e.rua).toBe("Rua das Flores");
    expect(e.numero).toBe("45");
    expect(e.complemento).toBe("");
    expect(e.bairro).toBe("Vila Nova");
    expect(e.cidade).toBe("Dourados");
    expect(e.estado).toBe("MS");
    expect(e.cep).toBe("79800-000");
  });

  it("formato B com complemento separado por travessão", () => {
    const e = parseEnderecoEmpregador("Rua das Flores, 45 — Bloco B, Vila Nova, Dourados/MS — CEP 79800-000");
    expect(e.rua).toBe("Rua das Flores");
    expect(e.numero).toBe("45");
    expect(e.complemento).toBe("Bloco B");
    expect(e.bairro).toBe("Vila Nova");
    expect(e.cidade).toBe("Dourados");
    expect(e.estado).toBe("MS");
    expect(e.cep).toBe("79800-000");
  });

  it("faz roundtrip fiel com o formato canônico do editar-perfil", () => {
    const f = { ruaEmp:"Rua X", numeroEmp:"500", complementoEmp:"", bairroEmp:"Tiradentes", cidadeEmp:"Campo Grande", estadoEmp:"MS", cepEmp:"79110-000" };
    const concat = `${f.ruaEmp}, ${f.numeroEmp}${f.complementoEmp ? `, ${f.complementoEmp}` : ""} - ${f.bairroEmp}, ${f.cidadeEmp}/${f.estadoEmp} - CEP: ${f.cepEmp}`;
    const e = parseEnderecoEmpregador(concat);
    expect(e.rua).toBe(f.ruaEmp);
    expect(e.numero).toBe(f.numeroEmp);
    expect(e.complemento).toBe(f.complementoEmp);
    expect(e.bairro).toBe(f.bairroEmp);
    expect(e.cidade).toBe(f.cidadeEmp);
    expect(e.estado).toBe(f.estadoEmp);
    expect(e.cep).toBe(f.cepEmp);
  });

  it("normaliza CEP só com dígitos para o formato 00000-000", () => {
    const e = parseEnderecoEmpregador("Rua Y, 10 - Centro, Campo Grande/MS - CEP 79000000");
    expect(e.cep).toBe("79000-000");
  });

  it("degrada com elegância quando o texto não bate com nenhum formato", () => {
    const e = parseEnderecoEmpregador("endereço bagunçado sem estrutura");
    // Não deve lançar; campos não reconhecidos voltam vazios.
    expect(e.cep).toBe("");
    expect(e.estado).toBe("");
    expect(typeof e.rua).toBe("string");
  });
});

describe("verificarConteudoProibido", () => {
  it("libera vagas legítimas (retorna null)", () => {
    expect(verificarConteudoProibido("Faxina em apartamento de 2 quartos")).toBeNull();
    expect(verificarConteudoProibido("Preciso de diarista para limpeza pesada")).toBeNull();
    expect(verificarConteudoProibido("Auxiliar de cozinha para evento")).toBeNull();
    expect(verificarConteudoProibido("Motoboy para entregas de comida")).toBeNull();
    expect(verificarConteudoProibido("")).toBeNull();
  });

  it("bloqueia 'biqueira' (boca de fumo)", () => {
    expect(verificarConteudoProibido("Biqueira")).not.toBeNull();
    expect(verificarConteudoProibido("trabalho na biqueira do bairro")).not.toBeNull();
  });

  it("não bloqueia 'biqueira de aço' (EPI de obra)", () => {
    expect(verificarConteudoProibido("Pedreiro — usar bota com biqueira de aço")).toBeNull();
    expect(verificarConteudoProibido("biqueira de ferro obrigatória")).toBeNull();
  });

  it("bloqueia drogas e tráfico", () => {
    expect(verificarConteudoProibido("entrega de drogas")).not.toBeNull();
    expect(verificarConteudoProibido("vender maconha")).not.toBeNull();
    expect(verificarConteudoProibido("boca de fumo")).not.toBeNull();
    expect(verificarConteudoProibido("preciso de traficante")).not.toBeNull();
  });

  it("bloqueia exploração sexual", () => {
    expect(verificarConteudoProibido("Garota de programa")).not.toBeNull();
    expect(verificarConteudoProibido("serviço sexual bem pago")).not.toBeNull();
  });

  it("bloqueia armas ilegais", () => {
    expect(verificarConteudoProibido("venda de armas")).not.toBeNull();
    expect(verificarConteudoProibido("arma de fogo disponível")).not.toBeNull();
  });

  it("bloqueia termos que ferem a dignidade (pejorativos claros)", () => {
    expect(verificarConteudoProibido("não quero viadinho aqui")).not.toBeNull();
    expect(verificarConteudoProibido("sua vagabunda")).not.toBeNull();
  });

  it("é insensível a acentos e caixa", () => {
    expect(verificarConteudoProibido("PROSTITUIÇÃO")).not.toBeNull();
    expect(verificarConteudoProibido("Cocaína")).not.toBeNull();
  });
});
