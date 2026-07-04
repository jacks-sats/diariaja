import { describe, it, expect } from "vitest";
import {
  planoSelecao,
  empregoExigePlanoParaChamar,
  vagaApareceNoFeed,
  documentoAprovado,
  extrairPrimeiroLink,
  mensagemDoPar,
  erroTelefoneSave,
  rotuloDistanciaFeed,
  distanciaParaFiltroRaio,
  geoPrecisoParaSalvar,
  deveMostrarLembreteGeo,
  parseEnderecoReverso,
  protocoloContato,
  maskData,
  isoParaBR,
  brParaIso,
  gerarHorarios,
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
  conviteExpirou,
  formatarDistancia,
  tempoEstimadoMin,
  formatarTempo,
  calcularNivelConfiabilidade,
  calcScoreEmpregador,
  formatTempoRelativo,
  calcularIdade,
  validarSenhaForte,
  validarPix,
  codigoPresenca,
  parseEnderecoEmpregador,
  verificarConteudoProibido,
  verificarDiscriminacao,
  traduzirErroBanco,
  vagaProximaDeVencer,
  checkinDentroDaJanela,
  diariaNoShow,
  duracaoTurnoMin,
  calcularNivelAcademy,
  faseCiclo,
  vezDoCiclo,
  montarTextoVaga,
  linkVaga,
  URL_APP,
  completudeEditavel,
  vagaEmpregoExcedeuCota,
  limiteVagasEmpregoMes,
  LIMITE_VAGAS_EMPREGO_GRATIS_MES,
  rotuloPrecoVaga,
  precoDiariaParaSalvar,
  cargaHorariaConvite,
} from "../helpers";
import { FUNCOES_DELIVERY } from "../constants";

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

  it("bio com exatamente 20 chars pontua (>= 20, consistente com breakdown)", () => {
    const bio20 = "x".repeat(20);
    expect(calcScore({ bio: bio20 }, 0, null)).toBe(10);
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

  it("horário malformado ('14' sem minutos) → não quebra, retorna false", () => {
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "14", status: "aberta" }, agora)).toBe(false);
    expect(vagaExpirou({ data: "2026-05-24", horario_fim: "abc", status: "aberta" }, agora)).toBe(false);
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

  it("turno que cruza a meia-noite: NÃO expira durante a madrugada do dia seguinte", () => {
    // Diária 23/06 18:00 → 02:00. Às 01:00 do dia 24 ainda está rolando.
    expect(vagaExpirou(
      { data: "2026-06-23", horario_inicio: "18:00", horario_fim: "02:00", status: "aberta" },
      new Date("2026-06-24T01:00:00"),
    )).toBe(false);
  });
  it("turno que cruza a meia-noite: expira após o fim real (02:00 do dia seguinte)", () => {
    expect(vagaExpirou(
      { data: "2026-06-23", horario_inicio: "18:00", horario_fim: "02:00", status: "aberta" },
      new Date("2026-06-24T02:30:00"),
    )).toBe(true);
  });
});

