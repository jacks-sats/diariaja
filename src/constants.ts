// ── Constantes e dados estáticos do DiáriaJá ────────────────────────────────
// Extraídos do App.tsx para separação de concerns.

// ── Funções que usam formulário especial de Delivery ─────────────────────────
export const FUNCOES_DELIVERY = ["Motoboy", "Entregador de Bicicleta", "Entregador de Carro"];

// ── Categorias organizadas por demanda em Campo Grande / MS ─────────────────
export const CATEGORIAS_NEGOCIO = {
  "Delivery": {
    icone: "🏍️",
    cor: "#FF6B35",
    funcoes: ["Motoboy", "Entregador de Bicicleta", "Entregador de Carro"],
    destaque: "🔥 Em alta em CG",
  },
  "Supermercado / Varejo": {
    icone: "🛒",
    cor: "#3A86FF",
    funcoes: ["Repositor de Prateleiras", "Operador de Caixa", "Açougueiro", "Padeiro", "Auxiliar de Limpeza"],
    destaque: "⭐ Muito procurado",
  },
  "Gastronomia": {
    icone: "🍽️",
    cor: "#E71D36",
    funcoes: ["Garçom", "Bartender", "Ajudante de Cozinha", "Lavador de Louças", "Pizzaiolo", "Churrasqueiro"],
    destaque: "⭐ Muito procurado",
  },
  "Doméstico": {
    icone: "🏠",
    cor: "#8338EC",
    funcoes: ["Diarista / Faxineira", "Passadeira", "Cozinheira", "Babá", "Jardineiro"],
    destaque: "⭐ Muito procurado",
  },
  "Construção Civil": {
    icone: "🔨",
    cor: "#FF9F1C",
    funcoes: ["Pedreiro", "Servente de Obra", "Pintor", "Eletricista", "Encanador", "Gesseiro", "Montador de Móveis"],
  },
  "Eventos & Festas": {
    icone: "🎉",
    cor: "#06d6a0",
    funcoes: ["Garçom de Eventos", "Barman", "Montador de Estrutura", "Promoter", "Recepcionista"],
  },
  "Saúde & Cuidado": {
    icone: "🏥",
    cor: "#ef476f",
    funcoes: ["Cuidador de Idoso", "Acompanhante Hospitalar", "Auxiliar de Saúde", "Técnico de Enfermagem"],
  },
  "Logística & Armazém": {
    icone: "📦",
    cor: "#118ab2",
    funcoes: ["Ajudante de Carga e Descarga", "Separador de Pedidos", "Operador de Empilhadeira", "Auxiliar Logístico"],
  },
  "Pet & Animais": {
    icone: "🐾",
    cor: "#ffd166",
    funcoes: ["Pet Sitter", "Dog Walker", "Tosador", "Auxiliar Veterinário"],
  },
  "Beleza & Estética": {
    icone: "💅",
    cor: "#e91e8c",
    funcoes: [
      "Manicure",
      "Pedicure",
      "Manicure e Pedicure",
      "Designer de Sobrancelhas",
      "Depiladora",
      "Cabeleireiro(a)",
      "Maquiador(a)",
      "Barbeiro",
      "Esteticista",
    ],
    destaque: "💅 Para ele e ela",
  },
} as const;

export type CategoriaNegocio = keyof typeof CATEGORIAS_NEGOCIO;

// ── Tipo de oferta (diária vs serviço pontual) ───────────────────────────────
// Spec: docs/spec-tipo-oferta-diaria-vs-servico.md

// Tempos pré-definidos pra serviço (em minutos). 0 = "a combinar".
export const TEMPOS_ESTIMADOS_SERVICO: Array<{ valor: number; label: string }> = [
  { valor: 15,  label: "15 minutos" },
  { valor: 30,  label: "30 minutos" },
  { valor: 60,  label: "1 hora" },
  { valor: 120, label: "2 horas" },
  { valor: 180, label: "3 horas" },
  { valor: 240, label: "4 horas" },
  { valor: 0,   label: "A combinar" },
];

