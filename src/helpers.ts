// ── Funções utilitárias do DiáriaJá ─────────────────────────────────────────
// Extraídas do App.tsx para separação de concerns.

// ── Código de presença (fallback do QR Code) ─────────────────────────────────
// Deriva 4 dígitos determinísticos do UUID da diária pra usar como fallback
// quando a câmera do empregador não funciona. O diarista lê o código em voz
// alta e o empregador digita no app — o app compara contra suas próprias
// diárias em estado "aceita" (RLS já filtra), então não é um identificador
// público nem precisa ser secreto: é só uma forma compacta de referenciar
// a diária que o diarista tem na mão.
export function codigoPresenca(diariaId: string): string {
  // Hash simples (djb2 truncado em 14 bits → 0–9999) — determinístico,
  // sem dependências, e o suficiente pra mapear 1-para-1 dentro do escopo
  // das diárias abertas de UM empregador (tipicamente <10 simultâneas).
  let h = 5381;
  for (let i = 0; i < diariaId.length; i++) {
    h = ((h << 5) + h + diariaId.charCodeAt(i)) >>> 0;
  }
  return String(h % 10000).padStart(4, "0");
}

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

// ── Breakdown do Score de confiança em 4 dimensões ───────────────────────────
// Usado pra mostrar onde o diarista precisa investir pra subir o score.
//   Perfil:     foto + CPF + telefone + bio + endereço (até 30 pts)
//   Reputação:  média das avaliações × volume (até 30 pts)
//   Atividade:  diárias concluídas (até 25 pts)
//   Confiança:  CPF/CNPJ verificado + telefone verificado + KYC (até 15 pts)
export interface ScoreBreakdown {
  total: number;          // 0–100 (= soma)
  perfil:    { valor: number; max: number };
  reputacao: { valor: number; max: number };
  atividade: { valor: number; max: number };
  confianca: { valor: number; max: number };
  nivelLabel: string;     // "Crescendo" | "Visitante" | "Sólido" | "Top"
  nivelCor: string;
}

export function calcScoreBreakdown(
  p: { foto_url?: string; cpf?: string; cnpj?: string; telefone?: string;
       bio?: string; endereco_empregador?: string; lat?: number | null;
       telefone_verificado?: boolean;
       documento_status?: "nao_enviado" | "enviado" | "aprovado" | "rejeitado"; },
  diariasFeitas: number,
  totalAvaliacoes: number,
  mediaAval: number | null,
): ScoreBreakdown {
  // Perfil — 30 pts
  let perfil = 0;
  if (p.foto_url)                        perfil += 8;
  if (p.cpf || p.cnpj)                   perfil += 6;
  if (p.telefone)                        perfil += 4;
  if (p.bio && p.bio.length >= 20)       perfil += 6;
  if (p.endereco_empregador || p.lat)    perfil += 6;
  perfil = Math.min(perfil, 30);

  // Reputação — 30 pts (média × volume)
  let reputacao = 0;
  if (mediaAval !== null && totalAvaliacoes > 0) {
    const fatorMedia  = Math.max(0, Math.min(1, (mediaAval - 1) / 4)); // 1.0=0, 5.0=1
    const fatorVolume = Math.min(1, totalAvaliacoes / 10);
    reputacao = Math.round(30 * fatorMedia * fatorVolume);
  }

  // Atividade — 25 pts (curva acelera no início, satura no fim)
  // 1 diária = 5, 5 = 12, 15 = 20, 30 = 25
  let atividade = 0;
  if (diariasFeitas >= 1)  atividade += 5;
  if (diariasFeitas >= 5)  atividade += 7;
  if (diariasFeitas >= 15) atividade += 8;
  if (diariasFeitas >= 30) atividade += 5;
  atividade = Math.min(atividade, 25);

  // Confiança — 15 pts
  let confianca = 0;
  if (p.telefone_verificado)             confianca += 5;
  if (p.cpf || p.cnpj)                   confianca += 5;
  if (p.documento_status === "aprovado") confianca += 5;
  confianca = Math.min(confianca, 15);

  const total = perfil + reputacao + atividade + confianca;

  let nivelLabel = "Visitante";
  let nivelCor   = "#94a3b8";
  if (total >= 75)      { nivelLabel = "Top";       nivelCor = "#16a34a"; }
  else if (total >= 50) { nivelLabel = "Sólido";    nivelCor = "#3A86FF"; }
  else if (total >= 25) { nivelLabel = "Crescendo"; nivelCor = "#f59e0b"; }

  return {
    total,
    perfil:    { valor: perfil,    max: 30 },
    reputacao: { valor: reputacao, max: 30 },
    atividade: { valor: atividade, max: 25 },
    confianca: { valor: confianca, max: 15 },
    nivelLabel, nivelCor,
  };
}

