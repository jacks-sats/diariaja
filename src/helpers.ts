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
  if (p.bio && p.bio.length >= 20) score += 10;  // padronizado com calcScoreBreakdown/calcCompletude
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
  ];
  const preenchidos = itens.filter(i => i.preenchido).length;
  const pct = Math.round((preenchidos / itens.length) * 100);
  return { pct, itens };
}

// ── Lembrete "Complete seu perfil" ───────────────────────────────────────────
// Dos itens de completude, estes são os que o usuário consegue preencher SOZINHO,
// sem precisar trabalhar. "1ª diária concluída" e "avaliação positiva" só vêm com
// uso real, então NÃO entram no lembrete — por isso o teto editável dá ~70-80% do
// perfil (5 de 7 itens). O banner do feed some quando estes 5 estão completos.
export const CHAVES_COMPLETUDE_EDITAVEL = ["foto", "cpf", "telefone", "bio", "endereco"] as const;

export function completudeEditavel(
  p: Parameters<typeof calcCompletude>[0],
): { pct: number; pendentes: CompletudeItem[]; preenchidos: number; total: number } {
  const { itens } = calcCompletude(p, 0, null);
  const editaveis = itens.filter(i =>
    (CHAVES_COMPLETUDE_EDITAVEL as readonly string[]).includes(i.chave));
  const pendentes = editaveis.filter(i => !i.preenchido);
  const preenchidos = editaveis.length - pendentes.length;
  const pct = editaveis.length ? Math.round((preenchidos / editaveis.length) * 100) : 100;
  return { pct, pendentes, preenchidos, total: editaveis.length };
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

// ── Moderação antidiscriminação (Lei 9.029/1995) ─────────────────────────────
// Proíbe exigências discriminatórias em anúncios/vagas (idade, sexo, aparência,
// estado civil/família). BLOQUEIA com mensagem EDUCATIVA (a maioria é por
// desconhecimento, não má-fé). Conservadora: só pega a CONSTRUÇÃO discriminatória
// clara, pra não barrar vaga legítima. Importante p/ o mural de "vaga de emprego".
const MSG_DISCRIMINACAO =
  "🚫 Esse texto traz uma exigência que pode ser discriminatória (Lei 9.029/95) — como idade, sexo, aparência ou estado civil. Descreva apenas requisitos da função (experiência, habilidades, disponibilidade) e tente de novo.";

const PADROES_DISCRIMINATORIOS: RegExp[] = [
  // Idade (ex.: "até 30 anos", "idade máxima 25", "menor de 40", "faixa etária")
  /\bate\s+\d{2}\s+anos?\b/, /\bidade\s+m[ax]\w*/, /\bno\s+maximo\s+\d{2}\s+anos?\b/,
  /\bmenor(es)?\s+de\s+\d{2}\b/, /\bfaixa\s+etaria\b/,
  // Sexo/gênero exclusivo (ex.: "apenas mulheres", "só homens", "sexo feminino")
  /\b(apenas|somente|so|exclusiv\w*|preferencialmente)\s+(para\s+)?(mulher(es)?|homens?|mo[cç]as|rapazes)\b/,
  /\b(vaga|contrata\w*)\s+(para\s+)?(mulher(es)?|homens?)\s+(apenas|somente)\b/,
  /\bsexo\s+(feminino|masculino)\b/,
  // Aparência (clássico marcador discriminatório)
  /\bboa\s+aparencia\b/,
  // Estado civil / família
  /\bsem\s+filhos\b/, /\bque\s+nao\s+tenha\s+filhos\b/,
  /\b(solteir[ao]s?)\s+(apenas|somente|preferencialmente)\b/,   // "solteiras preferencialmente"
  /\bpreferenc\w*\s+(para\s+)?solteir[ao]s?\b/,                 // "preferência para solteiras"
];

export function verificarDiscriminacao(texto: string): string | null {
  if (!texto) return null;
  const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const padrao of PADROES_DISCRIMINATORIOS) {
    if (padrao.test(t)) return MSG_DISCRIMINACAO;
  }
  return null;
}