// Sugestão de default pro toggle no form de criar anúncio.
// Categoria selecionada PRE-SELECIONA o tipo (usuário pode trocar).
// TI, Beleza, Pet, Delivery → serviço pontual.
// Doméstico, Construção, Eventos, Logística, Gastronomia, Supermercado → diária.
// Saúde varia (cuidado de idoso é diária, aplicação injeção é serviço) → sem default.
export const TIPO_OFERTA_PADRAO_POR_CATEGORIA: Record<string, 'diaria' | 'servico'> = {
  "Delivery":               "servico",
  "Supermercado / Varejo":  "diaria",
  "Gastronomia":            "diaria",
  "Doméstico":              "diaria",
  "Construção Civil":       "diaria",
  "Eventos & Festas":       "diaria",
  // "Saúde & Cuidado":     varia — sem default, usuário escolhe.
  "Logística & Armazém":    "diaria",
  "Pet & Animais":          "servico",
  "Beleza & Estética":      "servico",
};

// ── Médias de valores por função em Campo Grande, MS ─────────────────────────
export const MEDIAS_CAMPO_GRANDE: Record<string, { min: number; max: number; media: number }> = {
  "Diarista / Faxineira":       { min: 120, max: 180, media: 150 },
  "Passadeira":                 { min: 100, max: 150, media: 120 },
  "Cozinheira":                 { min: 120, max: 180, media: 150 },
  "Babá":                       { min: 120, max: 180, media: 150 },
  "Jardineiro":                 { min: 120, max: 180, media: 150 },
  "Motoboy":                    { min: 130, max: 200, media: 160 },
  "Entregador de Bicicleta":    { min: 100, max: 160, media: 130 },
  "Entregador de Carro":        { min: 130, max: 200, media: 160 },
  "Repositor de Prateleiras":   { min: 100, max: 140, media: 115 },
  "Operador de Caixa":          { min: 100, max: 140, media: 120 },
  "Açougueiro":                 { min: 130, max: 200, media: 160 },
  "Padeiro":                    { min: 130, max: 200, media: 160 },
  "Auxiliar de Limpeza":        { min: 100, max: 150, media: 120 },
  "Garçom":                     { min: 130, max: 200, media: 165 },
  "Bartender":                  { min: 150, max: 250, media: 190 },
  "Ajudante de Cozinha":        { min: 100, max: 150, media: 120 },
  "Lavador de Louças":          { min: 90,  max: 130, media: 105 },
  "Pizzaiolo":                  { min: 150, max: 250, media: 190 },
  "Churrasqueiro":              { min: 180, max: 300, media: 230 },
  "Pedreiro":                   { min: 180, max: 280, media: 220 },
  "Servente de Obra":           { min: 100, max: 160, media: 125 },
  "Pintor":                     { min: 150, max: 240, media: 185 },
  "Eletricista":                { min: 180, max: 320, media: 240 },
  "Encanador":                  { min: 170, max: 300, media: 220 },
  "Gesseiro":                   { min: 160, max: 260, media: 200 },
  "Montador de Móveis":         { min: 120, max: 220, media: 160 },
  "Garçom de Eventos":          { min: 140, max: 220, media: 175 },
  "Barman":                     { min: 160, max: 280, media: 210 },
  "Montador de Estrutura":      { min: 130, max: 200, media: 160 },
  "Promoter":                   { min: 130, max: 220, media: 170 },
  "Recepcionista":              { min: 120, max: 200, media: 155 },
  "Cuidador de Idoso":          { min: 150, max: 250, media: 190 },
  "Acompanhante Hospitalar":    { min: 150, max: 250, media: 190 },
  "Auxiliar de Saúde":          { min: 140, max: 220, media: 175 },
  "Técnico de Enfermagem":      { min: 180, max: 300, media: 230 },
  "Ajudante de Carga e Descarga":{ min: 100, max: 170, media: 130 },
  "Separador de Pedidos":       { min: 110, max: 170, media: 135 },
  "Operador de Empilhadeira":   { min: 150, max: 240, media: 185 },
  "Auxiliar Logístico":         { min: 110, max: 180, media: 140 },
  "Pet Sitter":                 { min: 80,  max: 150, media: 110 },
  "Dog Walker":                 { min: 60,  max: 120, media: 85  },
  "Tosador":                    { min: 120, max: 200, media: 155 },
  "Auxiliar Veterinário":       { min: 110, max: 180, media: 140 },
  // Beleza & Estética
  "Manicure":                   { min: 80,  max: 150, media: 110 },
  "Pedicure":                   { min: 80,  max: 150, media: 110 },
  "Manicure e Pedicure":        { min: 120, max: 200, media: 155 },
  "Designer de Sobrancelhas":   { min: 80,  max: 160, media: 115 },
  "Depiladora":                 { min: 100, max: 180, media: 135 },
  "Cabeleireiro(a)":            { min: 120, max: 220, media: 165 },
  "Maquiador(a)":               { min: 150, max: 300, media: 210 },
  "Barbeiro":                   { min: 100, max: 200, media: 145 },
  "Esteticista":                { min: 130, max: 250, media: 180 },
};

