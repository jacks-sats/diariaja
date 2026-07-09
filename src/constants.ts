// ── Constantes e dados estáticos do DiáriaJá ────────────────────────────────
// Extraídos do App.tsx para separação de concerns.

// ── Funções que usam formulário especial de Delivery ─────────────────────────
export const FUNCOES_DELIVERY = ["Motoboy", "Entregador de Bicicleta", "Entregador de Carro"];

export const SERVICOS_EMPRESARIAIS = [
  { id: "promotor_reposicao", nome: "Promotor de Reposição", subtitulo: "Abastecimento, organização e validade" },
  { id: "promotor_merchandising", nome: "Promotor de Merchandising", subtitulo: "Ponto extra, material de PDV e exposição" },
  { id: "auditoria_loja", nome: "Auditoria de Loja", subtitulo: "Verificação de execução e processos" },
  { id: "inventario", nome: "Inventário", subtitulo: "Contagem de estoque e ruptura" },
  { id: "precificacao", nome: "Precificação", subtitulo: "Pesquisa e troca de preços" },
  { id: "mudanca_layout", nome: "Mudança de Layout", subtitulo: "Planograma, gôndola e exposição" },
  { id: "montagem_ilha", nome: "Montagem de Ilha", subtitulo: "Ilhas, pontas e campanhas sazonais" },
  { id: "degustacao", nome: "Degustação", subtitulo: "Ações promocionais e demonstrações" },
  { id: "reposicao_noturna", nome: "Reposição Noturna", subtitulo: "Abastecimento fora do horário comercial" },
  { id: "pesquisa_precos", nome: "Pesquisa de Preços", subtitulo: "Coleta de preço, concorrência e ruptura" },
] as const;

export const ATIVIDADES_SERVICO_EMPRESA = [
  "Abastecer gôndola",
  "Organizar produtos",
  "Verificar validade",
  "Conferir preço",
  "Tirar fotos",
  "Montar ilha",
  "Aplicar material de PDV",
  "Negociar ponto extra",
  "Contar estoque",
  "Checar planograma",
] as const;

export const CHECKLIST_SERVICO_EMPRESA_PADRAO = [
  "Produto em falta?",
  "Preço incorreto?",
  "Conseguiu abastecer?",
  "Conseguiu ponto extra?",
  "Material de PDV aplicado?",
  "Observações gerais",
] as const;