// ── duracaoTurnoMin (regra "vira o dia") ─────────────────────────────────────
describe("duracaoTurnoMin", () => {
  it("turno normal: 08:00 → 17:00 = 540min (9h)", () => {
    expect(duracaoTurnoMin("08:00", "17:00")).toBe(540);
  });
  it("turno que CRUZA A MEIA-NOITE: 18:00 → 02:00 = 480min (8h)", () => {
    expect(duracaoTurnoMin("18:00", "02:00")).toBe(480);
  });
  it("virada extrema: 23:30 → 00:00 = 30min", () => {
    expect(duracaoTurnoMin("23:30", "00:00")).toBe(30);
  });
  it("fim == início = 0 (turno de duração zero — inválido pra quem chama)", () => {
    expect(duracaoTurnoMin("18:00", "18:00")).toBe(0);
  });
  it("aceita HH:MM:SS", () => {
    expect(duracaoTurnoMin("18:00:00", "02:00:00")).toBe(480);
  });
  it("null quando falta horário ou é malformado", () => {
    expect(duracaoTurnoMin("", "02:00")).toBeNull();
    expect(duracaoTurnoMin("18:00", "")).toBeNull();
    expect(duracaoTurnoMin("18:00", "ab")).toBeNull();
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

// ── calcScoreEmpregador ──────────────────────────────────────────────────────
describe("calcScoreEmpregador", () => {
  it("contratante novo (sem métricas) → novo/Novo, score null", () => {
    const r = calcScoreEmpregador(null);
    expect(r.novo).toBe(true);
    expect(r.score).toBeNull();
    expect(r.label).toBe("Novo");
  });

  it("objeto vazio ou tudo null também é Novo", () => {
    expect(calcScoreEmpregador({}).novo).toBe(true);
    expect(calcScoreEmpregador({ total_avaliacoes: 0, nota_media: null,
      pct_pagou_combinado: null, pct_cumpriu_combinado: null }).novo).toBe(true);
  });

  it("nota 5★ + 100% pagou + 100% cumpriu → 100 Excelente", () => {
    const r = calcScoreEmpregador({ total_avaliacoes: 8, nota_media: 5,
      pct_pagou_combinado: 100, pct_cumpriu_combinado: 100 });
    expect(r.score).toBe(100);
    expect(r.label).toBe("Excelente");
    expect(r.cor).toBe("#16a34a");
  });

  it("nota 1★ + 0% + 0% → 0 Atenção", () => {
    const r = calcScoreEmpregador({ total_avaliacoes: 3, nota_media: 1,
      pct_pagou_combinado: 0, pct_cumpriu_combinado: 0 });
    expect(r.score).toBe(0);
    expect(r.label).toBe("Atenção");
  });

  it("só nota (pcts null) usa 100% do peso na nota — 4★ → 75", () => {
    const r = calcScoreEmpregador({ total_avaliacoes: 2, nota_media: 4 });
    expect(r.score).toBe(75); // (4-1)/4*100 = 75
    expect(r.novo).toBe(false);
    expect(r.label).toBe("Bom");
  });

  it("faixa Regular entre 40 e 59", () => {
    // nota 3★ → 50; pagou 50; cumpriu 50 → 50
    const r = calcScoreEmpregador({ total_avaliacoes: 4, nota_media: 3,
      pct_pagou_combinado: 50, pct_cumpriu_combinado: 50 });
    expect(r.score).toBe(50);
    expect(r.label).toBe("Regular");
  });

  it("recorta valores fora de faixa (defensivo)", () => {
    const r = calcScoreEmpregador({ total_avaliacoes: 1, nota_media: 5,
      pct_pagou_combinado: 150, pct_cumpriu_combinado: -20 });
    // nota→100 (peso .5), pagou→100 (.25), cumpriu→0 (.25) => 75
    expect(r.score).toBe(75);
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

describe("verificarDiscriminacao (Lei 9.029/95)", () => {
  it("libera vagas legítimas (retorna null)", () => {
    expect(verificarDiscriminacao("Auxiliar administrativo com experiência em Excel")).toBeNull();
    expect(verificarDiscriminacao("Garçom para evento, disponibilidade aos fins de semana")).toBeNull();
    expect(verificarDiscriminacao("Vaga para todos — buscamos proatividade e responsabilidade")).toBeNull();
    expect(verificarDiscriminacao("")).toBeNull();
  });

  it("bloqueia restrição de idade", () => {
    expect(verificarDiscriminacao("Atendente, até 30 anos")).not.toBeNull();
    expect(verificarDiscriminacao("idade máxima 25")).not.toBeNull();
    expect(verificarDiscriminacao("somente menor de 40")).not.toBeNull();
    expect(verificarDiscriminacao("dentro da faixa etária jovem")).not.toBeNull();
  });

  it("bloqueia restrição de sexo/gênero", () => {
    expect(verificarDiscriminacao("Vaga apenas para mulheres")).not.toBeNull();
    expect(verificarDiscriminacao("contratamos somente homens")).not.toBeNull();
    expect(verificarDiscriminacao("sexo feminino")).not.toBeNull();
  });

  it("bloqueia 'boa aparência' e estado civil/família", () => {
    expect(verificarDiscriminacao("Recepcionista com boa aparência")).not.toBeNull();
    expect(verificarDiscriminacao("preferência para solteiras")).not.toBeNull();
    expect(verificarDiscriminacao("que não tenha filhos")).not.toBeNull();
  });

  it("é insensível a acentos e caixa", () => {
    expect(verificarDiscriminacao("BOA APARÊNCIA")).not.toBeNull();
    expect(verificarDiscriminacao("Faixa Etária")).not.toBeNull();
  });
});

describe("traduzirErroBanco", () => {
  it("traduz o erro de time/timestamp (nunca mostra jargão)", () => {
    const msg = traduzirErroBanco("invalid input syntax for type time: \"\"");
    expect(msg).not.toMatch(/syntax|type time/i);
    expect(msg.toLowerCase()).toContain("horário");
  });
  it("traduz erro de rede", () => {
    expect(traduzirErroBanco("Failed to fetch").toLowerCase()).toContain("conexão");
    expect(traduzirErroBanco({ message: "TypeError: NetworkError" }).toLowerCase()).toContain("conexão");
  });
  it("traduz duplicado / permissão / sessão", () => {
    expect(traduzirErroBanco({ code: "23505", message: "duplicate key" }).toLowerCase()).toContain("já está cadastrado");
    expect(traduzirErroBanco("permission denied for table").toLowerCase()).toContain("permissão");
    expect(traduzirErroBanco("JWT expired").toLowerCase()).toContain("sessão");
  });
  it("traduz o gate do modo beta", () => {
    expect(traduzirErroBanco("MODO_BETA: ação indisponível")).toContain("lançamento");
  });
  it("fallback gentil pra erro desconhecido / vazio", () => {
    expect(traduzirErroBanco("")).toMatch(/tente de novo/i);
    expect(traduzirErroBanco("algum erro bizarro xyz")).toMatch(/tente de novo/i);
    expect(traduzirErroBanco(null)).toMatch(/tente de novo/i);
  });
});

describe("vagaProximaDeVencer", () => {
  const base = new Date("2026-05-29T12:00:00");
  it("true quando aberta e fim em 3h (dentro da janela de 6h)", () => {
    expect(vagaProximaDeVencer({ data: "2026-05-29", horario_fim: "15:00", status: "aberta" }, 6, base)).toBe(true);
  });
  it("false quando fim ainda longe (20h)", () => {
    expect(vagaProximaDeVencer({ data: "2026-05-30", horario_fim: "08:00", status: "aberta" }, 6, base)).toBe(false);
  });
  it("false quando já passou do fim (não é 'pra vencer', já venceu)", () => {
    expect(vagaProximaDeVencer({ data: "2026-05-29", horario_fim: "10:00", status: "aberta" }, 6, base)).toBe(false);
  });
  it("false quando status não é 'aberta'", () => {
    expect(vagaProximaDeVencer({ data: "2026-05-29", horario_fim: "15:00", status: "aceita" }, 6, base)).toBe(false);
  });
  it("usa horario_inicio quando não há horario_fim (serviço)", () => {
    expect(vagaProximaDeVencer({ data: "2026-05-29", horario_inicio: "14:00", status: "aberta" }, 6, base)).toBe(true);
  });
  it("false sem data/horário", () => {
    expect(vagaProximaDeVencer({ data: "", horario_fim: "15:00", status: "aberta" }, 6, base)).toBe(false);
    expect(vagaProximaDeVencer({ data: "2026-05-29", status: "aberta" }, 6, base)).toBe(false);
  });
});

describe("checkinDentroDaJanela", () => {
  // Diária 14:00–18:00. Janela válida: 13:30 (–30min) até 20:00 (+2h).
  const dia = { data: "2026-05-29", horario_inicio: "14:00", horario_fim: "18:00" };
  it("true durante a diária", () => {
    expect(checkinDentroDaJanela(dia, new Date("2026-05-29T15:00:00"))).toBe(true);
  });
  it("true 30min antes do início", () => {
    expect(checkinDentroDaJanela(dia, new Date("2026-05-29T13:35:00"))).toBe(true);
  });
  it("false bem antes do início (mais de 30min)", () => {
    expect(checkinDentroDaJanela(dia, new Date("2026-05-29T12:00:00"))).toBe(false);
  });
  it("true até 2h depois do fim", () => {
    expect(checkinDentroDaJanela(dia, new Date("2026-05-29T19:30:00"))).toBe(true);
  });
  it("false depois de 2h do fim (origem do 'expirada ainda pede QR')", () => {
    expect(checkinDentroDaJanela(dia, new Date("2026-05-29T20:30:00"))).toBe(false);
  });
  it("usa horario_inicio quando não há horario_fim (serviço)", () => {
    const serv = { data: "2026-05-29", horario_inicio: "14:00" };
    expect(checkinDentroDaJanela(serv, new Date("2026-05-29T15:30:00"))).toBe(true);
    expect(checkinDentroDaJanela(serv, new Date("2026-05-29T17:00:00"))).toBe(false);
  });
  it("false sem data", () => {
    expect(checkinDentroDaJanela({ data: "", horario_inicio: "14:00" }, new Date("2026-05-29T15:00:00"))).toBe(false);
  });
  it("turno que cruza a meia-noite (18:00→02:00): janela abre até 04:00 do dia seguinte", () => {
    const noturna = { data: "2026-06-23", horario_inicio: "18:00", horario_fim: "02:00" };
    expect(checkinDentroDaJanela(noturna, new Date("2026-06-24T01:00:00"))).toBe(true);  // durante a madrugada
    expect(checkinDentroDaJanela(noturna, new Date("2026-06-24T03:30:00"))).toBe(true);  // até fim+2h (04:00)
    expect(checkinDentroDaJanela(noturna, new Date("2026-06-24T05:00:00"))).toBe(false); // depois de fim+2h
  });
});

describe("diariaNoShow", () => {
  // Diária 14:00–18:00. No-show só após fim+2h = 20:00.
  const base = { data: "2026-05-29", horario_inicio: "14:00", horario_fim: "18:00", diarista_aceite_id: "x" };
  it("true: aceita, sem check-in, passou de fim+2h", () => {
    expect(diariaNoShow({ ...base, status: "aceita" }, new Date("2026-05-29T20:30:00"))).toBe(true);
  });
  it("false: ainda dentro da tolerância de 2h", () => {
    expect(diariaNoShow({ ...base, status: "aceita" }, new Date("2026-05-29T19:30:00"))).toBe(false);
  });
  it("false: já fez check-in", () => {
    expect(diariaNoShow({ ...base, status: "aceita", checkin_em: "2026-05-29T14:05:00Z" }, new Date("2026-05-29T20:30:00"))).toBe(false);
  });
  it("false: status diferente de aceita", () => {
    expect(diariaNoShow({ ...base, status: "em_andamento" }, new Date("2026-05-29T20:30:00"))).toBe(false);
    expect(diariaNoShow({ ...base, status: "concluida" }, new Date("2026-05-29T20:30:00"))).toBe(false);
  });
  it("false: sem data", () => {
    expect(diariaNoShow({ ...base, data: "", status: "aceita" }, new Date("2026-05-29T20:30:00"))).toBe(false);
  });
  it("turno que cruza a meia-noite: no-show só após o fim real + 2h (04:00 do dia seguinte)", () => {
    const noturna = { data: "2026-06-23", horario_inicio: "18:00", horario_fim: "02:00", diarista_aceite_id: "x", status: "aceita" };
    expect(diariaNoShow(noturna, new Date("2026-06-24T01:00:00"))).toBe(false); // ainda durante o turno
    expect(diariaNoShow(noturna, new Date("2026-06-24T04:30:00"))).toBe(true);  // passou de fim+2h
  });
});

describe("calcularNivelAcademy", () => {
  it("XP 0 → Bronze, progresso pro próximo", () => {
    const n = calcularNivelAcademy(0);
    expect(n.nome).toBe("Bronze");
    expect(n.nivel).toBe(1);
    expect(n.faltam).toBe(50);
    expect(n.progressoPct).toBe(0);
  });
  it("XP 25 (curso obrigatório) ainda é Bronze, 50% do caminho", () => {
    const n = calcularNivelAcademy(25);
    expect(n.nome).toBe("Bronze");
    expect(n.faltam).toBe(25);
    expect(n.progressoPct).toBe(50);
  });
  it("XP 50 → Prata", () => {
    expect(calcularNivelAcademy(50).nome).toBe("Prata");
  });
  it("XP 120 → Ouro", () => {
    expect(calcularNivelAcademy(120).nome).toBe("Ouro");
  });
  it("XP 250+ → Diamante (máx, sem próximo)", () => {
    const n = calcularNivelAcademy(300);
    expect(n.nome).toBe("Diamante");
    expect(n.xpProximoNivel).toBeNull();
    expect(n.faltam).toBe(0);
    expect(n.progressoPct).toBe(100);
  });
  it("valores inválidos (NaN/negativo) → Bronze 0", () => {
    expect(calcularNivelAcademy(NaN).xp).toBe(0);
    expect(calcularNivelAcademy(-10).nome).toBe("Bronze");
  });
});

describe("maskData", () => {
  it("formata progressivamente DD/MM/AAAA", () => {
    expect(maskData("2")).toBe("2");
    expect(maskData("25")).toBe("25");
    expect(maskData("2512")).toBe("25/12");
    expect(maskData("25121990")).toBe("25/12/1990");
  });
  it("ignora não-dígitos e limita a 8", () => {
    expect(maskData("25/12/1990")).toBe("25/12/1990");
    expect(maskData("251219901234")).toBe("25/12/1990");
  });
});

describe("isoParaBR", () => {
  it("converte ISO para BR", () => {
    expect(isoParaBR("1990-12-25")).toBe("25/12/1990");
    expect(isoParaBR("2026-01-05T12:00:00")).toBe("05/01/2026");
  });
  it("vazio/nulo/inválido → string vazia", () => {
    expect(isoParaBR("")).toBe("");
    expect(isoParaBR(null)).toBe("");
    expect(isoParaBR("xpto")).toBe("");
  });
});

describe("brParaIso", () => {
  it("converte BR válido para ISO", () => {
    expect(brParaIso("25/12/1990")).toBe("1990-12-25");
    expect(brParaIso("05/01/2026")).toBe("2026-01-05");
  });
  it("rejeita datas inexistentes ou fora de faixa", () => {
    expect(brParaIso("31/02/2020")).toBe(""); // fev não tem 31
    expect(brParaIso("29/02/2021")).toBe(""); // 2021 não é bissexto
    expect(brParaIso("00/12/1990")).toBe("");
    expect(brParaIso("10/13/1990")).toBe("");
    expect(brParaIso("10/12/1800")).toBe(""); // ano implausível
    expect(brParaIso("123")).toBe("");        // incompleta
  });
  it("aceita 29/02 em ano bissexto", () => {
    expect(brParaIso("29/02/2020")).toBe("2020-02-29");
  });
  it("ida e volta (ISO→BR→ISO) preserva", () => {
    expect(brParaIso(isoParaBR("1985-07-09"))).toBe("1985-07-09");
  });
});

describe("gerarHorarios", () => {
  it("passo 30min gera 48 horários começando 00:00", () => {
    const hs = gerarHorarios(30);
    expect(hs.length).toBe(48);
    expect(hs[0]).toBe("00:00");
    expect(hs[1]).toBe("00:30");
    expect(hs[hs.length - 1]).toBe("23:30");
  });
  it("passo 60min gera 24 horários", () => {
    const hs = gerarHorarios(60);
    expect(hs.length).toBe(24);
    expect(hs[8]).toBe("08:00");
  });
});

describe("protocoloContato", () => {
  it("mesmo id → mesmo protocolo (determinístico, igual pros 2 lados)", () => {
    const id = "a1b2c3d4-0000-1111-2222-333344445555";
    expect(protocoloContato(id)).toBe(protocoloContato(id));
  });
  it("formato: 6 dígitos agrupados XXX XXX", () => {
    const p = protocoloContato("qualquer-id-aqui");
    expect(p).toMatch(/^\d{3} \d{3}$/);
  });
  it("ids diferentes tendem a protocolos diferentes", () => {
    expect(protocoloContato("id-aaaa")).not.toBe(protocoloContato("id-bbbb"));
  });
  it("vazio/nulo → travessão", () => {
    expect(protocoloContato("")).toBe("—");
    expect(protocoloContato(null)).toBe("—");
    expect(protocoloContato(undefined)).toBe("—");
  });
});

describe("faseCiclo", () => {
  it("mapeia os 4 status do trilho para as fases 1–4", () => {
    expect(faseCiclo("pendente")).toBe(1);
    expect(faseCiclo("aceita")).toBe(2);
    expect(faseCiclo("em_andamento")).toBe(3);
    expect(faseCiclo("concluida")).toBe(4);
  });
  it("status fora do trilho → null (sem stepper)", () => {
    expect(faseCiclo("aberta")).toBeNull();
    expect(faseCiclo("cancelada")).toBeNull();
    expect(faseCiclo("expirada")).toBeNull();
    expect(faseCiclo("qualquer")).toBeNull();
  });
});

describe("vezDoCiclo", () => {
  it("pendente: a bola é do prestador (aceitar)", () => {
    expect(vezDoCiclo("pendente", "prestador")).toMatch(/Sua vez/);
    expect(vezDoCiclo("pendente", "anunciante")).toMatch(/Aguardando/);
  });
  it("aceita: combinar no chat (igual pros dois)", () => {
    expect(vezDoCiclo("aceita", "prestador")).toBe(vezDoCiclo("aceita", "anunciante"));
    expect(vezDoCiclo("aceita", "prestador")).toMatch(/chat/i);
  });
  it("em_andamento: prestador registra chegada", () => {
    expect(vezDoCiclo("em_andamento", "prestador")).toMatch(/chegada/i);
    expect(vezDoCiclo("em_andamento", "anunciante")).toMatch(/andamento/i);
  });
  it("concluida: mesma frase pros dois", () => {
    expect(vezDoCiclo("concluida", "prestador")).toBe("Serviço concluído");
    expect(vezDoCiclo("concluida", "anunciante")).toBe("Serviço concluído");
  });
  it("status fora do trilho → string vazia", () => {
    expect(vezDoCiclo("cancelada", "prestador")).toBe("");
    expect(vezDoCiclo("aberta", "anunciante")).toBe("");
  });
});

describe("linkVaga", () => {
  it("com id → link com ?vaga=", () => {
    expect(linkVaga("abc123")).toBe(`${URL_APP}/?vaga=abc123`);
  });
  it("sem id → link genérico do app", () => {
    expect(linkVaga(null)).toBe(URL_APP);
    expect(linkVaga(undefined)).toBe(URL_APP);
  });
});

describe("montarTextoVaga", () => {
  it("diária: função e segmento em linhas separadas, valor/dia, data e bairro", () => {
    const t = montarTextoVaga({
      tipo_oferta: "diaria", funcao: "Faxineira", segmento: "Limpeza",
      valor: 150, data: "2026-07-10", horario_inicio: "08:00", horario_fim: "17:00",
      bairro: "Centro",
    });
    expect(t).toMatch(/Vaga de diária/);
    expect(t).toContain("👷 Faxineira");
    expect(t).toContain("🏷️ Limpeza");
    expect(t).toContain("💰 R$ 150/dia");
    expect(t).toContain("📅 10/07/2026 · 08:00–17:00");
    expect(t).toContain("📍 Centro");
    expect(t).toContain(URL_APP);
  });

  it("serviço: mostra preço fixo e tempo estimado em horas", () => {
    const t = montarTextoVaga({
      tipo_oferta: "servico", funcao: "Montador de Móveis", valor: 80,
      tempo_estimado_min: 120, data: "2026-07-02", horario_inicio: "14:00",
    });
    expect(t).toMatch(/Serviço disponível/);
    expect(t).toContain("👷 Montador de Móveis");
    expect(t).toContain("💰 R$ 80  ·  ⏱ 2h");
    expect(t).not.toContain("/dia");
  });

  it("emprego: usa salário-texto, contrato e regime (não usa R$ valor)", () => {
    const t = montarTextoVaga({
      tipo_oferta: "emprego", funcao: "Auxiliar", salario_texto: "R$ 1.800",
      tipo_contrato: "CLT", regime: "Presencial", valor: 0,
    });
    expect(t).toMatch(/Vaga de emprego/);
    expect(t).toContain("📄 CLT · Presencial");
    expect(t).toContain("💰 R$ 1.800");
    expect(t).not.toContain("/dia");
  });

  it("emprego sem salário → 'A combinar'", () => {
    const t = montarTextoVaga({ tipo_oferta: "emprego", funcao: "Vendedor" });
    expect(t).toContain("💰 A combinar");
  });

  it("inclui a descrição (o que a pessoa vai fazer) e a corta se for longa", () => {
    const t = montarTextoVaga({
      tipo_oferta: "diaria", funcao: "Pedreiro", descricao: "Levantar muro nos fundos",
    });
    expect(t).toContain("📋 Levantar muro nos fundos");
    const longa = "x".repeat(300);
    const t2 = montarTextoVaga({ tipo_oferta: "diaria", descricao: longa });
    expect(t2).toContain("…");
    expect(t2.length).toBeLessThan(longa.length + 100);
  });

  it("deep link: com id, o texto termina com ?vaga=ID", () => {
    const t = montarTextoVaga({ id: "v-99", tipo_oferta: "servico", funcao: "Pintor" });
    expect(t.trim().endsWith(`${URL_APP}/?vaga=v-99`)).toBe(true);
  });

  it("nunca vaza endereço completo nem termina sem o link do app", () => {
    const t = montarTextoVaga({
      tipo_oferta: "diaria", funcao: "Pedreiro", valor: 200,
      bairro: "Tiradentes", data: "2026-08-01", horario_inicio: "07:00", horario_fim: "16:00",
    });
    // bairro entra, mas nada de "Rua"/número (endereço só após aceitar no app)
    expect(t).not.toMatch(/Rua |Avenida |nº/i);
    expect(t.trim().endsWith(URL_APP)).toBe(true);
  });
});

describe("completudeEditavel", () => {
  it("perfil vazio: 0% e 5 itens pendentes (só os que o user preenche)", () => {
    const r = completudeEditavel({});
    expect(r.pct).toBe(0);
    expect(r.preenchidos).toBe(0);
    expect(r.total).toBe(5);
    expect(r.pendentes).toHaveLength(5);
  });

  it("ignora '1ª diária' e 'avaliação' — só conta os 5 itens editáveis", () => {
    // mesmo sem diárias/avaliação, preencher os 5 editáveis dá 100% editável.
    const r = completudeEditavel({
      foto_url: "u.jpg", cpf: "123", telefone: "67999999999",
      telefone_verificado: true, bio: "Trabalho com limpeza há 5 anos, caprichosa.",
      lat: -20.4,
    });
    expect(r.pct).toBe(100);
    expect(r.pendentes).toHaveLength(0);
  });

  it("preenchimento parcial: % proporcional aos 5 itens", () => {
    // foto + telefone preenchidos (2 de 5) = 40%
    const r = completudeEditavel({
      foto_url: "u.jpg", telefone: "67999999999",
    });
    expect(r.pct).toBe(40);
    expect(r.preenchidos).toBe(2);
    expect(r.pendentes.map(i => i.chave).sort()).toEqual(["bio", "cpf", "endereco"]);
  });

  it("aceita CNPJ no lugar de CPF (anunciante PJ) e endereço por lat ou endereco_empregador", () => {
    const r = completudeEditavel({
      foto_url: "u.jpg", cnpj: "11222333000181", telefone_verificado: true,
      bio: "Empresa de eventos com 10 anos de mercado na cidade.",
      endereco_empregador: "Centro, Campo Grande",
    });
    expect(r.pct).toBe(100);
  });

  it("bio curta (<20 chars) não conta como preenchida", () => {
    const r = completudeEditavel({
      foto_url: "u.jpg", cpf: "123", telefone: "67999999999", lat: -20.4,
      bio: "Oi",
    });
    expect(r.pendentes.map(i => i.chave)).toEqual(["bio"]);
    expect(r.pct).toBe(80);
  });
});

describe("cota de vagas de emprego", () => {
  it("a constante de cota grátis é 3", () => {
    expect(LIMITE_VAGAS_EMPREGO_GRATIS_MES).toBe(3);
  });

  it("limite efetivo = 3 + extras pagas no plano grátis", () => {
    expect(limiteVagasEmpregoMes(0, "gratis")).toBe(3);
    expect(limiteVagasEmpregoMes(2, "gratis")).toBe(5);
  });

  it("plano pago = ilimitado", () => {
    expect(limiteVagasEmpregoMes(0, "essencial")).toBe(Infinity);
    expect(limiteVagasEmpregoMes(0, "plus")).toBe(Infinity);
    expect(vagaEmpregoExcedeuCota(999, 0, "essencial")).toBe(false);
    expect(vagaEmpregoExcedeuCota(999, 0, "plus")).toBe(false);
  });

  it("grátis: libera as 3 primeiras, exige pagamento na 4ª", () => {
    expect(vagaEmpregoExcedeuCota(0, 0, "gratis")).toBe(false);
    expect(vagaEmpregoExcedeuCota(2, 0, "gratis")).toBe(false); // 3ª ainda grátis
    expect(vagaEmpregoExcedeuCota(3, 0, "gratis")).toBe(true);  // 4ª exige pagar
  });

  it("cada desbloqueio pago soma +1 à cota", () => {
    expect(vagaEmpregoExcedeuCota(3, 1, "gratis")).toBe(false); // 3 + 1 pago = 4
    expect(vagaEmpregoExcedeuCota(4, 1, "gratis")).toBe(true);  // estourou de novo
  });

  it("tolera entradas inválidas (negativas / NaN)", () => {
    expect(vagaEmpregoExcedeuCota(-5, -2, "gratis")).toBe(false);
    expect(vagaEmpregoExcedeuCota(NaN, NaN, "gratis")).toBe(false);
  });
});

describe("conviteExpirou", () => {
  const agora = new Date("2026-06-12T13:37:00");
  it("expira convite pendente com data/hora já passada", () => {
    expect(conviteExpirou({ data_servico: "2026-06-12", horario_servico: "06:00", status: "pendente" }, agora)).toBe(true);
  });
  it("não expira convite pendente com horário futuro no mesmo dia", () => {
    expect(conviteExpirou({ data_servico: "2026-06-12", horario_servico: "15:00", status: "pendente" }, agora)).toBe(false);
  });
  it("não expira convite de data futura", () => {
    expect(conviteExpirou({ data_servico: "2026-06-13", horario_servico: "06:00", status: "pendente" }, agora)).toBe(false);
  });
  it("só status pendente expira (aceito/confirmado/recusado nunca)", () => {
    expect(conviteExpirou({ data_servico: "2026-06-10", horario_servico: "06:00", status: "aceito" }, agora)).toBe(false);
    expect(conviteExpirou({ data_servico: "2026-06-10", horario_servico: "06:00", status: "confirmado" }, agora)).toBe(false);
    expect(conviteExpirou({ data_servico: "2026-06-10", horario_servico: "06:00", status: "recusado" }, agora)).toBe(false);
  });
  it("sem horário, só expira depois do fim do dia (23:59)", () => {
    expect(conviteExpirou({ data_servico: "2026-06-12", horario_servico: null, status: "pendente" }, agora)).toBe(false);
    expect(conviteExpirou({ data_servico: "2026-06-11", horario_servico: null, status: "pendente" }, agora)).toBe(true);
  });
  it("horário malformado cai no fim do dia (não expira indevidamente)", () => {
    expect(conviteExpirou({ data_servico: "2026-06-12", horario_servico: "ab:cd", status: "pendente" }, agora)).toBe(false);
  });
  it("sem data_servico nunca expira", () => {
    expect(conviteExpirou({ data_servico: null, horario_servico: "06:00", status: "pendente" }, agora)).toBe(false);
  });
});

// ── erroTelefoneSave: telefone só bloqueia o save quando o save ALTERA o telefone ──
describe("erroTelefoneSave (saveProfile não revalida telefone em update parcial)", () => {
  it("update parcial { categorias } (sem telefone) NÃO revalida → null", () => {
    // saveProfile({ categorias }) => updates.telefone === undefined
    expect(erroTelefoneSave(undefined)).toBeNull();
  });
  it("update parcial { bio } (sem telefone) NÃO revalida → null", () => {
    expect(erroTelefoneSave(undefined)).toBeNull();
  });
  it("perfil com telefone legado fora de formato NÃO bloqueia save que não toca no campo", () => {
    // O legado mora em profile.telefone; como o update não passa telefone, é undefined.
    expect(erroTelefoneSave(undefined)).toBeNull();
  });
  it("quando o save edita o telefone com valor inválido → mensagem (regra mantida)", () => {
    expect(erroTelefoneSave("123")).toBe("Telefone inválido. Use o formato (XX) 9XXXX-XXXX.");
  });
  it("quando o save edita o telefone com valor válido → null", () => {
    expect(erroTelefoneSave("(67) 99999-9999")).toBeNull();
    expect(erroTelefoneSave("67999999999")).toBeNull();
  });
  it("telefone vazio no update não bloqueia (limpar campo) → null", () => {
    expect(erroTelefoneSave("")).toBeNull();
  });
});

// ── rotuloDistanciaFeed: distância honesta no feed (não mente "0,2 km") ──
describe("rotuloDistanciaFeed", () => {
  it("coord compartilhada por 3+ perfis (centroide) → null (esconde número)", () => {
    expect(rotuloDistanciaFeed(0.2, { perfisNaMesmaCoord: 12 })).toBeNull();
    expect(rotuloDistanciaFeed(6.0, { perfisNaMesmaCoord: 3 })).toBeNull();
  });
  it("distância abaixo do ruído do arredondamento (~1,1 km) → null", () => {
    expect(rotuloDistanciaFeed(0.2, { perfisNaMesmaCoord: 1 })).toBeNull();
    expect(rotuloDistanciaFeed(1.4, { perfisNaMesmaCoord: 1 })).toBeNull();
  });
  it("coord única e distância acima da grade → mostra '~X km'", () => {
    expect(rotuloDistanciaFeed(3.2, { perfisNaMesmaCoord: 1 })).toBe("~3,2 km");
    expect(rotuloDistanciaFeed(2.0, { perfisNaMesmaCoord: 2 })).toBe("~2,0 km");
  });
  it("Infinity (sem geo de um lado) → null", () => {
    expect(rotuloDistanciaFeed(Infinity, { perfisNaMesmaCoord: 1 })).toBeNull();
  });
  it("limiar da grade é configurável", () => {
    // gridKm 0 → some o piso de ruído; só o filtro de cluster vale.
    expect(rotuloDistanciaFeed(0.2, { perfisNaMesmaCoord: 1, gridKm: 0 })).toBe("~0,2 km");
  });
  it("ambosGeoPrecisos=false (algum lado centroide/null) → null", () => {
    expect(rotuloDistanciaFeed(3.2, { perfisNaMesmaCoord: 1, ambosGeoPrecisos: false })).toBeNull();
  });
  it("ambosGeoPrecisos=true + coord única + acima da grade → mostra '~X km'", () => {
    expect(rotuloDistanciaFeed(3.2, { perfisNaMesmaCoord: 1, ambosGeoPrecisos: true })).toBe("~3,2 km");
  });
  it("ambosGeoPrecisos=true NÃO fura o piso de ruído nem o cluster", () => {
    expect(rotuloDistanciaFeed(0.5, { perfisNaMesmaCoord: 1, ambosGeoPrecisos: true })).toBeNull();
    expect(rotuloDistanciaFeed(4.0, { perfisNaMesmaCoord: 3, ambosGeoPrecisos: true })).toBeNull();
  });
});

// ── distanciaParaFiltroRaio: filtro de raio fail-open sem geo confiável ──
describe("distanciaParaFiltroRaio", () => {
  it("ambos precisos → corta pela distância real", () => {
    expect(distanciaParaFiltroRaio(7.5, true)).toBe(7.5);
  });
  it("algum lado impreciso → Infinity (fail-open, não corta ninguém)", () => {
    expect(distanciaParaFiltroRaio(7.5, false)).toBe(Infinity);
    // 7,5 km > "até 5 km", mas com geo não confiável o perfil PASSA (Infinity).
    expect(distanciaParaFiltroRaio(7.5, false) <= 5).toBe(false);
  });
});

// ── geoPrecisoParaSalvar: save (edição de perfil/onboarding) seta geo_preciso ──
describe("geoPrecisoParaSalvar (save seta geo_preciso conforme a origem)", () => {
  it("GPS → sempre true (posição real)", () => {
    expect(geoPrecisoParaSalvar("gps")).toBe(true);
    expect(geoPrecisoParaSalvar("gps", false)).toBe(true); // GPS ignora cepPreciso
  });
  it("CEP preciso → true (geocode não caiu no centroide)", () => {
    expect(geoPrecisoParaSalvar("cep", true)).toBe(true);
  });
  it("CEP impreciso (centroide de cidade) → false", () => {
    expect(geoPrecisoParaSalvar("cep", false)).toBe(false);
    expect(geoPrecisoParaSalvar("cep")).toBe(false); // default = impreciso
  });
});

// ── parseEnderecoReverso: GPS sincroniza o CEP (lat/lng → endereço) ──
describe("parseEnderecoReverso (sincroniza CEP com a posição do GPS)", () => {
  it("address completo → CEP formatado + bairro/cidade/uf", () => {
    expect(parseEnderecoReverso({
      postcode: "79071160", suburb: "Tiradentes", city: "Campo Grande", state: "Mato Grosso do Sul",
    })).toEqual({ cep: "79071-160", bairro: "Tiradentes", cidade: "Campo Grande", uf: "Mato Grosso do Sul" });
  });
  it("aceita CEP já com hífen e usa fallbacks de bairro/cidade", () => {
    expect(parseEnderecoReverso({ postcode: "79071-160", neighbourhood: "Centro", town: "Sidrolândia" }))
      .toEqual({ cep: "79071-160", bairro: "Centro", cidade: "Sidrolândia", uf: "" });
  });
  it("sem postcode (ou inválido) → cep '' (GPS continua a verdade)", () => {
    expect(parseEnderecoReverso({ city: "Campo Grande" }).cep).toBe("");
    expect(parseEnderecoReverso({ postcode: "123" }).cep).toBe("");
  });
  it("address null/undefined → tudo vazio (sem quebrar)", () => {
    expect(parseEnderecoReverso(null)).toEqual({ cep: "", bairro: "", cidade: "", uf: "" });
    expect(parseEnderecoReverso(undefined)).toEqual({ cep: "", bairro: "", cidade: "", uf: "" });
  });
});

// ── Preço de delivery: estimativa = valor (fonte única) + rótulo "estimado" ───
describe("delivery: estimativa é o preço oficial", () => {
  // (a) delivery grava a estimativa em valor E espelha ganho_estimado_dia
  it("delivery: estimativa vira valor e espelha ganho_estimado_dia (fonte única)", () => {
    expect(precoDiariaParaSalvar({ ehDelivery: true, ehEmprego: false, valorForm: "180" }))
      .toEqual({ valor: 180, ganho_estimado_dia: 180 });
  });
  it("delivery: valor e ganho_estimado_dia nunca divergem (saem do mesmo input)", () => {
    const r = precoDiariaParaSalvar({ ehDelivery: true, ehEmprego: false, valorForm: 95 });
    expect(r.valor).toBe(r.ganho_estimado_dia);
  });
  it("delivery sem valor preenchido: valor 0 e ganho_estimado_dia null", () => {
    expect(precoDiariaParaSalvar({ ehDelivery: true, ehEmprego: false, valorForm: "" }))
      .toEqual({ valor: 0, ganho_estimado_dia: null });
  });
  it("não-delivery: ganho_estimado_dia não se aplica (null)", () => {
    expect(precoDiariaParaSalvar({ ehDelivery: false, ehEmprego: false, valorForm: "150" }))
      .toEqual({ valor: 150, ganho_estimado_dia: null });
  });
  it("emprego: valor zera (vai no salário) e sem ganho_estimado_dia", () => {
    expect(precoDiariaParaSalvar({ ehDelivery: false, ehEmprego: true, valorForm: "150" }))
      .toEqual({ valor: 0, ganho_estimado_dia: null });
  });

  // (b — indireto) as 3 funções de delivery, e só elas, acionam a regra
  it("FUNCOES_DELIVERY identifica exatamente motoboy/entregador (gate do campo)", () => {
    expect(FUNCOES_DELIVERY).toEqual(["Motoboy", "Entregador de Bicicleta", "Entregador de Carro"]);
    expect(FUNCOES_DELIVERY.includes("Diarista")).toBe(false);
  });

  // (c) card de delivery mostra que o preço é estimado
  it("card delivery: rótulo mostra ~ e '(estimado)'", () => {
    expect(rotuloPrecoVaga(180, { ehDelivery: true })).toBe("~R$ 180/dia (estimado)");
  });
  it("card não-delivery (diária): mantém 'R$ X/dia' seco", () => {
    expect(rotuloPrecoVaga(150, { ehDelivery: false })).toBe("R$ 150/dia");
  });
  it("card não-delivery (serviço): 'R$ X' sem /dia", () => {
    expect(rotuloPrecoVaga(80, { ehDelivery: false, ehServico: true })).toBe("R$ 80");
  });
});

// ── deveMostrarLembreteGeo: lembrete (1x) de atualizar localização ──
describe("deveMostrarLembreteGeo", () => {
  it("geo_preciso null e não dispensado → mostra (legados)", () => {
    expect(deveMostrarLembreteGeo(null, false)).toBe(true);
    expect(deveMostrarLembreteGeo(undefined, false)).toBe(true);
    expect(deveMostrarLembreteGeo(false, false)).toBe(true);
  });
  it("geo_preciso true → NÃO mostra (some sozinho após recapturar)", () => {
    expect(deveMostrarLembreteGeo(true, false)).toBe(false);
  });
  it("dispensado → NÃO mostra (1x só)", () => {
    expect(deveMostrarLembreteGeo(null, true)).toBe(false);
    expect(deveMostrarLembreteGeo(false, true)).toBe(false);
  });
});

// ── Vaga de EMPREGO: chamar vários (Fase 1) ──
describe("planoSelecao (emprego chama vários; diária inalterada)", () => {
  it("(a) emprego: chama vários — NÃO rejeita, NÃO fecha, NÃO define contratado", () => {
    expect(planoSelecao({ ehEmprego: true, vagas: 1, jaSelecionados: 0 }))
      .toEqual({ rejeitarPendentes: false, fecharVaga: false, definirAceite: false });
    // mesmo já tendo chamado vários, segue liberando
    expect(planoSelecao({ ehEmprego: true, vagas: 1, jaSelecionados: 5 }))
      .toEqual({ rejeitarPendentes: false, fecharVaga: false, definirAceite: false });
  });
  it("(b) diária 1 vaga: NÃO regrediu — lota na 1ª, rejeita os outros e fecha", () => {
    expect(planoSelecao({ ehEmprego: false, vagas: 1, jaSelecionados: 0 }))
      .toEqual({ rejeitarPendentes: true, fecharVaga: true, definirAceite: true });
  });
  it("(b) diária multi-vagas: só fecha/rejeita quando lota", () => {
    expect(planoSelecao({ ehEmprego: false, vagas: 3, jaSelecionados: 1 }))
      .toEqual({ rejeitarPendentes: false, fecharVaga: false, definirAceite: true }); // 2/3
    expect(planoSelecao({ ehEmprego: false, vagas: 3, jaSelecionados: 2 }))
      .toEqual({ rejeitarPendentes: true, fecharVaga: true, definirAceite: true });   // 3/3
  });
});

describe("vagaApareceNoFeed (encerrar tira do feed)", () => {
  it("(c) só 'aberta' aparece; 'encerrada' (e outras) saem do feed", () => {
    expect(vagaApareceNoFeed("aberta")).toBe(true);
    expect(vagaApareceNoFeed("encerrada")).toBe(false);
    expect(vagaApareceNoFeed("pendente")).toBe(false);
    expect(vagaApareceNoFeed("cancelada")).toBe(false);
  });
});

describe("empregoExigePlanoParaChamar (gate Essencial no chamar)", () => {
  it("(d) grátis exige plano na 1ª chamada; com plano libera todas (ilimitado)", () => {
    expect(empregoExigePlanoParaChamar("gratis")).toBe(true);
    expect(empregoExigePlanoParaChamar(null)).toBe(true);
    expect(empregoExigePlanoParaChamar("essencial")).toBe(false);
    expect(empregoExigePlanoParaChamar("plus")).toBe(false);
  });
});

// ── documentoAprovado: gate da candidatura (RG/CNH aprovado) ──
describe("documentoAprovado", () => {
  it("só 'aprovado' libera; os demais barram", () => {
    expect(documentoAprovado("aprovado")).toBe(true);
    expect(documentoAprovado("enviado")).toBe(false);
    expect(documentoAprovado("nao_enviado")).toBe(false);
    expect(documentoAprovado("rejeitado")).toBe(false);
    expect(documentoAprovado(null)).toBe(false);
    expect(documentoAprovado(undefined)).toBe(false);
  });
});

// ── extrairPrimeiroLink: aviso "saindo do DiáriaJá" na mensagem automática ──
describe("extrairPrimeiroLink", () => {
  it("acha o primeiro link http(s)", () => {
    expect(extrairPrimeiroLink("Boas-vindas! Cadastre-se em https://rh.empresa.com/vaga"))
      .toBe("https://rh.empresa.com/vaga");
    expect(extrairPrimeiroLink("http://exemplo.com.br já vale")).toBe("http://exemplo.com.br");
  });
  it("tira pontuação colada no fim", () => {
    expect(extrairPrimeiroLink("Acesse https://talent.com/x.")).toBe("https://talent.com/x");
    expect(extrairPrimeiroLink("(veja https://a.com/b)")).toBe("https://a.com/b");
  });
  it("sem link → null", () => {
    expect(extrairPrimeiroLink("Bem-vindo! Aguarde nosso contato.")).toBeNull();
    expect(extrairPrimeiroLink("www.semprotocolo.com")).toBeNull(); // exige http(s)
    expect(extrairPrimeiroLink("")).toBeNull();
    expect(extrairPrimeiroLink(null)).toBeNull();
    expect(extrairPrimeiroLink(undefined)).toBeNull();
  });
});

// ── Chat por par (Emprego Fase 2) — prova os 2 fluxos pedidos ────────────────
describe("mensagemDoPar — chat escopado", () => {
  const EMP = "empresa-1";
  const A = "candidato-A";
  const B = "candidato-B";
  // Mensagens de uma MESMA vaga (mesmo diaria_id), 2 pares diferentes:
  const msgsDaVaga = [
    { remetente_id: EMP, destinatario_id: A, conteudo: "Oi A" },
    { remetente_id: A,   destinatario_id: EMP, conteudo: "Olá empresa (A)" },
    { remetente_id: EMP, destinatario_id: B, conteudo: "Oi B" },
    { remetente_id: B,   destinatario_id: EMP, conteudo: "Olá empresa (B)" },
  ];

  it("FLUXO DIÁRIA/CONVITE (1 par) — comportamento IDÊNTICO ao de hoje", () => {
    // Diária: empresa ↔ 1 diarista. Só existe 1 par, então o filtro é no-op:
    // tudo que vem (já limitado por diaria_id) passa — nada muda vs. hoje.
    const diaria = [
      { remetente_id: EMP, destinatario_id: A, conteudo: "msg 1" },
      { remetente_id: A,   destinatario_id: EMP, conteudo: "msg 2" },
    ];
    // Lado anunciante (eu=EMP, outro=diarista A) → vê as 2.
    expect(diaria.filter(m => mensagemDoPar(m, EMP, A))).toHaveLength(2);
    // Lado diarista (eu=A, outro=EMP) → vê as 2.
    expect(diaria.filter(m => mensagemDoPar(m, A, EMP))).toHaveLength(2);
    // Sem "outro" definido (fallback) → não filtra (igual ao load só por diaria_id).
    expect(diaria.filter(m => mensagemDoPar(m, EMP, null))).toHaveLength(2);
  });

  it("FLUXO EMPREGO (N candidatos) — cada chat só vê o SEU par", () => {
    // Anunciante abre o chat do candidato A → só as msgs do par EMP↔A.
    const chatComA = msgsDaVaga.filter(m => mensagemDoPar(m, EMP, A));
    expect(chatComA.map(m => m.conteudo)).toEqual(["Oi A", "Olá empresa (A)"]);
    // Anunciante abre o chat do candidato B → só as msgs do par EMP↔B.
    const chatComB = msgsDaVaga.filter(m => mensagemDoPar(m, EMP, B));
    expect(chatComB.map(m => m.conteudo)).toEqual(["Oi B", "Olá empresa (B)"]);
    // NÃO vaza: A não aparece no chat de B e vice-versa.
    expect(chatComA.some(m => m.conteudo.includes("B"))).toBe(false);
    expect(chatComB.some(m => m.conteudo.includes("A"))).toBe(false);
    // Lado do candidato A (eu=A) → só vê o par dele (RLS já garante, mas confirma).
    expect(msgsDaVaga.filter(m => mensagemDoPar(m, A, EMP)).map(m => m.conteudo))
      .toEqual(["Oi A", "Olá empresa (A)"]);
  });
});

// ── cargaHorariaConvite (item 9 — valor × carga no convite) ─────────────────
describe("cargaHorariaConvite", () => {
  it("prioriza a coluna estruturada quando presente", () => {
    expect(cargaHorariaConvite(10, "08:00 (6h de trabalho)")).toBe(10);
  });
  it("extrai do texto legado quando a coluna é nula", () => {
    expect(cargaHorariaConvite(null, "08:00 (10h de trabalho)")).toBe(10);
    expect(cargaHorariaConvite(undefined, "14:30 (4h de trabalho)")).toBe(4);
  });
  it("aceita decimal com vírgula ou ponto no texto legado", () => {
    expect(cargaHorariaConvite(null, "08:00 (7,5h de trabalho)")).toBe(7.5);
    expect(cargaHorariaConvite(null, "08:00 (7.5h de trabalho)")).toBe(7.5);
  });
  it("retorna null quando não há como saber a carga", () => {
    expect(cargaHorariaConvite(null, "08:00")).toBeNull();
    expect(cargaHorariaConvite(null, null)).toBeNull();
    expect(cargaHorariaConvite(undefined, undefined)).toBeNull();
    expect(cargaHorariaConvite(null, "")).toBeNull();
  });
  it("ignora coluna inválida (zero/negativa/NaN) e cai no texto", () => {
    expect(cargaHorariaConvite(0, "08:00 (8h de trabalho)")).toBe(8);
    expect(cargaHorariaConvite(-2, "08:00 (8h de trabalho)")).toBe(8);
    expect(cargaHorariaConvite(NaN, "08:00 (8h de trabalho)")).toBe(8);
  });
});