export function detectarContatoExterno(msg: string): boolean {
  return /\b\d{8,11}\b/.test(msg) ||
    /whatsapp|wpp|zap|telegram|meu.n[uú]mero|me.liga|me.chama|fora.do.app/i.test(msg);
}

// ── Tradução de erro de banco/rede → mensagem amigável (pt-BR) ───────────────
// O usuário NUNCA deve ver jargão técnico do Postgres/Supabase
// (ex.: "invalid input syntax for type time"). Esta função mapeia os erros mais
// comuns pra um texto que o leigo entende. Aceita string, Error, ou o objeto de
// erro do Supabase ({ message, code }). Fallback genérico e gentil.
export function traduzirErroBanco(erro: unknown): string {
  const obj = (erro && typeof erro === "object" ? erro : {}) as { message?: string; code?: string; error_description?: string };
  const raw = (typeof erro === "string" ? erro : obj.message || obj.error_description || "") + " " + (obj.code || "");
  const m = raw.toLowerCase();
  if (!m.trim()) return "Não foi possível concluir agora. Tente de novo em instantes.";

  if (m.includes("modo_beta")) return "🚀 Isso abre no lançamento (1º de julho). Por enquanto, deixe seu perfil completo!";
  if (/failed to fetch|networkerror|network error|timeout|fetch|err_internet|offline/.test(m))
    return "Sem conexão. Verifique sua internet e tente de novo.";
  if (/invalid input syntax for type (time|timestamp|date)|date\/time/.test(m))
    return "Houve um problema com a data ou o horário. Recarregue a página e tente de novo.";
  if (/duplicate key|already exists|unique constraint|23505/.test(m))
    return "Esse dado já está cadastrado.";
  if (/permission denied|row-level security|violates row-level|42501|not authorized/.test(m))
    return "Você não tem permissão para isso. Tente sair e entrar de novo.";
  if (/jwt|token|expired|not authenticated|session|auth session missing/.test(m))
    return "Sua sessão expirou. Entre novamente.";
  if (/foreign key|violates foreign key|23503/.test(m))
    return "Não foi possível concluir — um item relacionado não está mais disponível.";
  if (/null value|not-null|23502/.test(m))
    return "Faltou preencher um campo obrigatório. Confira e tente de novo.";
  if (/check constraint|23514|invalid input value/.test(m))
    return "Algum valor não é aceito. Confira os campos destacados.";
  if (/rate limit|too many|429/.test(m))
    return "Muitas tentativas em pouco tempo. Aguarde um minutinho e tente de novo.";
  return "Não foi possível concluir agora. Tente de novo em instantes.";
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

// ── Protocolo do contato (número estável, igual pros 2 lados) ────────────────
// Deriva um protocolo NUMÉRICO determinístico do id da diária/conversa. Como sai
// do mesmo id, anunciante e prestador veem SEMPRE o mesmo número — sem coluna no
// banco, sem geração/sincronização. Serve pra suporte/debug: "deu erro no
// protocolo 73 9021" → vamos direto na conversa certa.
//
// Formato: 6 dígitos agrupados "XXX XXX" (fácil de ditar). Hash simples (FNV-1a)
// do id → número de 6 dígitos, com padding. Colisão é possível em teoria, mas
// irrelevante pro uso (o id real continua sendo a fonte da verdade).
export const protocoloContato = (id?: string | null): string => {
  if (!id) return "—";
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const n = (h % 1_000_000).toString().padStart(6, "0");
  return `${n.slice(0, 3)} ${n.slice(3)}`;
};

// ── Data digitável DD/MM/AAAA (sem calendário nativo) ────────────────────────
// Usuário leigo se perde no calendário do Android. Estes helpers deixam digitar
// a data como todo brasileiro escreve, e convertem de/para o ISO (yyyy-mm-dd)
// que o resto do app/banco usa.

// Máscara progressiva: "25121990" → "25/12/1990".
export const maskData = (v: string): string => {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0,2)}/${d.slice(2)}`;
  return `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`;
};

// ISO (yyyy-mm-dd) → BR (dd/mm/aaaa). String vazia se inválida/vazia.
export const isoParaBR = (iso?: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
};

// BR (dd/mm/aaaa) → ISO (yyyy-mm-dd). Retorna "" se a data não for válida
// (dia/mês fora de faixa, ano implausível, ou data inexistente tipo 31/02).
export const brParaIso = (br: string): string => {
  const d = br.replace(/\D/g, "");
  if (d.length !== 8) return "";
  const dia = +d.slice(0,2), mes = +d.slice(2,4), ano = +d.slice(4,8);
  if (mes < 1 || mes > 12) return "";
  if (dia < 1 || dia > 31) return "";
  if (ano < 1900 || ano > 2100) return "";
  // Valida data real (rejeita 31/04, 29/02 em ano não bissexto, etc.).
  const dt = new Date(ano, mes - 1, dia);
  if (dt.getFullYear() !== ano || dt.getMonth() !== mes - 1 || dt.getDate() !== dia) return "";
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return `${ano}-${mm}-${dd}`;
};

// ── Lista de horários (rolagem) — substitui o relógio circular nativo ────────
// Gera ["00:00","00:30",...,"23:30"] (ou com o passo dado). HH:MM, formato que
// o app já usa pros horários de diária.
export const gerarHorarios = (passoMin = 30): string[] => {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += passoMin) {
    const h = Math.floor(m / 60), min = m % 60;
    out.push(`${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`);
  }
  return out;
};

// ── Duração de um turno em minutos, tratando VIRADA DE MEIA-NOITE ────────────
// REGRA "VIRA O DIA": se horario_fim < horario_inicio, o término é no DIA
// SEGUINTE (+24h). Ex.: 18:00 → 02:00 = 480min (8h). fim == início devolve 0
// (turno de duração zero — quem chama trata como inválido). Devolve null se
// faltar algum horário ou se não for "HH:MM"/"HH:MM:SS" válido.
export function duracaoTurnoMin(horarioInicio?: string, horarioFim?: string): number | null {
  if (!horarioInicio || !horarioFim) return null;
  const [h1, m1] = horarioInicio.split(":").map(Number);
  const [h2, m2] = horarioFim.split(":").map(Number);
  if ([h1, m1, h2, m2].some(v => v == null || Number.isNaN(v))) return null;
  let min = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (min < 0) min += 1440; // virou o dia: o fim cai no dia seguinte
  return min;
}

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

// ── Máquina de estados do ciclo de vida da diária ───────────────────────────
// Fonte única de verdade do fluxo de contratação (candidatura e convite), pra
// poder ser testada fora do App.tsx (que é o monólito não-testado).
//
// Fluxo feliz (candidatura):
//   aberta → (anunciante seleciona) pendente → (prestador confirma) aceita
//          → (check-in) em_andamento → (check-out) concluida
// Ramos:
//   • desiste:  pendente|aceita → aberta  (volta pro feed)
//   • no-show:  pendente|aceita → expirada  (expirou sem virar diária)
//   • cancela:  qualquer não-terminal → cancelada
export const STATUS_DIARIA = [
  "aberta", "pendente", "aceita", "em_andamento", "concluida", "cancelada", "expirada",
] as const;
export type StatusDiaria = (typeof STATUS_DIARIA)[number];

const TRANSICOES_DIARIA: Record<string, StatusDiaria[]> = {
  aberta:       ["pendente", "expirada", "cancelada"],
  pendente:     ["aceita", "aberta", "expirada", "cancelada"], // aceita=confirma, aberta=desiste
  aceita:       ["em_andamento", "aberta", "expirada", "cancelada"], // em_andamento=check-in, aberta=desiste, expirada=no-show
  em_andamento: ["concluida", "cancelada"],
  concluida:    [],
  cancelada:    [],
  expirada:     [],
};

// Uma transição de status é permitida pelo fluxo? (de === para é sempre falso)
export function transicaoDiariaPermitida(de: string, para: string): boolean {
  if (de === para) return false;
  return (TRANSICOES_DIARIA[de] ?? []).includes(para as StatusDiaria);
}

// Estado terminal: não há transição de saída.
export function statusTerminal(status: string): boolean {
  return (TRANSICOES_DIARIA[status]?.length ?? 0) === 0;
}

// ── Fase do ciclo de vida (stepper da UI) ────────────────────────────────────
// Traduz o `status` cru numa das 4 fases mostradas no stepper do card:
//   1 Selecionado  — o anunciante escolheu, falta o prestador aceitar o serviço
//   2 Combinando   — aceito; chat liberado pros dois combinarem os detalhes
//   3 No dia       — dia do serviço (chegada registrada / em andamento)
//   4 Concluído    — serviço encerrado
// Retorna null pra status fora do trilho (aberta sem aceite, cancelada,
// expirada/no-show) — nesses casos o card não mostra stepper.
export type FaseCiclo = 1 | 2 | 3 | 4;
export function faseCiclo(status: string): FaseCiclo | null {
  switch (status) {
    case "pendente":     return 1;
    case "aceita":       return 2;
    case "em_andamento": return 3;
    case "concluida":    return 4;
    default:             return null;
  }
}

// De quem é a vez agir, dado o status e a perspectiva (prestador vs anunciante).
// Usado pra escrever sempre "o que acontece agora" no card — some na audita de UX
// os usuários não sabiam se estavam esperando ou se a bola estava com eles.
export function vezDoCiclo(
  status: string,
  perspectiva: "prestador" | "anunciante",
): string {
  const ehPrest = perspectiva === "prestador";
  switch (status) {
    case "pendente":
      return ehPrest ? "Sua vez: aceitar o serviço" : "Aguardando o prestador aceitar";
    case "aceita":
      return "Combinem os detalhes no chat";
    case "em_andamento":
      return ehPrest ? "Dia do serviço — registre sua chegada" : "Serviço em andamento";
    case "concluida":
      return "Serviço concluído";
    default:
      return "";
  }
}


// ── Liberação de contato (chat + endereço) ───────────────────────────────────
// Chat e endereço só abrem DEPOIS que o prestador aceita o serviço (status
// 'aceita'). Antes disso (aberta/pendente) o contato fica fechado — é o que
// protege o modelo de "pagar R$1 pra liberar".
const STATUS_COM_CONTATO = ["aceita", "em_andamento", "concluida"];
export function contatoLiberado(status: string): boolean {
  return STATUS_COM_CONTATO.includes(status);
}

// ── Cota de seleção do mês (crédito interno) ─────────────────────────────────
// A seleção consome 1 da cota grátis SE tem prestador selecionado e NÃO virou
// no-show. No-show ('expirada') é creditado de volta — o anunciante escolhe
// outro sem pagar de novo. Desistência limpa diarista_aceite_id → também não conta.
export function contaNaCotaSelecao(
  d: { diarista_aceite_id?: string | null; status: string },
): boolean {
  return !!d.diarista_aceite_id && d.status !== "expirada";
}

// ── Resposta de convite (fluxo 2) ────────────────────────────────────────────
export const RESPOSTAS_CONVITE = ["aceito", "recusado"] as const;
export function respostaConviteValida(resposta: string): boolean {
  return (RESPOSTAS_CONVITE as readonly string[]).includes(resposta);
}

// ── Vaga expirada: data + horario_fim já passou e nada foi confirmado ────────
// Recebe os campos crus do banco; retorna true se a vaga deveria sair do feed.
export function vagaExpirou(
  diaria: { data: string; horario_inicio?: string; horario_fim: string; status: string },
  agora: Date = new Date(),
): boolean {
  if (!diaria.data || !diaria.horario_fim) return false;
  if (!["aberta", "pendente"].includes(diaria.status)) return false;
  // horario_fim pode vir como "HH:MM" ou "HH:MM:SS"
  const [h, m] = diaria.horario_fim.split(":").map(Number);
  // Number.isNaN(undefined) é false — checa undefined explicitamente, senão
  // "14" (sem minutos) geraria data inválida e a vaga nunca expiraria.
  if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return false;
  // Trata como horário local (sem timezone) — vagas são locais ao usuário
  const fim = new Date(`${diaria.data}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  // REGRA "VIRA O DIA": turno que cruza a meia-noite (fim < início) termina no
  // dia seguinte — adia o `fim` em 24h pra vaga não "expirar" antes da hora.
  const ini = diaria.horario_inicio && diaria.horario_inicio.trim();
  if (ini) {
    const [hi, mi] = ini.split(":").map(Number);
    if (hi != null && mi != null && !Number.isNaN(hi) && !Number.isNaN(mi)
        && (h * 60 + m) < (hi * 60 + mi)) {
      fim.setTime(fim.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  return agora.getTime() > fim.getTime();
}

// ── No-show: diária aceita, com profissional, mas que passou da janela sem ──
// check-in. Espelha o critério do servidor (`expirar_e_encerrar_diarias`):
// status 'aceita', sem `checkin_em`, e já passou `horario_fim + 2h` (mesma
// tolerância da janela de check-in). Usado para expirar no-show no client
// mesmo antes de o pg_cron estar ativo, alimentando o feedback obrigatório.
export function diariaNoShow(
  diaria: { data: string; horario_inicio?: string; horario_fim?: string; status: string; checkin_em?: string | null; diarista_aceite_id?: string | null },
  agora: Date = new Date(),
): boolean {
  if (diaria.status !== "aceita") return false;
  if (diaria.checkin_em) return false;
  if (!diaria.data) return false;
  const ini = (diaria.horario_inicio && diaria.horario_inicio.trim()) || "00:00";
  const fimRaw = (diaria.horario_fim && diaria.horario_fim.trim()) || ini;
  const [hi, mi] = ini.split(":").map(Number);
  const [hf, mf] = fimRaw.split(":").map(Number);
  if (hf == null || mf == null || Number.isNaN(hf) || Number.isNaN(mf)) return false;
  const fim = new Date(`${diaria.data}T${String(hf).padStart(2, "0")}:${String(mf).padStart(2, "0")}:00`);
  // REGRA "VIRA O DIA": fim < início ⇒ turno cruza a meia-noite (fim no dia seguinte).
  if (hi != null && mi != null && !Number.isNaN(hi) && !Number.isNaN(mi)
      && (hf * 60 + mf) < (hi * 60 + mi)) {
    fim.setTime(fim.getTime() + 24 * 60 * 60 * 1000);
  }
  return agora.getTime() > fim.getTime() + 2 * 60 * 60 * 1000;
}

// ── Janela de check-in: presença só é confirmável perto do horário ──────────
// A confirmação de presença (QR/GPS/código) vale apenas dentro de
// [horario_inicio − 30min, horario_fim + 2h]. Fora disso o servidor (RPC
// `registrar_checkin`) recusa; o client usa este helper para esconder o QR de
// uma diária que já passou da hora — corrige o "expirada ainda pede QR".
export function checkinDentroDaJanela(
  diaria: { data: string; horario_inicio?: string; horario_fim?: string },
  agora: Date = new Date(),
): boolean {
  if (!diaria.data) return false;
  const ini = (diaria.horario_inicio && diaria.horario_inicio.trim()) || "00:00";
  const fimRaw = (diaria.horario_fim && diaria.horario_fim.trim()) || ini;
  const [hi, mi] = ini.split(":").map(Number);
  const [hf, mf] = fimRaw.split(":").map(Number);
  // checa undefined (hora sem minutos, ex. "14") além de NaN
  if ([hi, mi, hf, mf].some(v => v == null || Number.isNaN(v))) return false;
  const inicio = new Date(`${diaria.data}T${String(hi).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`);
  const fim = new Date(`${diaria.data}T${String(hf).padStart(2, "0")}:${String(mf).padStart(2, "0")}:00`);
  // REGRA "VIRA O DIA": fim < início ⇒ turno cruza a meia-noite (fim no dia seguinte),
  // pra a janela de check-in/check-out abrir certo na virada (ex.: 18:00 → 02:00).
  if ((hf * 60 + mf) < (hi * 60 + mi)) fim.setTime(fim.getTime() + 24 * 60 * 60 * 1000);
  const abre = inicio.getTime() - 30 * 60 * 1000;       // 30min antes do início
  const fecha = fim.getTime() + 2 * 60 * 60 * 1000;     // 2h depois do fim
  const t = agora.getTime();
  return t >= abre && t <= fecha;
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

// ── Compartilhar vaga (loop viral) ───────────────────────────────────────────
// Link público do app — usado no texto compartilhado fora do app (WhatsApp,
// Facebook, etc.). Sem deep link porque o app não usa rotas (padrão `tela`).
export const URL_APP = "https://www.diariaja.com";

// Campos da diária que podem entrar no texto compartilhado. SÓ informação
// pública (o "chamariz"): função, segmento, valor/salário, bairro, data/horário.
// NUNCA endereço completo nem contato — isso só é liberado DENTRO do app depois
// que o anunciante aceita o prestador.
export interface VagaCompartilhavel {
  id?: string | null;                 // entra no link como ?vaga=ID (deep link)
  tipo_oferta?: string | null;
  segmento?: string | null;
  funcao?: string | null;
  descricao?: string | null;          // o que a pessoa vai fazer (observação)
  valor?: number | null;
  salario_texto?: string | null;
  bairro?: string | null;
  data?: string | null;
  horario_inicio?: string | null;
  horario_fim?: string | null;
  tempo_estimado_min?: number | null;
  tipo_contrato?: string | null;
  regime?: string | null;
}

// Link direto pra vaga (deep link). O app lê ?vaga=ID ao abrir e já mostra a
// vaga. Sem o id, cai no link genérico do app.
export function linkVaga(id?: string | null): string {
  return id ? `${URL_APP}/?vaga=${id}` : URL_APP;
}

// Monta o texto "chamariz" que o diarista compartilha fora do app. Trata os três
// tipos de oferta (diária, serviço pontual e vaga de emprego), com layout limpo
// (título em negrito do WhatsApp + divisórias) e termina com o link direto da
// vaga, pra trazer usuários novos.
export function montarTextoVaga(v: VagaCompartilhavel): string {
  const hi = (v.horario_inicio || "").slice(0, 5);
  const hf = (v.horario_fim || "").slice(0, 5);
  const dataBR = isoParaBR(v.data);
  const funcao = (v.funcao || "").trim();
  const segmento = (v.segmento || "").trim();
  const bairro = (v.bairro || "").trim();
  const div = "━━━━━━━━━━━━━";

  let emoji = "🌞";
  let titulo = "Vaga de diária";
  let linhaValor = "";
  let linhaQuando = "";

  if (v.tipo_oferta === "emprego") {
    emoji = "💼"; titulo = "Vaga de emprego";
    linhaValor = `💰 ${(v.salario_texto || "").trim() || "A combinar"}`;
    const contrato = [v.tipo_contrato, v.regime].map(s => (s || "").trim()).filter(Boolean).join(" · ");
    linhaQuando = contrato ? `📄 ${contrato}` : "";
  } else if (v.tipo_oferta === "servico") {
    emoji = "⚡"; titulo = "Serviço disponível";
    const tempo = v.tempo_estimado_min
      ? (v.tempo_estimado_min >= 60 ? `${Math.round(v.tempo_estimado_min / 60)}h` : `${v.tempo_estimado_min}min`)
      : "a combinar";
    linhaValor = typeof v.valor === "number" ? `💰 R$ ${v.valor}  ·  ⏱ ${tempo}` : `⏱ ${tempo}`;
    linhaQuando = dataBR ? `📅 ${dataBR}${hi ? ` às ${hi}` : ""}` : "";
  } else {
    emoji = "🌞"; titulo = "Vaga de diária";
    linhaValor = typeof v.valor === "number" ? `💰 R$ ${v.valor}/dia` : "";
    linhaQuando = dataBR ? `📅 ${dataBR}${hi ? ` · ${hi}${hf ? `–${hf}` : ""}` : ""}` : "";
  }

  const linhas: string[] = [];
  linhas.push(`${emoji} *${titulo} no DiáriaJá!*`);
  linhas.push(div);
  if (funcao) linhas.push(`👷 ${funcao}`);
  if (segmento) linhas.push(`🏷️ ${segmento}`);
  if (linhaValor) linhas.push(linhaValor);
  if (linhaQuando) linhas.push(linhaQuando);
  if (bairro) linhas.push(`📍 ${bairro}`);
  // Descrição (o que a pessoa vai fazer) — limitada pra não virar um textão.
  const desc = (v.descricao || "").trim();
  if (desc) {
    const descCurta = desc.length > 200 ? `${desc.slice(0, 197).trimEnd()}…` : desc;
    linhas.push("");
    linhas.push(`📋 ${descCurta}`);
  }
  linhas.push(div);
  linhas.push("👉 Veja os detalhes e candidate-se no app:");
  linhas.push(linkVaga(v.id));
  return linhas.join("\n");
}

// ── Cota de VAGAS DE EMPREGO (plano grátis) ──────────────────────────────────
// O anunciante no plano grátis publica até 3 vagas de emprego por mês; cada
// publicação avulsa paga soma +1 à cota daquele mês. Planos pagos
// (essencial/plus) = ilimitado. Diária e serviço NÃO entram nesta conta.
// Pura/testável — o servidor (RPC `pode_postar_vaga_emprego` + trigger
// `enforce_limite_vaga_emprego`) é a autoridade; isto espelha a regra no client.
export const LIMITE_VAGAS_EMPREGO_GRATIS_MES = 3;

// Limite efetivo do mês: 3 grátis + extras pagas (ou "ilimitado" se plano pago).
export function limiteVagasEmpregoMes(extrasPagas: number, plano: string): number {
  if (plano === "essencial" || plano === "plus") return Number.POSITIVE_INFINITY;
  return LIMITE_VAGAS_EMPREGO_GRATIS_MES + Math.max(0, extrasPagas || 0);
}

// Já estourou a cota deste mês? (true = a próxima publicação exige pagamento).
export function vagaEmpregoExcedeuCota(
  postadasMes: number,
  extrasPagas: number,
  plano: string,
): boolean {
  return Math.max(0, postadasMes || 0) >= limiteVagasEmpregoMes(extrasPagas, plano);
}

// ── Convite direto vencido: a data/hora do serviço já passou e o prestador ──
// não respondeu (status ainda 'pendente'). Não há regra no servidor — este
// helper é a fonte da UI dos DOIS lados: anunciante vê badge "Expirado";
// prestador deixa de ver o convite e não consegue aceitar vencido.
// Sem horário, considera o fim do dia (23:59) — só expira no dia seguinte.
export function conviteExpirou(
  conv: { data_servico?: string | null; horario_servico?: string | null; status?: string },
  agora: Date = new Date(),
): boolean {
  if (conv.status && conv.status !== "pendente") return false;
  if (!conv.data_servico) return false;
  // Number("") === 0 (!) — parse manual: vazio/ausente/inválido => NaN => 23:59
  const [hRaw, mRaw] = (conv.horario_servico || "").trim().split(":");
  const h = hRaw ? Number(hRaw) : NaN;
  const m = mRaw ? Number(mRaw) : NaN;
  const hOk = !Number.isNaN(h) ? h : 23;
  const mOk = !Number.isNaN(m) ? m : 59;
  // Horário local (sem timezone) — convites são locais ao usuário, igual vagaExpirou
  const inicio = new Date(`${conv.data_servico}T${String(hOk).padStart(2, "0")}:${String(mOk).padStart(2, "0")}:00`);
  if (Number.isNaN(inicio.getTime())) return false;
  return agora.getTime() > inicio.getTime();
}