// ── Planos de assinatura — Modelo Dual Track 2026-05 ─────────────────────────
// IMPORTANTE: cada usuário tem assinatura SEPARADA por papel (diarista/empregador).
// Quem é "ambos" pode ter Essencial diarista (R$9,90) + Plus empregador (R$49,90)
// ao mesmo tempo. Fonte da verdade: tabela `assinaturas(user_id, user_type, plano)`.
// O campo legado `user_profiles.plano_ativo` ainda é lido por retrocompat mas
// será deprecated em fase futura.
//
// 'pro' (legado) → 'plus' (novo nome). Migration faz UPDATE automático.
// 'destaque' (legado diarista) → 'plus'. Migration faz UPDATE automático.
export const PLANOS_EMPREGADOR = [
  {
    id: "gratis", nome: "Grátis", valor: 0, cor: "#64748b",
    vagas_mes: Infinity,
    matches_gratis_mes: 0,                 // sem cota grátis: R$1 por contato liberado
    descricao: "Pra começar a publicar anúncios sem custo",
    recursos: [
      "Anúncios ilimitados",
      "Até 5 interessados por anúncio",
      "R$ 1 por contato liberado",
      "Chat liberado só após conexão confirmada",
    ],
    destaque: false, badge: false,
  },
  {
    id: "essencial", nome: "Essencial", valor: 24.90, cor: "#3A86FF",
    vagas_mes: Infinity,
    matches_gratis_mes: Infinity,
    descricao: "Pra quem publica anúncios com frequência",
    recursos: [
      "Tudo do Grátis",
      "Conexões ilimitadas (sem R$1)",
      "IA Jájá pra criar anúncios em segundos",
      "Filtros avançados",
      "Prestadores favoritos",
      "Histórico de contatos",
      "Destaque moderado nos anúncios",
    ],
    destaque: false, badge: true, popular: true,
  },
  {
    id: "plus", nome: "Plus", valor: 49.90, cor: "#FF6B35",
    vagas_mes: Infinity,
    matches_gratis_mes: Infinity,
    descricao: "Pra empresas e divulgação recorrente de anúncios",
    recursos: [
      "Tudo do Essencial",
      "Prioridade máxima nos anúncios (topo da lista)",
      "Anúncios impulsionados",
      "Convites diretos ilimitados",
      "Automações de anúncios recorrentes",
      "Multi-endereço",
      "Relatórios simples",
      "Selo Anunciante Verificado",
    ],
    destaque: true, badge: true, popular: false,
  },
] as const;

export const PLANOS_DIARISTA = [
  {
    id: "gratis", nome: "Grátis", valor: 0, cor: "#64748b",
    descricao: "Use completo, sem limite de tempo",
    recursos: [
      "Demonstrações de interesse ilimitadas",
      "Receber conexões",
      "Chat após confirmação",
      "Curso interno (Já Decola)",
      "Níveis de confiança",
      "Primeiras 3 diárias concluídas grátis",
    ],
    destaque: false,
  },
  {
    id: "essencial", nome: "Essencial", valor: 9.90, cor: "#3A86FF",
    descricao: "Pra continuar recebendo oportunidades depois das primeiras diárias",
    recursos: [
      "Diárias ilimitadas",
      "Prioridade moderada nas buscas",
      "Selo Profissional no perfil",
      "IA assistente pra montar bio e respostas",
      "Boost semanal de visibilidade",
      "Notificações antecipadas de anúncios",
    ],
    destaque: false, badge: true, popular: true,
  },
  {
    id: "plus", nome: "Plus", valor: 19.90, cor: "#FF6B35",
    descricao: "Pra quem quer aparecer primeiro e fechar mais diárias",
    recursos: [
      "Tudo do Essencial",
      "Topo da lista nas buscas",
      "Boost diário de visibilidade",
      "Destaque Premium no perfil",
      "IA avançada (sugestões personalizadas)",
      "Prioridade máxima em convites",
      "Selo Alta Confiabilidade",
    ],
    destaque: true, popular: false,
  },
] as const;

