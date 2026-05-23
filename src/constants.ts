// ── Constantes e dados estáticos do Trampojá ────────────────────────────────
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
    funcoes: ["Pedreiro", "Servente de Obra", "Pintor", "Eletricista", "Encanador", "Gesseiro"],
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
} as const;

export type CategoriaNegocio = keyof typeof CATEGORIAS_NEGOCIO;

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
};

// ── Planos de assinatura ─────────────────────────────────────────────────────
export const PLANOS_EMPREGADOR = [
  {
    id: "gratis", nome: "Grátis", valor: 0, cor: "#64748b",
    vagas_mes: 3,
    recursos: ["Até 3 vagas por mês", "Candidatos ilimitados", "Chat com diarista", "Avaliações"],
    destaque: false, badge: false,
  },
  {
    id: "essencial", nome: "Essencial", valor: 49, cor: "#3A86FF",
    vagas_mes: Infinity,
    recursos: ["Vagas ilimitadas", "Badge verificado ✅", "Candidatos ilimitados", "Chat com diarista", "Avaliações"],
    destaque: false, badge: true, popular: false,
  },
  {
    id: "pro", nome: "Pro", valor: 99, cor: "#FF6B35",
    vagas_mes: Infinity,
    recursos: ["Tudo do Essencial", "Vagas em destaque 🔥", "Aparece primeiro nas buscas", "Relatório de candidatos"],
    destaque: true, badge: true, popular: true,
  },
] as const;

export const PLANOS_DIARISTA = [
  {
    id: "gratis", nome: "Grátis", valor: 0, cor: "#64748b",
    recursos: ["Aparece na listagem", "Candidatura a vagas", "Chat com empregador", "Avaliações"],
    destaque: false,
  },
  {
    id: "destaque", nome: "Destaque ⭐", valor: 19, cor: "#FF6B35",
    recursos: ["Aparece em 1º nas buscas", "Badge ⭐ Destaque no perfil", "Mais visibilidade para empregadores", "Candidatura prioritária"],
    destaque: true, popular: true,
  },
] as const;

// ── Dias da semana ────────────────────────────────────────────────────────────
export const DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
export const DIAS_LABEL: Record<string, string> = {
  seg: "Seg", ter: "Ter", qua: "Qua", qui: "Qui", sex: "Sex", sab: "Sáb", dom: "Dom",
};

// Máximo de candidatos visíveis na listagem do empregador
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