export const MODELOS_SERVICO_EMPRESA: Record<string, {
  atividades: string[];
  checklist: Array<{ pergunta: string; tipo: "sim_nao" | "texto" | "numero" | "foto"; obrigatorio?: boolean }>;
  produtoLabel: string;
  produtoPlaceholder: string;
  materialPlaceholder: string;
  uniformePlaceholder: string;
  observacaoPlaceholder: string;
}> = {
  promotor_reposicao: {
    atividades: ["Abastecer gôndola", "Organizar produtos", "Verificar validade", "Conferir preço", "Tirar fotos"],
    checklist: [
      { pergunta: "Produto em falta?", tipo: "sim_nao" },
      { pergunta: "Gôndola abastecida?", tipo: "sim_nao" },
      { pergunta: "Validade verificada?", tipo: "sim_nao" },
      { pergunta: "Preço confere com etiqueta?", tipo: "sim_nao" },
      { pergunta: "Foto da gôndola antes", tipo: "foto" },
      { pergunta: "Foto da gôndola depois", tipo: "foto" },
      { pergunta: "Observações gerais", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Produto ou linha",
    produtoPlaceholder: "Ex: Refrigerantes 2L, biscoitos recheados, linha higiene",
    materialPlaceholder: "Ex: camisa da marca, etiquetas, cartazes, lista de SKUs",
    uniformePlaceholder: "Ex: camisa da marca, calça preta, sapato fechado",
    observacaoPlaceholder: "Ex: priorizar corredor de bebidas, falar com gerente do setor, reportar ruptura",
  },
  promotor_merchandising: {
    atividades: ["Aplicar material de PDV", "Negociar ponto extra", "Organizar produtos", "Checar planograma", "Tirar fotos"],
    checklist: [
      { pergunta: "Material de PDV aplicado?", tipo: "sim_nao" },
      { pergunta: "Ponto extra negociado?", tipo: "sim_nao" },
      { pergunta: "Planograma respeitado?", tipo: "sim_nao" },
      { pergunta: "Produtos com boa exposição?", tipo: "sim_nao" },
      { pergunta: "Foto do ponto natural", tipo: "foto" },
      { pergunta: "Foto do ponto extra", tipo: "foto" },
      { pergunta: "Observações gerais", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Produto, campanha ou linha",
    produtoPlaceholder: "Ex: Campanha volta às aulas, linha premium, lançamento",
    materialPlaceholder: "Ex: wobblers, faixas, stopper, display, cartaz de preço",
    uniformePlaceholder: "Ex: camiseta da ação, crachá, calça preta",
    observacaoPlaceholder: "Ex: negociar ponta de gôndola, aplicar material novo e registrar resistência da loja",
  },
  auditoria_loja: {
    atividades: ["Auditar execução", "Checar planograma", "Conferir preço", "Registrar divergência", "Tirar fotos"],
    checklist: [
      { pergunta: "Produto encontrado na loja?", tipo: "sim_nao" },
      { pergunta: "Planograma cumprido?", tipo: "sim_nao" },
      { pergunta: "Preço correto?", tipo: "sim_nao" },
      { pergunta: "Material de PDV visível?", tipo: "sim_nao" },
      { pergunta: "Divergências encontradas", tipo: "texto", obrigatorio: false },
      { pergunta: "Foto da execução auditada", tipo: "foto" },
    ],
    produtoLabel: "Marca, produto ou processo auditado",
    produtoPlaceholder: "Ex: Execução de cervejas, validade do setor, campanha vigente",
    materialPlaceholder: "Ex: roteiro de auditoria, lista de lojas, padrão esperado",
    uniformePlaceholder: "Ex: discreto, sem uniforme da marca, ou conforme orientação",
    observacaoPlaceholder: "Ex: não interferir na execução, apenas fotografar e responder checklist",
  },
  inventario: {
    atividades: ["Contar estoque", "Registrar ruptura", "Conferir validade", "Consolidar contagem", "Tirar fotos"],
    checklist: [
      { pergunta: "Contagem realizada?", tipo: "sim_nao" },
      { pergunta: "Quantidade encontrada", tipo: "numero" },
      { pergunta: "Ruptura identificada?", tipo: "sim_nao" },
      { pergunta: "Validade crítica encontrada?", tipo: "sim_nao" },
      { pergunta: "Foto do estoque/gôndola", tipo: "foto" },
      { pergunta: "Observações da contagem", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Produto, categoria ou área inventariada",
    produtoPlaceholder: "Ex: Bebidas energéticas, higiene oral, estoque de mercearia",
    materialPlaceholder: "Ex: planilha de SKUs, coletor, lista de códigos, caneta",
    uniformePlaceholder: "Ex: roupa neutra, sapato fechado, colete se houver",
    observacaoPlaceholder: "Ex: contar estoque de retaguarda e gôndola, separar produtos avariados",
  },
  precificacao: {
    atividades: ["Conferir preço", "Trocar etiqueta", "Registrar ruptura", "Tirar fotos", "Registrar divergência"],
    checklist: [
      { pergunta: "Preço da gôndola correto?", tipo: "sim_nao" },
      { pergunta: "Preço do sistema/confência informado?", tipo: "texto", obrigatorio: false },
      { pergunta: "Etiqueta trocada?", tipo: "sim_nao" },
      { pergunta: "Produto sem preço?", tipo: "sim_nao" },
      { pergunta: "Foto da etiqueta antes", tipo: "foto" },
      { pergunta: "Foto da etiqueta depois", tipo: "foto" },
    ],
    produtoLabel: "Produto ou lista de SKUs",
    produtoPlaceholder: "Ex: SKU 789..., linha de cafés, lista promocional da semana",
    materialPlaceholder: "Ex: etiquetas, lista de preços, autorização do gerente",
    uniformePlaceholder: "Ex: uniforme da loja ou roupa neutra, conforme combinado",
    observacaoPlaceholder: "Ex: conferir preço promocional e avisar gerente em caso de divergência",
  },
  mudanca_layout: {
    atividades: ["Checar planograma", "Organizar produtos", "Reorganizar gôndola", "Aplicar material de PDV", "Tirar fotos"],
    checklist: [
      { pergunta: "Layout anterior registrado?", tipo: "sim_nao" },
      { pergunta: "Planograma aplicado?", tipo: "sim_nao" },
      { pergunta: "Produtos realocados?", tipo: "sim_nao" },
      { pergunta: "Material aplicado?", tipo: "sim_nao" },
      { pergunta: "Foto antes do layout", tipo: "foto" },
      { pergunta: "Foto depois do layout", tipo: "foto" },
      { pergunta: "Pendências do layout", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Categoria ou área alterada",
    produtoPlaceholder: "Ex: Gôndola de cafés, setor de limpeza, geladeira de bebidas",
    materialPlaceholder: "Ex: planograma impresso, etiquetas, material de PDV, fitas",
    uniformePlaceholder: "Ex: calça preta, sapato fechado, camiseta da ação",
    observacaoPlaceholder: "Ex: seguir planograma anexo e registrar qualquer produto sem espaço",
  },
  montagem_ilha: {
    atividades: ["Montar ilha", "Abastecer produtos", "Aplicar material de PDV", "Negociar ponto extra", "Tirar fotos"],
    checklist: [
      { pergunta: "Ponto da ilha liberado?", tipo: "sim_nao" },
      { pergunta: "Ilha montada conforme orientação?", tipo: "sim_nao" },
      { pergunta: "Produtos abastecidos?", tipo: "sim_nao" },
      { pergunta: "Material visual aplicado?", tipo: "sim_nao" },
      { pergunta: "Foto da ilha montada", tipo: "foto" },
      { pergunta: "Observações da montagem", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Produto, campanha ou ilha",
    produtoPlaceholder: "Ex: Ilha de chocolates, cervejas premium, campanha sazonal",
    materialPlaceholder: "Ex: display, pallets, cartazes, faixas, material promocional",
    uniformePlaceholder: "Ex: camiseta da campanha, sapato fechado, calça preta",
    observacaoPlaceholder: "Ex: confirmar local com gerente e registrar se a ilha foi movida",
  },
  degustacao: {
    atividades: ["Preparar degustação", "Abordar clientes", "Distribuir amostras", "Registrar feedback", "Tirar fotos"],
    checklist: [
      { pergunta: "Mesa/estação montada?", tipo: "sim_nao" },
      { pergunta: "Amostras distribuídas", tipo: "numero" },
      { pergunta: "Clientes abordados", tipo: "numero" },
      { pergunta: "Produto aprovado pelo público?", tipo: "sim_nao" },
      { pergunta: "Foto da estação de degustação", tipo: "foto" },
      { pergunta: "Comentários dos clientes", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Produto degustado",
    produtoPlaceholder: "Ex: Café gelado, queijo, iogurte, bebida funcional",
    materialPlaceholder: "Ex: mesa, luvas, touca, copos, amostras, lixeira, banner",
    uniformePlaceholder: "Ex: uniforme da ação, touca, luvas, sapato fechado",
    observacaoPlaceholder: "Ex: usar luvas, abordar clientes no corredor principal e anotar feedbacks",
  },
  reposicao_noturna: {
    atividades: ["Abastecer gôndola", "Organizar produtos", "Verificar validade", "Registrar ruptura", "Tirar fotos"],
    checklist: [
      { pergunta: "Abastecimento concluído?", tipo: "sim_nao" },
      { pergunta: "Rupturas registradas?", tipo: "sim_nao" },
      { pergunta: "Produtos vencidos encontrados?", tipo: "sim_nao" },
      { pergunta: "Área limpa e organizada?", tipo: "sim_nao" },
      { pergunta: "Foto final da gôndola", tipo: "foto" },
      { pergunta: "Pendências para o próximo turno", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Categoria ou setor",
    produtoPlaceholder: "Ex: Bebidas, mercearia, frios, higiene pessoal",
    materialPlaceholder: "Ex: lista de prioridades, EPIs, acesso ao estoque",
    uniformePlaceholder: "Ex: sapato fechado, roupa escura, colete refletivo se necessário",
    observacaoPlaceholder: "Ex: entrar pela doca, procurar líder noturno e priorizar ruptura crítica",
  },
  pesquisa_precos: {
    atividades: ["Coletar preço", "Conferir concorrência", "Registrar ruptura", "Tirar fotos", "Registrar divergência"],
    checklist: [
      { pergunta: "Preço coletado?", tipo: "sim_nao" },
      { pergunta: "Valor encontrado", tipo: "numero" },
      { pergunta: "Produto em promoção?", tipo: "sim_nao" },
      { pergunta: "Concorrente informado?", tipo: "texto", obrigatorio: false },
      { pergunta: "Foto da etiqueta/preço", tipo: "foto" },
      { pergunta: "Observações da pesquisa", tipo: "texto", obrigatorio: false },
    ],
    produtoLabel: "Produto ou lista de pesquisa",
    produtoPlaceholder: "Ex: Arroz 5kg, leite UHT, cerveja lata, cesta básica",
    materialPlaceholder: "Ex: lista de produtos, formulário de pesquisa, régua de preço",
    uniformePlaceholder: "Ex: roupa neutra ou uniforme discreto, conforme orientação",
    observacaoPlaceholder: "Ex: coletar preço da marca própria e concorrentes diretos quando houver",
  },
};

export const HABILIDADES_TRADE = [
  "Reposição",
  "Merchandising",
  "Auditoria de loja",
  "Inventário",
  "Precificação",
  "Degustação",
  "Montagem de ilha",
  "Pesquisa de preços",
  "Reposição noturna",
] as const;

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
    funcoes: ["Repositor de Prateleiras", "Operador de Caixa", "Açougueiro", "Padeiro", "Auxiliar de Limpeza", "Estoquista", "Conferente", "Fiscal de Loja / Prevenção de Perdas", "Empacotador"],
    destaque: "⭐ Muito procurado",
  },
  "Gastronomia": {
    icone: "🍽️",
    cor: "#E71D36",
    funcoes: ["Garçom", "Bartender", "Ajudante de Cozinha", "Lavador de Louças", "Pizzaiolo", "Churrasqueiro", "Copeiro(a)", "Chapeiro", "Atendente de Lanchonete"],
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
    funcoes: ["Pedreiro", "Servente de Obra", "Pintor", "Eletricista", "Encanador", "Gesseiro", "Montador de Móveis", "Azulejista", "Carpinteiro", "Soldador", "Serralheiro", "Vidraceiro"],
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
    funcoes: ["Ajudante de Carga e Descarga", "Separador de Pedidos", "Operador de Empilhadeira", "Auxiliar Logístico", "Motorista de Caminhão / Carreteiro", "Motorista de Van / Furgão", "Conferente de Carga", "Auxiliar de Expedição"],
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
  "Limpeza Especializada": {
    icone: "🧹",
    cor: "#0d9488",
    funcoes: ["Limpeza Pós-Obra", "Auxiliar de Limpeza Predial/Comercial", "Limpeza de Vidros/Fachada"],
  },
  "Portaria & Segurança": {
    icone: "🛡️",
    cor: "#475569",
    funcoes: ["Porteiro", "Vigia", "Controlador de Acesso", "Segurança de Evento"],
  },
  "Administrativo & Escritório": {
    icone: "💼",
    cor: "#6366f1",
    funcoes: ["Auxiliar Administrativo", "Auxiliar de RH / Departamento Pessoal", "Auxiliar Financeiro", "Recepcionista (comércio/clínica)", "Telefonista"],
  },
  "Agro & Rural": {
    icone: "🌾",
    cor: "#65a30d",
    funcoes: ["Trabalhador Rural", "Tratorista", "Ordenhador"],
  },
  "Comercial & Vendas": {
    icone: "🛍️",
    cor: "#db2777",
    funcoes: ["Vendedor Interno", "Vendedor Externo", "Representante Comercial", "Promotor de Vendas", "Demonstrador / Degustação", "Consultor de Vendas", "Panfleteiro / Captador", "Operador de Telemarketing"],
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

// Benefícios oferecidos numa VAGA DE EMPREGO (seleção por chips no criar-vaga).
// O anunciante marca os que oferece + pode escrever extras no campo "Outros".
export const BENEFICIOS_VAGA: readonly string[] = [
  "Vale-transporte",
  "Vale-refeição",
  "Vale-alimentação",
  "Plano de saúde",
  "Plano odontológico",
  "Auxílio-creche",
  "Comissão",
  "Bônus",
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
    // Cota grátis = 3 contatos/mês (alinhado ao servidor — cota_3_gratis_contato.sql
    // — e ao useLimits.ts). Acima disso, R$ 2,50 por contato. (Campo informativo;
    // o limite real é enforçado no banco + useLimits, não por este número.)
    matches_gratis_mes: 3,
    descricao: "Pra começar a publicar anúncios sem custo",
    recursos: [
      "Anúncios ilimitados",
      "Até 5 interessados por anúncio",
      "3 contatos grátis por mês — depois R$ 2,50 por contato",
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
      "Conexões ilimitadas (sem a taxa por contato)",
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
    descricao: "Pra continuar aceitando diárias depois das 3 primeiras",
    // P0-2: a tela só lista o que o código ENTREGA hoje. "Diárias ilimitadas"
    // virou real com a trava da cota grátis (enforce_cota_gratis_diarista).
    // Os recursos antes prometidos (prioridade/selo/IA/boost/notificações
    // antecipadas) NÃO estão ligados em lugar nenhum (permissions.diarista.*
    // não é consumido) — removidos até serem implementados de verdade.
    recursos: [
      "Diárias ilimitadas — aceite quantas quiser, sem o limite de 3 grátis",
      "Tudo do plano Grátis incluído",
    ],
    destaque: false, badge: true, popular: true,
  },
  {
    id: "plus", nome: "Plus", valor: 19.90, cor: "#FF6B35",
    descricao: "Pra quem quer aparecer primeiro e fechar mais diárias",
    // P0-2 ⚠️: NENHUM diferencial do Plus está implementado (topo da lista,
    // boost, destaque, IA avançada, prioridade em convites, selo) — todos
    // dependem de permissions.diarista.*, que não é consumido. Removidos por
    // honestidade. CONSEQUÊNCIA: hoje o Plus não entrega nada além do Essencial.
    // Decisão de produto pendente: esconder o Plus OU implementar os recursos.
    recursos: [
      "Tudo do Essencial",
      "Diárias ilimitadas",
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

// Teto de candidatos (pendentes) por vaga: ao atingir, a vaga some do feed.
// ⚠️ Se mudar aqui, atualize TAMBÉM o trigger enforce_max_interessados no banco
// (supabase/migrations/max_interessados_trigger.sql) — Postgres não lê esta const.
export const MAX_INTERESSADOS = 10;

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
export const GOOGLE_ADS_LABEL_CADASTRO_PRESTADOR = "l2gcCLn_mL4cEPqQ0-5D";
