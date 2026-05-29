// ── Tipos e Interfaces do DiáriaJá ──────────────────────────────────────────
// Extraídos do App.tsx para separação de concerns.

export interface Assinatura {
  id: string;
  user_id: string;
  plano: "gratis" | "essencial" | "plus" | string; // string p/ aceitar legados ('pro','destaque') até migration rodar
  user_type: "diarista" | "empregador" | string;   // qual papel essa assinatura cobre (dual track)
  status: "pendente" | "ativo" | "pausado" | "cancelado" | string;
  mp_subscription_id?: string;
  valor: number;
  inicio: string;
  proximo_pagamento?: string;
  created_at?: string;
  updated_at?: string;
}

// Diária (jornada de várias horas) vs Serviço (tarefa pontual "vem-faz-vai").
// Spec: docs/spec-tipo-oferta-diaria-vs-servico.md
export type TipoOferta = 'diaria' | 'servico';
export type TipoPreco = 'fixo' | 'a_combinar' | 'a_partir_de';

export interface Diaria {
  id: string;
  // Auto-moderação: vaga ocultada após acúmulo de denúncias (trigger no banco).
  oculto?: boolean;
  empregador_id: string;
  nome_negocio: string;
  segmento: string;
  funcao: string;
  descricao: string;
  data: string;
  horario_inicio: string;
  horario_fim: string;
  valor: number;
  status: string;
  diarista_aceite_id: string | null;
  created_at: string;
  motivo_cancelamento?: string;
  endereco?: string;
  lat?: number | null;
  lng?: number | null;
  // Campos especiais para Delivery/Motoboy
  valor_encostada?: number | null;
  valor_por_entrega?: number | null;
  ganho_estimado_dia?: number | null;
  // Pagamento Mercado Pago
  pagamento_status?: string | null;   // aguardando | pago | falhou | cancelado | reembolsado
  pagamento_mp_id?: string | null;
  taxa_plataforma?: number | null;
  valor_diarista?: number | null;
  bairro?: string | null;             // bairro do CEP da vaga (preenchido ao publicar)
  // ── Tipo da oferta (diária vs serviço pontual) ───────────────────────────
  tipo_oferta: TipoOferta;            // default 'diaria' (legado + criação atual)
  tempo_estimado_min?: number | null; // só se tipo_oferta='servico'
  tipo_preco?: TipoPreco | null;      // só se tipo_oferta='servico'
}

export interface UserProfile {
  id: string;
  // Auto-moderação: perfil ocultado após acúmulo de denúncias (trigger no banco).
  oculto?: boolean;
  user_type: string;
  nome: string;
  telefone: string;
  nome_negocio: string;
  segmento: string;
  funcao: string;
  valor_diaria: number;
  disponivel: boolean;
  agenda: string[];
  bio: string;
  foto_url: string;
  categorias: string[];
  lat: number | null;
  lng: number | null;
  cpf?: string;
  cnpj?: string;
  pessoa_tipo?: string;       // "fisica" | "juridica"
  // ── Campos específicos PJ (Empresa com CNPJ) ──────────────────────────
  razao_social?: string;      // Razão social registrada na Receita
  nome_fantasia?: string;     // Nome público / fachada
  responsavel_nome?: string;  // Nome do responsável legal pela conta
  responsavel_cpf?: string;   // CPF do responsável (privado)
  sexo?: string;
  data_nascimento?: string;
  cep?: string;                       // CEP do prestador (diarista) — usado p/ distância
  endereco_empregador?: string;
  created_at?: string;
  mp_user_id?: string;
  mp_access_token?: string;
  plano_ativo?: string;       // 'gratis' | 'destaque'
  is_admin?: boolean;
  is_suporte?: boolean;       // agente de suporte — promovido pelo admin via RPC promover_suporte()
  portfolio_urls?: string[];  // até 3 fotos do trabalho (diarista)
  // ── Níveis de confiabilidade ─────────────────────────────────────────
  telefone_verificado?: boolean;
  documento_status?: "nao_enviado" | "enviado" | "aprovado" | "rejeitado";
  documento_url?: string;
  documento_enviado_em?: string;
  documento_revisado_em?: string;
  documento_motivo_rejeicao?: string;
  // ── Antecedentes criminais (certidão negativa em PDF) ────────────────
  antecedentes_status?: "nao_enviado" | "enviado" | "aprovado" | "rejeitado";
  antecedentes_url?: string;
  antecedentes_enviado_em?: string;
  antecedentes_revisado_em?: string;
  antecedentes_motivo_rejeicao?: string;
  // Heartbeat de presença (painel admin "online agora")
  last_activity_at?: string;
  // PIX do diarista (recebe pagamentos da plataforma)
  pix_chave?: string;
  pix_tipo?: "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";
  // Audit trail de aceite dos Termos (LGPD — prova server-side)
  termos_aceitos_em?: string;
  termos_versao?: string;
}

