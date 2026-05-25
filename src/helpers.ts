// ── Funções utilitárias do Trampojá ─────────────────────────────────────────
// Extraídas do App.tsx para separação de concerns.

// ── Gamificação: nível do diarista ───────────────────────────────────────────
export function nivelDiarista(diariasFeitas: number): {
  nome: string; cor: string; icone: string; proximo: number; atual: number;
} {
  if (diariasFeitas >= 30) return { nome: "Elite",  cor: "#7c3aed", icone: "💎", proximo: 0,  atual: 30 };
  if (diariasFeitas >= 15) return { nome: "Ouro",   cor: "#d97706", icone: "🏆", proximo: 30, atual: 15 };
  if (diariasFeitas >= 5)  return { nome: "Prata",  cor: "#64748b", icone: "🥈", proximo: 15, atual: 5  };
  return                          { nome: "Bronze", cor: "#b45309", icone: "🥉", proximo: 5,  atual: 0  };
}

// ── Score de confiança (0–100) ────────────────────────────────────────────────
export function calcScore(
  p: { foto_url?: string; cpf?: string; telefone?: string; bio?: string },
  diariasFeitas: number,
  mediaAval: number | null,
): number {
  let score = 0;
  if (p.foto_url)  score += 25;
  if (p.cpf)       score += 25;
  if (p.telefone)  score += 10;
  if (p.bio && p.bio.length > 20) score += 10;
  if (diariasFeitas >= 1)  score += 10;
  if (diariasFeitas >= 5)  score += 10;
  if (diariasFeitas >= 15) score += 5;
  if (mediaAval && mediaAval >= 4.0) score += 5;
  return Math.min(score, 100);
}