// Tipo dos IDs de plano — usado pelos hooks e validações.
export type PlanoId = "gratis" | "essencial" | "plus";
export type RoleAssinatura = "diarista" | "empregador";

// ── Dias da semana ────────────────────────────────────────────────────────────
export const DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
export const DIAS_LABEL: Record<string, string> = {
  seg: "Seg", ter: "Ter", qua: "Qua", qui: "Qui", sex: "Sex", sab: "Sáb", dom: "Dom",
};

// Máximo de interessados visíveis na listagem do anunciante
export const MAX_INTERESSADOS = 5;

// ── Cores de avatar (background, foreground) ─────────────────────────────────
export const avatarColors: [string, string][] = [
  ["#FF6B35", "#fff"], ["#2EC4B6", "#fff"], ["#E71D36", "#fff"],
  ["#FF9F1C", "#fff"], ["#3A86FF", "#fff"], ["#8338EC", "#fff"],
  ["#06d6a0", "#fff"], ["#ef476f", "#fff"], ["#118ab2", "#fff"],
  ["#ffd166", "#073b4c"], ["#6d6875", "#fff"], ["#b5838d", "#fff"],
];

// ── Lista de todas as funções disponíveis (pré-calculada) ────────────────────
export const TODAS_AS_FUNCOES = ["Todos", ...Array.from(new Set(
  Object.values(CATEGORIAS_NEGOCIO).flatMap(cat => [...cat.funcoes])
)).sort()];

// ── Motivos de anúncio expirado (oferecidos no modal de feedback) ────────────
export const MOTIVOS_VAGA_EXPIRADA: { id: string; label: string; emoji: string }[] = [
  { id: "sem_candidatos", label: "Ninguém demonstrou interesse",          emoji: "🦗" },
  { id: "valor_baixo",    label: "Acho que o valor estava baixo",         emoji: "💸" },
  { id: "data_passou",    label: "Esqueci de selecionar a tempo",         emoji: "⏰" },
  { id: "desisti",        label: "Desisti de buscar prestador dessa vez", emoji: "🤷" },
  { id: "contratei_fora", label: "Acabei conectando com alguém fora do app", emoji: "🚪" },
  { id: "outro",          label: "Outro motivo (descrever)",              emoji: "✏️"  },
];

// Motivos quando a diária TINHA um profissional confirmado mas expirou sem
// check-in (no-show). Usado no mesmo modal de feedback obrigatório (Fase A.5).
// Reaproveita 'contratei_fora'/'desisti'/'outro' já aceitos pelo banco.
export const MOTIVOS_NO_SHOW: { id: string; label: string; emoji: string }[] = [
  { id: "diarista_nao_compareceu", label: "O prestador não apareceu",               emoji: "🚫" },
  { id: "diarista_cancelou",       label: "O prestador avisou que não viria",       emoji: "📵" },
  { id: "compareceu_sem_registro", label: "Compareceu, mas esqueci de confirmar",   emoji: "✅" },
  { id: "contratei_fora",          label: "Resolvi por fora do app",                emoji: "🚪" },
  { id: "desisti",                 label: "Não precisei mais",                      emoji: "🤷" },
  { id: "outro",                   label: "Outro motivo (descrever)",               emoji: "✏️"  },
];

// ── Google Ads (gtag) ─────────────────────────────────────────────────────────
// ID da tag instalada no index.html. O RÓTULO de conversão é gerado pelo
// painel do Google Ads ao criar a ação de conversão (Metas → Conversões →
// Nova ação → Site → criar manualmente). Enquanto o rótulo estiver vazio,
// o disparo de conversão é pulado (o evento nomeado dispara mesmo assim).
export const GOOGLE_ADS_ID = "AW-18217224314";
export const GOOGLE_ADS_LABEL_CADASTRO_PRESTADOR = "";