// ── Já Decola — Sistema educacional gamificado ─────────────────────────────
export interface AcademyCurso {
  id: string;
  slug: string;
  titulo: string;
  descricao: string;
  icone: string;
  cor: string;
  audiencia: "diarista" | "empregador" | "ambos";
  nivel: "basico" | "intermediario" | "avancado";
  ordem: number;
  pontos_score: number;
  selo_titulo?: string;
  selo_icone?: string;
  publicado: boolean;
}
export interface AcademyModulo {
  id: string;
  curso_id: string;
  ordem: number;
  titulo: string;
  descricao: string;
}
export interface AcademyAula {
  id: string;
  modulo_id: string;
  ordem: number;
  tipo: "texto" | "video" | "dica";
  titulo: string;
  conteudo: string;
  tempo_min_seg: number;
}
export interface AcademyPerguntaCliente {
  pergunta_id: string;
  ordem: number;
  pergunta: string;
  opcoes: { id: string; texto: string }[];
}
export interface AcademyProgressoAula {
  user_id: string;
  aula_id: string;
  iniciada_em: string;
  concluida_em: string | null;
  tempo_gasto_seg: number;
}
export interface AcademyCertificado {
  user_id: string;
  curso_id: string;
  concluido_em: string;
  pontuacao: number;
}

// ── Sistema de níveis de confiabilidade ────────────────────────────────────
// Cada nível destrava funcionalidades e aumenta a confiança na plataforma.
export type NivelConfiabilidade = 1 | 2 | 3 | 4;

export interface NivelInfo {
  nivel: NivelConfiabilidade;
  nome: string;          // "Básico" | "Verificado" | "Confiável" | "Premium"
  cor: string;
  pendencias: string[];  // o que falta pra subir ao próximo nível
  proximo?: NivelConfiabilidade;
}

export interface Topico {
  id: string;
  autor_id?: string;
  autor_nome: string;
  autor_tipo?: string;
  titulo: string;
  conteudo: string;
  categoria: string;          // 'geral' | 'dicas' | 'duvidas' | 'conquistas' | 'suporte'
  likes: number;
  total_comentarios: number;
  pinned: boolean;
  created_at: string;
}

export interface ComentarioComunidade {
  id: string;
  topico_id: string;
  autor_id?: string;
  autor_nome: string;
  autor_tipo?: string;
  conteudo: string;
  likes: number;
  created_at: string;
}

export interface Convite {
  id: string;
  contratante_id: string;
  diarista_id: string;
  contratante_nome?: string;
  diarista_nome?: string;
  funcao?: string;
  local_servico: string;
  data_servico: string;
  horario_servico: string;
  observacoes?: string;
  valor?: number;
  status: string;             // 'pendente' | 'aceito' | 'recusado'
  created_at: string;
}

export interface AnalyticsEvento {
  evento: string;
  user_id?: string;
  user_type?: string;
  propriedades?: Record<string, unknown>;
}

export interface FeedbackVagaExpirada {
  id: string;
  diaria_id: string;
  empregador_id: string;
  motivo_categoria:
    | "sem_candidatos"
    | "valor_baixo"
    | "data_passou"
    | "desisti"
    | "contratei_fora"
    | "outro";
  motivo_texto?: string;
  created_at: string;
}

export interface FeedbackPosConclusao {
  id: string;
  diaria_id: string;
  empregador_id: string;
  chegou_no_horario: boolean;
  nota_qualidade: number; // 1–5
  recomendaria: boolean;
  comentario?: string;
  created_at: string;
}

export interface ReputacaoEmpregador {
  empregador_id: string;
  total_avaliacoes: number;
  nota_media: number | null;        // 1.0–5.0
  pct_pagou_combinado: number | null;   // 0–100, null se ninguém respondeu ainda
  pct_cumpriu_combinado: number | null;
}

// ── Suporte por tickets (painel admin) ──────────────────────────────────────
export interface SuporteTicket {
  id: string;
  user_id: string;
  assunto: string;
  status: "aberto" | "aguardando_user" | "resolvido" | "fechado";
  ultima_resposta_role: "user" | "admin" | null;
  created_at: string;
  updated_at: string;
}

export interface SuporteResposta {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: "user" | "admin";
  mensagem: string;
  created_at: string;
}

export interface AdminStats {
  total_usuarios: number;
  online_agora: number;
  novos_hoje: number;
  novos_semana: number;
  tickets_abertos: number;
  diarias_ativas: number;
}