// ── Completude do perfil (%) ─────────────────────────────────────────────────
// Lista de campos que o user precisa preencher pra ter perfil "completo".
// Retorna % + array de itens com label/ícone/preenchido.
export interface CompletudeItem {
  chave: string;
  icone: string;
  label: string;
  descricao?: string;
  preenchido: boolean;
}

export function calcCompletude(
  p: { foto_url?: string; cpf?: string; cnpj?: string; telefone?: string;
       telefone_verificado?: boolean; bio?: string;
       endereco_empregador?: string; lat?: number | null;
       pix_chave?: string; mp_user_id?: string; },
  diariasFeitas: number,
  mediaAval: number | null,
): { pct: number; itens: CompletudeItem[] } {
  const itens: CompletudeItem[] = [
    { chave: "foto",         icone: "📷", label: "Foto de perfil",       preenchido: !!p.foto_url },
    { chave: "cpf",          icone: "🪪", label: "CPF verificado",       preenchido: !!(p.cpf || p.cnpj) },
    { chave: "telefone",     icone: "📱", label: "Telefone",             preenchido: !!(p.telefone_verificado || p.telefone) },
    { chave: "bio",          icone: "📝", label: "Apresentação",
      descricao: "Escreva pelo menos 20 caracteres sobre você e suas habilidades.",
      preenchido: !!(p.bio && p.bio.length >= 20) },
    { chave: "endereco",     icone: "📍", label: "Localização",
      preenchido: !!(p.endereco_empregador || p.lat) },
    { chave: "primeira",     icone: "✅", label: "1ª diária concluída",  preenchido: diariasFeitas >= 1 },
    { chave: "avaliacao",    icone: "⭐", label: "Avaliação positiva",
      descricao: "Mantenha média acima de 4.0 para ganhar mais confiança.",
      preenchido: (mediaAval ?? 0) >= 4.0 },
    { chave: "pagamento",    icone: "💳", label: "Recebimento via PIX",
      descricao: "Cadastre sua chave PIX ou conecte o Mercado Pago para receber pagamentos.",
      preenchido: !!(p.pix_chave || p.mp_user_id) },
  ];
  const preenchidos = itens.filter(i => i.preenchido).length;
  const pct = Math.round((preenchidos / itens.length) * 100);
  return { pct, itens };
}

// ── Conquistas (8 medalhas calculadas a partir do estado atual) ──────────────
export interface Conquista {
  chave: string;
  icone: string;
  titulo: string;
  descricao: string;
  alcancada: boolean;
  progresso?: { atual: number; alvo: number };
}