// ── Validação de nome real (anti-fake) ───────────────────────────────────────
export function validarNome(nome: string): string | null {
  const t = nome.trim();
  if (t.length < 3) return "Nome muito curto (mínimo 3 caracteres)";
  if (/\d/.test(t)) return "Nome não pode conter números";
  if (/[!@#$%^&*()_+=\[\]{}|<>?/\\;:,\".~`]/.test(t)) return "Nome não pode conter símbolos especiais";
  const partes = t.split(/\s+/).filter(p => p.length > 0);
  if (partes.length < 2) return "Informe seu nome completo (nome e sobrenome)";
  return null;
}

// ── Validação do título/local da diária ──────────────────────────────────────
// Bloqueia títulos muito curtos, ofensivos ou claramente inapropriados
const PALAVRAS_PROIBIDAS = [
  "droga", "drogas", "cocaína", "crack", "maconha", "tráfico",
  "arma", "armas", "pistola", "fuzil", "matar", "assassinar",
  "prostituição", "programa", "sexo", "nude", "nudez",
  "golpe", "fraude", "enganar", "estelionato",
];
export function validarTituloDiaria(titulo: string): string | null {
  const t = titulo.trim().toLowerCase();
  if (!t) return "Informe o nome do local onde o serviço será prestado.";
  if (t.length < 3) return "⚠️ Título muito curto — descreva melhor o local.";
  for (const palavra of PALAVRAS_PROIBIDAS) {
    if (t.includes(palavra)) {
      return `⚠️ O título contém conteúdo não permitido ("${palavra}"). Descreva apenas serviços lícitos.`;
    }
  }
  return null;
}

// ── Anti-fraude em descrições de vagas ───────────────────────────────────────
export function verificarFraudeDescricao(texto: string): string | null {
  if (!texto) return null;
  if (/\b\d{8,11}\b/.test(texto))
    return "⚠️ Parece que há um número de telefone na descrição. Combine contatos apenas pelo chat do app.";
  if (/whatsapp|wpp|zap|telegram|instagram|insta/i.test(texto))
    return "⚠️ Não inclua redes sociais na vaga. Use o chat do app para combinar detalhes.";
  if (/pague.antes|transferência.antes|pix.antes/i.test(texto))
    return "⚠️ Nunca solicite pagamento antecipado. Isso pode ser golpe.";
  if (texto.trim().length < 15)
    return "⚠️ Descreva melhor a vaga para atrair bons profissionais.";
  return null;
}

// ── Anti-exit: detecta tentativa de trocar contato externo no chat ───────────
export function detectarContatoExterno(msg: string): boolean {
  return /\b\d{8,11}\b/.test(msg) ||
    /whatsapp|wpp|zap|telegram|meu.n[uú]mero|me.liga|me.chama|fora.do.app/i.test(msg);
}

// ── Validação de CPF com dígito verificador (LGPD / anti-fraude) ─────────────
export function validarCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false; // ex: 111.111.111-11
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i]) * (10 - i);
  let r = (soma * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(c[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i]) * (11 - i);
  r = (soma * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(c[10]);
}

// ── Máscaras de formatação ────────────────────────────────────────────────────
export const maskCPF = (v: string): string => {
  v = v.replace(/\D/g, "").slice(0, 11);
  if (v.length > 9) return v.slice(0,3)+"."+v.slice(3,6)+"."+v.slice(6,9)+"-"+v.slice(9);
  if (v.length > 6) return v.slice(0,3)+"."+v.slice(3,6)+"."+v.slice(6);
  if (v.length > 3) return v.slice(0,3)+"."+v.slice(3);
  return v;
};

export const maskCNPJ = (v: string): string => {
  v = v.replace(/\D/g, "").slice(0, 14);
  if (v.length > 12) return v.slice(0,2)+"."+v.slice(2,5)+"."+v.slice(5,8)+"/"+v.slice(8,12)+"-"+v.slice(12);
  if (v.length > 8)  return v.slice(0,2)+"."+v.slice(2,5)+"."+v.slice(5,8)+"/"+v.slice(8);
  if (v.length > 5)  return v.slice(0,2)+"."+v.slice(2,5)+"."+v.slice(5);
  if (v.length > 2)  return v.slice(0,2)+"."+v.slice(2);
  return v;
};

// ── Validação de e-mail (formato básico, espelha a checagem do Supabase) ─────
export function validarEmail(email: string): boolean {
  const e = email.trim();
  if (e.length < 5 || e.length > 254) return false;
  // local@dominio.tld — sem espaços, com pelo menos um ponto no domínio
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ── Validação de telefone brasileiro (10 ou 11 dígitos, com ou sem máscara) ──
// 10 dígitos: fixo (XX XXXX-XXXX); 11 dígitos: celular (XX 9XXXX-XXXX).
export function validarTelefone(telefone: string): boolean {
  const t = telefone.replace(/\D/g, "");
  if (t.length !== 10 && t.length !== 11) return false;
  // DDD válido (11 a 99); 11 dígitos exige 9 no primeiro dígito após o DDD
  const ddd = parseInt(t.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  if (t.length === 11 && t[2] !== "9") return false;
  return true;
}

// ── Formata distância em km para exibição consistente ───────────────────────
// Antes: "0.3 km", "1.2 km", "12.34567 km" misturados pelo app.
// Agora: "menos de 1 km" / "X,X km" (1 casa, vírgula PT-BR) / "X km" (inteiro).
export function formatarDistancia(km: number | null | undefined): string {
  if (km === null || km === undefined || Number.isNaN(km)) return "";
  if (km < 1) return "menos de 1 km";
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km)} km`;
}

// ── Tempo estimado de moto/carro (rota terrestre ~30% maior + 30km/h média) ──
// Heurística simples: não consulta serviço de roteamento, só estima a partir
// da distância em linha reta. Bom o suficiente pra "10 min", "1h" no card.
export function tempoEstimadoMin(km: number | null | undefined): number | null {
  if (km === null || km === undefined || Number.isNaN(km) || km <= 0) return null;
  const kmRota = km * 1.3;        // sinuosidade média urbana
  const velKmh = 30;              // moto/carro em CG (mistura semáforos + avenidas)
  return Math.max(1, Math.round((kmRota / velKmh) * 60));
}

export function formatarTempo(min: number | null | undefined): string {
  if (min === null || min === undefined) return "";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// ── Nível de confiabilidade do usuário ───────────────────────────────────────
// Calcula em qual dos 4 níveis o usuário está com base nos dados preenchidos.
// É puro: depende só do profile, não bate no banco.
//
//   Nível 1 (Básico):     telefone verificado (SMS) OU email confirmado
//   Nível 2 (Verificado): + CPF (PF) ou CNPJ (PJ)
//   Nível 3 (Confiável):  + documento (foto/selfie) aprovado por KYC
//   Nível 4 (Premium):    + 2FA ativado (mfa habilitado no Supabase Auth)
//
// "Grandfathering": usuário antigo com email+CPF já vira Nível 2 sem
// precisar passar pelo OTP de telefone — porque email confirmado conta
// como verificação base.
export interface NivelEntrada {
  telefone_verificado?: boolean;
  email_confirmado?: boolean;
  cpf?: string;
  cnpj?: string;
  documento_status?: "nao_enviado" | "enviado" | "aprovado" | "rejeitado";
  mfa_enabled?: boolean;
}

export function calcularNivelConfiabilidade(p: NivelEntrada): {
  nivel: 1 | 2 | 3 | 4;
  nome: string;
  cor: string;
  pendencias: string[];
  proximo?: 1 | 2 | 3 | 4;
} {
  const temBase   = !!(p.telefone_verificado || p.email_confirmado);
  const temDoc    = !!((p.cpf && p.cpf.length > 0) || (p.cnpj && p.cnpj.length > 0));
  const docAprovado = p.documento_status === "aprovado";
  const tem2FA    = !!p.mfa_enabled;

  // Nível 4 — Premium
  if (temBase && temDoc && docAprovado && tem2FA) {
    return { nivel: 4, nome: "Premium", cor: "#7c3aed", pendencias: [] };
  }
  // Nível 3 — Confiável (falta 2FA pra Premium)
  if (temBase && temDoc && docAprovado) {
    return {
      nivel: 3, nome: "Confiável", cor: "#16a34a",
      pendencias: ["Ative 2FA para atingir Premium"],
      proximo: 4,
    };
  }
  // Nível 2 — Verificado (falta documento aprovado)
  if (temBase && temDoc) {
    const pend: string[] = [];
    if (p.documento_status === "nao_enviado" || !p.documento_status) pend.push("Envie documento com foto");
    else if (p.documento_status === "enviado") pend.push("Documento em análise");
    else if (p.documento_status === "rejeitado") pend.push("Reenvie seu documento (foi rejeitado)");
    return { nivel: 2, nome: "Verificado", cor: "#3A86FF", pendencias: pend, proximo: 3 };
  }
  // Nível 1 — Básico (falta CPF/CNPJ)
  if (temBase) {
    return {
      nivel: 1, nome: "Básico", cor: "#FF6B35",
      pendencias: ["Adicione seu CPF ou CNPJ pra verificar"],
      proximo: 2,
    };
  }
  // Sem base — tecnicamente abaixo de Nível 1. Devolve N1 com pendência
  // explícita pra UI não quebrar.
  return {
    nivel: 1, nome: "Básico", cor: "#94a3b8",
    pendencias: ["Verifique seu telefone ou confirme seu email"],
    proximo: 2,
  };
}

// ── Tempo relativo curto pt-BR ("agora", "há 12min", "há 2h", "ontem") ───────
// Usado nos cards do feed pra mostrar há quanto tempo a vaga foi publicada.
export function formatTempoRelativo(
  data: string | Date | null | undefined,
  agora: Date = new Date(),
): string {
  if (!data) return "";
  const d = typeof data === "string" ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = agora.getTime() - d.getTime();
  if (diffMs < 0) return "agora";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  // Acima de 7 dias mostra a data abreviada DD/MM
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// ── Vaga expirada: data + horario_fim já passou e nada foi confirmado ────────
// Recebe os campos crus do banco; retorna true se a vaga deveria sair do feed.
export function vagaExpirou(
  diaria: { data: string; horario_fim: string; status: string },
  agora: Date = new Date(),
): boolean {
  if (!diaria.data || !diaria.horario_fim) return false;
  if (!["aberta", "pendente"].includes(diaria.status)) return false;
  // horario_fim pode vir como "HH:MM" ou "HH:MM:SS"
  const [h, m] = diaria.horario_fim.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  // Trata como horário local (sem timezone) — vagas são locais ao usuário
  const fim = new Date(`${diaria.data}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  return agora.getTime() > fim.getTime();
}

// ── Distância geográfica (fórmula de Haversine) ───────────────────────────────
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