export function calcConquistas(
  p: { foto_url?: string; cpf?: string; cnpj?: string; telefone?: string;
       telefone_verificado?: boolean; bio?: string; },
  diariasFeitas: number,
  totalAvaliacoes: number,
  mediaAval: number | null,
): Conquista[] {
  const perfilCompleto =
    !!p.foto_url && !!(p.cpf || p.cnpj) && !!p.telefone && !!(p.bio && p.bio.length >= 20);
  return [
    { chave: "primeira",  icone: "🚀", titulo: "Primeira Diária",  descricao: "Conclua sua primeira diária",
      alcancada: diariasFeitas >= 1,
      progresso: diariasFeitas < 1 ? { atual: diariasFeitas, alvo: 1 } : undefined },
    { chave: "cinco",     icone: "✋", titulo: "Nas 5!",            descricao: "Conclua 5 diárias",
      alcancada: diariasFeitas >= 5,
      progresso: diariasFeitas < 5 ? { atual: diariasFeitas, alvo: 5 } : undefined },
    { chave: "confiavel", icone: "🥈", titulo: "Confiável",         descricao: "Conclua 15 diárias",
      alcancada: diariasFeitas >= 15,
      progresso: diariasFeitas < 15 ? { atual: diariasFeitas, alvo: 15 } : undefined },
    { chave: "elite",     icone: "💎", titulo: "Elite",             descricao: "Conclua 30 diárias",
      alcancada: diariasFeitas >= 30,
      progresso: diariasFeitas < 30 ? { atual: diariasFeitas, alvo: 30 } : undefined },
    { chave: "lenda",     icone: "🌟", titulo: "Lenda",             descricao: "Conclua 50 diárias",
      alcancada: diariasFeitas >= 50,
      progresso: diariasFeitas < 50 ? { atual: diariasFeitas, alvo: 50 } : undefined },
    { chave: "perfil",    icone: "⭐", titulo: "Perfil Completo",   descricao: "Preencha foto, CPF, telefone e bio",
      alcancada: perfilCompleto },
    { chave: "bemaval",   icone: "🏆", titulo: "Bem Avaliado",      descricao: "Alcance média de avaliações ≥ 4.5",
      alcancada: (mediaAval ?? 0) >= 4.5 && totalAvaliacoes >= 3,
      progresso: (mediaAval ?? 0) < 4.5 || totalAvaliacoes < 3 ? { atual: totalAvaliacoes, alvo: 3 } : undefined },
    { chave: "reconhec",  icone: "👑", titulo: "Reconhecido",       descricao: "Receba 10 avaliações",
      alcancada: totalAvaliacoes >= 10,
      progresso: totalAvaliacoes < 10 ? { atual: totalAvaliacoes, alvo: 10 } : undefined },
  ];
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

// ── Moderação de conteúdo: BANE termos ilegais / que ferem a dignidade ───────
// Diferente de verificarFraudeDescricao (que é só aviso de golpe), esta função
// BLOQUEIA a publicação. Retorna a mensagem de bloqueio, ou null se o texto OK.
// Normaliza acentos + caixa antes de testar. Conservadora de propósito, pra
// evitar falso-positivo em vaga legítima (ex.: "biqueira de aço" = EPI de obra).
// A lista é facilmente ajustável — adicione/remova padrões conforme necessário.
const MSG_CONTEUDO_PROIBIDO =
  "🚫 Seu texto contém um termo que viola nossas regras de conduta. Remova conteúdo ilegal, ofensivo ou que desrespeite a dignidade das pessoas e tente de novo.";

const PADROES_PROIBIDOS: RegExp[] = [
  // Drogas / tráfico ("biqueira" = boca de fumo; exceção pro EPI tratada à parte)
  /\bboca\s+de\s+fumo\b/, /\btrafic\w*/, /\bmaconha\b/, /\bcocain\w*/, /\bcrack\b/,
  /\bskunk\b/, /\bhero[ií]na\b/, /\bmetanfetamina\b/, /\b(vender|venda|entrega|levar)\s+(de\s+)?drogas?\b/,
  /\bmula\s+(de\s+)?carga\b/,
  // Armas ilegais
  /\b(venda|comprar?|vender)\s+(de\s+)?armas?\b/, /\barma\s+de\s+fogo\b/, /\bmunic[aã]o\b/, /\bgranada\b/,
  // Exploração sexual
  /\bgarot[ao]\s+de\s+programa\b/, /\bprograma\s+sexual\b/, /\bfavor\s+sexual\b/,
  /\bservi[cç]o\s+sexual\b/, /\bprostitu\w*/, /\bacompanhante\s+sexual\b/, /\bmassagem\s+com\s+final\b/,
  // Exploração de menores / trabalho infantil
  /\btrabalho\s+infantil\b/, /\bexplora\w*\s+de\s+menor\w*/,
  // Discurso de ódio / pejorativos claros (dignidade humana) — lista conservadora
  /\bviadinho\b/, /\bbichinha\b/, /\bsapat[aã]o\b/, /\btraveco\b/, /\bcrioul[oa]\b/,
  /\bretardad[oa]\b/, /\bmongol[oó]ide\b/, /\bvagabund[ao]\b/, /\bvad(ia|ias)\b/,
];

export function verificarConteudoProibido(texto: string): string | null {
  if (!texto) return null;
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // "biqueira" sozinha é boca de fumo; "biqueira de aço/ferro" é EPI legítimo.
  if (/\bbiqueira\b/.test(t) && !/\bbiqueira\s+(de\s+)?(aco|ferro|metal|composite|plastico|seguranca)\b/.test(t))
    return MSG_CONTEUDO_PROIBIDO;
  for (const padrao of PADROES_PROIBIDOS) {
    if (padrao.test(t)) return MSG_CONTEUDO_PROIBIDO;
  }
  return null;
}


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

// ── Validação de CNPJ com dígitos verificadores (anti-fraude) ────────────────
// Algoritmo oficial da Receita Federal: 2 dígitos verificadores calculados
// com pesos diferentes (5..2 e 6..2). Rejeita também sequências repetidas
// (11.111.111/1111-11) que passam matematicamente mas são CNPJs inválidos.
export function validarCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calcDV = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((acc, n, i) => acc + parseInt(n) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calcDV(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== parseInt(c[12])) return false;
  const dv2 = calcDV(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === parseInt(c[13]);
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

// ── Máscara de telefone BR ───────────────────────────────────────────────────
// Aceita celular (11 dígitos: XX 9XXXX-XXXX) ou fixo (10 dígitos: XX XXXX-XXXX).
// Formata progressivamente conforme o usuário digita.
export const maskTelefone = (v: string): string => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  // 11 dígitos: celular com 9 inicial → "(XX) 9XXXX-XXXX"
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
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

// ── Calcula idade a partir de uma data de nascimento (ISO YYYY-MM-DD) ────────
// Usado para bloquear menores de 18 no cadastro de diarista (CLT/LC 150).
// Considera o dia/mês exato — não basta diff de ano.
export function calcularIdade(dataNasc: string, hoje: Date = new Date()): number {
  if (!dataNasc) return 0;
  const nasc = new Date(dataNasc);
  if (Number.isNaN(nasc.getTime())) return 0;
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return Math.max(0, idade);
}

// ── Validação de senha forte ─────────────────────────────────────────────────
// NIST SP 800-63B recomenda 8+ caracteres com complexidade. Adotamos esse
// mínimo (8 + 1 letra + 1 número) para alinhar UX (placeholder, validação
// client e mensagens de erro do backend) e bloqueamos as senhas mais comuns
// no Brasil — quase 100% das contas comprometidas em vazamentos usam uma delas.
const SENHAS_BLOQUEADAS = new Set([
  "12345678","123456789","1234567890","102030","abc123","abcd1234",
  "senha123","senha1234","admin123","mudar123","mudar1234","trocar123",
  "qwerty123","master123","brasil123","brasil2024","brasil2025","brasil2026",
  "diariaja123","trampoja123",
]);

export function validarSenhaForte(senha: string): string | null {
  if (!senha) return "Informe uma senha.";
  if (senha.length < 8) return "Senha muito curta (mínimo 8 caracteres).";
  if (senha.length > 72) return "Senha muito longa (máximo 72 caracteres).";
  if (!/[A-Za-zÀ-ÿ]/.test(senha)) return "A senha precisa ter ao menos 1 letra.";
  if (!/[0-9]/.test(senha)) return "A senha precisa ter ao menos 1 número.";
  if (SENHAS_BLOQUEADAS.has(senha.toLowerCase())) {
    return "Essa senha é muito comum — escolha uma diferente.";
  }
  // Bloqueia sequência repetida (aaaaaaaaaa) e numérica simples (1234567890)
  if (/^(.)\1+$/.test(senha)) return "Não use uma única letra/número repetido.";
  if (/^(0123456789|1234567890|9876543210|0987654321)/.test(senha)) {
    return "Não use sequências numéricas simples.";
  }
  return null;
}

// ── Validação de chave PIX por tipo ──────────────────────────────────────────
// O tipo é escolhido pelo diarista no cadastro; aqui apenas validamos o formato.
// A verificação real (chave existe no MP) é feita server-side pela plataforma
// no primeiro pagamento.
export function validarPix(chave: string, tipo: string): string | null {
  const c = chave.trim();
  if (!c) return "Informe sua chave PIX.";
  if (tipo === "cpf") {
    if (!validarCPF(c)) return "PIX do tipo CPF inválido — confira os dígitos.";
    return null;
  }
  if (tipo === "cnpj") {
    if (!validarCNPJ(c)) return "PIX do tipo CNPJ inválido — confira os dígitos.";
    return null;
  }
  if (tipo === "email") {
    if (!validarEmail(c)) return "PIX do tipo e-mail inválido.";
    return null;
  }
  if (tipo === "telefone") {
    if (!validarTelefone(c)) return "PIX do tipo telefone inválido.";
    return null;
  }
  if (tipo === "aleatoria") {
    // Chave aleatória do BC: UUID v4 (com ou sem hífens)
    const semHifen = c.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(semHifen)) return "Chave aleatória inválida (deve ter 32 caracteres hexadecimais).";
    return null;
  }
  return "Tipo de PIX desconhecido.";
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

// ── Vaga PRÓXIMA de vencer: ainda no ar, mas o horário-fim chega em breve ─────
// Usado pra lembrar o anunciante ("ainda quer manter no ar ou tirar?") ANTES de
// a vaga expirar sozinha. Só vale pra vaga ainda "aberta" (ninguém confirmado).
// Para serviço (sem horario_fim) usa o horário de início como referência.
export function vagaProximaDeVencer(
  diaria: { data: string; horario_fim?: string; horario_inicio?: string; status: string },
  horasAntes = 6,
  agora: Date = new Date(),
): boolean {
  if (diaria.status !== "aberta") return false;
  if (!diaria.data) return false;
  const hhmm = (diaria.horario_fim && diaria.horario_fim.trim())
    ? diaria.horario_fim
    : diaria.horario_inicio;
  if (!hhmm) return false;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const fim = new Date(`${diaria.data}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  const restanteMs = fim.getTime() - agora.getTime();
  // Ainda no futuro (não expirou) E dentro da janela de aviso.
  return restanteMs > 0 && restanteMs <= horasAntes * 60 * 60 * 1000;
}


// O perfil do empregador guarda o endereço como UMA string concatenada na coluna
// `endereco_empregador` (não há colunas separadas). Para que a tela "Editar perfil"
// consiga pré-preencher os campos (rua, número, complemento, bairro, cidade, UF e
// CEP) precisamos fazer o caminho inverso da concatenação. Tolera os dois formatos
// que o app já gerou ao longo do tempo:
//   A) "Rua, Num[, Compl] - Bairro, Cidade/UF - CEP: 00000-000"   (editar-perfil)
//   B) "Rua, Num[ — Compl], Bairro, Cidade/UF — CEP 00000-000"    (cadastro)
// Degrada com elegância: campos que não derem match voltam como "" (a tela ainda
// mostra o "Endereço atual" cru, então nada se perde de fato).
export interface EnderecoEmpregador {
  cep: string; rua: string; numero: string; complemento: string;
  bairro: string; cidade: string; estado: string;
}

export function parseEnderecoEmpregador(raw: string | null | undefined): EnderecoEmpregador {
  const vazio: EnderecoEmpregador = { cep: "", rua: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "" };
  if (!raw || typeof raw !== "string") return vazio;
  const out: EnderecoEmpregador = { ...vazio };
  let s = raw.trim();

  // 1) CEP no final — aceita "CEP: 00000-000" ou "CEP 00000000", com separador
  //    opcional (hífen, travessão ou vírgula) antes do rótulo.
  const cepMatch = s.match(/\s*[-–—,]?\s*CEP[:\s]*([\d]{5}-?[\d]{0,3})\s*$/i);
  if (cepMatch && cepMatch.index !== undefined) {
    const dig = cepMatch[1].replace(/\D/g, "").slice(0, 8);
    out.cep = dig.length > 5 ? dig.slice(0, 5) + "-" + dig.slice(5) : dig;
    s = s.slice(0, cepMatch.index).trim();
  }

  // 2) Cidade/UF no final — "..., Cidade/UF"
  const cidUf = s.match(/,\s*([^,/]+?)\s*\/\s*([A-Za-z]{2})\s*$/);
  if (cidUf && cidUf.index !== undefined) {
    out.cidade = cidUf[1].trim();
    out.estado = cidUf[2].toUpperCase();
    s = s.slice(0, cidUf.index).trim();
  }

  // 3) Bairro — no formato A vem após " - " (hífen com espaços); no formato B é o
  //    último trecho separado por vírgula. O complemento do formato B usa travessão
  //    (" — "/" – "), então um hífen ASCII só pode ser o separador do bairro.
  const hifenIdx = s.lastIndexOf(" - ");
  if (hifenIdx !== -1) {
    out.bairro = s.slice(hifenIdx + 3).trim();
    s = s.slice(0, hifenIdx).trim();
  } else {
    const virgIdx = s.lastIndexOf(", ");
    if (virgIdx !== -1) {
      out.bairro = s.slice(virgIdx + 2).trim();
      s = s.slice(0, virgIdx).trim();
    }
  }

  // 4) Resta "Rua, Num[, Compl]" (formato A) ou "Rua, Num[ — Compl]" (formato B).
  const travIdx = s.search(/\s[–—]\s/); // travessão = separador de complemento (B)
  if (travIdx !== -1) {
    out.complemento = s.slice(travIdx).replace(/^\s*[–—]\s*/, "").trim();
    s = s.slice(0, travIdx).trim();
    const p = s.split(",").map(x => x.trim());
    out.rua = p[0] || "";
    out.numero = p[1] || "";
  } else {
    const p = s.split(",").map(x => x.trim());
    out.rua = p[0] || "";
    out.numero = p[1] || "";
    out.complemento = p.slice(2).join(", ").trim();
  }

  return out;
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

// ── Níveis da Universidade (Já Decola): XP → Bronze/Prata/Ouro/Diamante ───────
// XP = soma dos `pontos_score` dos cursos concluídos. Puro/testável.
export interface NivelAcademy {
  nivel: 1 | 2 | 3 | 4;
  nome: string;                  // Bronze | Prata | Ouro | Diamante
  icone: string;
  cor: string;
  xp: number;
  xpProximoNivel: number | null; // XP pra subir; null se já é Diamante (máx)
  faltam: number;                // quanto falta pro próximo (0 se máx)
  progressoPct: number;          // 0–100 dentro da faixa atual
}

const NIVEIS_ACADEMY = [
  { nivel: 1 as const, nome: "Bronze",   icone: "🥉", cor: "#cd7f32", min: 0   },
  { nivel: 2 as const, nome: "Prata",    icone: "🥈", cor: "#94a3b8", min: 50  },
  { nivel: 3 as const, nome: "Ouro",     icone: "🥇", cor: "#f59e0b", min: 120 },
  { nivel: 4 as const, nome: "Diamante", icone: "💎", cor: "#3A86FF", min: 250 },
];

export function calcularNivelAcademy(xp: number): NivelAcademy {
  const x = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let idx = 0;
  for (let i = NIVEIS_ACADEMY.length - 1; i >= 0; i--) {
    if (x >= NIVEIS_ACADEMY[i].min) { idx = i; break; }
  }
  const atual = NIVEIS_ACADEMY[idx];
  const prox = NIVEIS_ACADEMY[idx + 1];
  const xpProximoNivel = prox ? prox.min : null;
  const faltam = prox ? Math.max(0, prox.min - x) : 0;
  const progressoPct = prox
    ? Math.min(100, Math.max(0, Math.round(((x - atual.min) / (prox.min - atual.min)) * 100)))
    : 100;
  return {
    nivel: atual.nivel, nome: atual.nome, icone: atual.icone, cor: atual.cor,
    xp: x, xpProximoNivel, faltam, progressoPct,
  };
}
