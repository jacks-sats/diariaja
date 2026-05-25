/**
 * DiáriaJá — Marketplace de diárias.
 * Copyright (c) 2025–2026 Jackson dos Santos da Silva. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição sem autorização escrita é proibido.
 * Lei 9.609/98 e Lei 9.610/98. Contato: suporte@diariaja.com.br
 */
import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { Session } from "@supabase/supabase-js";
import MapComponent from "./MapComponent";
// ── Ícones (Lucide React — outline moderno, tree-shaken) ─────────────────────
import {
  Home, Briefcase, MessageCircle, User, Plus, ArrowLeft,
  Star, CheckCircle2, AlertTriangle, MapPin, Camera, QrCode,
  Heart, Bell, LogOut, Settings, Search, Filter, X, Send,
  Wallet, ShieldCheck, ThumbsUp, ThumbsDown, Clock, Trash2,
  Eye, EyeOff, ChevronRight, Inbox, Loader2,
} from "lucide-react";
// QRCodeSVG é carregado sob demanda — economiza ~117KB gzip no startup
const QRCodeSVG = React.lazy(() =>
  import("qrcode.react").then(m => ({ default: m.QRCodeSVG })),
);

// ── Helper de haptic feedback (vibração curta nos toques importantes) ───────
const hapticTick = () => { try { navigator.vibrate?.(8); } catch {} };
// Vibração mais forte para confirmações importantes (verificação, aceite, etc.)
const hapticConfirm = () => { try { navigator.vibrate?.([100, 50, 200]); } catch {} };

// ── Wrapper pra disparar push notification via Edge Function send-push ──────
type PushTipo = "mensagem" | "vaga_proxima" | "candidatura" | "selecionado" | "confirmacao" | "default";
async function enviarPush(
  userIds: string[],
  title: string,
  body: string,
  opts: { tipo?: PushTipo; url?: string } = {},
) {
  if (!userIds.length) return;
  try {
    const { data: { session: sess } } = await supabase.auth.getSession();
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${sess?.access_token ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        user_ids: userIds, title, body,
        tipo: opts.tipo || "default",
        url: opts.url || "/",
      }),
    });
  } catch { /* push é best-effort — falhas não interrompem o fluxo */ }
}
// ── Separação de concerns ────────────────────────────────────────────────────
import type { Assinatura, Diaria, UserProfile, Topico, ComentarioComunidade, Convite, ReputacaoEmpregador } from "./types";
import {
  FUNCOES_DELIVERY, CATEGORIAS_NEGOCIO, MEDIAS_CAMPO_GRANDE,
  PLANOS_EMPREGADOR, PLANOS_DIARISTA,
  DIAS, DIAS_LABEL, MAX_INTERESSADOS, avatarColors, TODAS_AS_FUNCOES,
  MOTIVOS_VAGA_EXPIRADA,
} from "./constants";
import {
  nivelDiarista, calcScore, validarNome, verificarFraudeDescricao,
  detectarContatoExterno, validarCPF, maskCPF, maskCNPJ, haversineKm,
  validarTituloDiaria, validarEmail, validarTelefone, vagaExpirou,
  formatarDistancia, tempoEstimadoMin, formatarTempo, formatTempoRelativo,
  calcularNivelConfiabilidade,
} from "./helpers";
import { usePushNotifications } from "./usePushNotifications";
import { showLoadingBar, hideLoadingBar } from "./GlobalLoadingBar";

// ── Analytics: registra eventos de uso no Supabase ──────────────────────────
async function trackEvento(
  evento: string,
  userId: string | undefined,
  userType: string | undefined,
  propriedades?: Record<string, unknown>,
) {
  try {
    await supabase.from("analytics_eventos").insert({
      evento,
      user_id: userId ?? null,
      user_type: userType ?? null,
      propriedades: propriedades ?? {},
    });
  } catch {
    // Analytics não é crítico — falhas silenciosas
  }
}

// BUG-C2 fix: QRScanner definido fora do App para não ser recriado a cada render
function QRScannerComponent({ onResult, onError, onClose }: {
  onResult: (diariaId: string) => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    let html5QrCode: any;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        html5QrCode = new Html5Qrcode("qr-reader");
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (result: string) => {
            html5QrCode.stop().catch(() => {});
            if (result.startsWith("DIARIAJA:")) {
              onResult(result.replace("DIARIAJA:", ""));
            } else {
              onError("QR Code inválido. Use o código gerado pelo diarista.");
            }
            onClose();
          },
          () => {}
        );
      } catch {
        onError("Não foi possível acessar a câmera. Verifique as permissões.");
        onClose();
      }
    })();
    return () => { html5QrCode?.stop().catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div id="qr-reader" style={{ width:"100%", borderRadius:12, overflow:"hidden" }} />;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // ── Controle de aceite dos Termos de Uso ──────────────────────────────
  const TERMOS_VERSAO = "v1"; // incrementar aqui força re-aceite em nova versão
  const [termosAceitos, setTermosAceitos] = useState<boolean>(() => {
    try { return localStorage.getItem("diariaja_termos_" + TERMOS_VERSAO) === "1"; } catch { return false; }
  });
  const [mostrarTermos, setMostrarTermos] = useState(false);       // modal de termos (usado no cadastro)
  // Gate de aceite removido: consentimento agora ocorre no momento do cadastro (melhoria UX/conversão)
  const [checkTermos, setCheckTermos] = useState(false);           // checkbox no cadastro
  // ─────────────────────────────────────────────────────────────────────
  const [tela, setTela]                   = useState<string>(() => {
    try { return localStorage.getItem("diariaja_tela") || "splash"; } catch { return "splash"; }
  });
  const [tipo, setTipo]                   = useState<string | null>(null);
  const [modoAtual, setModoAtual]         = useState<"empregador"|"diarista">(() => {
    return (localStorage.getItem("diariaja_modo") as "empregador"|"diarista") || "empregador";
  });
  const [negocioSelecionado, setNegocio]  = useState<string | null>(null);
  const [form, setForm]                   = useState({ nome:"", telefone:"", funcao:"", valor:"", nomeNegocio:"", email:"", senha:"", bio:"", cpf:"", cnpj:"", pessoaTipo:"fisica", sexo:"", dataNasc:"", cepEmp:"", ruaEmp:"", numeroEmp:"", complementoEmp:"", bairroEmp:"", cidadeEmp:"", estadoEmp:"", cep:"", bairro:"", cidade:"" });
  const [buscandoCEPEmp, setBuscandoCEPEmp] = useState(false);
  const [fotoUrl, setFotoUrl]             = useState<string | null>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [agendaSelecionada, setAgenda]          = useState<string[]>([]);
  const [categoriasSelecionadas, setCategorias] = useState<string[]>([]);
  const [disponivelAgora, setDisponivel]  = useState(false);
  const [filtroFuncao, setFiltroFuncao]   = useState("Todos");
  const [filtroDisp, setFiltroDisp]       = useState(false);
  const [diarias, setDiarias]                     = useState<Diaria[]>([]);
  const [formDiaria, setFormDiaria]               = useState({ local:"", descricao:"", funcao:"", data:"", horario_inicio:"", horario_fim:"", valor:"", cep:"", rua:"", numero:"", complemento:"", bairro:"", cidade:"", estado:"", valor_encostada:"", valor_por_entrega:"", ganho_estimado_dia:"" });
  const [buscandoCEP, setBuscandoCEP]             = useState(false);
  const [buscandoCEPPerfil, setBuscandoCEPPerfil] = useState(false);  // diarista profile CEP
  const [latPerfilCEP, setLatPerfilCEP]           = useState<number | null>(null); // geocoded from profile CEP
  const [lngPerfilCEP, setLngPerfilCEP]           = useState<number | null>(null);
  const [localizandoDiaria, setLocalizandoDiaria] = useState(false);
  const [latDiaria, setLatDiaria]                 = useState<number | null>(null);
  const [lngDiaria, setLngDiaria]                 = useState<number | null>(null);
  const [salvandoDiaria, setSalvandoDiaria]       = useState(false);
  const [vagasReais, setVagasReais]               = useState<Diaria[]>([]);
  const [vagaConfirm, setVagaConfirm]             = useState<Diaria | null>(null);
  const [vagaConfirmada, setVagaConfirmada]       = useState(false);
  const [diaristasReais, setDiaristasReais]       = useState<UserProfile[]>([]);
  const [diaristaSelecionadaReal, setDiaristaSelecionadaReal] = useState<UserProfile | null>(null);
  const [modalContratoReal, setModalContratoReal] = useState(false);
  const [contratadoReal, setContratadoReal]       = useState(false);
  const [convitesRecebidos, setConvitesRecebidos] = useState<Convite[]>([]);
  const [convitesEnviados, setConvitesEnviados]   = useState<Convite[]>([]);
  const [modalConvite, setModalConvite]           = useState(false);
  const [enviandoConvite, setEnviandoConvite]     = useState(false);
  const [formConvite, setFormConvite]             = useState({ cep: "", rua: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", endereco: "", data: "", horario: "", cargaHoraria: "", observacoes: "" });
  const [buscandoCEPConvite, setBuscandoCEPConvite] = useState(false);
  // Comunidade
  const [topicos, setTopicos]                     = useState<Topico[]>([]);
  const [topicoAtivo, setTopicoAtivo]             = useState<Topico | null>(null);
  const [comentariosTopico, setComentariosTopico] = useState<ComentarioComunidade[]>([]);
  const [filtroComunidade, setFiltroComunidade]   = useState("todos");
  const [modalNovoTopico, setModalNovoTopico]     = useState(false);
  const [formTopico, setFormTopico]               = useState({ titulo: "", conteudo: "", categoria: "geral" });
  const [novoComentario, setNovoComentario]       = useState("");
  const [enviandoTopico, setEnviandoTopico]       = useState(false);
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const diaristasReaisRef = useRef<UserProfile[]>([]);
  const [tab, setTab]                     = useState("lista");
  const [tabDiarista, setTabDiarista]     = useState("inicio");
  const [tabEmpregador, setTabEmpregador] = useState("inicio");
  const [authError, setAuthError]         = useState("");
  const [authLoading, setAuthLoading]     = useState(false);
  const [minhasDiarias, setMinhasDiarias] = useState<Diaria[]>([]);
  const [qrDiaria, setQrDiaria]           = useState<Diaria | null>(null);
  const [scannerAberto, setScannerAberto] = useState(false);
  const [scanMsg, setScanMsg]             = useState<{ok:boolean,txt:string}|null>(null);
  const scannerRef = useRef<any>(null);
  // Avaliação mútua
  const [modalAvalEmp, setModalAvalEmp]           = useState<Diaria | null>(null);  // diarista avalia empregador
  const [modalAvalDiaristaReal, setModalAvalDiaristaReal] = useState<Diaria | null>(null); // empregador avalia diarista
  const [notaEmp, setNotaEmp]                     = useState(0);
  const [comentarioEmp, setComentarioEmp]         = useState("");
  const [notaDiaristaReal, setNotaDiaristaReal]   = useState(0);
  const [comentarioDiaristaReal, setComentarioDiaristaReal] = useState("");
  const [enviandoAvalMutua, setEnviandoAvalMutua] = useState(false);
  const [avaliadosDiarias, setAvaliadosDiarias]   = useState<Set<string>>(new Set()); // diaria_ids já avaliados
  const [avaliacoesDiaristaReal, setAvaliacoesDiaristaReal] = useState<{id:string,nota:number,comentario:string,created_at:string}[]>([]);
  const [mediaEmpregadorPerfil, setMediaEmpregadorPerfil] = useState<number|null>(null); // média do empregador logado
  const [msgNaoLidas, setMsgNaoLidas] = useState(0); // badge de mensagens não lidas
  const [alertaAceite, setAlertaAceite] = useState<Diaria | null>(null); // modal quando diarista aceita diária do empregador
  const [modalCancelar, setModalCancelar] = useState<Diaria | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [cancelando, setCancelando] = useState(false);
  // Desistência (diarista devolve a vaga — fica aberta novamente)
  const [modalDesistir, setModalDesistir] = useState<Diaria | null>(null);
  const [motivoDesistencia, setMotivoDesistencia] = useState("");
  const [desistindo, setDesistindo] = useState(false);
  // Detalhes da diária aceita (modal ao clicar no card)
  const [detalhesDiaria, setDetalhesDiaria] = useState<Diaria | null>(null);
  // Menu de troca de perfil (bottom sheet ao clicar no nome/avatar)
  const [menuTrocarPerfil, setMenuTrocarPerfil] = useState(false);
  // Modal de informações do perfil (ao clicar no nome)
  const [modalInfoPerfil, setModalInfoPerfil] = useState(false);
  const [editandoBio, setEditandoBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  // Excluir diária (empregador)
  const [modalExcluir, setModalExcluir] = useState<Diaria | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [motivoExclusao, setMotivoExclusao] = useState("");
  // Candidaturas (fluxo: interesse → seleção → confirmação)
  const [meuInteresse, setMeuInteresse]               = useState<Record<string,string>>({});          // diaria_id → status
  const [candidaturas, setCandidaturas]               = useState<{id:string,diaria_id:string,diarista_id:string,status:string}[]>([]);
  const [candidatosProfiles, setCandidatosProfiles]   = useState<Record<string,UserProfile>>({});
  const [modalCandidatos, setModalCandidatos]         = useState<Diaria|null>(null);
  const [selecionando, setSelecionando]               = useState(false);
  const [confirmando, setConfirmando]                 = useState(false);
  // Perfil do candidato (empregador vê detalhes ao clicar no card)
  const [perfilCandidato, setPerfilCandidato]         = useState<UserProfile|null>(null);
  const [avaliacoesCandidato, setAvaliacoesCandidato] = useState<{id:string,nota:number,comentario:string,created_at:string}[]>([]);
  const [diariasCandidato, setDiariasCandidato]       = useState(0);
  const [loadingPerfil, setLoadingPerfil]             = useState(false);
  const [toastSuccess, setToastSuccess]               = useState("");  // toast verde auto-dismiss 3s
  const [toastError, setToastError]                   = useState("");  // toast vermelho auto-dismiss 4s

  // Notificações in-app (painel do sino)
  const [listaNotif, setListaNotif] = useState<{tipo:"ok"|"erro", msg:string, ts:number}[]>([]);
  const [modalNotif, setModalNotif] = useState(false);
  const [notifNaoLidas, setNotifNaoLidas] = useState(0);
  const [suporteNaoLidos, setSuporteNaoLidos] = useState(0); // badge admin para tópicos de suporte

  // Filtro/sort de vagas (diarista)
  const [modalFiltro, setModalFiltro] = useState(false);
  // Default agora é "feed" (distância → recência → valor) — só altera se o
  // usuário escolher explicitamente no menu de ordenação.
  const [sortVagas, setSortVagas] = useState<"feed"|"recentes"|"proximas"|"menor_valor"|"maior_valor">("feed");
  const [filtroDataVaga, setFiltroDataVaga] = useState<"todas"|"hoje"|"amanha">("todas");
  const [filtroRaioKm, setFiltroRaioKm] = useState<number>(50); // raio máximo de distância
  const [filtroValorMin, setFiltroValorMin] = useState<number>(0); // R$ mínimo (chip 0/100/150/200)
  // Pull-to-refresh — tracking de gesto e estado de loading
  const [puxando, setPuxando] = useState(0);      // px puxados (0–100)
  const [recarregandoFeed, setRecarregandoFeed] = useState(false);
  const ptrStartY = useRef<number | null>(null);

  // Dark mode
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem("diariaja_dark") === "1"; } catch { return false; }
  });

  // Diária recorrente
  const [dirariaRepetir, setDiariaRepetir] = useState<"nao"|"semanal"|"quinzenal">("nao");

  // Editar diária
  const [modalEditarDiaria, setModalEditarDiaria] = useState<Diaria | null>(null);
  const [formEditarDiaria, setFormEditarDiaria] = useState({ descricao:"", horario_inicio:"", horario_fim:"", valor:"" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false); // loading global do saveProfile

  // ── Push Notifications ────────────────────────────────────────────────────
  const { estado: pushEstado, solicitarPermissao: ativarPush } = usePushNotifications(session?.user?.id);

  // Recibo digital
  const [modalRecibo, setModalRecibo] = useState<Diaria | null>(null);
  const [modalPix, setModalPix] = useState<Diaria | null>(null);
  const [modalPagamentoMP, setModalPagamentoMP] = useState<Diaria | null>(null);
  const [criandoPagamento, setCriandoPagamento] = useState(false);
  const [mpOAuthStatus, setMpOAuthStatus] = useState<"idle"|"conectando"|"conectado"|"erro">("idle");
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null);
  const [criandoAssinatura, setCriandoAssinatura] = useState(false);
  const [modalLimiteVagas, setModalLimiteVagas] = useState(false);
  const [modalLimiteContato, setModalLimiteContato] = useState(false);
  const [desbloqueandoContato, setDesbloqueandoContato] = useState(false);
  // Contatos desbloqueados via R$ 1 neste mês (persiste em localStorage)
  const [contatosDesbloqueados, setContatosDesbloqueados] = useState<number>(() => {
    try {
      const chave = "diariaja_contatos_desblo_" + new Date().toISOString().slice(0, 7);
      return parseInt(localStorage.getItem(chave) || "0", 10);
    } catch { return 0; }
  });

  // Novas features v2
  const [modalTermoCiencia, setModalTermoCiencia] = useState<{diaria: Diaria, diaristaId: string} | null>(null);
  const [termoCienciaCheck, setTermoCienciaCheck] = useState(false);
  const [modalTermoDiarista, setModalTermoDiarista] = useState<Diaria | null>(null);
  const [termoDiaristaCheck, setTermoDiaristaCheck] = useState(false);
  const [chatSuporte, setChatSuporte] = useState(false);
  const [msgsSuporte, setMsgsSuporte] = useState<{de: "user"|"bot", texto: string}[]>([{de:"bot", texto:"Olá! 👋 Sou a **Jájá**, assistente virtual do Trampojá. Conheço todo o app e posso te ajudar agora! O que você precisa?"}]);
  const [inputSuporte, setInputSuporte] = useState("");
  const [suporteDigitando, setSuporteDigitando] = useState(false);
  // Histórico no formato Anthropic API (role: user | assistant)
  const historicoSuporteRef = useRef<{role:"user"|"assistant", content:string}[]>([]);
  const [habilidadesExpandidas, setHabilidadesExpandidas] = useState(false);
  const [modalReciboDiarista, setModalReciboDiarista] = useState<Diaria | null>(null);

  // Denúncias
  const [modalDenunciar, setModalDenunciar] = useState<{tipo:"vaga"|"usuario"; id:string; nome:string} | null>(null);
  const [motivoDenuncia, setMotivoDenuncia] = useState("");
  const [enviandoDenuncia, setEnviandoDenuncia] = useState(false);

  // Fila de vagas expiradas sem feedback (empregador é forçado a responder)
  const [vagasExpFeedback, setVagasExpFeedback] = useState<Diaria[]>([]);
  const [motivoExpSelecionado, setMotivoExpSelecionado] = useState<string>("");
  const [motivoExpTexto, setMotivoExpTexto] = useState("");
  const [enviandoFeedbackExp, setEnviandoFeedbackExp] = useState(false);

  // Fila de diárias concluídas sem pesquisa pós (empregador responde)
  const [diariasPosFeedback, setDiariasPosFeedback] = useState<Diaria[]>([]);
  const [posChegouHorario, setPosChegouHorario] = useState<boolean | null>(null);
  const [posNotaQualidade, setPosNotaQualidade] = useState(0);
  const [posRecomendaria, setPosRecomendaria] = useState<boolean | null>(null);
  const [posComentario, setPosComentario] = useState("");
  const [enviandoFeedbackPos, setEnviandoFeedbackPos] = useState(false);

  // Fila de diárias concluídas que o diarista ainda não avaliou o empregador
  const [diariasAvaliarEmp, setDiariasAvaliarEmp] = useState<Diaria[]>([]);
  const [avalEmpNota, setAvalEmpNota]                 = useState(0);
  const [avalEmpPagou, setAvalEmpPagou]               = useState<boolean | null>(null);
  const [avalEmpCumpriu, setAvalEmpCumpriu]           = useState<boolean | null>(null);
  const [avalEmpComentario, setAvalEmpComentario]     = useState("");
  const [enviandoAvalEmpOb, setEnviandoAvalEmpOb]     = useState(false);

  // Reputação dos empregadores indexada por id (cache para os cards de vaga)
  const [reputacaoEmp, setReputacaoEmp] = useState<Record<string, ReputacaoEmpregador>>({});

  // Perfil do empregador aberto pelo diarista (tela "perfil-empregador")
  const [empregadorAberto, setEmpregadorAberto] = useState<UserProfile | null>(null);
  const [avaliacoesEmpAbertas, setAvaliacoesEmpAbertas] = useState<
    { id: string; nota: number; comentario?: string; pagou_combinado?: boolean | null; cumpriu_combinado?: boolean | null; created_at: string; diarista_nome?: string }[]
  >([]);
  const [carregandoEmpAberto, setCarregandoEmpAberto] = useState(false);

  // Não tenho interesse — IDs de vagas ocultas pelo diarista
  const [vagasIgnoradas, setVagasIgnoradas] = useState<Set<string>>(() => {
    try {
      const salvo = localStorage.getItem("diariaja_nao_interesse");
      return salvo ? new Set(JSON.parse(salvo) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  // Contagem de dislikes por diária (para o empregador)
  const [dislikesPorVaga, setDislikesPorVaga] = useState<Record<string, number>>({});

  // Contato liberado após pagamento (Set de convite IDs cujo contato foi desbloqueado)
  const [contatosLiberados, setContatosLiberados] = useState<Set<string>>(new Set());

  // BUG-C1 fix: faqAberta deve estar no topo, não dentro do bloco if(tela==="suporte")
  const [faqAberta, setFaqAberta] = useState<number | null>(null);

  // Portfólio do diarista (até 3 fotos)
  const [portfolioUrls, setPortfolioUrls] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("diariaja_portfolio") || "[]"); } catch { return []; }
  });
  const [uploadingPortfolio, setUploadingPortfolio] = useState(false);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  // Código de indicação / referral
  const [modalIndicar, setModalIndicar] = useState(false);
  const [modalQuemSomos, setModalQuemSomos] = useState(false);

  // Mostrar/ocultar senha nos campos de login e cadastro
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarSenhaCadastro, setMostrarSenhaCadastro] = useState(false);
  const [resetSenhaEnviado, setResetSenhaEnviado] = useState(false);
  const [resetSenhaLoading, setResetSenhaLoading] = useState(false);
  // Modo de login: por email ou por CPF/CNPJ
  const [modoLogin, setModoLogin] = useState<"email"|"cpf">("email");
  const [loginCpfInput, setLoginCpfInput] = useState("");

  // Configurações / Conta
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [alterandoSenha, setAlterandoSenha] = useState(false);
  const [confirmDeleteConta, setConfirmDeleteConta] = useState(false);
  const [deletandoConta, setDeletandoConta] = useState(false);
  const [telefoneVerificado, setTelefoneVerificado] = useState<boolean>(() => {
    try { return localStorage.getItem("diariaja_tel_verif") === "1"; } catch { return false; }
  });
  const [etapaVerifTel, setEtapaVerifTel] = useState<"input"|"codigo">("input");
  const [codigoVerifInput, setCodigoVerifInput] = useState("");
  const [enviandoVerif, setEnviandoVerif] = useState(false);
  // Favoritos (empregador salva diaristas favoritos)
  const [favoritos, setFavoritos] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("diariaja_favoritos") || "[]")); } catch { return new Set<string>(); }
  });
  // Anti-exit aviso no chat
  const [antiExitAviso, setAntiExitAviso] = useState(false);

  // Chat real (empregador ↔ diarista via diária)
  const [diaristasAceites, setDiaristasAceites] = useState<Record<string, UserProfile>>({});
  const [empregadoresProfiles, setEmpregadoresProfiles] = useState<Record<string, UserProfile>>({});
  const [diaristasContagemDiarias, setDiaristasContagemDiarias] = useState<Record<string, number>>({}); // id → qtd concluídas
  const [chatDiariaAtiva, setChatDiariaAtiva] = useState<Diaria | null>(null);
  const [hiddenChats, setHiddenChats] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("diariaja_hidden_chats") || "[]")); } catch { return new Set<string>(); }
  });
  const [confirmExcluirChat, setConfirmExcluirChat] = useState(false);
  const [confirmExcluirDiariaCancelada, setConfirmExcluirDiariaCancelada] = useState<string | null>(null);
  const [confirmCancelarConvite, setConfirmCancelarConvite] = useState<string | null>(null); // convite ID
  const [mensagensReais, setMensagensReais] = useState<{id:string,diaria_id:string,remetente_id:string,destinatario_id:string,conteudo:string,created_at:string,lida_em?:string|null}[]>([]);
  const [msgInputReal, setMsgInputReal] = useState("");
  const [enviandoMsgReal, setEnviandoMsgReal] = useState(false);
  const mensagensEndRef = useRef<HTMLDivElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null); // ref para o input de foto de perfil

  // ── Chat v2: digitando + não-lidas por conversa ────────────────────────────
  // outroDigitando: true se o outro lado está digitando agora (broadcast)
  const [outroDigitando, setOutroDigitando] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingBroadcastRef = useRef<number>(0);
  // Não-lidas indexado por diaria_id (carregado e atualizado em tempo real)
  const [naoLidasPorDiaria, setNaoLidasPorDiaria] = useState<Record<string, number>>({});
  // Ref pra closures lerem o chat ativo atual sem causar re-subscribe
  const chatDiariaAtivaRef = useRef<Diaria | null>(null);
  useEffect(() => { chatDiariaAtivaRef.current = chatDiariaAtiva; }, [chatDiariaAtiva]);

  // Auto-dismiss dos toasts
  useEffect(() => {
    if (!toastSuccess) return;
    const t = setTimeout(() => setToastSuccess(""), 3000);
    setListaNotif(prev => [{ tipo:"ok" as const, msg:toastSuccess, ts:Date.now() }, ...prev].slice(0,30));
    setNotifNaoLidas(prev => prev + 1);
    return () => clearTimeout(t);
  }, [toastSuccess]);
  useEffect(() => {
    if (!toastError) return;
    const t = setTimeout(() => setToastError(""), 4000);
    setListaNotif(prev => [{ tipo:"erro" as const, msg:toastError, ts:Date.now() }, ...prev].slice(0,30));
    setNotifNaoLidas(prev => prev + 1);
    return () => clearTimeout(t);
  }, [toastError]);

  // FIX 2: ref para capturar o tipo atual dentro do closure do onAuthStateChange
  const tipoRef = useRef<string | null>(null);
  const notifHojeEnviadaRef = useRef(false); // evita reenviar notif de "diária hoje" na mesma sessão
  // BUG-H5 fix: ref para acessar diarias atual no closure do Realtime sem declarar dependência
  const diariasRef = useRef<Diaria[]>([]);
  useEffect(() => { diariasRef.current = diarias; }, [diarias]);
  useEffect(() => { tipoRef.current = tipo; }, [tipo]);
  // Persiste o modo atual para sobreviver ao reload da página
  useEffect(() => { localStorage.setItem("diariaja_modo", modoAtual); }, [modoAtual]);
  // Persiste a tela atual para não sair da página ao recarregar
  useEffect(() => { localStorage.setItem("diariaja_tela", tela); }, [tela]);
  // Persiste e aplica dark mode via CSS custom properties + atributo no body
  useEffect(() => {
    localStorage.setItem("diariaja_dark", darkMode ? "1" : "0");
    const r = document.documentElement;
    r.style.setProperty("--bg-app",      darkMode ? "#0f172a" : "#f0f2f5");
    r.style.setProperty("--bg-card",     darkMode ? "#1e293b" : "#ffffff");
    r.style.setProperty("--bg-surface",  darkMode ? "#111827" : "#f8fafc");
    r.style.setProperty("--bg-subtle",   darkMode ? "#1e293b" : "#f1f5f9");
    r.style.setProperty("--text-1",      darkMode ? "#f1f5f9" : "#0f172a");
    r.style.setProperty("--text-2",      darkMode ? "#94a3b8" : "#64748b");
    r.style.setProperty("--text-3",      darkMode ? "#64748b" : "#94a3b8");
    r.style.setProperty("--text-label",  darkMode ? "#94a3b8" : "#475569");
    r.style.setProperty("--border",      darkMode ? "#334155" : "#e2e8f0");
    r.style.setProperty("--border-sub",  darkMode ? "#1e293b" : "#f1f5f9");
    r.style.setProperty("--input-bg",    darkMode ? "#0f172a" : "#ffffff");
    r.style.setProperty("--btn-edit-bg", darkMode ? "#1e293b" : "#f1f5f9");
    r.style.setProperty("--btn-edit-cl", darkMode ? "#94a3b8" : "#475569");
    // Alias legados (componentes que ainda usam os nomes antigos)
    r.style.setProperty("--bg-app",      darkMode ? "#0f172a" : "#f0f2f5");
    r.style.setProperty("--text-primary",   darkMode ? "#f1f5f9" : "#0f172a");
    r.style.setProperty("--text-secondary", darkMode ? "#94a3b8" : "#64748b");
    r.style.setProperty("--border-color",   darkMode ? "#334155" : "#e2e8f0");
    // Aplica no body para que o CSS global do index.html também reaja
    document.body.setAttribute("data-dark", darkMode ? "1" : "0");
    document.body.style.background = darkMode ? "#0f172a" : "#f0f2f5";
  }, [darkMode]);

  // Detecta retorno do OAuth do Mercado Pago e parâmetros de pagamento na URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mpOAuth = params.get("mp_oauth");
    const pagStatus = params.get("pagamento");
    if (mpOAuth === "sucesso") {
      setMpOAuthStatus("conectado");
      setToastSuccess("✅ Conta Mercado Pago conectada com sucesso!");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (mpOAuth === "erro") {
      setMpOAuthStatus("erro");
      setToastError("❌ Erro ao conectar conta MP. Tente novamente.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (pagStatus === "sucesso") {
      const diariaRetornoId = params.get("diaria");
      if (diariaRetornoId) {
        // Atualiza estado local imediatamente — o webhook MP já gravou "pago" no banco
        setDiarias(prev => prev.map(d => d.id === diariaRetornoId ? { ...d, pagamento_status: "pago" } : d));
      }
      setToastSuccess("✅ Pagamento confirmado via Mercado Pago! O chat foi liberado.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (pagStatus === "falha") {
      setToastError("❌ Pagamento não aprovado. Tente novamente.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (pagStatus === "pendente") {
      setToastSuccess("⏳ Pagamento em processamento. O chat será liberado assim que confirmado.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    const assinaturaStatus = params.get("assinatura");
    if (assinaturaStatus === "sucesso") {
      setToastSuccess("🎉 Assinatura ativada! Aproveite seu plano.");
      window.history.replaceState({}, "", window.location.pathname);
      // Recarrega assinatura do banco
      if (session?.user?.id) {
        supabase.from("assinaturas").select("*").eq("user_id", session.user.id).eq("status", "ativo").maybeSingle()
          .then(({ data }) => setAssinatura(data || null));
      }
    }
  // BUG-M5 fix: inclui session.user.id para reprocessar quando sessão carrega após redirect OAuth
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Diaristas reais: IDs negativos = índice no array (via ref)
  const handleDiaristaClick = useCallback((id: number) => {
    const realIdx = (-id) - 1;
    const d = diaristasReaisRef.current[realIdx];
    if (d) { setDiaristaSelecionadaReal(d); setModalContratoReal(false); setContratadoReal(false); setTela("perfil-diarista-real"); }
  }, []);

  // Redireciona para escolha-negocio SOMENTE se nem o estado nem o perfil têm segmento
  useEffect(() => {
    if (tela === "home-empregador" && !negocioSelecionado && !profile?.segmento) {
      setTela("escolha-negocio");
    }
  }, [tela, negocioSelecionado, profile]);

  // Carrega diaristas reais cadastrados no banco
  useEffect(() => {
    if (tela !== "home-empregador" || !session?.user) return;
    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_type", "diarista");
      if (data) {
        setDiaristasReais(data);
        diaristasReaisRef.current = data;
      }
    })();
  }, [tela, session?.user?.id]);

  // Carrega as diárias do empregador ao entrar na home
  useEffect(() => {
    if (tela !== "home-empregador" || !session?.user) return;
    (async () => {
      const { data } = await supabase
        .from("diarias")
        .select("*")
        .eq("empregador_id", session.user!.id)
        .neq("status", "cancelada")
        .order("created_at", { ascending: false });
      if (data) {
        // ── Auto-expira vagas que passaram do horário_fim ──────────────────
        const venceram = data.filter((d: any) => vagaExpirou(d));
        if (venceram.length > 0) {
          await supabase
            .from("diarias")
            .update({ status: "expirada" })
            .in("id", venceram.map((d: any) => d.id))
            .eq("empregador_id", session.user!.id);
          venceram.forEach((d: any) => { d.status = "expirada"; });
        }

        setDiarias(data);

        // ── Monta as filas de feedback pendente ────────────────────────────
        const expiradas = data.filter((d: any) => d.status === "expirada");
        const concluidas = data.filter((d: any) => d.status === "concluida");

        if (expiradas.length > 0) {
          const { data: jaResp } = await supabase
            .from("feedback_vaga_expirada")
            .select("diaria_id")
            .in("diaria_id", expiradas.map((d: any) => d.id));
          const respondidas = new Set((jaResp ?? []).map((r: any) => r.diaria_id));
          setVagasExpFeedback(expiradas.filter((d: any) => !respondidas.has(d.id)));
        }

        if (concluidas.length > 0) {
          const { data: jaResp } = await supabase
            .from("feedback_pos_conclusao")
            .select("diaria_id")
            .in("diaria_id", concluidas.map((d: any) => d.id));
          const respondidas = new Set((jaResp ?? []).map((r: any) => r.diaria_id));
          setDiariasPosFeedback(concluidas.filter((d: any) => !respondidas.has(d.id)));
        }

        // Carrega candidaturas das diárias do empregador
        const ids = data.map((d:any) => d.id);
        if (ids.length > 0) {
          const { data: cands } = await supabase.from("candidaturas").select("*").in("diaria_id", ids);
          if (cands && cands.length > 0) {
            setCandidaturas(cands);
            const dids = [...new Set(cands.map((c:any) => c.diarista_id))];
            const { data: profs } = await supabase.from("user_profiles").select("*").in("id", dids);
            if (profs) { const m: Record<string,UserProfile> = {}; profs.forEach((p:any) => { m[p.id] = p; }); setCandidatosProfiles(m); }
          }
          // Carrega contagem de dislikes por vaga
          carregarDislikesPorVaga(ids);
        }
      }
    })();
  }, [tela, session?.user?.id]);

  // ── Envio de feedback de vaga expirada (modal obrigatório) ──────────────────
  const enviarFeedbackVagaExpirada = async () => {
    if (!session?.user || vagasExpFeedback.length === 0 || !motivoExpSelecionado) return;
    if (motivoExpSelecionado === "outro" && !motivoExpTexto.trim()) {
      setToastError("Descreva brevemente o motivo.");
      return;
    }
    const vaga = vagasExpFeedback[0];
    setEnviandoFeedbackExp(true);
    const { error } = await supabase.from("feedback_vaga_expirada").insert({
      diaria_id:        vaga.id,
      empregador_id:    session.user.id,
      motivo_categoria: motivoExpSelecionado,
      motivo_texto:     motivoExpTexto.trim() || null,
    });
    setEnviandoFeedbackExp(false);
    if (error) { setToastError("Erro: " + error.message); return; }
    trackEvento("feedback_vaga_expirada", session.user.id, "empregador", {
      diaria_id: vaga.id, motivo: motivoExpSelecionado,
    });
    setVagasExpFeedback(prev => prev.slice(1));
    setMotivoExpSelecionado("");
    setMotivoExpTexto("");
  };

  // ── Envio de pesquisa pós-conclusão (modal obrigatório) ─────────────────────
  const enviarFeedbackPosConclusao = async () => {
    if (!session?.user || diariasPosFeedback.length === 0) return;
    if (posChegouHorario === null) { setToastError("Informe se o profissional chegou no horário."); return; }
    if (posNotaQualidade === 0)    { setToastError("Dê uma nota de qualidade (1 a 5)."); return; }
    if (posRecomendaria === null)  { setToastError("Informe se você recomendaria o profissional."); return; }
    const diaria = diariasPosFeedback[0];
    setEnviandoFeedbackPos(true);
    const { error } = await supabase.from("feedback_pos_conclusao").insert({
      diaria_id:         diaria.id,
      empregador_id:     session.user.id,
      chegou_no_horario: posChegouHorario,
      nota_qualidade:    posNotaQualidade,
      recomendaria:      posRecomendaria,
      comentario:        posComentario.trim() || null,
    });
    setEnviandoFeedbackPos(false);
    if (error) { setToastError("Erro: " + error.message); return; }
    trackEvento("feedback_pos_conclusao", session.user.id, "empregador", {
      diaria_id: diaria.id, nota: posNotaQualidade, recomendaria: posRecomendaria, no_horario: posChegouHorario,
    });
    setDiariasPosFeedback(prev => prev.slice(1));
    setPosChegouHorario(null);
    setPosNotaQualidade(0);
    setPosRecomendaria(null);
    setPosComentario("");
  };

  // Loader do feed do diarista — extraído pra ser reutilizável pelo pull-to-refresh
  const carregarFeedVagas = useCallback(async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from("diarias")
      .select("*")
      .eq("status", "aberta")
      .neq("empregador_id", session.user.id) // BUG-M8 fix: usuário "ambos" não vê suas próprias vagas
      .order("created_at", { ascending: false });
      if (data) {
        const ids = data.map((d: any) => d.id);
        // Conta candidaturas pendentes por vaga para ocultar vagas lotadas
        let lotadas = new Set<string>();
        if (ids.length > 0) {
          const { data: conts } = await supabase
            .from("candidaturas")
            .select("diaria_id")
            .in("diaria_id", ids)
            .eq("status", "pendente");
          if (conts) {
            const contMap: Record<string, number> = {};
            conts.forEach((c: any) => { contMap[c.diaria_id] = (contMap[c.diaria_id] || 0) + 1; });
            lotadas = new Set(Object.entries(contMap).filter(([, n]) => n >= MAX_INTERESSADOS).map(([id]) => id));
          }
        }
        setVagasReais(data.filter((d: any) => !lotadas.has(d.id)));
        // Carrega perfis dos empregadores para exibir foto no card
        const empIds = [...new Set(data.map((d: any) => d.empregador_id).filter(Boolean))];
        if (empIds.length > 0) {
          const { data: emps } = await supabase.from("user_profiles").select("id, nome, foto_url, segmento").in("id", empIds);
          if (emps && emps.length > 0) {
            const m: Record<string, any> = {};
            emps.forEach((p: any) => { m[p.id] = p; });
            setEmpregadoresProfiles(prev => ({ ...prev, ...m }));
          }
          // Reputação pública dos empregadores (média + % pagou/cumpriu)
          const { data: reps } = await supabase
            .from("reputacao_empregadores")
            .select("*")
            .in("empregador_id", empIds);
          if (reps) {
            const rm: Record<string, ReputacaoEmpregador> = {};
            reps.forEach((r: any) => { rm[r.empregador_id] = r; });
            setReputacaoEmp(prev => ({ ...prev, ...rm }));
          }
        }
      }
  }, [session?.user?.id]);

  useEffect(() => {
    if (tela !== "home-diarista") return;
    carregarFeedVagas();
  }, [tela, carregarFeedVagas]);

  // Carrega as diárias aceitas/concluídas do próprio diarista
  useEffect(() => {
    if (tela !== "home-diarista" || !session?.user) return;
    (async () => {
      const { data } = await supabase
        .from("diarias")
        .select("*")
        .eq("diarista_aceite_id", session.user!.id)
        .in("status", ["pendente", "aceita", "em_andamento", "concluida", "cancelada"])
        .order("data", { ascending: false });
      if (data) {
        setMinhasDiarias(data);
        // Registra timestamp de cancelamento para as já canceladas que ainda não têm registro local
        // (garante que diárias canceladas em sessões anteriores também entrem no filtro de 24h)
        const agora = Date.now();
        try {
          const cancels: Record<string,number> = JSON.parse(localStorage.getItem("diariaja_cancels") || "{}");
          let mudou = false;
          data.filter((d: any) => d.status === "cancelada").forEach((d: any) => {
            if (!cancels[d.id]) { cancels[d.id] = agora; mudou = true; }
          });
          // Limpa entradas com mais de 48h para não crescer indefinidamente
          Object.keys(cancels).forEach(id => { if (agora - cancels[id] > 48 * 60 * 60 * 1000) { delete cancels[id]; mudou = true; } });
          if (mudou) localStorage.setItem("diariaja_cancels", JSON.stringify(cancels));
        } catch {}
      }
      // Carrega interesses/candidaturas do diarista para saber quais vagas já sinalizou
      const { data: ints } = await supabase.from("candidaturas").select("diaria_id, status").eq("diarista_id", session.user!.id);
      if (ints) { const m: Record<string,string> = {}; ints.forEach((i:any) => { m[i.diaria_id] = i.status; }); setMeuInteresse(m); }

      // Carrega quais diárias o diarista já avaliou
      const { data: jaAvaliou } = await supabase
        .from("avaliacoes_empregador")
        .select("diaria_id")
        .eq("diarista_id", session.user!.id);
      const idsAvaliados = new Set((jaAvaliou ?? []).map((r: any) => r.diaria_id));
      if (jaAvaliou) setAvaliadosDiarias(idsAvaliados);

      // ── Fila obrigatória: avaliar empregador em diárias concluídas ────────
      if (data) {
        const aAvaliar = data.filter(
          (d: any) => d.status === "concluida" && !idsAvaliados.has(d.id),
        );
        setDiariasAvaliarEmp(aAvaliar);

        // ── Notifica diárias em que o diarista foi selecionado e expiraram ──
        const expiradasMinhas = data.filter((d: any) => d.status === "expirada");
        if (expiradasMinhas.length > 0) {
          const chave = "diariaja_exp_avisadas";
          let avisadas: string[] = [];
          try { avisadas = JSON.parse(localStorage.getItem(chave) || "[]"); } catch {}
          const novas = expiradasMinhas.filter((d: any) => !avisadas.includes(d.id));
          if (novas.length > 0) {
            setToastError(
              novas.length === 1
                ? `⏰ Sua vaga em ${novas[0].nome_negocio || novas[0].segmento} expirou — o empregador não confirmou sua chegada.`
                : `⏰ ${novas.length} vagas suas expiraram — empregadores não confirmaram chegada.`,
            );
            try { localStorage.setItem(chave, JSON.stringify([...avisadas, ...novas.map((d: any) => d.id)])); } catch {}
          }
        }
      }
    })();
  }, [tela, session?.user?.id]);

  // ── Carrega avaliações detalhadas quando o diarista abre o perfil do empregador
  useEffect(() => {
    if (tela !== "perfil-empregador" || !empregadorAberto) return;
    setCarregandoEmpAberto(true);
    (async () => {
      // Avaliações com nome do diarista que avaliou (sem revelar contato)
      const { data: avs } = await supabase
        .from("avaliacoes_empregador")
        .select("id, nota, comentario, pagou_combinado, cumpriu_combinado, created_at, diarista_id")
        .eq("empregador_id", empregadorAberto.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (avs) {
        // Busca nomes dos diaristas que avaliaram
        const dids = [...new Set(avs.map((a: any) => a.diarista_id).filter(Boolean))];
        let nomes: Record<string, string> = {};
        if (dids.length > 0) {
          const { data: profs } = await supabase
            .from("user_profiles")
            .select("id, nome")
            .in("id", dids);
          (profs ?? []).forEach((p: any) => { nomes[p.id] = p.nome; });
        }
        setAvaliacoesEmpAbertas(
          avs.map((a: any) => ({ ...a, diarista_nome: nomes[a.diarista_id] || "Diarista" })),
        );
      }
      // Carrega reputação agregada se ainda não estiver em cache
      if (!reputacaoEmp[empregadorAberto.id]) {
        const { data: rep } = await supabase
          .from("reputacao_empregadores")
          .select("*")
          .eq("empregador_id", empregadorAberto.id)
          .maybeSingle();
        if (rep) setReputacaoEmp(prev => ({ ...prev, [empregadorAberto.id]: rep }));
      }
      setCarregandoEmpAberto(false);
    })();
  }, [tela, empregadorAberto?.id]);

  // Abre a tela do perfil do empregador (diarista clica num card de vaga)
  const abrirPerfilEmpregador = async (empregadorId: string) => {
    if (!empregadorId) return;
    showLoadingBar();
    const cache = empregadoresProfiles[empregadorId];
    if (cache && cache.nome) {
      setEmpregadorAberto(cache as UserProfile);
      setTela("perfil-empregador");
      hideLoadingBar();
      return;
    }
    const { data } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", empregadorId)
      .maybeSingle();
    hideLoadingBar();
    if (data) {
      setEmpregadoresProfiles(prev => ({ ...prev, [empregadorId]: data }));
      setEmpregadorAberto(data);
      setTela("perfil-empregador");
    } else {
      setToastError("Não foi possível carregar o perfil do contratante.");
    }
  };

  // ── Envia a avaliação obrigatória do empregador (modal full-screen) ────────
  const enviarAvaliacaoEmpObrigatoria = async () => {
    if (!session?.user || diariasAvaliarEmp.length === 0) return;
    if (avalEmpNota === 0)           { setToastError("Dê uma nota de 1 a 5 estrelas."); return; }
    if (avalEmpPagou === null)       { setToastError("Informe se o empregador pagou o combinado."); return; }
    if (avalEmpCumpriu === null)     { setToastError("Informe se o empregador cumpriu o combinado."); return; }
    const diaria = diariasAvaliarEmp[0];
    setEnviandoAvalEmpOb(true);
    const { error } = await supabase.from("avaliacoes_empregador").insert({
      diarista_id:       session.user.id,
      empregador_id:     diaria.empregador_id,
      diaria_id:         diaria.id,
      nota:              avalEmpNota,
      pagou_combinado:   avalEmpPagou,
      cumpriu_combinado: avalEmpCumpriu,
      comentario:        avalEmpComentario.trim() || null,
    });
    setEnviandoAvalEmpOb(false);
    if (error) { setToastError("Erro: " + error.message); return; }
    trackEvento("avaliacao_enviada", session.user.id, "diarista", {
      tipo: "empregador", nota: avalEmpNota, pagou: avalEmpPagou, cumpriu: avalEmpCumpriu,
    });
    setAvaliadosDiarias(prev => new Set([...prev, diaria.id]));
    setDiariasAvaliarEmp(prev => prev.slice(1));
    setAvalEmpNota(0);
    setAvalEmpPagou(null);
    setAvalEmpCumpriu(null);
    setAvalEmpComentario("");
  };

  // Carrega avaliações do diarista real ao abrir o perfil dele
  // E também recarrega os convites enviados para garantir status atualizado
  useEffect(() => {
    if (tela !== "perfil-diarista-real" || !diaristaSelecionadaReal) return;
    setAvaliacoesDiaristaReal([]);
    (async () => {
      const { data } = await supabase
        .from("avaliacoes_diarista")
        .select("id, nota, comentario, created_at")
        .eq("diarista_id", diaristaSelecionadaReal.id)
        .order("created_at", { ascending: false });
      if (data) setAvaliacoesDiaristaReal(data);
    })();
    // Recarrega convites para exibir status atualizado no botão
    if (session?.user) carregarConvites(session.user.id, "empregador");
  }, [tela, diaristaSelecionadaReal?.id]);

  // Carrega média de avaliação do próprio empregador logado (para mostrar no perfil)
  useEffect(() => {
    if (tela !== "home-empregador" || !session?.user) return;
    (async () => {
      const { data } = await supabase
        .from("avaliacoes_empregador")
        .select("nota")
        .eq("empregador_id", session.user!.id);
      if (data && data.length > 0) {
        const media = data.reduce((s: number, r: any) => s + r.nota, 0) / data.length;
        setMediaEmpregadorPerfil(media);
      }
      // Carrega quais diárias o empregador já avaliou
      const { data: jaAvaliou } = await supabase
        .from("avaliacoes_diarista")
        .select("diaria_id")
        .eq("empregador_id", session.user!.id);
      if (jaAvaliou) setAvaliadosDiarias(new Set(jaAvaliou.map((r: any) => r.diaria_id)));
    })();
  }, [tela, session?.user?.id]);

  // perfil-diarista (mock) removido — useEffect de avaliações do mock também removido

  // ── Notificações ──────────────────────────────────────────────────────────

  // 1) Pede permissão de notificação ao browser assim que o usuário loga
  useEffect(() => {
    if (!session?.user) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [session?.user?.id]);

  // 2) Notifica diarista quando chega o dia de uma diária agendada
  useEffect(() => {
    if (!session?.user || modoAtual !== "diarista") return;
    if (minhasDiarias.length === 0) return;
    if (notifHojeEnviadaRef.current) return; // só uma vez por sessão
    const hoje = new Date().toISOString().split("T")[0];
    const diariastHoje = minhasDiarias.filter(
      d => d.data === hoje && (d.status === "aceita" || d.status === "em_andamento")
    );
    if (diariastHoje.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
      notifHojeEnviadaRef.current = true;
      diariastHoje.forEach(d => {
        new Notification("📅 Você tem uma diária hoje!", {
          body: `${d.nome_negocio} às ${d.horario_inicio}`,
          icon: "/vite.svg",
        });
      });
    }
  }, [minhasDiarias, tipo, session?.user?.id]);

  // 3) Supabase Realtime — notifica quando chega nova mensagem
  useEffect(() => {
    if (!session?.user || !modoAtual) return;
    const userId = session.user.id;

    const channel = supabase
      .channel(`msgs-notif-${userId}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "mensagens" },
        (payload: any) => {
          const msg = payload.new;
          const paraMim = msg.destinatario_id === userId;
          if (!paraMim) return;
          setMsgNaoLidas(prev => prev + 1);
          // Não-lidas por conversa — só conta se a conversa NÃO está aberta
          if (msg.diaria_id && msg.diaria_id !== chatDiariaAtivaRef.current?.id) {
            setNaoLidasPorDiaria(prev => ({ ...prev, [msg.diaria_id]: (prev[msg.diaria_id] || 0) + 1 }));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]);

  // 4) Realtime: empregador é avisado em tempo real quando diarista aceita a vaga
  useEffect(() => {
    if (!session?.user || modoAtual !== "empregador") return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`diarias-emp-${userId}`)
      .on("postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "diarias", filter: `empregador_id=eq.${userId}` },
        (payload: any) => {
          const updated = payload.new as Diaria;
          // Atualiza lista local em tempo real; ignora se a diária já foi removida (ex: durante exclusão)
          setDiarias(prev => {
            const existe = prev.some(d => d.id === updated.id);
            if (!existe) return prev; // diária já excluída localmente — não reinsere
            return prev.map(d => d.id === updated.id ? updated : d);
          });
          const oldStatus = payload.old?.status;
          const vaga = updated.funcao || updated.segmento;
          const motivo = updated.motivo_cancelamento ? ` Motivo: ${updated.motivo_cancelamento}` : "";
          // Dispara alertaAceite quando diarista confirma (aceita = confirmou, aguarda QR)
          if (updated.status === "aceita" && oldStatus === "pendente") setAlertaAceite(updated);
          // Realtime: webhook MP confirmou pagamento → desbloqueia chat automaticamente
          if (updated.pagamento_status === "pago" && payload.old?.pagamento_status !== "pago") {
            setToastSuccess(`✅ Pagamento confirmado pelo Mercado Pago! O chat com o diarista foi liberado.`);
          }
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            if (updated.status === "aceita" && oldStatus === "pendente") {
              new Notification("✅ Diarista confirmou presença!", {
                body: `O profissional confirmou presença na vaga de ${vaga}. Escaneie o QR Code dele!`,
                icon: "/vite.svg",
              });
            } else if (updated.status === "aceita" && oldStatus === "aberta") {
              new Notification("🎉 Diarista confirmado!", {
                body: `Alguém aceitou sua vaga de ${vaga}!`,
                icon: "/vite.svg",
              });
            } else if (updated.status === "aberta" && oldStatus === "aceita") {
              // Diarista desistiu — vaga voltou a ser aberta
              new Notification("⚠️ Diarista desistiu!", {
                body: `O diarista desistiu da vaga de ${vaga}. Ela está disponível novamente.${motivo}`,
                icon: "/vite.svg",
              });
            } else if (updated.status === "cancelada" && oldStatus !== "cancelada") {
              new Notification("❌ Diária cancelada pelo diarista", {
                body: `A vaga de ${vaga} foi cancelada.${motivo}`,
                icon: "/vite.svg",
              });
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]);

  // 5) Realtime: diarista recebe notificação quando empregador confirma chegada ou conclui
  useEffect(() => {
    if (!session?.user || modoAtual !== "diarista") return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`diarias-diar-${userId}`)
      .on("postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "diarias" },
        (payload: any) => {
          const updated = payload.new as Diaria;
          if (updated.diarista_aceite_id !== userId) return;
          // Atualiza minhasDiarias em tempo real
          setMinhasDiarias(prev =>
            prev.map(d => d.id === updated.id ? updated : d)
          );
          if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
          const local = updated.nome_negocio || updated.segmento;
          const oldSt = payload.old?.status;
          if (updated.status === "pendente" && oldSt !== "pendente" && updated.diarista_aceite_id === session?.user?.id) {
            // Diarista foi escolhido pelo empregador (status pendente = aguardando confirmação do diarista)
            setMinhasDiarias(prev => prev.some(d => d.id === updated.id) ? prev.map(d => d.id === updated.id ? updated : d) : [...prev, updated]);
            setMeuInteresse(prev => ({ ...prev, [updated.id]: "pendente" }));
            // BUG-3 fix: toast in-app garantido independente de permissão de push
            setToastSuccess(`🎯 ${local} escolheu você! Vá em "Vagas" e confirme sua presença.`);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("🎯 Você foi selecionado!", {
                body: `${local} escolheu você para a vaga! Abra o app e confirme sua presença.`,
                icon: "/vite.svg",
              });
            }
          } else if (updated.status === "em_andamento") {
            // BUG-5 fix: toast in-app quando empregador confirma chegada via QR
            setToastSuccess(`🔄 Sua chegada foi confirmada em ${local}. Bom trabalho!`);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("🔄 Chegada confirmada!", {
                body: `Sua presença em ${local} foi confirmada. Bom trabalho!`,
                icon: "/vite.svg",
              });
            }
          } else if (updated.status === "cancelada" && oldSt !== "cancelada") {
            // Salva timestamp de cancelamento para auto-sumir após 24h
            try {
              const cancels = JSON.parse(localStorage.getItem("diariaja_cancels") || "{}");
              cancels[updated.id] = Date.now();
              localStorage.setItem("diariaja_cancels", JSON.stringify(cancels));
            } catch {}
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("❌ Diária cancelada pelo empregador", {
                body: `Sua diária em ${local} foi cancelada.${updated.motivo_cancelamento ? " Motivo: " + updated.motivo_cancelamento : ""}`,
                icon: "/vite.svg",
              });
            }
            setToastError(`❌ Diária em ${local} foi cancelada pelo empregador.${updated.motivo_cancelamento ? " Motivo: " + updated.motivo_cancelamento : ""}`);
          } else if (updated.status === "concluida") {
            // Auto-abre recibo do diarista após conclusão
            setToastSuccess(`🎉 Diária concluída em ${local}! Gere seu recibo e avalie o contratante.`);
            setTimeout(() => setModalReciboDiarista(updated), 500);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("🎉 Diária concluída!", {
                body: `Sua diária em ${local} foi encerrada. Avalie o empregador!`,
                icon: "/vite.svg",
              });
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]);

  // 6) Realtime: empregador recebe nova candidatura em tempo real
  useEffect(() => {
    if (!session?.user || modoAtual !== "empregador") return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`candidaturas-emp-${userId}`)
      .on("postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "candidaturas" },
        async (payload: any) => {
          const c = payload.new;
          // BUG-H5 fix: usa ref para não recriar o canal a cada mudança de diarias
          const minhasDiariasIds = diariasRef.current.map(d => d.id);
          if (!minhasDiariasIds.includes(c.diaria_id)) return;
          setCandidaturas(prev => [...prev, c]);
          // Carrega perfil do candidato
          const { data } = await supabase.from("user_profiles").select("*").eq("id", c.diarista_id).single();
          if (data) setCandidatosProfiles(prev => ({ ...prev, [c.diarista_id]: data }));
          // BUG-2 fix: toast in-app independente da permissão de push
          const vaga = diariasRef.current.find(d => d.id === c.diaria_id);
          const nomeVaga = vaga?.funcao || vaga?.segmento || "sua vaga";
          setToastSuccess(`👋 Novo candidato na vaga de ${nomeVaga}! Toque em "Diárias" para ver.`);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("👋 Novo candidato!", {
              body: `Um diarista demonstrou interesse na sua vaga de ${nomeVaga}!`,
              icon: "/vite.svg",
            });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]); // BUG-H5 fix: removido 'diarias' das deps

  // Sempre que o modal de candidatos abre, garante que os perfis de todos os candidatos estão carregados
  useEffect(() => {
    if (!modalCandidatos) return;
    const cands = candidaturas.filter(c => c.diaria_id === modalCandidatos.id && c.status === "pendente");
    const faltando = cands.map(c => c.diarista_id).filter(id => !candidatosProfiles[id]);
    if (faltando.length === 0) return;
    (async () => {
      const { data: profs } = await supabase.from("user_profiles").select("*").in("id", faltando);
      if (profs && profs.length > 0) {
        setCandidatosProfiles(prev => {
          const m = { ...prev };
          profs.forEach((p: any) => { m[p.id] = p; });
          return m;
        });
      }
    })();
  }, [modalCandidatos]);

  // 7) Realtime: diarista recebe notificação quando sua candidatura é cancelada (vaga excluída pelo empregador)
  useEffect(() => {
    if (!session?.user || modoAtual !== "diarista") return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`candidaturas-cancel-${userId}`)
      .on("postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "candidaturas", filter: `diarista_id=eq.${userId}` },
        (payload: any) => {
          const updated = payload.new;
          const oldStatus = payload.old?.status;
          if (updated.status === "cancelada" && oldStatus !== "cancelada") {
            // Remove o interesse local para que a vaga não apareça com estado preso
            setMeuInteresse(prev => { const n = { ...prev }; delete n[updated.diaria_id]; return n; });
            setToastError("⚠️ Uma vaga na qual você tinha interesse foi cancelada pelo empregador.");
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("❌ Vaga cancelada pelo empregador", {
                body: "Uma diária na qual você tinha interesse foi removida. Verifique as vagas disponíveis.",
                icon: "/vite.svg",
              });
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]);

  // 8) Realtime: diarista recebe novo convite direto (notificação ao vivo)
  useEffect(() => {
    if (!session?.user || modoAtual !== "diarista") return;
    const userId = session.user.id;
    // Carrega convites já existentes
    carregarConvites(userId, "diarista");
    const channel = supabase
      .channel(`convites-diar-${userId}`)
      .on("postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "convites", filter: `diarista_id=eq.${userId}` },
        (payload: any) => {
          const novoConvite: Convite = payload.new;
          setConvitesRecebidos(prev => [novoConvite, ...prev]);
          setToastSuccess(`📨 ${novoConvite.contratante_nome || "Um contratante"} te convidou para uma diária!`);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("📨 Novo convite de diária!", {
              body: `${novoConvite.contratante_nome} quer te contratar para ${novoConvite.funcao} em ${new Date(novoConvite.data_servico + "T00:00:00").toLocaleDateString("pt-BR")}`,
              icon: "/vite.svg",
            });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]);

  // 9) Realtime: contratante é notificado quando diarista responde ao convite
  useEffect(() => {
    if (!session?.user || modoAtual !== "empregador") return;
    const userId = session.user.id;
    // Carrega convites enviados
    carregarConvites(userId, "empregador");
    const channel = supabase
      .channel(`convites-emp-${userId}`)
      .on("postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "convites", filter: `contratante_id=eq.${userId}` },
        (payload: any) => {
          const updated: Convite = payload.new;
          setConvitesEnviados(prev => prev.map(c => c.id === updated.id ? updated : c));
          if (updated.status === "aceito") {
            setToastSuccess(`✅ ${updated.diarista_nome} aceitou seu convite para ${new Date(updated.data_servico + "T00:00:00").toLocaleDateString("pt-BR")}!`);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("✅ Convite aceito!", {
                body: `${updated.diarista_nome} confirmou presença para ${new Date(updated.data_servico + "T00:00:00").toLocaleDateString("pt-BR")} às ${updated.horario_servico}`,
                icon: "/vite.svg",
              });
            }
          } else if (updated.status === "recusado") {
            setToastError(`❌ ${updated.diarista_nome} não pôde ir para ${new Date(updated.data_servico + "T00:00:00").toLocaleDateString("pt-BR")}.`);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, modoAtual]);

  // 10) Realtime: admin recebe notificação quando alguém posta tópico de suporte
  useEffect(() => {
    if (!session?.user || !profile?.is_admin) return;
    const channel = supabase
      .channel(`suporte-admin-${session.user.id}`)
      .on("postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "topicos" },
        (payload: any) => {
          const t: Topico = payload.new;
          if (t.categoria === "suporte") {
            setSuporteNaoLidos(prev => prev + 1);
            setToastSuccess(`🔧 Novo pedido de suporte de ${t.autor_nome}!`);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("🔧 Novo pedido de suporte!", {
                body: `${t.autor_nome}: "${t.titulo}"`,
                icon: "/vite.svg",
              });
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, profile?.is_admin]);

  // Carrega perfis dos diaristas que aceitaram as diárias do empregador
  useEffect(() => {
    if (!diarias.length) return;
    const ids = [...new Set(diarias.filter(d => d.diarista_aceite_id).map(d => d.diarista_aceite_id!))];
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase.from("user_profiles").select("*").in("id", ids);
      if (data) {
        const map: Record<string, UserProfile> = {};
        data.forEach((p: UserProfile) => { map[p.id] = p; });
        setDiaristasAceites(prev => ({ ...prev, ...map }));
      }
      // Conta diárias concluídas de cada diarista
      for (const id of ids) {
        const { count } = await supabase.from("diarias")
          .select("id", { count: "exact", head: true })
          .eq("diarista_aceite_id", id)
          .eq("status", "concluida");
        if (count !== null) setDiaristasContagemDiarias(prev => ({ ...prev, [id]: count }));
      }
    })();
  }, [diarias]);

  // BUG-FIX: Quando o modal PIX abre de um Convite, busca o perfil do diarista se ainda não está em cache
  // Convite usa diarista_id; Diaria usa diarista_aceite_id
  useEffect(() => {
    if (!modalPix) return;
    const id = (modalPix as any).diarista_aceite_id || (modalPix as any).diarista_id;
    if (!id || diaristasAceites[id]) return; // já carregado
    supabase.from("user_profiles").select("*").eq("id", id).single()
      .then(({ data }) => {
        if (data) setDiaristasAceites(prev => ({ ...prev, [id]: data as UserProfile }));
      });
  }, [modalPix]);

  // Carrega mensagens do chat ativo + marca como lidas as do destinatário=eu
  useEffect(() => {
    if (!chatDiariaAtiva || !session?.user) return;
    const userId = session.user.id;
    const diariaId = chatDiariaAtiva.id;
    (async () => {
      const { data } = await supabase
        .from("mensagens")
        .select("*")
        .eq("diaria_id", diariaId)
        .order("created_at", { ascending: true });
      if (data) setMensagensReais(data);
      setTimeout(() => mensagensEndRef.current?.scrollIntoView(), 100);

      // Marca como lidas todas as que eu recebi nessa conversa
      await supabase
        .from("mensagens")
        .update({ lida_em: new Date().toISOString() })
        .eq("diaria_id", diariaId)
        .eq("destinatario_id", userId)
        .is("lida_em", null);
      // Zera contagem local dessa conversa
      setNaoLidasPorDiaria(prev => {
        if (!prev[diariaId]) return prev;
        const next = { ...prev }; delete next[diariaId];
        return next;
      });
    })();
  }, [chatDiariaAtiva?.id, session?.user?.id]);

  // Realtime: novas mensagens no chat ativo + UPDATE de lida_em (✓✓)
  useEffect(() => {
    if (!chatDiariaAtiva || !session?.user) return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`mensagens-${chatDiariaAtiva.id}`)
      .on("postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "mensagens", filter: `diaria_id=eq.${chatDiariaAtiva.id}` },
        (payload: any) => {
          const nova = payload.new;
          if (nova.remetente_id === userId) return; // já adicionada otimisticamente
          setMensagensReais(prev => [...prev, nova]);
          setTimeout(() => mensagensEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          // Como o chat está aberto, marca a recebida como lida na hora
          supabase.from("mensagens").update({ lida_em: new Date().toISOString() }).eq("id", nova.id);
        },
      )
      .on("postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "mensagens", filter: `diaria_id=eq.${chatDiariaAtiva.id}` },
        (payload: any) => {
          const upd = payload.new;
          // Atualiza lida_em na minha mensagem (mostra ✓✓ do meu lado)
          setMensagensReais(prev => prev.map(m => m.id === upd.id ? { ...m, lida_em: upd.lida_em } : m));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatDiariaAtiva?.id, session?.user?.id]);

  // ── Realtime: canal de "digitando..." (broadcast presence-style) ────────────
  useEffect(() => {
    if (!chatDiariaAtiva || !session?.user) return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`typing-${chatDiariaAtiva.id}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (msg: any) => {
        if (msg.payload?.user_id === userId) return;
        setOutroDigitando(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setOutroDigitando(false), 2800);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setOutroDigitando(false);
    };
  }, [chatDiariaAtiva?.id, session?.user?.id]);

  // Helper chamado no onChange do input — emite "typing" no máx 1×/2s
  const sinalizarDigitando = useCallback(() => {
    if (!chatDiariaAtiva || !session?.user || !typingChannelRef.current) return;
    const agora = Date.now();
    if (agora - lastTypingBroadcastRef.current < 2000) return;
    lastTypingBroadcastRef.current = agora;
    typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: session.user.id },
    });
  }, [chatDiariaAtiva?.id, session?.user?.id]);

  // ── Carrega contagem de não-lidas POR conversa quando entra na aba chat ─────
  useEffect(() => {
    if (!session?.user) return;
    if (tabEmpregador !== "chat" && tabDiarista !== "chat") return;
    const userId = session.user.id;
    (async () => {
      const { data } = await supabase
        .from("mensagens")
        .select("diaria_id")
        .eq("destinatario_id", userId)
        .is("lida_em", null);
      if (data) {
        const cont: Record<string, number> = {};
        for (const m of data) cont[m.diaria_id] = (cont[m.diaria_id] || 0) + 1;
        setNaoLidasPorDiaria(cont);
      }
    })();
  }, [tabEmpregador, tabDiarista, session?.user?.id]);

  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Timeout de segurança: se após 12s o loading ainda estiver ativo, desbloqueie
    const safetyTimer = setTimeout(() => {
      setLoading(prev => { if (prev) { setTela("splash"); } return false; });
    }, 12000);

    // ── Retorno do MP após desbloqueio de contato (R$ 1) ───────────────────
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("contato_desbloqueado") === "sucesso") {
      try {
        const chave = "diariaja_contatos_desblo_" + new Date().toISOString().slice(0, 7);
        const atual = parseInt(localStorage.getItem(chave) || "0", 10);
        localStorage.setItem(chave, String(atual + 1));
        setContatosDesbloqueados(atual + 1);
      } catch { /* ignore */ }
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Se a URL contém erro de auth do Supabase (ex: bad_oauth_state), vai direto para splash
    if (urlParams.get("error") || urlParams.get("error_code")) {
      const desc = urlParams.get("error_description")?.replace(/\+/g, " ") || "Erro de autenticação";
      window.history.replaceState({}, "", window.location.pathname);
      setLoading(false);
      setTela("login");
      setAuthError(`⚠️ ${desc}. Por favor, tente novamente.`);
      clearTimeout(safetyTimer);
      return;
    }

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        // Não chamamos checkProfile aqui — o onAuthStateChange (INITIAL_SESSION)
        // já dispara logo abaixo e evita race condition de dois checkProfile simultâneos.
        if (!session) { setLoading(false); }
      })
      .catch(() => {
        // Erro de rede ou outro problema — vai para splash para não travar
        setLoading(false);
        setTela("splash");
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignora eventos que não mudam estado (ex: TOKEN_REFRESHED quando já estava logado)
      if (event === "TOKEN_REFRESHED") return;
      setSession(session);
      if (session) {
        (async () => {
          try {
            const { data } = await supabase
              .from("user_profiles")
              .select("user_type")
              .eq("id", session.user.id)
              .maybeSingle();
            if (data?.user_type) {
              await checkProfile(session.user.id);
            } else {
              // FIX 2: usa o ref para não perder o tipo selecionado antes do redirect OAuth
              const t = tipoRef.current;
              if (t === "empregador") setTela("cadastro-empregador");
              else if (t === "diarista") setTela("cadastro-diarista");
              else setTela("cadastro-tipo");
              setLoading(false);
            }
          } catch {
            setLoading(false);
            setTela("splash");
          }
        })();
      } else {
        setProfile(null);
        setTela("splash");
        setLoading(false);
      }
    });

    return () => { subscription.unsubscribe(); clearTimeout(safetyTimer); };
  }, []);

  const checkProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) { setLoading(false); return; }

    if (data) {
      setProfile(data);
      setTipo(data.user_type);
      setNegocio(data.segmento || null);
      // Carrega disponibilidade e agenda reais do banco
      setDisponivel(data.disponivel || false);
      setAgenda(data.agenda || []);
      setFotoUrl(data.foto_url || null);
      setCategorias(data.categorias || []);
      // Portfólio agora vem do banco — sobrevive a troca de aparelho
      if (Array.isArray(data.portfolio_urls)) {
        setPortfolioUrls(data.portfolio_urls);
        try { localStorage.setItem("diariaja_portfolio", JSON.stringify(data.portfolio_urls)); } catch {}
      }
      // Carrega assinatura ativa
      supabase.from("assinaturas").select("*").eq("user_id", userId).eq("status", "ativo").maybeSingle()
        .then(({ data: sub }) => setAssinatura(sub || null));
      // Restaura o modo e a tela salvos em localStorage (sobrevive ao reload)
      const modoSalvo = localStorage.getItem("diariaja_modo") as "empregador"|"diarista" | null;
      const telaSalva = (() => { try { return localStorage.getItem("diariaja_tela") || ""; } catch { return ""; } })();
      // Telas que NÃO devem ser restauradas (requerem autenticação/fluxo limpo)
      // Telas que dependem de seleção em memória (não restaurar do localStorage)
      const TELAS_AUTH = new Set(["splash","login","cadastro-tipo","cadastro-auth","cadastro-empregador","cadastro-diarista","pedir-localizacao","perfil-empregador","perfil-diarista-real","chat"]);
      const podeRestaurar = (t: string) => t && !TELAS_AUTH.has(t);

      // Sem CEP cadastrado → bloqueia até resolver (feed depende de lat/lng)
      const semCEP = !data.lat || !data.lng;

      if (data.user_type === "diarista") {
        setModoAtual("diarista");
        if (semCEP) { setTela("pedir-localizacao"); }
        else setTela(podeRestaurar(telaSalva) ? telaSalva : "home-diarista");
      } else if (data.user_type === "ambos" && modoSalvo === "diarista" && data.funcao && data.valor_diaria) {
        // Usuário "ambos" que estava no modo diarista → volta para diarista
        setModoAtual("diarista");
        if (semCEP) { setTela("pedir-localizacao"); }
        else setTela(podeRestaurar(telaSalva) ? telaSalva : "home-diarista");
      } else {
        // "empregador" ou "ambos" → home do empregador se tiver segmento
        setModoAtual("empregador");
        if (data.segmento) setTela(podeRestaurar(telaSalva) ? telaSalva : "home-empregador");
        else setTela("escolha-negocio");
      }
    } else {
      setTela("cadastro-tipo");
    }
    setLoading(false);
  };

  const saveProfile = async (updates: Partial<UserProfile>) => {
    if (!session?.user) return false;
    const telefoneFinal = updates.telefone ?? profile?.telefone ?? form.telefone;
    // Telefone só é validado se foi preenchido (alguns fluxos salvam sem ele)
    if (telefoneFinal && telefoneFinal.trim() && !validarTelefone(telefoneFinal)) {
      setAuthError("Telefone inválido. Use o formato (XX) 9XXXX-XXXX.");
      return false;
    }
    setSalvandoPerfil(true);
    const full: UserProfile = {
      id: session.user.id,
      user_type: updates.user_type ?? tipo ?? profile?.user_type ?? "",
      // Usa dados do profile como fallback para não sobrescrever com campos vazios
      nome: updates.nome ?? profile?.nome ?? form.nome,
      telefone: telefoneFinal,
      nome_negocio: updates.nome_negocio ?? profile?.nome_negocio ?? form.nomeNegocio ?? "",
      segmento: updates.segmento ?? profile?.segmento ?? negocioSelecionado ?? "",
      funcao: updates.funcao ?? profile?.funcao ?? form.funcao ?? "",
      valor_diaria: updates.valor_diaria ?? profile?.valor_diaria ?? (Number(form.valor) || 0),
      disponivel: updates.disponivel ?? disponivelAgora,
      agenda: updates.agenda ?? agendaSelecionada,
      bio: updates.bio ?? profile?.bio ?? form.bio ?? "",
      foto_url: updates.foto_url ?? profile?.foto_url ?? fotoUrl ?? "",
      categorias: updates.categorias ?? profile?.categorias ?? categoriasSelecionadas ?? [],
      lat: updates.lat !== undefined ? updates.lat : (profile?.lat ?? null),
      lng: updates.lng !== undefined ? updates.lng : (profile?.lng ?? null),
      cpf: updates.cpf ?? profile?.cpf ?? form.cpf ?? "",
      cnpj: updates.cnpj ?? profile?.cnpj ?? form.cnpj ?? "",
      pessoa_tipo: updates.pessoa_tipo ?? profile?.pessoa_tipo ?? form.pessoaTipo ?? "fisica",
      sexo: updates.sexo ?? profile?.sexo ?? form.sexo ?? "",
      data_nascimento: updates.data_nascimento ?? profile?.data_nascimento ?? form.dataNasc ?? "",
      endereco_empregador: updates.endereco_empregador ?? profile?.endereco_empregador ?? "",
    };
    const { error } = await supabase.from("user_profiles").upsert(full);
    setSalvandoPerfil(false);
    if (error) { setAuthError("Erro ao salvar perfil: " + error.message); return false; }
    setProfile(full);
    return true;
  };

  // Traduz mensagens de erro brutas do Supabase para pt-BR
  const traduzirErroAuth = (msg: string): string => {
    const m = msg.toLowerCase();
    if (m.includes("missing email") || m.includes("missing email or phone")) return "Informe seu e-mail.";
    if (m.includes("invalid login credentials") || m.includes("invalid credentials")) return "E-mail ou senha incorretos. Verifique seus dados ou use 'Esqueci minha senha'.";
    if (m.includes("email not confirmed")) return "⚠️ Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada (inclusive o spam).";
    if (m.includes("user already registered") || m.includes("already registered")) return "Este e-mail já está cadastrado. Faça login.";
    if (m.includes("password should be at least")) return "A senha deve ter pelo menos 6 caracteres.";
    if (m.includes("invalid email")) return "E-mail inválido. Verifique e tente novamente.";
    if (m.includes("email rate limit") || m.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (m.includes("signup is disabled")) return "Cadastros temporariamente desabilitados. Tente mais tarde.";
    if (m.includes("anonymous") || m.includes("sign-ins are disabled")) return "Informe seu e-mail e senha para continuar.";
    if (m.includes("network") || m.includes("fetch")) return "Sem conexão. Verifique sua internet e tente novamente.";
    if (m.includes("weak password")) return "Senha muito fraca. Use pelo menos 6 caracteres com letras e números.";
    if (m.includes("email_address_not_authorized")) return "E-mail não autorizado nesta plataforma.";
    if (m.includes("too many requests") || m.includes("over_email_send_rate_limit")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (m.includes("for security purposes")) return "Por segurança, aguarde alguns segundos antes de tentar novamente.";
    return msg; // fallback: exibe o original se não reconhecido
  };

  const handleEmailLogin = async () => {
    setAuthError(""); setAuthLoading(true);
    const { data: loginData, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.senha });
    if (error) {
      setAuthError(traduzirErroAuth(error.message));
    } else {
      trackEvento("login_sucesso", loginData?.user?.id, undefined);
    }
    setAuthLoading(false);
  };

  // Login por CPF/CNPJ: primeiro descobre o e-mail via edge function, depois loga normal
  const handleCPFLogin = async () => {
    setAuthError(""); setAuthLoading(true);
    const digits = loginCpfInput.replace(/\D/g, "");
    // Validação client-side básica (a edge function valida de novo)
    if (digits.length !== 11 && digits.length !== 14) {
      setAuthError("CPF deve ter 11 dígitos ou CNPJ 14.");
      setAuthLoading(false);
      return;
    }
    if (digits.length === 11 && !validarCPF(digits)) {
      setAuthError("CPF inválido. Confira os dígitos.");
      setAuthLoading(false);
      return;
    }
    if (!form.senha) {
      setAuthError("Informe sua senha.");
      setAuthLoading(false);
      return;
    }
    try {
      // Edge function devolve o e-mail (genérica em caso de erro, pra não vazar info)
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/lookup-by-cpf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(digits.length === 11 ? { cpf: digits } : { cnpj: digits }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok || !json.email) {
        setAuthError(json.error || "CPF/CNPJ ou senha incorretos.");
        setAuthLoading(false);
        return;
      }
      // Login com email recuperado + a senha que o usuário forneceu
      const { data: loginData, error } = await supabase.auth.signInWithPassword({ email: json.email, password: form.senha });
      if (error) {
        // Mesma mensagem genérica pra não dar pista se o CPF existe ou não
        setAuthError("CPF/CNPJ ou senha incorretos.");
      } else {
        trackEvento("login_sucesso", loginData?.user?.id, undefined, { metodo: "cpf" });
      }
    } catch {
      setAuthError("Erro de conexão. Tente novamente.");
    }
    setAuthLoading(false);
  };

  const handleEmailSignup = async () => {
    if (!checkTermos) { setAuthError("Você precisa aceitar os Termos de Uso para criar uma conta."); return; }
    if (!validarEmail(form.email)) { setAuthError("E-mail inválido. Confira e tente novamente."); return; }
    if (form.senha.length < 6) { setAuthError("A senha deve ter pelo menos 6 caracteres."); return; }
    setAuthError(""); setAuthLoading(true);
    const { error } = await supabase.auth.signUp({ email: form.email, password: form.senha });
    if (error) {
      setAuthError(traduzirErroAuth(error.message));
    } else {
      // Registra aceite dos termos no momento do cadastro
      try {
        localStorage.setItem("diariaja_termos_" + TERMOS_VERSAO, "1");
        localStorage.setItem("diariaja_termos_data", new Date().toISOString());
        setTermosAceitos(true);
      } catch { /* ignore */ }
    }
    setAuthLoading(false);
  };

  const handleResetSenha = async () => {
    if (!form.email.trim()) { setAuthError("Informe seu e-mail para redefinir a senha."); return; }
    setResetSenhaLoading(true); setAuthError("");
    const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), { redirectTo: window.location.origin });
    setResetSenhaLoading(false);
    if (error) { setAuthError(traduzirErroAuth(error.message)); } else { setResetSenhaEnviado(true); }
  };

  const handleGoogleLogin = async () => {
    setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) setAuthError(traduzirErroAuth(error.message));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Limpa TODO o estado local para não vazar dados entre usuários no mesmo dispositivo
    const keysToRemove = [
      "diariaja_tela", "diariaja_modo", "diariaja_dark",
      "diariaja_hidden_chats", "diariaja_portfolio", "diariaja_cancels",
    ];
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Reset de estado React
    setProfile(null); setTipo(null); setNegocio(null);
    setModoAtual("empregador");
    setDiarias([]); setMinhasDiarias([]); setVagasReais([]);
    setCandidaturas([]); setCandidatosProfiles({});
    setConvitesEnviados([]); setConvitesRecebidos([]);
    setMensagensReais([]); setChatDiariaAtiva(null);
    setDiaristasReais([]); setDiaristasAceites({});
    setContatosLiberados(new Set());
    setListaNotif([]); setNotifNaoLidas(0);
    setTela("splash");
  };

  const negocio = negocioSelecionado ? CATEGORIAS_NEGOCIO[negocioSelecionado as keyof typeof CATEGORIAS_NEGOCIO] : null;
  const funcoesDoNegocio = negocio ? negocio.funcoes : [];
  const toggleDia = (dia: string) =>
    setAgenda(prev => prev.includes(dia) ? prev.filter(d => d !== dia) : [...prev, dia]);


  // Atualiza localização do usuário (usado no perfil após cadastro)
  const handleAtualizarLocalizacao = () => {
    if (!navigator.geolocation) { setAuthError("Geolocalização não suportada neste dispositivo."); return; }
    setAuthError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const ok = await saveProfile({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (ok) setToastSuccess("📍 Localização atualizada!");
      },
      () => setAuthError("Permissão negada. Ative a localização nas configurações."),
      { timeout: 15000, enableHighAccuracy: true }
    );
  };

  // Salva SOMENTE a foto_url no banco — evita sobrescrever outros campos (closure issue)
  const salvarFotoUrl = async (url: string) => {
    if (!session?.user) return false;
    const { error } = await supabase
      .from("user_profiles")
      .update({ foto_url: url })
      .eq("id", session.user.id);
    if (error) {
      setToastError("❌ Erro ao salvar foto: " + error.message);
      return false;
    }
    // Atualiza estado local sem precisar rebuscar tudo
    setProfile(prev => prev ? { ...prev, foto_url: url } : prev);
    return true;
  };

  // Upload de foto de perfil para o Supabase Storage
  const handleFotoUpload = async (file: File) => {
    if (!session?.user) return;
    // Reseta o input para permitir selecionar o mesmo arquivo novamente
    if (fotoInputRef.current) fotoInputRef.current.value = "";

    // Valida tamanho (max 5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setToastError("❌ Foto muito grande. Use uma imagem menor que 5 MB.");
      return;
    }

    // Mostra preview LOCAL imediatamente (blob URL)
    const previewUrl = URL.createObjectURL(file);
    setFotoUrl(previewUrl);
    setUploadingFoto(true);

    // Sempre usa .jpg para evitar ter múltiplos arquivos no bucket
    const path = `${session.user.id}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: "image/jpeg" });

    if (uploadError) {
      // Fallback: converte para base64 e salva direto no banco
      setToastError("⚠️ Storage falhou, salvando localmente...");
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = ev.target?.result as string;
        if (base64) {
          setFotoUrl(base64);
          const ok = await salvarFotoUrl(base64);
          if (ok) setToastSuccess("✅ Foto salva!");
        } else {
          setToastError("❌ Não foi possível salvar a foto.");
        }
        setUploadingFoto(false);
      };
      reader.readAsDataURL(file);
      return;
    }

    // URL pública sem cache-buster (mais estável)
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = data.publicUrl;
    setFotoUrl(url);
    const ok = await salvarFotoUrl(url);
    if (ok) setToastSuccess("✅ Foto atualizada!");
    setUploadingFoto(false);
  };

  // Diarista avalia o empregador após diária concluída
  const enviarAvaliacaoEmpregador = async () => {
    if (!session?.user || !modalAvalEmp || notaEmp === 0) return;
    setEnviandoAvalMutua(true);
    const { error } = await supabase.from("avaliacoes_empregador").insert({
      diarista_id:   session.user.id,
      empregador_id: modalAvalEmp.empregador_id,
      diaria_id:     modalAvalEmp.id,
      nota:          notaEmp,
      comentario:    comentarioEmp.trim(),
    });
    if (error) { setAuthError("Erro: " + error.message); setEnviandoAvalMutua(false); return; }
    trackEvento("avaliacao_enviada", session.user.id, "diarista", { tipo: "empregador", nota: notaEmp });
    setAvaliadosDiarias(prev => new Set([...prev, modalAvalEmp.id]));
    setModalAvalEmp(null); setNotaEmp(0); setComentarioEmp("");
    setEnviandoAvalMutua(false);
  };

  // Empregador avalia diarista real após concluir
  const enviarAvaliacaoDiaristaReal = async () => {
    if (!session?.user || !modalAvalDiaristaReal || notaDiaristaReal === 0) return;
    setEnviandoAvalMutua(true);
    // Busca diarista_id da diária
    const diaria = modalAvalDiaristaReal;
    const { error } = await supabase.from("avaliacoes_diarista").insert({
      empregador_id: session.user.id,
      diarista_id:   diaria.diarista_aceite_id,
      diaria_id:     diaria.id,
      nota:          notaDiaristaReal,
      comentario:    comentarioDiaristaReal.trim(),
    });
    if (error) { setAuthError("Erro: " + error.message); setEnviandoAvalMutua(false); return; }
    trackEvento("avaliacao_enviada", session.user.id, "empregador", { tipo: "diarista", nota: notaDiaristaReal });
    setAvaliadosDiarias(prev => new Set([...prev, diaria.id]));
    setModalAvalDiaristaReal(null); setNotaDiaristaReal(0); setComentarioDiaristaReal("");
    setEnviandoAvalMutua(false);
  };

  // Empregador escaneia QR → confirma início da diária
  const confirmarInicio = async (diariaId: string) => {
    if (!session?.user) return;
    const { error } = await supabase
      .from("diarias")
      .update({ status: "em_andamento" })
      .eq("id", diariaId)
      .eq("empregador_id", session.user.id);
    if (error) { setScanMsg({ ok:false, txt:"Erro: " + error.message }); return; }
    setScanMsg({ ok:true, txt:"✅ Início confirmado! A diária está em andamento." });
    setDiarias(prev => prev.map(d => d.id === diariaId ? { ...d, status:"em_andamento" } : d));
    hapticConfirm();
    // Push pro diarista: o empregador confirmou sua chegada
    const diaria = diarias.find(d => d.id === diariaId);
    if (diaria?.diarista_aceite_id) {
      enviarPush(
        [diaria.diarista_aceite_id],
        "Chegada confirmada ✅",
        `${profile?.nome_negocio || "O contratante"} confirmou sua presença. Bom trabalho!`,
        { tipo: "confirmacao", url: "/" },
      );
    }
  };

  // Empregador marca diária como concluída
  const concluirDiaria = async (diariaId: string) => {
    if (!session?.user) return;
    const { error } = await supabase
      .from("diarias")
      .update({ status: "concluida" })
      .eq("id", diariaId)
      .eq("empregador_id", session.user.id);
    if (error) { setAuthError("Erro ao concluir: " + error.message); return; }
    const diariaAtualizada = diarias.find(d => d.id === diariaId);
    setDiarias(prev => prev.map(d => d.id === diariaId ? { ...d, status:"concluida" } : d));
    // Auto-abre recibo para o empregador após conclusão
    if (diariaAtualizada) setTimeout(() => setModalRecibo({ ...diariaAtualizada, status:"concluida" }), 400);
  };

  // Cancela uma diária com motivo
  const cancelarDiaria = async () => {
    if (!session?.user || !modalCancelar || !motivoCancelamento.trim()) return;
    setCancelando(true);
    const { error } = await supabase
      .from("diarias")
      .update({ status: "cancelada", motivo_cancelamento: motivoCancelamento.trim() })
      .eq("id", modalCancelar.id)
      .eq("empregador_id", session.user.id); // BUG-M6 fix: garante que só o dono cancela
    if (error) { setAuthError("Erro ao cancelar: " + error.message); setCancelando(false); return; }
    const atualizada = { ...modalCancelar, status: "cancelada", motivo_cancelamento: motivoCancelamento.trim() };
    setDiarias(prev => prev.map(d => d.id === modalCancelar.id ? atualizada : d));
    setMinhasDiarias(prev => prev.map(d => d.id === modalCancelar.id ? atualizada : d));
    setModalCancelar(null);
    setMotivoCancelamento("");
    setCancelando(false);
  };

  // Diarista desiste — vaga volta a ficar aberta para outros
  const desistirDiaria = async () => {
    if (!session?.user || !modalDesistir || !motivoDesistencia.trim()) return;
    setDesistindo(true);
    const diariaId = modalDesistir.id;
    const { error } = await supabase
      .from("diarias")
      .update({ status: "aberta", diarista_aceite_id: null, motivo_cancelamento: motivoDesistencia.trim() })
      .eq("id", diariaId);
    if (error) { setAuthError("Erro ao desistir: " + error.message); setDesistindo(false); return; }
    // Remove candidatura da tabela para que possa se recandidatar depois
    await supabase.from("candidaturas").delete()
      .eq("diaria_id", diariaId)
      .eq("diarista_id", session.user.id);
    // Remove da lista "minhas diárias"
    setMinhasDiarias(prev => prev.filter(d => d.id !== diariaId));
    // Reseta o interesse local para que a vaga apareça como disponível
    setMeuInteresse(prev => { const n = { ...prev }; delete n[diariaId]; return n; });
    // Recarrega a vaga atualizada (status "aberta") e insere em vagasReais
    const { data: vagaVolta } = await supabase.from("diarias").select("*").eq("id", diariaId).single();
    if (vagaVolta) setVagasReais(prev => [vagaVolta, ...prev.filter(v => v.id !== diariaId)]);
    setModalDesistir(null);
    setMotivoDesistencia("");
    setDesistindo(false);
    setToastSuccess("✅ Desistência registrada. A vaga voltou a ficar disponível.");
  };

  // Diarista retira interesse numa vaga (ainda pendente, não aceito)
  // BUG-H3 fix: verifica erro antes de atualizar estado
  const retirarInteresse = async (diariaId: string) => {
    if (!session?.user) return;
    const { error } = await supabase.from("candidaturas")
      .delete()
      .eq("diaria_id", diariaId)
      .eq("diarista_id", session.user.id);
    if (error) { setToastError("Erro ao retirar candidatura. Tente novamente."); return; }
    setMeuInteresse(prev => { const n = { ...prev }; delete n[diariaId]; return n; });
    setToastSuccess("↩️ Candidatura retirada.");
  };

  // Envia denúncia de vaga ou usuário
  // BUG-H2 fix: verifica erro do Supabase antes de fechar modal
  const enviarDenuncia = async () => {
    if (!session?.user || !modalDenunciar || !motivoDenuncia.trim()) return;
    setEnviandoDenuncia(true);
    const { error } = await supabase.from("denuncias").insert({
      denunciante_id:  session.user.id,
      tipo:            modalDenunciar.tipo,
      alvo_id:         modalDenunciar.id,
      alvo_nome:       modalDenunciar.nome,
      motivo:          motivoDenuncia.trim(),
    });
    setEnviandoDenuncia(false);
    if (error) { setToastError("Falha ao enviar denúncia. Tente novamente."); return; }
    setModalDenunciar(null);
    setMotivoDenuncia("");
    setToastSuccess("⚑ Denúncia enviada. Vamos analisar em breve.");
  };

  // ── NÃO TENHO INTERESSE ───────────────────────────────────────────────────
  const marcarNaoInteresse = async (diariaId: string) => {
    const novas = new Set(vagasIgnoradas);
    novas.add(diariaId);
    setVagasIgnoradas(novas);
    localStorage.setItem("diariaja_nao_interesse", JSON.stringify([...novas]));
    setToastSuccess("👎 Vaga ocultada. Não aparecerá mais.");
    // Salva no Supabase para o contador do empregador (fail silencioso)
    if (session?.user) {
      try {
        await supabase.from("nao_interesse").insert({
          diarista_id: session.user.id,
          diaria_id:   diariaId,
        });
      } catch { /* tabela pode não existir ainda — ok */ }
    }
  };

  // Carrega contagem de dislikes para as diárias do empregador
  const carregarDislikesPorVaga = async (diariaIds: string[]) => {
    if (!diariaIds.length) return;
    try {
      const { data } = await supabase
        .from("diarias_dislikes")
        .select("diaria_id, total")
        .in("diaria_id", diariaIds);
      if (data) {
        const mapa: Record<string, number> = {};
        data.forEach((row: { diaria_id: string; total: number }) => { mapa[row.diaria_id] = row.total; });
        setDislikesPorVaga(mapa);
      }
    } catch { /* view pode não existir ainda */ }
  };

  // ── CONVITES DIRETOS ──────────────────────────────────────────────────────

  const carregarConvites = async (userId: string, userType: string) => {
    if (userType === "diarista" || userType === "ambos") {
      const { data } = await supabase.from("convites").select("*")
        .eq("diarista_id", userId).order("created_at", { ascending: false });
      setConvitesRecebidos(data || []);
    }
    if (userType === "empregador" || userType === "ambos") {
      const { data } = await supabase.from("convites").select("*")
        .eq("contratante_id", userId).order("created_at", { ascending: false });
      setConvitesEnviados(data || []);
    }
  };

  const enviarConvite = async () => {
    if (!session?.user || !diaristaSelecionadaReal) return;
    // Valida campos obrigatórios — aceita CEP ou endereço livre
    const enderecoFinal = formConvite.rua.trim()
      ? `${formConvite.rua}, ${formConvite.numero}${formConvite.complemento.trim() ? ` — ${formConvite.complemento.trim()}` : ""}, ${formConvite.bairro}, ${formConvite.cidade}/${formConvite.estado}${formConvite.cep ? ` — CEP ${formConvite.cep}` : ""}`
      : formConvite.endereco.trim();
    if (!enderecoFinal || !formConvite.data || !formConvite.horario || !formConvite.cargaHoraria) {
      setToastError("Preencha CEP/endereço, data, horário e carga horária.");
      return;
    }
    setEnviandoConvite(true);
    const horarioCompleto = `${formConvite.horario} (${formConvite.cargaHoraria}h de trabalho)`;
    const { error } = await supabase.from("convites").insert({
      contratante_id:   session.user.id,
      diarista_id:      diaristaSelecionadaReal.id,
      contratante_nome: profile?.nome || "Contratante",
      diarista_nome:    diaristaSelecionadaReal.nome,
      funcao:           diaristaSelecionadaReal.funcao,
      local_servico:    enderecoFinal,
      data_servico:     formConvite.data,
      horario_servico:  horarioCompleto,
      observacoes:      formConvite.observacoes.trim() || null,
      valor:            diaristaSelecionadaReal.valor_diaria || null,
      status:           "pendente",
    });
    setEnviandoConvite(false);
    if (error) {
      console.error("Erro convite:", error);
      setToastError(`Erro ao enviar convite: ${error.message}`);
      return;
    }
    setModalConvite(false);
    setFormConvite({ cep: "", rua: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", endereco: "", data: "", horario: "", cargaHoraria: "", observacoes: "" });
    setContratadoReal(false);
    // Recarrega convites enviados e vai direto para aba Diárias
    if (session?.user) carregarConvites(session.user.id, "empregador");
    setTabEmpregador("diarias");
    setToastSuccess(`📨 Convite enviado para ${diaristaSelecionadaReal?.nome}! Aguardando resposta.`);
  };

  const responderConvite = async (conviteId: string, resposta: "aceito" | "recusado") => {
    const { error } = await supabase.from("convites")
      .update({ status: resposta })
      .eq("id", conviteId);
    if (error) { setToastError("Erro ao responder convite."); return; }
    setConvitesRecebidos(prev => prev.map(c => c.id === conviteId ? { ...c, status: resposta } : c));
    setToastSuccess(resposta === "aceito" ? "✅ Convite aceito! O contratante será notificado." : "❌ Convite recusado.");
  };

  const cancelarConvite = async (conviteId: string) => {
    const { error } = await supabase.from("convites").delete().eq("id", conviteId);
    if (error) { setToastError("Erro ao cancelar convite."); return; }
    setConvitesEnviados(prev => prev.filter(c => c.id !== conviteId));
    setConfirmCancelarConvite(null);
    setToastSuccess("🗑️ Convite cancelado.");
  };

  // ── COMUNIDADE ───────────────────────────────────────────────────────────

  const carregarTopicos = async (categoria = "todos") => {
    let q = supabase.from("topicos").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false });
    if (categoria !== "todos") q = q.eq("categoria", categoria);
    const { data } = await q;
    setTopicos(data || []);
  };

  const carregarComentarios = async (topicoId: string) => {
    const { data } = await supabase.from("comentarios_comunidade").select("*").eq("topico_id", topicoId).order("created_at", { ascending: true });
    setComentariosTopico(data || []);
  };

  const criarTopico = async () => {
    if (!session?.user || !formTopico.titulo.trim() || !formTopico.conteudo.trim()) {
      setToastError("Preencha título e conteúdo."); return;
    }
    setEnviandoTopico(true);
    const { data, error } = await supabase.from("topicos").insert({
      autor_id:  session.user.id,
      autor_nome: profile?.nome || "Usuário",
      autor_tipo: tipo || "empregador",
      titulo:    formTopico.titulo.trim(),
      conteudo:  formTopico.conteudo.trim(),
      categoria: formTopico.categoria,
    }).select().single();
    setEnviandoTopico(false);
    if (error) { setToastError("Erro ao criar tópico."); return; }
    setTopicos(prev => [data, ...prev]);
    setModalNovoTopico(false);
    setFormTopico({ titulo: "", conteudo: "", categoria: "geral" });
    setToastSuccess("✅ Tópico publicado na comunidade!");
  };

  const criarComentario = async () => {
    if (!session?.user || !topicoAtivo || !novoComentario.trim()) return;
    setEnviandoComentario(true);
    const { data, error } = await supabase.from("comentarios_comunidade").insert({
      topico_id:  topicoAtivo.id,
      autor_id:   session.user.id,
      autor_nome: profile?.nome || "Usuário",
      autor_tipo: tipo || "empregador",
      conteudo:   novoComentario.trim(),
    }).select().single();
    setEnviandoComentario(false);
    if (error) { setToastError("Erro ao comentar."); return; }
    setComentariosTopico(prev => [...prev, data]);
    setNovoComentario("");
    // Atualiza contador do tópico
    await supabase.from("topicos").update({ total_comentarios: (topicoAtivo.total_comentarios || 0) + 1 }).eq("id", topicoAtivo.id);
    setTopicoAtivo(prev => prev ? { ...prev, total_comentarios: (prev.total_comentarios || 0) + 1 } : prev);
  };

  const deletarTopico = async (topicoId: string) => {
    if (!window.confirm("Excluir este tópico e todos os comentários?")) return;
    await supabase.from("topicos").delete().eq("id", topicoId);
    setTopicos(prev => prev.filter(t => t.id !== topicoId));
    if (topicoAtivo?.id === topicoId) setTopicoAtivo(null);
    setToastSuccess("Tópico excluído.");
  };

  const deletarComentario = async (comentId: string) => {
    await supabase.from("comentarios_comunidade").delete().eq("id", comentId);
    setComentariosTopico(prev => prev.filter(c => c.id !== comentId));
  };

  const fixarTopico = async (topico: Topico) => {
    await supabase.from("topicos").update({ pinned: !topico.pinned }).eq("id", topico.id);
    setTopicos(prev => prev.map(t => t.id === topico.id ? { ...t, pinned: !t.pinned } : t));
  };

  const curtirTopico = async (topicoId: string) => {
    await supabase.from("topicos").update({ likes: (topicos.find(t => t.id === topicoId)?.likes || 0) + 1 }).eq("id", topicoId);
    setTopicos(prev => prev.map(t => t.id === topicoId ? { ...t, likes: t.likes + 1 } : t));
    if (topicoAtivo?.id === topicoId) setTopicoAtivo(prev => prev ? { ...prev, likes: prev.likes + 1 } : prev);
  };

  // Empregador exclui a diária — notifica o diarista aceito E todos os candidatos com interesse
  const excluirDiaria = async () => {
    if (!session?.user || !modalExcluir) return;
    if (!motivoExclusao.trim()) { setAuthError("Informe o motivo da exclusão."); return; }
    setExcluindo(true);
    const dia = modalExcluir;
    const motivo = motivoExclusao.trim();

    // Remoção otimista imediata — evita que sub #4 re-adicione a diária cancelada
    setDiarias(prev => prev.filter(d => d.id !== dia.id));
    setModalExcluir(null);
    setMotivoExclusao("");

    // 1. Marca candidaturas como "cancelada" → dispara Realtime para diaristas com interesse
    await supabase.from("candidaturas")
      .update({ status: "cancelada" })
      .eq("diaria_id", dia.id);

    // 2. Se havia diarista aceito: atualiza diária para "cancelada" com motivo → aciona sub #5
    if (dia.diarista_aceite_id) {
      await supabase
        .from("diarias")
        .update({ status: "cancelada", motivo_cancelamento: motivo })
        .eq("id", dia.id);
      // Aguarda o Realtime disparar para o diarista antes de deletar
      await new Promise(r => setTimeout(r, 900));
    }

    // 3. Remove candidaturas do banco (elimina dependência FK antes do delete)
    await supabase.from("candidaturas").delete().eq("diaria_id", dia.id);

    // 4. Deleta a diária do banco
    const { error } = await supabase.from("diarias").delete().eq("id", dia.id);
    if (error) {
      // Rollback: recarrega a diária do banco caso o delete falhe
      const { data: volta } = await supabase.from("diarias").select("*").eq("id", dia.id).single();
      if (volta) setDiarias(prev => [volta, ...prev.filter(d => d.id !== dia.id)]);
      setAuthError("Erro ao excluir diária: " + error.message);
      setExcluindo(false);
      return;
    }

    setExcluindo(false);
    setToastSuccess("✅ Diária excluída. Candidatos notificados.");
  };

  // Envia mensagem no chat real (empregador ↔ diarista)
  const enviarMensagemReal = async () => {
    if (!msgInputReal.trim() || !session?.user || !chatDiariaAtiva) return;
    // BUG-H4 fix: diarista_aceite_id pode ser null — verificar antes de usar
    if (tipo === "empregador" && !chatDiariaAtiva.diarista_aceite_id) return;
    // Anti-exit filter: detecta tentativa de sair do app
    if (detectarContatoExterno(msgInputReal)) {
      setAntiExitAviso(true);
      return;
    }
    setEnviandoMsgReal(true);
    const destinatario = tipo === "empregador"
      ? chatDiariaAtiva.diarista_aceite_id!
      : chatDiariaAtiva.empregador_id;
    const textoMsg = msgInputReal.trim();
    const { data: novaMsg, error } = await supabase.from("mensagens").insert({
      diaria_id: chatDiariaAtiva.id,
      remetente_id: session.user.id,
      destinatario_id: destinatario,
      conteudo: textoMsg,
    }).select().single();
    if (!error && novaMsg) {
      // BUG-M7 fix: adiciona localmente (Realtime ignora próprias msgs para evitar duplicata)
      setMensagensReais(prev => [...prev, novaMsg]);
      setMsgInputReal("");
      setTimeout(() => mensagensEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      // Push pro destinatário
      const remNome = profile?.nome?.split(" ")[0] || (tipo === "diarista" ? "Diarista" : "Contratante");
      enviarPush(
        [destinatario],
        `Mensagem de ${remNome}`,
        textoMsg.length > 80 ? textoMsg.slice(0, 80) + "…" : textoMsg,
        { tipo: "mensagem", url: "/" },
      );
    }
    setEnviandoMsgReal(false);
  };

  // Diarista aceita uma diária — concorda com o valor do empregador
  // Abre o perfil completo de um candidato no modal
  const abrirPerfilCandidato = async (dp: UserProfile) => {
    setPerfilCandidato(dp);
    setAvaliacoesCandidato([]);
    setDiariasCandidato(0);
    setLoadingPerfil(true);
    const [{ data: avs }, { count }] = await Promise.all([
      supabase.from("avaliacoes_diarista").select("id,nota,comentario,created_at").eq("diarista_id", dp.id).order("created_at", { ascending: false }),
      supabase.from("diarias").select("id", { count: "exact", head: true }).eq("diarista_aceite_id", dp.id).eq("status", "concluida"),
    ]);
    if (avs) setAvaliacoesCandidato(avs);
    setDiariasCandidato(count ?? 0);
    setLoadingPerfil(false);
  };

  // Diarista registra interesse numa vaga (novo fluxo)
  const demonstrarInteresse = async (diaria: Diaria) => {
    if (!session?.user) return;

    // Verifica conflito com diárias já aceitas no mesmo dia
    const diariasNoDia = minhasDiarias.filter(d =>
      d.data === diaria.data && (d.status === "aceita" || d.status === "em_andamento" || d.status === "pendente")
    );
    // Máximo 2 diárias por dia
    if (diariasNoDia.length >= 2) {
      setToastError("❌ Você já tem 2 diárias neste dia. Máximo permitido é 2.");
      return;
    }
    // Verifica conflito de horário (precisa de pelo menos 1h de intervalo)
    for (const d of diariasNoDia) {
      const niMin = parseInt(diaria.horario_inicio.split(":")[0])*60 + parseInt(diaria.horario_inicio.split(":")[1]);
      const nfMin = parseInt(diaria.horario_fim.split(":")[0])*60 + parseInt(diaria.horario_fim.split(":")[1]);
      const iMin = parseInt(d.horario_inicio.split(":")[0])*60 + parseInt(d.horario_inicio.split(":")[1]);
      const fMin = parseInt(d.horario_fim.split(":")[0])*60 + parseInt(d.horario_fim.split(":")[1]);
      // Precisa de 60 min de intervalo entre diárias
      if (niMin < fMin + 60 && nfMin > iMin - 60) {
        setToastError(`❌ Conflito de horário! Você tem uma diária de ${d.horario_inicio.slice(0,5)} às ${d.horario_fim.slice(0,5)}. Precisa de 1h de intervalo.`);
        return;
      }
    }

    const { error } = await supabase.from("candidaturas").insert({
      diaria_id: diaria.id,
      diarista_id: session.user.id,
      status: "pendente",
      diarista_info: {
        nome: profile?.nome || "",
        funcao: profile?.funcao || "",
        foto_url: fotoUrl || profile?.foto_url || "",
        lat: profile?.lat || null,
        lng: profile?.lng || null,
        categorias: profile?.categorias || [],
      }
    });
    if (error) { setAuthError("Erro ao registrar interesse: " + error.message); return; }
    trackEvento("candidatura_enviada", session?.user?.id, "diarista", { diaria_id: diaria.id, funcao: diaria.funcao });
    setMeuInteresse(prev => ({ ...prev, [diaria.id]: "pendente" }));
    setVagaConfirmada(true);
    hapticConfirm();

    // Push pro empregador: alguém demonstrou interesse na vaga dele
    enviarPush(
      [diaria.empregador_id],
      "Novo interessado na sua vaga",
      `${profile?.nome?.split(" ")[0] || "Um diarista"} demonstrou interesse em "${diaria.funcao || diaria.segmento}".`,
      { tipo: "candidatura", url: "/" },
    );

    // Verifica se a vaga atingiu o limite de 5 interessados → some do feed
    const { count } = await supabase
      .from("candidaturas")
      .select("*", { count: "exact", head: true })
      .eq("diaria_id", diaria.id)
      .eq("status", "pendente");
    if ((count ?? 0) >= MAX_INTERESSADOS) {
      setVagasReais(prev => prev.filter(v => v.id !== diaria.id));
    }
  };

  // Empregador seleciona um candidato — executa a lógica real após confirmação do modal
  const executarSelecaoCandidato = async (diaria: Diaria, diaristaId: string) => {
    if (!session?.user) {
      // Fecha o modal ANTES de mostrar o toast (modal faz early-return e bloqueia o toast)
      setModalTermoCiencia(null);
      setTermoCienciaCheck(false);
      setToastError("❌ Sessão expirada. Faça login novamente.");
      return;
    }
    setSelecionando(true);

    // Fecha o modal imediatamente (UI otimista) para que toasts apareçam
    setModalTermoCiencia(null);
    setTermoCienciaCheck(false);

    // 1. Atualiza a diária
    const { error: e1 } = await supabase
      .from("diarias")
      .update({ status: "pendente", diarista_aceite_id: diaristaId })
      .eq("id", diaria.id)
      .eq("empregador_id", session.user.id);

    if (e1) {
      setSelecionando(false);
      setToastError("❌ Erro ao selecionar candidato: " + e1.message);
      return;
    }

    // 2. Atualiza candidaturas
    await supabase.from("candidaturas").update({ status: "selecionado" }).eq("diaria_id", diaria.id).eq("diarista_id", diaristaId);
    await supabase.from("candidaturas").update({ status: "rejeitado"  }).eq("diaria_id", diaria.id).neq("diarista_id", diaristaId);

    // 3. Push pro diarista escolhido + pros rejeitados (atualiza a sensação)
    enviarPush(
      [diaristaId],
      "🎯 Você foi escolhido!",
      `${profile?.nome_negocio || "Um contratante"} te selecionou pra "${diaria.funcao || diaria.segmento}". Abra o app pra confirmar.`,
      { tipo: "selecionado", url: "/" },
    );
    hapticConfirm();

    // 3. Atualiza estado local
    setDiarias(prev => prev.map(d => d.id === diaria.id ? { ...d, status: "pendente", diarista_aceite_id: diaristaId } : d));
    setCandidaturas(prev => prev.map(c => c.diaria_id === diaria.id ? { ...c, status: c.diarista_id === diaristaId ? "selecionado" : "rejeitado" } : c));

    setModalCandidatos(null);
    setSelecionando(false);
    setToastSuccess("✅ Candidato selecionado! Aguardando confirmação dele.");
  };

  // Inicia pagamento de R$ 1 para desbloquear seleção de contato adicional
  const desbloquearContato = async () => {
    if (!session?.user) return;
    setDesbloqueandoContato(true);
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/create-contact-payment`,
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ empregador_id: session.user.id }),
        }
      );
      const data = await resp.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        setToastError("❌ Erro ao gerar link de pagamento. Tente novamente.");
      }
    } catch {
      setToastError("❌ Erro de conexão. Verifique sua internet.");
    }
    setDesbloqueandoContato(false);
  };

  // Wrapper: verifica limite de contatos e abre modal de termo antes de selecionar
  const selecionarCandidato = (diaria: Diaria, diaristaId: string) => {
    // Verifica limite para plano grátis (3 seleções/mês + extras desbloqueados)
    const planoEmp = assinatura?.plano ?? "gratis";
    if (planoEmp === "gratis") {
      const mes = new Date().toISOString().slice(0, 7);
      const selecionadasNoMes = diarias.filter(
        d => d.diarista_aceite_id && d.created_at && d.created_at.slice(0, 7) === mes
      ).length;
      const limite = 3 + contatosDesbloqueados;
      if (selecionadasNoMes >= limite) {
        setModalLimiteContato(true);
        return;
      }
    }
    setModalTermoCiencia({ diaria, diaristaId });
    setTermoCienciaCheck(false);
  };

  // Wrapper: abre o modal de termo antes de confirmar presença
  const confirmarPresenca = (diaria: Diaria) => {
    setModalTermoDiarista(diaria);
    setTermoDiaristaCheck(false);
  };

  // Executa confirmação real após aceite do modal
  const executarConfirmarPresenca = async (diaria: Diaria) => {
    if (!session?.user) return;
    setConfirmando(true);
    const { error } = await supabase.from("diarias").update({ status: "aceita" }).eq("id", diaria.id);
    if (error) { setAuthError(error.message); setConfirmando(false); return; }
    await supabase.from("candidaturas").update({ status: "confirmado" }).eq("diaria_id", diaria.id).eq("diarista_id", session.user.id);
    setMinhasDiarias(prev => prev.map(d => d.id === diaria.id ? { ...d, status: "aceita" } : d));
    setMeuInteresse(prev => ({ ...prev, [diaria.id]: "confirmado" }));
    setConfirmando(false);
    setModalTermoDiarista(null);
    setTermoDiaristaCheck(false);
    // BUG-4 fix: feedback de sucesso para o diarista após confirmação
    setToastSuccess("✅ Presença confirmada! O contratante foi notificado. Gere o QR Code no dia da diária.");
  };

  const excluirChat = async (diaId: string) => {
    await supabase.from("mensagens").delete().eq("diaria_id", diaId);
    setMensagensReais([]);
    setChatDiariaAtiva(null);
    setConfirmExcluirChat(false);
    const novo = new Set(hiddenChats); novo.add(diaId);
    setHiddenChats(novo);
    localStorage.setItem("diariaja_hidden_chats", JSON.stringify([...novo]));
    setToastSuccess("🗑️ Conversa excluída.");
  };

  const excluirDiariaLocal = (diaId: string) => {
    try {
      const cancels = JSON.parse(localStorage.getItem("diariaja_cancels") || "{}");
      delete cancels[diaId];
      localStorage.setItem("diariaja_cancels", JSON.stringify(cancels));
    } catch {}
    setMinhasDiarias(prev => prev.filter(d => d.id !== diaId));
  };

  const excluirDiariaJaCancelada = async (diaId: string) => {
    // Diária já está cancelada — diaristas já foram notificados; só remove do banco
    setDiarias(prev => prev.filter(d => d.id !== diaId));
    setConfirmExcluirDiariaCancelada(null);
    await supabase.from("candidaturas").delete().eq("diaria_id", diaId);
    await supabase.from("diarias").delete().eq("id", diaId);
    setToastSuccess("🗑️ Diária cancelada removida permanentemente.");
  };

  // Salva edição de diária aberta (empregador)
  const salvarEdicaoDiaria = async () => {
    if (!modalEditarDiaria) return;
    const [h1, m1] = (formEditarDiaria.horario_inicio || "0:0").split(":").map(Number);
    const [h2, m2] = (formEditarDiaria.horario_fim || "0:0").split(":").map(Number);
    if ((h2 * 60 + m2) - (h1 * 60 + m1) <= 0) { setAuthError("Horário inválido."); return; }
    if (!formEditarDiaria.valor || Number(formEditarDiaria.valor) <= 0) { setAuthError("Informe um valor válido."); return; }
    setSalvandoEdicao(true);
    const updates = {
      descricao: formEditarDiaria.descricao,
      horario_inicio: formEditarDiaria.horario_inicio,
      horario_fim: formEditarDiaria.horario_fim,
      valor: Number(formEditarDiaria.valor),
    };
    const { error } = await supabase.from("diarias").update(updates).eq("id", modalEditarDiaria.id);
    if (error) { setAuthError("Erro ao salvar: " + error.message); setSalvandoEdicao(false); return; }
    setDiarias(prev => prev.map(d => d.id === modalEditarDiaria.id ? { ...d, ...updates } : d));
    setModalEditarDiaria(null);
    setSalvandoEdicao(false);
    setToastSuccess("✅ Diária atualizada!");
  };

  // Upload de foto do portfólio (diarista)
  const handlePortfolioUpload = async (file: File) => {
    if (!session?.user) return;
    if (portfolioUrls.length >= 3) { setToastError("Máximo de 3 fotos no portfólio."); return; }
    if (file.size > 5 * 1024 * 1024) {
      setToastError("❌ Foto muito grande. Use uma imagem menor que 5 MB.");
      return;
    }
    setUploadingPortfolio(true);
    const idx = portfolioUrls.length;
    const path = `${session.user.id}_portfolio_${idx}_${Date.now()}.jpg`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: "image/jpeg" });
    if (error) { setToastError("Erro ao enviar foto."); setUploadingPortfolio(false); return; }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const novas = [...portfolioUrls, urlData.publicUrl];
    setPortfolioUrls(novas);
    localStorage.setItem("diariaja_portfolio", JSON.stringify(novas)); // cache local
    const { error: upErr } = await supabase
      .from("user_profiles")
      .update({ portfolio_urls: novas })
      .eq("id", session.user.id);
    if (upErr) setToastError("Foto subida, mas falhou ao sincronizar com o banco.");
    setUploadingPortfolio(false);
    if (!upErr) setToastSuccess("📸 Foto adicionada ao portfólio!");
  };

  const removerFotoPortfolio = async (idx: number) => {
    if (!session?.user) return;
    const urlAntiga = portfolioUrls[idx];
    const novas = portfolioUrls.filter((_, i) => i !== idx);
    setPortfolioUrls(novas);
    localStorage.setItem("diariaja_portfolio", JSON.stringify(novas));
    await supabase
      .from("user_profiles")
      .update({ portfolio_urls: novas })
      .eq("id", session.user.id);
    // Tenta apagar do Storage também (a URL termina em ".../object/public/avatars/<path>")
    try {
      const match = urlAntiga?.match(/\/avatars\/(.+)$/);
      if (match?.[1]) await supabase.storage.from("avatars").remove([match[1]]);
    } catch { /* silencioso — o registro no banco já saiu */ }
  };

  const aceitarVaga = async (diaria: Diaria) => {
    if (!session?.user) return;
    const { error } = await supabase
      .from("diarias")
      .update({ status: "aceita", diarista_aceite_id: session.user.id })
      .eq("id", diaria.id);
    if (error) { setAuthError("Erro ao aceitar: " + error.message); return; }
    setVagaConfirmada(true);
    setVagasReais(prev => prev.filter(v => v.id !== diaria.id));
  };

  // Publica uma nova diária
  // Inicia assinatura de plano via Mercado Pago Preapproval
  const iniciarAssinatura = async (planoId: string) => {
    if (!session?.user) return;
    setCriandoAssinatura(true);
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/create-subscription`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            plano:      planoId,
            user_id:    session.user.id,
            user_type:  modoAtual,
            payer_email: session.user.email,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) { setAuthError(data.error || "Erro ao criar assinatura."); setCriandoAssinatura(false); return; }
      window.open(data.checkout_url, "_blank");
      setToastSuccess("🏦 Checkout aberto! Conclua a assinatura na nova aba.");
      setTela(modoAtual === "empregador" ? "home-empregador" : "home-diarista");
    } catch {
      setAuthError("Erro de conexão.");
    }
    setCriandoAssinatura(false);
  };

  // Cria preferência de pagamento MP e redireciona o empregador para o checkout
  const iniciarPagamentoMP = async (diaria: Diaria) => {
    if (!session?.user) return;
    setCriandoPagamento(true);
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/create-payment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ diaria_id: diaria.id, empregador_id: session.user.id }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        setAuthError(data.error || "Erro ao iniciar pagamento. Tente novamente.");
        setCriandoPagamento(false);
        return;
      }
      // Redireciona para o checkout do MP
      window.open(data.checkout_url, "_blank");
      setModalPagamentoMP(null);
      setToastSuccess("🏦 Checkout aberto! Conclua o pagamento na nova aba.");
    } catch {
      setAuthError("Erro de conexão ao iniciar pagamento.");
    }
    setCriandoPagamento(false);
  };

  const salvarDiaria = async () => {
    if (!session?.user) return;

    // ── Limite de vagas: removido (vagas são ilimitadas em todos os planos) ──
    // O limite passou a ser em seleções de candidato (R$ 1/contato extra no grátis)
    // Verificado em selecionarCandidato()

    const [h1v, m1v] = (formDiaria.horario_inicio || "0:0").split(":").map(Number);
    const [h2v, m2v] = (formDiaria.horario_fim || "0:0").split(":").map(Number);
    const minTot = (h2v * 60 + m2v) - (h1v * 60 + m1v);
    const erroTitulo = validarTituloDiaria(formDiaria.local);
    if (erroTitulo) { setAuthError(erroTitulo); return; }
    if (!formDiaria.descricao.trim()) { setAuthError("Descreva o que precisa ser feito."); return; }
    if (!formDiaria.data) { setAuthError("Selecione a data da diária."); return; }
    if (!formDiaria.horario_inicio || !formDiaria.horario_fim) { setAuthError("Informe o horário de início e término."); return; }
    if (minTot <= 0) { setAuthError("O horário de término deve ser após o início."); return; }
    if (!formDiaria.valor || isNaN(Number(formDiaria.valor)) || Number(formDiaria.valor) <= 0) { setAuthError("Informe um valor numérico válido."); return; }
    if (!formDiaria.cep.trim() || formDiaria.cep.replace(/\D/g,"").length < 8) { setAuthError("Informe um CEP válido (8 dígitos)."); return; }
    if (!formDiaria.rua.trim()) { setAuthError("Informe o logradouro (rua/avenida)."); return; }
    if (!formDiaria.numero.trim()) { setAuthError("Informe o número do local."); return; }
    if (!formDiaria.bairro.trim() || !formDiaria.cidade.trim()) { setAuthError("Bairro e cidade são obrigatórios."); return; }
    // Verificação anti-fraude
    const fraudeAviso = verificarFraudeDescricao(formDiaria.descricao);
    if (fraudeAviso) { setAuthError(fraudeAviso); return; }
    const enderecoComposto = `${formDiaria.rua}, ${formDiaria.numero}${formDiaria.complemento.trim() ? ` — ${formDiaria.complemento.trim()}` : ""}, ${formDiaria.bairro}, ${formDiaria.cidade}/${formDiaria.estado} — CEP ${formDiaria.cep}`;
    setSalvandoDiaria(true);
    const isDelivery = FUNCOES_DELIVERY.includes(formDiaria.funcao);
    const nova = {
      empregador_id: session.user.id,
      nome_negocio: formDiaria.local.trim() || profile?.nome_negocio || "",
      segmento: negocioSelecionado || profile?.segmento || "",
      funcao: formDiaria.funcao,
      descricao: formDiaria.descricao,
      data: formDiaria.data,
      horario_inicio: formDiaria.horario_inicio,
      horario_fim: formDiaria.horario_fim,
      valor: Number(formDiaria.valor),
      status: "aberta",
      endereco: enderecoComposto,
      bairro: formDiaria.bairro.trim() || null,
      lat: latDiaria,
      lng: lngDiaria,
      ...(isDelivery && {
        valor_encostada: formDiaria.valor_encostada ? Number(formDiaria.valor_encostada) : null,
        valor_por_entrega: formDiaria.valor_por_entrega ? Number(formDiaria.valor_por_entrega) : null,
        ganho_estimado_dia: formDiaria.ganho_estimado_dia ? Number(formDiaria.ganho_estimado_dia) : null,
      }),
    };
    const { data, error } = await supabase.from("diarias").insert(nova).select().single();
    if (error) { setAuthError("Erro ao publicar: " + error.message); setSalvandoDiaria(false); return; }
    const novasDiarias = data ? [data] : [];

    // Cria diárias extras se recorrente
    if (dirariaRepetir !== "nao" && formDiaria.data) {
      const intervalo = dirariaRepetir === "semanal" ? 7 : 14;
      const extras = [];
      for (let i = 1; i <= 3; i++) { // 3 repetições futuras
        const dt = new Date(formDiaria.data + "T12:00:00");
        dt.setDate(dt.getDate() + intervalo * i);
        extras.push({ ...nova, data: dt.toISOString().split("T")[0] });
      }
      const { data: extData } = await supabase.from("diarias").insert(extras).select();
      if (extData) novasDiarias.push(...extData);
    }

    if (novasDiarias.length > 0) setDiarias(prev => [...novasDiarias, ...prev]);
    trackEvento("diaria_criada", session?.user?.id, "empregador", {
      funcao: formDiaria.funcao,
      valor: Number(formDiaria.valor),
      recorrente: dirariaRepetir !== "nao",
      total_criadas: novasDiarias.length,
    });
    setFormDiaria({ local:"", descricao:"", funcao:"", data:"", horario_inicio:"", horario_fim:"", valor:"", cep:"", rua:"", numero:"", complemento:"", bairro:"", cidade:"", estado:"", valor_encostada:"", valor_por_entrega:"", ganho_estimado_dia:"" });
    setDiariaRepetir("nao");
    setLatDiaria(null); setLngDiaria(null);
    setAuthError("");
    setSalvandoDiaria(false);
    setTabEmpregador("diarias"); // BUG-1 fix: empregador vê a vaga que acabou de criar
    setToastSuccess(dirariaRepetir !== "nao" ? `✅ ${novasDiarias.length} diárias criadas com sucesso!` : "✅ Diária publicada! Aguardando candidatos.");
    setTela("home-empregador");
  };

  // Busca endereço pelo CEP via ViaCEP
  // ── Geocoding com cache em localStorage + BrasilAPI → Nominatim ────────────
  // Precisão > Nominatim sozinho (BrasilAPI conhece coordenadas de muitos CEPs
  // brasileiros direto da Receita; Nominatim cai no centróide do bairro).
  // Cache local com TTL de 30d evita repetir lookup do mesmo CEP.
  const GEOCACHE_KEY = "diariaja_geocache_v1";
  const GEOCACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  type GeoCacheEntry = { lat: number; lng: number; ts: number };

  const lerGeoCache = (): Record<string, GeoCacheEntry> => {
    try { return JSON.parse(localStorage.getItem(GEOCACHE_KEY) || "{}"); } catch { return {}; }
  };
  const escreverGeoCache = (cep: string, lat: number, lng: number) => {
    try {
      const cache = lerGeoCache();
      cache[cep] = { lat, lng, ts: Date.now() };
      // Limita a 200 entradas (LRU simples — remove as mais antigas)
      const entries = Object.entries(cache);
      if (entries.length > 200) {
        entries.sort((a, b) => a[1].ts - b[1].ts);
        entries.slice(0, entries.length - 200).forEach(([k]) => { delete cache[k]; });
      }
      localStorage.setItem(GEOCACHE_KEY, JSON.stringify(cache));
    } catch { /* localStorage cheio — ignora */ }
  };

  const geocodificarCEP = async (cep: string, cidade?: string, uf?: string): Promise<{lat:number, lng:number}|null> => {
    const cepNorm = cep.replace(/\D/g, "");
    if (cepNorm.length !== 8) return null;

    // 1. Cache local (instantâneo)
    const cache = lerGeoCache();
    const hit = cache[cepNorm];
    if (hit && Date.now() - hit.ts < GEOCACHE_TTL_MS) {
      return { lat: hit.lat, lng: hit.lng };
    }

    // 2. BrasilAPI v2 — retorna lat/lng quando disponível (mais preciso pra BR)
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepNorm}`);
      if (r.ok) {
        const j = await r.json();
        const lat = parseFloat(j?.location?.coordinates?.latitude);
        const lng = parseFloat(j?.location?.coordinates?.longitude);
        if (!Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0)) {
          escreverGeoCache(cepNorm, lat, lng);
          return { lat, lng };
        }
      }
    } catch { /* tenta o fallback */ }

    // 3. Fallback: Nominatim com CEP + cidade + UF (centróide do bairro)
    try {
      const query = encodeURIComponent(`${cepNorm}${cidade ? ", " + cidade : ""}${uf ? ", " + uf : ""}, Brasil`);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=0`,
        { headers: { "Accept-Language": "pt-BR", "User-Agent": "Diariajakapp/1.0" } },
      );
      const data = await res.json();
      if (data?.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        escreverGeoCache(cepNorm, lat, lng);
        return { lat, lng };
      }
      const res2 = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${cepNorm}&country=Brazil&format=json&limit=1`,
        { headers: { "Accept-Language": "pt-BR", "User-Agent": "Diariajakapp/1.0" } },
      );
      const data2 = await res2.json();
      if (data2?.length > 0) {
        const lat = parseFloat(data2[0].lat);
        const lng = parseFloat(data2[0].lon);
        escreverGeoCache(cepNorm, lat, lng);
        return { lat, lng };
      }
    } catch { /* sem internet ou erro — segue sem coordenadas */ }
    return null;
  };

  // Busca endereço pelo CEP (formulário de diária) + geocodifica automaticamente
  const buscarCEP = async (cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCEP(true);
    setAuthError("");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = await res.json();
      if (json.erro) { setAuthError("CEP não encontrado. Verifique e tente novamente."); setBuscandoCEP(false); return; }
      setFormDiaria(prev => ({
        ...prev,
        rua: json.logradouro || prev.rua,
        bairro: json.bairro || prev.bairro,
        cidade: json.localidade || prev.cidade,
        estado: json.uf || prev.estado,
      }));
      // Geocodifica o CEP → lat/lng automático (sem precisar de GPS do dispositivo)
      const coords = await geocodificarCEP(cep, json.localidade, json.uf);
      if (coords) { setLatDiaria(coords.lat); setLngDiaria(coords.lng); }
    } catch { setAuthError("Erro ao buscar CEP. Verifique sua conexão."); }
    setBuscandoCEP(false);
  };

  // Busca endereço pelo CEP para o cadastro do empregador + geocodifica
  const buscarCEPEmp = async (cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g,"");
    if (cep.length !== 8) return;
    setBuscandoCEPEmp(true);
    setAuthError("");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = await res.json();
      if (json.erro) { setAuthError("CEP não encontrado."); setBuscandoCEPEmp(false); return; }
      setForm(prev => ({ ...prev, ruaEmp: json.logradouro||prev.ruaEmp, bairroEmp: json.bairro||prev.bairroEmp, cidadeEmp: json.localidade||prev.cidadeEmp, estadoEmp: json.uf||prev.estadoEmp }));
      // Geocodifica o CEP do empregador automaticamente
      const coords = await geocodificarCEP(cep, json.localidade, json.uf);
      if (coords) { setLatPerfilCEP(coords.lat); setLngPerfilCEP(coords.lng); }
    } catch { setAuthError("Erro ao buscar CEP. Verifique sua conexão."); }
    setBuscandoCEPEmp(false);
  };

  // Busca CEP do perfil do diarista → preenche bairro/cidade e geocodifica
  const buscarCEPPerfil = async (cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCEPPerfil(true);
    setAuthError("");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = await res.json();
      if (json.erro) { setAuthError("CEP não encontrado. Verifique o CEP digitado."); setBuscandoCEPPerfil(false); return; }
      setForm(prev => ({ ...prev, bairro: json.bairro || prev.bairro, cidade: json.localidade || prev.cidade }));
      const coords = await geocodificarCEP(cep, json.localidade, json.uf);
      if (coords) { setLatPerfilCEP(coords.lat); setLngPerfilCEP(coords.lng); }
      else setAuthError("CEP encontrado, mas não foi possível obter as coordenadas. Tente novamente.");
    } catch { setAuthError("Erro ao buscar CEP. Verifique sua conexão."); }
    setBuscandoCEPPerfil(false);
  };

  // Busca endereço pelo CEP para o formulário de convite direto
  const buscarCEPConvite = async (cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCEPConvite(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = await res.json();
      if (json.erro) { setBuscandoCEPConvite(false); return; }
      setFormConvite(prev => ({ ...prev, rua: json.logradouro || prev.rua, bairro: json.bairro || prev.bairro, cidade: json.localidade || prev.cidade, estado: json.uf || prev.estado }));
    } catch {}
    setBuscandoCEPConvite(false);
  };

  // ── SUPORTE FAQ (chatbot automático) ─────────────────────────────────────
  const SUPORTE_FAQ = [
    { keys: ["cancelar","cancel"], resp: "Para cancelar uma diária, abra a diária na aba 'Diárias' e toque em '✕ Cancelar'. Informe um motivo — o diarista/contratante será notificado automaticamente. ⚠️ Cancelamentos frequentes afetam sua reputação." },
    { keys: ["pagar","pagamento","pix","dinheiro"], resp: "O pagamento é combinado entre contratante e profissional, diretamente via PIX. Não há intermediação financeira. Após a conclusão, acesse a diária e toque em '🏦 PIX' para ver a chave do profissional ou em '🧾 Recibo' para gerar o comprovante." },
    { keys: ["avalia","nota","star","estrela"], resp: "Após a conclusão da diária, ambos podem se avaliar. A avaliação aparece no perfil e ajuda a construir reputação. Seja justo! ⭐" },
    { keys: ["conta","perfil","editar","foto"], resp: "Para editar seu perfil, vá na aba 'Perfil' e toque em '✏️ Editar'. Você pode atualizar foto, bio, função e muito mais." },
    { keys: ["convite","convidar"], resp: "Empregadores podem enviar convites diretos a diaristas específicos. Acesse o perfil do diarista e toque em '📨 Convidar para diária'." },
    { keys: ["qr","qrcode","check","chegada"], resp: "O check-in é feito via QR Code. O diarista mostra o QR Code no app e o empregador escaneia. Isso confirma a chegada e inicia a diária oficialmente." },
    { keys: ["senha","esqueci","login","entrar"], resp: "Para redefinir sua senha, toque em 'Esqueci minha senha' na tela de login. Um link será enviado para seu e-mail." },
    { keys: ["problema","erro","bug","não funciona","ajuda"], resp: "Sinto muito pelo transtorno! 🙏 Entre em contato pelo e-mail suporte@diariaja.com.br ou pelo WhatsApp. Respondemos em até 24h." },
    { keys: ["taxa","cobrança","custo","gratuito"], resp: "O DiáriaJá cobra uma taxa de 1,5% sobre o valor da diária para empregadores. Diaristas não pagam taxa. 💚" },
    { keys: ["nota fiscal","recibo","comprovante"], resp: "Após conclusão da diária, o comprovante fica disponível na aba 'Diárias'. Toque em '🧾 Recibo' para visualizar e compartilhar." },
    { keys: ["seguro","garantia","confiavel","verificado"], resp: "Todos os diaristas com badge '✅ Verificado' tiveram o CPF confirmado. Recomendamos verificar avaliações e histórico antes de contratar. 🛡️" },
  ];

  const responderSuporte = async (msg: string) => {
    // Adiciona mensagem do usuário ao histórico da API
    historicoSuporteRef.current = [
      ...historicoSuporteRef.current,
      { role: "user", content: msg },
    ];

    setSuporteDigitando(true);
    try {
      const { data: { session: sess } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${sess?.access_token ?? SUPABASE_ANON_KEY}`,
      };

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/ai-support`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ messages: historicoSuporteRef.current }),
        }
      );
      const json = await res.json() as { reply?: string; error?: string };
      const reply = json.reply ?? "Desculpe, tive um problema. Tente novamente ou fale com nossa equipe: suporte@diariaja.com.br 🙏";

      // Adiciona resposta da IA ao histórico
      historicoSuporteRef.current = [
        ...historicoSuporteRef.current,
        { role: "assistant", content: reply },
      ];

      setMsgsSuporte(prev => [...prev, { de: "bot", texto: reply }]);
    } catch {
      setMsgsSuporte(prev => [...prev, { de: "bot", texto: "Ops! Sem conexão no momento. Tente novamente ou contate: suporte@diariaja.com.br 📧" }]);
    } finally {
      setSuporteDigitando(false);
    }
  };

  // Salva disponibilidade no banco ao clicar no toggle
  const handleToggleDisponivel = async () => {
    const novoValor = !disponivelAgora;
    setDisponivel(novoValor);
    await saveProfile({ disponivel: novoValor });
  };

  // Salva agenda no banco ao clicar num dia
  const handleToggleDia = async (dia: string) => {
    const novaAgenda = agendaSelecionada.includes(dia)
      ? agendaSelecionada.filter(d => d !== dia)
      : [...agendaSelecionada, dia];
    setAgenda(novaAgenda);
    await saveProfile({ agenda: novaAgenda });
  };

  // SVG do Google reutilizável
  const GoogleSVG = (
    <svg width="20" height="20" viewBox="0 0 24 24" style={{marginRight:10,flexShrink:0}}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );

  // LOADING
  // ── Barra de progresso global (aparece em qualquer operação assíncrona) ─────
  const anyLoading = loading || salvandoPerfil || authLoading || salvandoDiaria || enviandoAvalMutua || selecionando;

  // Controla a barra de loading global via DOM — funciona em qualquer tela
  // sem precisar injetar <GlobalLoadingBar> em cada return() da árvore
  useEffect(() => {
    if (anyLoading) showLoadingBar();
    else hideLoadingBar();
  }, [anyLoading]);

  if (loading) return (
    <div style={S.splash}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
        <div style={{ fontSize:56, filter:"drop-shadow(0 0 24px #FF6B35)", animation:"pulse 1.5s ease-in-out infinite" }}>⚡</div>
        <div style={{ fontSize:36, fontWeight:900, color:"#fff", letterSpacing:-1 }}>
          Diária<span style={{ color:"#FF6B35" }}>Já</span>
        </div>
        <p style={{ color:"var(--text-2,#64748b)", fontSize:15, marginTop:8 }}>Carregando...</p>
        <p style={{ color:"var(--text-label,#475569)", fontSize:12, marginTop:4 }}>Se demorar, verifique sua conexão</p>
        <button
          style={{ marginTop:8, background:"none", border:"1px solid #334155", color:"var(--text-3,#94a3b8)", borderRadius:10, padding:"8px 20px", fontSize:13, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
          onClick={() => { setLoading(false); setTela("splash"); }}>
          Ir para o início
        </button>
      </div>
    </div>
  );

  // ── MODAL DE TERMOS COMPLETO (acessível de qualquer tela) ───────────
  // (gate removido: landing é mostrada primeiro, consent ocorre no cadastro)
  {mostrarTermos && (
        <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:999, overflowY:"auto", fontFamily:"Inter, system-ui, sans-serif" }}>
          <div style={{ position:"sticky", top:0, background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"16px 20px", display:"flex", alignItems:"center", gap:12, zIndex:1 }}>
            <button style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#FF6B35", padding:0 }} onClick={() => setMostrarTermos(false)}>←</button>
            <div style={{ fontWeight:900, fontSize:17, color:"#0f172a" }}>Termos de Uso — DiáriaJá</div>
          </div>
          <div style={{ padding:"20px 20px 60px", maxWidth:480, margin:"0 auto" }}>
            {[
              { titulo:"1. Apresentação", body:`O DiáriaJá é uma plataforma digital (PWA) que conecta trabalhadores autônomos (diaristas) a empregadores — pessoas físicas e estabelecimentos comerciais — para contratação de serviços pontuais nas categorias: Doméstico, Supermercado, Restaurante, Construção, Eventos, Saúde & Cuidado, Logística e Pet & Animais.\n\nAo acessar, cadastrar-se ou utilizar o DiáriaJá, você declara que leu, compreendeu e aceitou integralmente este Termo. Caso não concorde, interrompa o uso imediatamente.\n\nEste Termo observa: LGPD (Lei nº 13.709/2018), Marco Civil da Internet (Lei nº 12.965/2014), CDC (Lei nº 8.078/1990) e LC nº 150/2015.` },
              { titulo:"2. Natureza da Plataforma", body:`O DiáriaJá é um ambiente digital de intermediação. Não prestamos serviços diretamente, não somos empregador das diaristas e não garantimos qualidade, presença ou pagamento externo.\n\nA relação entre diarista e empregador, após o aceite, é de responsabilidade exclusiva das partes. A prestação por mais de dois dias por semana, com pessoalidade e continuidade, pode configurar vínculo doméstico (LC nº 150/2015) — cabendo às partes avaliar suas obrigações legais.` },
              { titulo:"3. Cadastro e Conta", body:`O cadastro exige dados verdadeiros, atualizados e completos. O DiáriaJá adota modelo dual: o mesmo usuário pode alternar entre modo diarista e empregador.\n\nÉ proibido: criar perfis falsos, usar CPF de terceiros, simular avaliações, duplicar contas abusivamente. O usuário responde por toda atividade realizada em sua conta.\n\nO usuário declara ser maior de 18 anos e plenamente capaz para praticar atos da vida civil.` },
              { titulo:"4. Perfil do Diarista", body:`O perfil pode conter: nome, foto, cidade, localização aproximada, habilidades, categorias, disponibilidade, histórico de diárias e avaliações. O CPF é coletado para verificação interna e nunca exibido publicamente.\n\nO DiáriaJá exibe um badge "✅ Verificado" para diaristas com CPF ou CNPJ cadastrado — indicador de identidade verificada, sem garantia de idoneidade absoluta.\n\nO diarista pode publicar portfólio com até 3 fotos de trabalhos anteriores.` },
              { titulo:"5. Perfil do Empregador", body:`O perfil pode conter: nome, foto, tipo de negócio, segmento, endereço do serviço, histórico e avaliações recebidas. O empregador compromete-se a publicar apenas oportunidades reais, lícitas e compatíveis com a plataforma.\n\nÉ proibido solicitar atividades ilegais, perigosas, humilhantes ou incompatíveis com o escopo informado.` },
              { titulo:"6. Publicação de Diárias", body:`O empregador publica uma diária informando: data, categoria, função, valor, horário, local (CEP + mapa) e observações. O empregador pode criar diárias recorrentes (semanais ou quinzenais).\n\nA publicação não garante candidatos disponíveis. O empregador pode cancelar uma diária, informando motivo — os candidatos serão notificados automaticamente.` },
              { titulo:"7. Candidaturas, Convites e Aceite", body:`O diarista pode se candidatar a vagas compatíveis com seu perfil. Ao se candidatar, declara intenção real de realizar o serviço.\n\nO empregador também pode enviar convites diretos a diaristas. O diarista pode aceitar ou recusar.\n\nApós o aceite, as demais candidaturas são recusadas automaticamente. O diarista confirma presença via QR Code gerado no app — esse evento marca o início da diária.` },
              { titulo:"8. Comunicação e Chat", body:`O chat é exclusivo para fins relacionados à diária. É proibido usar o canal para assédio, ameaças, spam, discriminação, pedido de dados excessivos, conteúdo ilegal ou manipulação de avaliações.\n\nO DiáriaJá armazena mensagens para fins de segurança e resolução de conflitos, conforme a LGPD.` },
              { titulo:"9. Pagamentos e Taxa de Plataforma", body:`O DiáriaJá facilita o pagamento via chave PIX exibida no app. A taxa de plataforma é de 1,5% sobre o valor da diária, devida pelo empregador. Esse valor deve ser enviado separadamente via PIX para suporte@diariaja.com.br.\n\nO DiáriaJá não processa pagamentos diretamente. Não nos responsabilizamos por atrasos, inadimplementos ou acordos realizados fora da plataforma.\n\nO sistema de planos (Grátis, Pro, Premium) oferece funcionalidades diferenciadas para empregadores.` },
              { titulo:"10. Cancelamentos e Conclusão", body:`Empregador pode cancelar diárias abertas ou em andamento, informando motivo. Diarista pode cancelar diária aceita, informando motivo — a vaga volta a "aberta".\n\nDiárias são concluídas após QR Code de check-in + confirmação de encerramento. Após a conclusão, ambas as partes podem avaliar a experiência.\n\nO DiáriaJá registra todos os eventos (candidatura, aceite, cancelamento, conclusão) para fins de reputação e segurança.` },
              { titulo:"11. Avaliações e Reputação", body:`Empregadores e diaristas podem avaliar uns aos outros após a conclusão da diária. As avaliações devem refletir experiências reais, de forma honesta e respeitosa.\n\nÉ proibido publicar avaliações falsas, ofensivas, compradas ou manipuladas. O DiáriaJá pode remover avaliações que violem este Termo.\n\nO histórico de avaliações é público e compõe a reputação do usuário na plataforma.` },
              { titulo:"12. Geolocalização", body:`O DiáriaJá usa geolocalização (GPS do dispositivo ou CEP informado) para calcular distância entre diaristas e vagas. O usuário pode revogar a permissão nas configurações — isso limita funcionalidades de proximidade.\n\nÉ proibido usar informações de localização para perseguição, assédio ou qualquer finalidade fora da contratação legítima de diárias.` },
              { titulo:"13. Dados Pessoais e Privacidade (LGPD)", body:`Tratamos os seguintes dados: nome, e-mail, foto, CPF/CNPJ (privado), geolocalização, endereço do serviço, histórico de diárias, candidaturas, mensagens e registros técnicos.\n\nFinalidades: cadastro, autenticação, segurança, cálculo de distância, exibição de perfis, comunicação, melhoria do produto e cumprimento legal.\n\nO CPF nunca é exibido publicamente — apenas o badge "Verificado" é visível.\n\nVocê pode solicitar acesso, correção, exclusão ou portabilidade dos seus dados pelo e-mail suporte@diariaja.com.br. Para encerrar sua conta, entre em contato pelo mesmo canal.` },
              { titulo:"14. Condutas Proibidas", body:`São proibidas: fraude ou falsidade de dados; discriminação por raça, sexo, religião, origem ou condição social; assédio e violência; atividades ilícitas; spam, engenharia reversa, raspagem de dados; conteúdo ofensivo, pornográfico ou difamatório.\n\nO descumprimento pode resultar em suspensão ou exclusão definitiva da conta, além de comunicação às autoridades competentes.` },
              { titulo:"15. Limitação de Responsabilidade", body:`O DiáriaJá não se responsabiliza por: informações falsas de usuários, descumprimento de acordos entre partes, inadimplemento de pagamento, qualidade do serviço, furtos, acidentes, conflitos pessoais, falhas de conexão ou serviços externos.\n\nEssa limitação não exclui responsabilidades previstas em lei, especialmente no CDC.` },
              { titulo:"16. Alterações do Termo", body:`O DiáriaJá pode atualizar este Termo. Alterações relevantes serão comunicadas via notificação no app. O uso continuado após a publicação da nova versão indica aceitação. Versões novas requerem novo aceite explícito.` },
              { titulo:"17. Informações da Operadora", body:`Aplicativo: DiáriaJá\nVersão: Beta 1.0\nData: 21 de maio de 2026\nE-mail de suporte: suporte@diariaja.com.br\nURL: diariaja.vercel.app\n\nRazão social, CNPJ e foro serão informados quando da formalização empresarial. O foro aplicável é o do domicílio do consumidor, em caso de relação de consumo, conforme o CDC.` },
            ].map(({ titulo, body }) => (
              <div key={titulo} style={{ marginBottom:24 }}>
                <div style={{ fontWeight:900, fontSize:15, color:"#0f172a", marginBottom:8, paddingBottom:6, borderBottom:"2px solid #FF6B35" }}>{titulo}</div>
                {body.split("\n\n").map((p, i) => (
                  <p key={i} style={{ fontSize:13, color:"#475569", lineHeight:1.7, marginBottom:10 }}>{p}</p>
                ))}
              </div>
            ))}
            <button
              style={{ width:"100%", padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:8 }}
              onClick={() => { setMostrarTermos(false); setCheckTermos(true); }}>
              ✅ Entendido — Aceitar os Termos
            </button>
          </div>
        </div>
  )}
  // ────────────────────────────────────────────────────────────────────────

  // SPLASH
  if (tela === "splash") return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#060d1f 0%,#0d1a35 60%,#0f2040 100%)", fontFamily:"Inter, system-ui, sans-serif", display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto", position:"relative", overflow:"hidden" }}>

      {/* Brilho de fundo centralizado */}
      <div style={{ position:"absolute", top:"8%", left:"50%", transform:"translateX(-50%)", width:320, height:320, background:"radial-gradient(circle,rgba(255,107,53,.2) 0%,transparent 70%)", pointerEvents:"none" }} />
      {/* Segundo brilho sutil na base */}
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)", width:360, height:180, background:"radial-gradient(ellipse,rgba(255,107,53,.08) 0%,transparent 70%)", pointerEvents:"none" }} />

      {/* ── HERO ── */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"56px 28px 0" }}>

        {/* Raio com glow */}
        <div style={{ fontSize:80, filter:"drop-shadow(0 0 36px #FF6B35) drop-shadow(0 0 10px #FF6B35bb)", marginBottom:16, lineHeight:1 }}>⚡</div>

        {/* Logo */}
        <div style={{ fontSize:52, fontWeight:900, letterSpacing:-2, lineHeight:1, marginBottom:8 }}>
          <span style={{ color:"#ffffff" }}>Diária</span><span style={{ color:"#FF6B35" }}>Já</span>
        </div>

        {/* Linha gradiente */}
        <div style={{ width:200, height:2, background:"linear-gradient(90deg,transparent,#FF6B35,transparent)", marginBottom:22 }} />

        {/* Tagline */}
        <p style={{ fontSize:16, color:"#94a3b8", textAlign:"center", lineHeight:1.6, margin:"0 0 4px", fontWeight:400 }}>
          Contrate ou encontre serviços por diária
        </p>
        <p style={{ fontSize:21, color:"#FF6B35", textAlign:"center", lineHeight:1.4, margin:"0 0 8px", fontWeight:900, letterSpacing:-0.3 }}>
          em Campo Grande/MS
        </p>
        <p style={{ fontSize:12, color:"#64748b", textAlign:"center", lineHeight:1.6, margin:"0 0 26px", maxWidth:300 }}>
          Conectamos contratantes, empresas e profissionais autônomos com perfis verificados, chat, avaliações e confirmação de presença pelo app.
        </p>

        {/* ── 3 cards de features — ícones SVG laranja, sem dependência de emoji ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, width:"100%", marginBottom:22 }}>
          {([
            {
              svg: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  <path d="M21 21v-2a4 4 0 0 0-3-3.87"/>
                </svg>
              ),
              title:"Profissionais", sub:"verificados",
            },
            {
              svg: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              ),
              title:"Contratação", sub:"em minutos",
            },
            {
              svg: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <polyline points="9 12 11 14 15 10"/>
                </svg>
              ),
              title:"Mais seguro", sub:"para todos",
            },
          ] as { svg: React.ReactNode; title: string; sub: string }[]).map(f => (
            <div key={f.title} style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,107,53,.22)", borderRadius:18, padding:"16px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:9 }}>
              <div style={{ width:46, height:46, background:"rgba(255,107,53,.18)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {f.svg}
              </div>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:"#f1f5f9", fontSize:12, fontWeight:800, lineHeight:1.3 }}>{f.title}</div>
                <div style={{ color:"var(--text-2,#64748b)", fontSize:11, marginTop:2 }}>{f.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Categorias / Social proof ── */}
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" as const, marginBottom:4 }}>
          {[
            { dot:"🏠", txt:"Doméstico" },
            { dot:"🍽️", txt:"Restaurante" },
            { dot:"🏗️", txt:"Construção" },
            { dot:"🎉", txt:"Eventos" },
            { dot:"🚚", txt:"Delivery" },
          ].map(b => (
            <div key={b.txt} style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:20, padding:"5px 12px", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ fontSize:11 }}>{b.dot}</span>
              <span style={{ color:"var(--text-3,#94a3b8)", fontSize:11, fontWeight:600 }}>{b.txt}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Seção de Confiança ── */}
      <div style={{ padding:"16px 24px 0" }}>
        <div style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:20, padding:"16px 18px" }}>
          <p style={{ color:"var(--text-3,#94a3b8)", fontSize:11, fontWeight:800, textTransform:"uppercase" as const, letterSpacing:0.8, textAlign:"center", marginBottom:12 }}>
            🛡️ Como protegemos os dois lados
          </p>
          <div style={{ display:"flex", flexDirection:"column" as const, gap:8 }}>
            {[
              { icon:"✅", txt:"Perfis verificados por CPF/CNPJ" },
              { icon:"⭐", txt:"Sistema de avaliações mútuas" },
              { icon:"📋", txt:"Termos de uso claros e transparentes" },
              { icon:"🔒", txt:"Dados protegidos pela LGPD" },
            ].map(item => (
              <div key={item.txt} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:14, flexShrink:0 }}>{item.icon}</span>
                <span style={{ color:"#cbd5e1", fontSize:12, fontWeight:500 }}>{item.txt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Como funciona — 6 passos ── */}
      <div style={{ padding:"16px 24px 0" }}>
        <div style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:20, padding:"16px 18px" }}>
          <p style={{ color:"var(--text-3,#94a3b8)", fontSize:11, fontWeight:800, textTransform:"uppercase" as const, letterSpacing:0.8, textAlign:"center", marginBottom:14 }}>
            📋 Como funciona
          </p>
          <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
            {[
              { n:"1", txt:"Crie sua conta como contratante, profissional ou empresa." },
              { n:"2", txt:"Complete seu perfil com dados básicos e área de atuação." },
              { n:"3", txt:"Publique uma diária ou candidate-se às vagas próximas." },
              { n:"4", txt:"Converse pelo chat e combine os detalhes com a outra parte." },
              { n:"5", txt:"Confirme a presença pelo QR Code no início do serviço." },
              { n:"6", txt:"Finalize, gere o comprovante e avalie a experiência." },
            ].map(step => (
              <div key={step.n} style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                <div style={{ width:22, height:22, borderRadius:8, background:"rgba(255,107,53,.25)", border:"1px solid rgba(255,107,53,.4)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                  <span style={{ color:"#FF6B35", fontSize:11, fontWeight:900, lineHeight:1 }}>{step.n}</span>
                </div>
                <span style={{ color:"#cbd5e1", fontSize:12, lineHeight:1.5 }}>{step.txt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spacer flexível */}
      <div style={{ flex:1, minHeight:12 }} />

      {/* ── Botões ── */}
      <div style={{ padding:"0 24px 44px", display:"flex", flexDirection:"column", gap:12 }}>

        {/* Entrar — laranja sólido */}
        <button
          style={{ width:"100%", padding:"16px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:16, fontSize:17, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 6px 24px rgba(255,107,53,.55)", letterSpacing:0.3 }}
          onClick={() => setTela("login")}>
          Entrar
        </button>

        {/* Cadastrar — fundo branco quase opaco, texto laranja: contraste máximo */}
        <button
          style={{ width:"100%", padding:"15px", background:"rgba(255,255,255,.93)", color:"#FF6B35", border:"none", borderRadius:16, fontSize:16, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", letterSpacing:0.2 }}
          onClick={() => setTela("cadastro-tipo")}>
          Cadastrar agora
        </button>

        <p style={{ textAlign:"center", color:"var(--text-label,#475569)", fontSize:11, margin:"6px 0 0", lineHeight:1.8 }}>
          Ao entrar você concorda com nossos{" "}
          <span style={{ color:"#FF6B35", cursor:"pointer" }} onClick={() => setTela("suporte")}>Termos de uso</span>
          {"  ·  "}
          <span style={{ color:"#FF6B35", cursor:"pointer" }} onClick={() => setModalQuemSomos(true)}>Quem Somos</span>
        </p>
      </div>

      {/* Modal Quem Somos */}
      {modalQuemSomos && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:9999, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={() => setModalQuemSomos(false)}>
          <div style={{ background:"#0d1a35", borderRadius:"24px 24px 0 0", padding:"28px 24px 48px", maxWidth:480, width:"100%", maxHeight:"88vh", overflowY:"auto" }}
            onClick={e => e.stopPropagation()}>

            {/* Handle */}
            <div style={{ width:40, height:4, background:"rgba(255,255,255,.2)", borderRadius:2, margin:"0 auto 24px" }} />

            {/* Header */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
              <div style={{ width:46, height:46, borderRadius:14, background:"rgba(255,107,53,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>⚡</div>
              <div>
                <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>
                  Diária<span style={{ color:"#FF6B35" }}>Já</span>
                </div>
                <div style={{ fontSize:12, color:"var(--text-3,#94a3b8)" }}>Plataforma de anúncios de serviços por diária</div>
              </div>
            </div>

            {/* Missão */}
            <div style={{ background:"rgba(255,107,53,.1)", border:"1px solid rgba(255,107,53,.25)", borderRadius:16, padding:"16px 18px", marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:800, color:"#FF6B35", textTransform:"uppercase" as const, letterSpacing:1, marginBottom:8 }}>🎯 Missão</div>
              <p style={{ fontSize:14, color:"#e2e8f0", lineHeight:1.7, margin:0 }}>
                Ser o principal canal de anúncios entre quem oferece e quem busca serviços informais por diária em Campo Grande e região — aproximando pessoas de forma simples, rápida e transparente.
              </p>
            </div>

            {/* Visão */}
            <div style={{ background:"rgba(59,130,246,.1)", border:"1px solid rgba(59,130,246,.25)", borderRadius:16, padding:"16px 18px", marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:800, color:"#60a5fa", textTransform:"uppercase" as const, letterSpacing:1, marginBottom:8 }}>🔭 Visão</div>
              <p style={{ fontSize:14, color:"#e2e8f0", lineHeight:1.7, margin:0 }}>
                Ser reconhecida como a plataforma de referência em Mato Grosso do Sul para anúncios de diárias — expandindo para todo o Brasil e democratizando o acesso a oportunidades de renda, um anúncio de cada vez.
              </p>
            </div>

            {/* Valores */}
            <div style={{ background:"rgba(139,92,246,.1)", border:"1px solid rgba(139,92,246,.25)", borderRadius:16, padding:"16px 18px", marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:800, color:"#a78bfa", textTransform:"uppercase" as const, letterSpacing:1, marginBottom:12 }}>💎 Valores</div>
              <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
                {[
                  { icon:"🤝", titulo:"Transparência", desc:"Anunciamos com clareza: somos uma plataforma de divulgação. Cada parte é responsável pela relação que estabelece." },
                  { icon:"⚡", titulo:"Agilidade", desc:"Conexão rápida entre quem anuncia e quem procura — sem burocracia desnecessária." },
                  { icon:"🛡️", titulo:"Respeito", desc:"Valorizamos a dignidade de quem trabalha e de quem contrata, promovendo uma comunidade de respeito mútuo." },
                  { icon:"🌱", titulo:"Inclusão", desc:"Acreditamos que toda pessoa merece acesso a oportunidades de renda, independentemente de formação ou histórico." },
                  { icon:"📋", titulo:"Responsabilidade", desc:"Prezamos pelo uso ético da plataforma e cumprimento das leis aplicáveis por todas as partes envolvidas." },
                ].map(v => (
                  <div key={v.titulo} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                    <span style={{ fontSize:18, flexShrink:0, marginTop:1 }}>{v.icon}</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:800, color:"#f1f5f9", marginBottom:2 }}>{v.titulo}</div>
                      <div style={{ fontSize:12, color:"var(--text-3,#94a3b8)", lineHeight:1.6 }}>{v.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Nota legal */}
            <div style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:12, padding:"12px 14px", marginBottom:20 }}>
              <div style={{ fontSize:11, color:"var(--text-2,#64748b)", lineHeight:1.6 }}>
                ⚠️ <strong style={{ color:"var(--text-3,#94a3b8)" }}>Aviso legal:</strong> O DiáriaJá é uma plataforma de anúncios. Não somos empregador, agência de emprego nem parte em qualquer contrato de prestação de serviços firmado entre usuários. Cada usuário é responsável por suas relações e obrigações. Consulte nossos <span style={{ color:"#FF6B35", cursor:"pointer" }} onClick={() => { setModalQuemSomos(false); setTela("suporte"); }}>Termos de Uso</span>.
              </div>
            </div>

            <button
              style={{ width:"100%", padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
              onClick={() => setModalQuemSomos(false)}>
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // LOGIN
  if (tela === "login") return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#060d1f 0%,#0d1a35 60%,#0f2040 100%)", fontFamily:"Inter, system-ui, sans-serif", display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto", padding:"0 24px" }}>

      <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:15, cursor:"pointer", padding:"52px 0 0", textAlign:"left", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => { setAuthError(""); setTela("splash"); }}>
        ← Voltar
      </button>

      {/* Logo compacta */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", margin:"24px 0 32px" }}>
        <div style={{ fontSize:40, filter:"drop-shadow(0 0 16px #FF6B35)", marginBottom:8 }}>⚡</div>
        <div style={{ fontSize:30, fontWeight:900, letterSpacing:-1 }}>
          <span style={{ color:"#fff" }}>Diária</span><span style={{ color:"#FF6B35" }}>Já</span>
        </div>
        <p style={{ color:"var(--text-2,#64748b)", fontSize:13, marginTop:4 }}>Bem-vindo de volta</p>
      </div>

      {/* Card de login */}
      <div style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:24, padding:"24px 20px" }}>
        <button style={{ width:"100%", padding:"13px", background:"var(--bg-card,#fff)", color:"var(--text-1,#0f172a)", border:"none", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:4 }} onClick={handleGoogleLogin}>
          {GoogleSVG} Entrar com Google
        </button>

        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"16px 0" }}>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,.1)" }} />
          <span style={{ color:"var(--text-label,#475569)", fontSize:12 }}>ou</span>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,.1)" }} />
        </div>

        {/* Toggle entre login por e-mail e por CPF/CNPJ */}
        <div style={{ display:"flex", gap:4, background:"rgba(255,255,255,.05)", borderRadius:10, padding:3, marginBottom:14 }}>
          {([
            { id: "email", label: "E-mail" },
            { id: "cpf",   label: "CPF / CNPJ" },
          ] as const).map(opt => {
            const ativo = modoLogin === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => { setAuthError(""); setModoLogin(opt.id); }}
                style={{
                  flex:1, padding:"8px 10px", border:"none", borderRadius:8,
                  background: ativo ? "#FF6B35" : "transparent",
                  color: ativo ? "#fff" : "var(--text-3,#94a3b8)",
                  fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>

        {modoLogin === "email" ? (
          <>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, display:"block", marginBottom:6 }}>E-mail</label>
            <input
              id="login-email"
              aria-label="E-mail"
              type="email"
              autoComplete="email"
              style={{ width:"100%", padding:"13px 16px", border:"1.5px solid rgba(255,255,255,.12)", borderRadius:12, fontSize:15, background:"rgba(255,255,255,.07)", color:"#f1f5f9", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, outline:"none", marginBottom:12 }}
              placeholder="seu@email.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
          </>
        ) : (
          <>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, display:"block", marginBottom:6 }}>CPF ou CNPJ</label>
            <input
              id="login-cpf"
              aria-label="CPF ou CNPJ"
              inputMode="numeric"
              autoComplete="off"
              style={{ width:"100%", padding:"13px 16px", border:"1.5px solid rgba(255,255,255,.12)", borderRadius:12, fontSize:15, background:"rgba(255,255,255,.07)", color:"#f1f5f9", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, outline:"none", marginBottom:12, letterSpacing:0.5 }}
              placeholder="000.000.000-00"
              value={loginCpfInput}
              onChange={e => {
                const d = e.target.value.replace(/\D/g, "").slice(0, 14);
                setLoginCpfInput(d.length <= 11 ? maskCPF(d) : maskCNPJ(d));
              }} />
          </>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <label htmlFor="login-senha" style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5 }}>Senha</label>
        </div>
        <div style={{ position:"relative" as const }}>
          <input
            id="login-senha"
            aria-label="Senha"
            autoComplete="current-password"
            style={{ width:"100%", padding:"13px 46px 13px 16px", border:"1.5px solid rgba(255,255,255,.12)", borderRadius:12, fontSize:15, background:"rgba(255,255,255,.07)", color:"#f1f5f9", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, outline:"none" }}
            placeholder="Sua senha" type={mostrarSenha ? "text" : "password"} value={form.senha} onChange={e=>setForm({...form,senha:e.target.value})} />
          <button type="button" aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"} style={{ position:"absolute" as const, right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#94a3b8", fontSize:18, padding:0, lineHeight:1 }}
            onClick={() => setMostrarSenha(p => !p)}>
            {mostrarSenha ? "🙈" : "👁️"}
          </button>
        </div>

        {authError && <p style={{ color:"#f87171", fontSize:13, fontWeight:600, marginTop:8, textAlign:"center" }}>{authError}</p>}

        {modoLogin === "cpf" ? (
          <p style={{ color:"#94a3b8", fontSize:11, marginTop:8, textAlign:"center" as const, lineHeight:1.5 }}>
            Esqueceu a senha? Volte pro login por <strong style={{ color:"#fff", cursor:"pointer" }} onClick={() => { setAuthError(""); setModoLogin("email"); }}>e-mail</strong> pra recuperar.
          </p>
        ) : resetSenhaEnviado ? (
          <p style={{ color:"#4ade80", fontSize:13, fontWeight:600, marginTop:8, textAlign:"center" }}>
            ✅ Link enviado! Verifique seu e-mail (inclusive o spam).
          </p>
        ) : (
          <p style={{ textAlign:"right", marginTop:8, marginBottom:0 }}>
            <span
              style={{ color:"#94a3b8", fontSize:12, cursor:"pointer", textDecoration:"underline" }}
              onClick={handleResetSenha}>
              {resetSenhaLoading ? "Enviando..." : "Esqueci minha senha"}
            </span>
          </p>
        )}

        <button style={{ width:"100%", padding:"15px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:16, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:16, opacity:authLoading?0.6:1, boxShadow:"0 4px 16px rgba(255,107,53,.4)" }}
          disabled={authLoading} onClick={modoLogin === "email" ? handleEmailLogin : handleCPFLogin}>
          {authLoading ? "Entrando..." : "Entrar"}
        </button>
      </div>

      <p style={{ textAlign:"center", color:"var(--text-2,#64748b)", fontSize:14, marginTop:20, cursor:"pointer" }} onClick={() => { setAuthError(""); setTela("cadastro-tipo"); }}>
        Não tem conta? <span style={{ color:"#FF6B35", fontWeight:700 }}>Cadastre-se grátis</span>
      </p>
    </div>
  );

  // CADASTRO TIPO
  if (tela === "cadastro-tipo") return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#060d1f 0%,#0d1a35 60%,#0f2040 100%)", fontFamily:"Inter, system-ui, sans-serif", display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto", padding:"0 24px 40px" }}>

      <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:15, cursor:"pointer", padding:"52px 0 0", textAlign:"left", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setTela("splash")}>
        ← Voltar
      </button>

      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", margin:"24px 0 32px" }}>
        <div style={{ fontSize:36, filter:"drop-shadow(0 0 16px #FF6B35)", marginBottom:8 }}>⚡</div>
        <div style={{ fontSize:26, fontWeight:900, letterSpacing:-0.5 }}>
          <span style={{ color:"#fff" }}>Diária</span><span style={{ color:"#FF6B35" }}>Já</span>
        </div>
        <p style={{ color:"var(--text-3,#94a3b8)", fontSize:14, marginTop:8 }}>Como você vai usar o app?</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:12 }}>
        {[
          { key:"empregador", icone:"🏢", label:"Quero contratar", desc:"Negócio, restaurante, obra..." },
          { key:"diarista",   icone:"👷", label:"Quero trabalhar", desc:"Encontrar vagas próximas" },
        ].map(t => (
          <div key={t.key}
            style={{ background: tipo===t.key ? "rgba(255,107,53,.15)" : "rgba(255,255,255,.06)", border: tipo===t.key ? "2px solid #FF6B35" : "1.5px solid rgba(255,255,255,.1)", borderRadius:20, padding:"24px 14px", display:"flex", flexDirection:"column", alignItems:"center", gap:10, cursor:"pointer" }}
            onClick={() => setTipo(t.key)}>
            <span style={{ fontSize:36 }}>{t.icone}</span>
            <span style={{ fontWeight:800, fontSize:15, color:tipo===t.key?"#FF6B35":"#f1f5f9" }}>{t.label}</span>
            <span style={{ fontSize:11, color:"var(--text-2,#64748b)", textAlign:"center" }}>{t.desc}</span>
          </div>
        ))}
      </div>
      {/* Card empresa — linha separada, largura total */}
      <div
        style={{ background: tipo==="empresa" ? "rgba(58,134,255,.18)" : "rgba(255,255,255,.06)", border: tipo==="empresa" ? "2px solid #3A86FF" : "1.5px solid rgba(255,255,255,.1)", borderRadius:20, padding:"18px 14px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, cursor:"pointer", marginBottom:24 }}
        onClick={() => setTipo("empresa")}>
        <span style={{ fontSize:36 }}>🏢</span>
        <span style={{ fontWeight:800, fontSize:15, color:tipo==="empresa"?"#3A86FF":"#f1f5f9" }}>Empresa com CNPJ</span>
        <span style={{ fontSize:11, color:"var(--text-2,#64748b)", textAlign:"center" as const }}>Pessoa jurídica — CNPJ obrigatório</span>
      </div>

      <button style={{ width:"100%", padding:"15px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:16, fontSize:16, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", opacity:tipo?1:0.35, boxShadow:"0 4px 16px rgba(255,107,53,.4)" }}
        disabled={!tipo}
        onClick={() => {
          if (tipo === "empresa") {
            setForm(prev => ({ ...prev, pessoaTipo: "juridica" }));
            if (session) { setTela("cadastro-empregador"); }
            else { setTela("cadastro-auth"); }
          } else if (session) {
            setTela(tipo === "empregador" ? "cadastro-empregador" : "cadastro-diarista");
          } else {
            setTela("cadastro-auth");
          }
        }}>
        Continuar →
      </button>
    </div>
  );

  // CADASTRO AUTH (email/senha + Google)
  if (tela === "cadastro-auth") return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#060d1f 0%,#0d1a35 60%,#0f2040 100%)", fontFamily:"Inter, system-ui, sans-serif", display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto", padding:"0 24px 40px" }}>

      <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:15, cursor:"pointer", padding:"52px 0 0", textAlign:"left", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => { setAuthError(""); setTela("cadastro-tipo"); }}>
        ← Voltar
      </button>

      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", margin:"24px 0 28px" }}>
        <div style={{ fontSize:36, filter:"drop-shadow(0 0 16px #FF6B35)", marginBottom:8 }}>⚡</div>
        <div style={{ fontSize:26, fontWeight:900, letterSpacing:-0.5 }}>
          <span style={{ color:"#fff" }}>Diária</span><span style={{ color:"#FF6B35" }}>Já</span>
        </div>
        <p style={{ color:"var(--text-3,#94a3b8)", fontSize:14, marginTop:6 }}>Crie sua conta grátis</p>
        {/* Microcopy contextual baseado no tipo de perfil */}
        {tipo === "empregador" && (
          <p style={{ color:"#FF6B35", fontSize:13, fontWeight:600, marginTop:6, textAlign:"center" }}>
            👔 Em poucos minutos você publica sua primeira vaga.
          </p>
        )}
        {tipo === "diarista" && (
          <p style={{ color:"#4ade80", fontSize:13, fontWeight:600, marginTop:6, textAlign:"center" }}>
            💼 Cadastre-se e comece a receber propostas de trabalho.
          </p>
        )}
        {tipo === "empresa" && (
          <p style={{ color:"#60a5fa", fontSize:13, fontWeight:600, marginTop:6, textAlign:"center" }}>
            🏢 Você precisará do CNPJ da empresa no próximo passo.
          </p>
        )}
      </div>

      <div style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:24, padding:"24px 20px" }}>
        <button style={{ width:"100%", padding:"13px", background:"var(--bg-card,#fff)", color:"var(--text-1,#0f172a)", border:"none", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:4 }} onClick={handleGoogleLogin}>
          {GoogleSVG} Cadastrar com Google
        </button>

        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"16px 0" }}>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,.1)" }} />
          <span style={{ color:"var(--text-label,#475569)", fontSize:12 }}>ou com e-mail</span>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,.1)" }} />
        </div>

        <label style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, display:"block", marginBottom:6 }}>E-mail</label>
        <input id="cad-email" aria-label="E-mail" type="email" autoComplete="email" style={{ width:"100%", padding:"13px 16px", border:"1.5px solid rgba(255,255,255,.12)", borderRadius:12, fontSize:15, background:"rgba(255,255,255,.07)", color:"#f1f5f9", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, outline:"none", marginBottom:12 }}
          placeholder="seu@email.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />

        <label style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, display:"block", marginBottom:6 }}>Senha</label>
        <div style={{ position:"relative" as const }}>
          <input style={{ width:"100%", padding:"13px 46px 13px 16px", border:"1.5px solid rgba(255,255,255,.12)", borderRadius:12, fontSize:15, background:"rgba(255,255,255,.07)", color:"#f1f5f9", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, outline:"none" }}
            id="cad-senha" aria-label="Senha" autoComplete="new-password" placeholder="Mínimo 6 caracteres" type={mostrarSenhaCadastro ? "text" : "password"} value={form.senha} onChange={e=>setForm({...form,senha:e.target.value})} />
          <button type="button" aria-label={mostrarSenhaCadastro ? "Ocultar senha" : "Mostrar senha"} style={{ position:"absolute" as const, right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#94a3b8", fontSize:18, padding:0, lineHeight:1 }}
            onClick={() => setMostrarSenhaCadastro(p => !p)}>
            {mostrarSenhaCadastro ? "🙈" : "👁️"}
          </button>
        </div>

        {authError && <p style={{ color:"#f87171", fontSize:13, fontWeight:600, marginTop:8, textAlign:"center" }}>{authError}</p>}

        {/* ── Consentimento de Termos (obrigatório antes de criar conta) ── */}
        <label aria-label="Aceite dos Termos de Uso" style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", margin:"16px 0 4px", background:"#f8fafc", borderRadius:12, padding:"12px 14px", border:`1.5px solid ${checkTermos?"#FF6B35":"#e2e8f0"}` }}>
          <input
            id="chk-termos"
            type="checkbox"
            checked={checkTermos}
            onChange={e => setCheckTermos(e.target.checked)}
            style={{ width:18, height:18, accentColor:"#FF6B35", flexShrink:0, marginTop:2 }}
          />
          <span style={{ fontSize:12, color:"#475569", lineHeight:1.5 }}>
            Li e aceito os{" "}
            <span role="button" style={{ color:"#FF6B35", fontWeight:700, cursor:"pointer", textDecoration:"underline" }}
              onClick={e => { e.preventDefault(); setMostrarTermos(true); }}>
              Termos de Uso
            </span>{" "}
            e a Política de Privacidade do DiáriaJá.{" "}
            <span style={{ color:"#94a3b8" }}>CPF/CNPJ são usados apenas para verificação interna e nunca aparecem no perfil público.</span>
          </span>
        </label>

        <button
          style={{ width:"100%", padding:"15px", background: checkTermos ? "#FF6B35" : "#cbd5e1", color: checkTermos ? "#fff" : "#94a3b8", border:"none", borderRadius:12, fontSize:16, fontWeight:800, cursor: checkTermos ? "pointer" : "default", fontFamily:"Inter, system-ui, sans-serif", marginTop:12, opacity:authLoading?0.6:1, boxShadow: checkTermos ? "0 4px 16px rgba(255,107,53,.4)" : "none", transition:"all .2s" }}
          disabled={authLoading || !checkTermos} onClick={handleEmailSignup}>
          {authLoading ? "Criando conta..." : checkTermos ? "Criar conta grátis →" : "Marque a caixa acima para continuar"}
        </button>
      </div>

      <p style={{ textAlign:"center", color:"var(--text-2,#64748b)", fontSize:14, marginTop:20, cursor:"pointer" }} onClick={() => { setAuthError(""); setTela("login"); }}>
        Já tem conta? <span style={{ color:"#FF6B35", fontWeight:700 }}>Entrar</span>
      </p>

      {/* Modal de Termos completo (acessível do cadastro) */}
      {mostrarTermos && (
        <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9999, overflowY:"auto", fontFamily:"Inter, system-ui, sans-serif" }}>
          <div style={{ position:"sticky", top:0, background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"16px 20px", display:"flex", alignItems:"center", gap:12, zIndex:1 }}>
            <button aria-label="Fechar termos" style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#FF6B35", padding:0 }} onClick={() => setMostrarTermos(false)}>←</button>
            <div style={{ fontWeight:900, fontSize:17, color:"#0f172a" }}>Termos de Uso — DiáriaJá</div>
          </div>
          <div style={{ padding:"20px 20px 60px", maxWidth:480, margin:"0 auto" }}>
            {[
              { titulo:"1. Apresentação", body:`O DiáriaJá conecta contratantes, empresas e profissionais autônomos para serviços por diária em Campo Grande/MS. Ao se cadastrar, você declara ter lido e aceito este Termo.\n\nObserva: LGPD (Lei nº 13.709/2018), Marco Civil da Internet, CDC e LC nº 150/2015.` },
              { titulo:"2. Natureza da Plataforma", body:`Somos um canal de conexão — não prestamos serviços, não somos empregador e não garantimos qualidade ou pagamento externo. A relação entre as partes é de responsabilidade exclusiva delas.` },
              { titulo:"3. Cadastro e Conta", body:`O cadastro exige dados verdadeiros. É proibido criar perfis falsos, usar CPF de terceiros ou duplicar contas. O usuário deve ser maior de 18 anos e capaz de praticar atos civis.` },
              { titulo:"4. Dados Pessoais e Privacidade (LGPD)", body:`Tratamos nome, e-mail, foto, CPF/CNPJ (privado), geolocalização e histórico de diárias. CPF nunca é exibido publicamente. Para exclusão de dados: suporte@diariaja.com.br.` },
              { titulo:"5. Pagamentos", body:`Quando habilitado, o pagamento ocorre via Mercado Pago diretamente pelo app. A plataforma não se responsabiliza por acordos realizados fora da plataforma.` },
              { titulo:"6. Condutas Proibidas", body:`São proibidas: fraude, discriminação, assédio, atividades ilícitas, spam e conteúdo ofensivo. O descumprimento pode resultar em exclusão da conta e comunicação às autoridades.` },
              { titulo:"7. Limitação de Responsabilidade", body:`O DiáriaJá não se responsabiliza por informações falsas de usuários, descumprimento de acordos, inadimplemento, acidentes ou falhas de conexão.` },
              { titulo:"8. Informações", body:`DiáriaJá · Beta 1.0 · Campo Grande/MS\nsuporte@diariaja.com.br · diariaja.vercel.app\nForo: domicílio do consumidor (CDC).` },
            ].map(({ titulo, body }) => (
              <div key={titulo} style={{ marginBottom:24 }}>
                <div style={{ fontWeight:900, fontSize:15, color:"#0f172a", marginBottom:8, paddingBottom:6, borderBottom:"2px solid #FF6B35" }}>{titulo}</div>
                {body.split("\n\n").map((p, i) => (
                  <p key={i} style={{ fontSize:13, color:"#475569", lineHeight:1.7, marginBottom:10 }}>{p}</p>
                ))}
              </div>
            ))}
            <button
              style={{ width:"100%", padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:8 }}
              onClick={() => { setMostrarTermos(false); setCheckTermos(true); }}>
              ✅ Entendido — Aceitar os Termos
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // CONFIGURAÇÕES
  if (tela === "configuracoes") {
    const voltarHome = modoAtual === "diarista" ? "home-diarista" : "home-empregador";
    return (
      <div style={{ minHeight:"100vh", background:"var(--bg-app,#f0f2f5)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:40 }}>
        <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", padding:"48px 20px 24px" }}>
          <button style={{ background:"none", border:"none", color:"#94a3b8", fontSize:15, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:0, marginBottom:16 }} onClick={() => setTela(voltarHome)}>← Voltar</button>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:48, height:48, background:"rgba(255,255,255,.1)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>⚙️</div>
            <div>
              <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>Configurações</div>
              <div style={{ fontSize:13, color:"#94a3b8" }}>Gerencie sua conta e preferências</div>
            </div>
          </div>
        </div>

        {/* ── Painel de Nível de Confiabilidade ──────────────────────────── */}
        {(() => {
          const nivelConf = calcularNivelConfiabilidade({
            telefone_verificado: profile?.telefone_verificado || telefoneVerificado,
            email_confirmado: !!session?.user?.email_confirmed_at,
            cpf: profile?.cpf, cnpj: profile?.cnpj,
            documento_status: profile?.documento_status,
            mfa_enabled: false,
          });
          const pct = (nivelConf.nivel / 4) * 100;
          return (
            <div style={{ padding:"16px 16px 4px" }}>
              <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Confiabilidade</div>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"16px 18px", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                    <ShieldCheck size={18} color={nivelConf.cor} />
                    <strong style={{ fontSize:15, color:"var(--text-1,#0f172a)" }}>Nível {nivelConf.nivel} — {nivelConf.nome}</strong>
                  </div>
                  <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:700 }}>{nivelConf.nivel}/4</span>
                </div>
                {/* Barra de progresso */}
                <div style={{ height:6, background:"var(--bg-subtle,#f1f5f9)", borderRadius:3, overflow:"hidden", marginBottom:12 }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:nivelConf.cor, transition:"width .4s" }} />
                </div>
                {/* Pendências */}
                {nivelConf.pendencias.length > 0 ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {nivelConf.pendencias.map((p, i) => (
                      <div key={i} style={{ fontSize:12, color:"var(--text-2,#64748b)", display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:6, height:6, borderRadius:3, background:nivelConf.cor, flexShrink:0 }} />
                        {p}
                      </div>
                    ))}
                    {/* CTAs específicos */}
                    {!(profile?.telefone_verificado || telefoneVerificado) && (
                      <button
                        style={{ marginTop:10, padding:"10px 14px", background:nivelConf.cor, color:"#fff", border:"none", borderRadius:10, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={() => { hapticTick(); setTela("verificar-telefone"); }}>
                        📱 Verificar telefone agora
                      </button>
                    )}
                    {(profile?.telefone_verificado || telefoneVerificado) && !profile?.cpf && !profile?.cnpj && (
                      <button
                        style={{ marginTop:10, padding:"10px 14px", background:nivelConf.cor, color:"#fff", border:"none", borderRadius:10, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={() => { hapticTick(); setTela(modoAtual === "diarista" ? "editar-perfil" : "editar-perfil-empregador"); }}>
                        🆔 Adicionar CPF / CNPJ
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize:12, color:"#16a34a", fontWeight:700, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <CheckCircle2 size={14} /> Tudo verificado!
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Conta */}
        <div style={{ padding:"16px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Minha conta</div>
          <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
            {[
              { icon:"👤", label:"Alterar perfil", sub:"Nome, foto, especialidade e dados", action:() => setTela(modoAtual === "diarista" ? "editar-perfil" : "editar-perfil-empregador") },
              { icon:"🔑", label:"Alterar senha", sub:"Mude sua senha de acesso", action:() => setTela("alterar-senha") },
              { icon:"📱", label:"Verificar número de telefone", sub: telefoneVerificado ? "✅ Número verificado" : "Confirme seu número para mais segurança", action:() => setTela("verificar-telefone") },
              ...(pushEstado.suportado ? [{
                icon: pushEstado.inscrito ? "🔔" : "🔕",
                label: "Notificações push",
                sub: pushEstado.inscrito ? "✅ Ativas — você será notificado mesmo com app fechado"
                   : pushEstado.permissao === "denied" ? "❌ Bloqueadas no navegador — libere nas configurações"
                   : "Receba alertas de novas vagas e mensagens",
                action: pushEstado.inscrito ? () => {} : () => ativarPush(),
              }] : []),
            ].map((item, i, arr) => (
              <div key={item.label} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 16px", borderBottom: i < arr.length-1 ? "1px solid var(--border-sub,#f1f5f9)" : "none", cursor:"pointer" }}
                onClick={item.action}>
                <div style={{ width:40, height:40, background:"#f1f5f9", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{item.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{item.label}</div>
                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>{item.sub}</div>
                </div>
                <span style={{ color:"#cbd5e1", fontSize:18 }}>›</span>
              </div>
            ))}
          </div>
        </div>

        {/* Aparência */}
        <div style={{ padding:"12px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Aparência</div>
          <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:40, height:40, background:"#f1f5f9", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{darkMode ? "🌙" : "☀️"}</div>
                <div>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{darkMode ? "Modo escuro" : "Modo claro"}</div>
                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>Aparência do aplicativo</div>
                </div>
              </div>
              <div style={{ width:52, height:28, borderRadius:14, background:darkMode?"#FF6B35":"#e2e8f0", position:"relative", cursor:"pointer", transition:"background .2s" }} onClick={() => setDarkMode(p => !p)}>
                <div style={{ position:"absolute", top:3, left:darkMode?26:3, width:22, height:22, borderRadius:11, background:"var(--bg-card,#fff)", transition:"left .2s", boxShadow:"0 1px 4px rgba(0,0,0,.2)" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Informações */}
        <div style={{ padding:"12px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Informações</div>
          <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
            {[
              { icon:"🎧", label:"Suporte", sub:"Fale com nossa equipe", action:() => setTela("suporte") },
              { icon:"ℹ️", label:"Quem somos", sub:"Conheça o DiáriaJá", action:() => setModalQuemSomos(true) },
              { icon:"📄", label:"Termos de uso", sub:"Leia nossos termos e políticas", action:() => setMostrarTermos(true) },
              { icon:"🔒", label:"Política de Privacidade", sub:"Como tratamos seus dados (LGPD)", action:() => setTela("politica-privacidade") },
            ].map((item, i, arr) => (
              <div key={item.label} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 16px", borderBottom: i < arr.length-1 ? "1px solid var(--border-sub,#f1f5f9)" : "none", cursor:"pointer" }}
                onClick={item.action}>
                <div style={{ width:40, height:40, background:"#f1f5f9", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{item.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{item.label}</div>
                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>{item.sub}</div>
                </div>
                <span style={{ color:"#cbd5e1", fontSize:18 }}>›</span>
              </div>
            ))}
          </div>
        </div>

        {/* Zona de perigo */}
        <div style={{ padding:"12px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"#ef4444", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Zona de perigo</div>
          <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 16px", borderBottom:"1px solid var(--border-sub,#f1f5f9)", cursor:"pointer" }} onClick={handleLogout}>
              <div style={{ width:40, height:40, background:"#fef2f2", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🚪</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>Sair da conta</div>
                <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>Encerrar sessão</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 16px", cursor:"pointer" }} onClick={() => setConfirmDeleteConta(true)}>
              <div style={{ width:40, height:40, background:"#fef2f2", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🗑️</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800, fontSize:14, color:"#dc2626" }}>Excluir conta</div>
                <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>Remove permanentemente todos os seus dados</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:12, marginTop:24 }}>
          <div style={{ fontSize:18, marginBottom:4 }}>⚡</div>
          <strong style={{ color:"#FF6B35" }}>DiáriaJá</strong> v1.0.0<br />Campo Grande, MS
        </div>

        {/* Modal confirmar excluir conta */}
        {confirmDeleteConta && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={() => setConfirmDeleteConta(false)}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }} onClick={e => e.stopPropagation()}>
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
              <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>🗑️</div>
              <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", textAlign:"center", marginBottom:8 }}>Excluir conta</div>
              <div style={{ fontSize:14, color:"var(--text-2,#64748b)", textAlign:"center", marginBottom:24, lineHeight:1.6 }}>
                Esta ação é <strong>permanente</strong> e não pode ser desfeita. Todos os seus dados, histórico e avaliações serão removidos.
              </div>
              <button
                style={{ width:"100%", padding:"14px", background: deletandoConta ? "#e2e8f0" : "#dc2626", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: deletandoConta ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
                disabled={deletandoConta}
                onClick={async () => {
                  setDeletandoConta(true);
                  try {
                    // Chama Edge Function que apaga auth.users via service_role
                    const { data: { session: sess } } = await supabase.auth.getSession();
                    const res = await fetch(
                      `${SUPABASE_URL}/functions/v1/delete-user`,
                      {
                        method: "POST",
                        headers: {
                          "Authorization": `Bearer ${sess?.access_token ?? ""}`,
                          "Content-Type": "application/json",
                        },
                      }
                    );
                    if (!res.ok) {
                      // Fallback: apaga só o perfil se Edge Function não estiver deployada
                      if (session?.user?.id) {
                        await supabase.from("user_profiles").delete().eq("id", session.user.id);
                      }
                    }
                  } catch {
                    // Fallback silencioso
                    if (session?.user?.id) {
                      await supabase.from("user_profiles").delete().eq("id", session.user.id);
                    }
                  }
                  // Limpa localStorage
                  ["diariaja_tela","diariaja_termos_v1","diariaja_dark","diariaja_cancels",
                   "diariaja_hidden_chats","diariaja_favoritos","diariaja_tel_verif"].forEach(k => {
                    try { localStorage.removeItem(k); } catch {}
                  });
                  await supabase.auth.signOut();
                  setConfirmDeleteConta(false);
                  setDeletandoConta(false);
                  setToastSuccess("Conta excluída. Até logo!");
                }}>
                {deletandoConta ? "Excluindo..." : "Confirmar exclusão"}
              </button>
              <button
                style={{ width:"100%", padding:"14px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-1,#0f172a)", border:"none", borderRadius:14, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => setConfirmDeleteConta(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {mostrarTermos && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:600, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto" }}>
              <button style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", display:"block", marginBottom:12 }} onClick={() => setMostrarTermos(false)}>✕</button>
              <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", marginBottom:12 }}>Termos de Uso</div>
              <div style={{ fontSize:13, color:"var(--text-label,#475569)", lineHeight:1.7 }}>
                O DiáriaJá é uma plataforma de conexão entre empregadores e profissionais autônomos. Ao usar o app, você concorda com nossos termos. Para dúvidas: suporte@diariaja.com.br
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ALTERAR SENHA
  if (tela === "alterar-senha") {
    const voltarHome = modoAtual === "diarista" ? "home-diarista" : "home-empregador";
    return (
      <div style={S.page}>
        <button style={S.back} onClick={() => setTela("configuracoes")}>← Voltar</button>
        <h2 style={S.pageTitle}>🔑 Alterar senha</h2>
        <p style={{ color:"var(--text-2,#64748b)", fontSize:13, marginBottom:20, lineHeight:1.5 }}>
          Digite sua nova senha. Ela deve ter pelo menos 6 caracteres.
        </p>

        <label style={S.label}>Nova senha</label>
        <input style={S.input} type="password" placeholder="Nova senha (mín. 6 caracteres)" value={novaSenha}
          onChange={e => setNovaSenha(e.target.value)} />

        <label style={S.label}>Confirmar nova senha</label>
        <input style={S.input} type="password" placeholder="Repita a nova senha" value={confirmSenha}
          onChange={e => setConfirmSenha(e.target.value)} />

        {authError && <p style={{ color: authError.startsWith("✅") ? "#16a34a" : "#ef4444", fontSize:13, fontWeight:600, marginBottom:12 }}>{authError}</p>}

        <button style={{ ...S.btnPrimary, opacity: alterandoSenha ? .6 : 1, marginTop:8 }}
          disabled={alterandoSenha}
          onClick={async () => {
            setAuthError("");
            if (novaSenha.length < 6) { setAuthError("A senha deve ter pelo menos 6 caracteres."); return; }
            if (novaSenha !== confirmSenha) { setAuthError("As senhas não coincidem."); return; }
            setAlterandoSenha(true);
            const { error } = await supabase.auth.updateUser({ password: novaSenha });
            setAlterandoSenha(false);
            if (error) { setAuthError("Erro ao alterar senha: " + error.message); }
            else {
              setToastSuccess("✅ Senha alterada com sucesso!");
              setNovaSenha(""); setConfirmSenha("");
              setTela("configuracoes");
            }
          }}>
          {alterandoSenha ? "Alterando..." : "Salvar nova senha"}
        </button>
      </div>
    );
  }

  // VERIFICAR TELEFONE
  if (tela === "verificar-telefone") {
    // Normaliza telefone BR pra formato E.164 (ex: "67 99988-7766" → "+5567999887766")
    const formatarE164 = (tel: string): string | null => {
      const digits = tel.replace(/\D/g, "");
      if (digits.length === 11) return `+55${digits}`;
      if (digits.length === 13 && digits.startsWith("55")) return `+${digits}`;
      return null;
    };
    return (
      <div style={S.page}>
        <button style={S.back} onClick={() => setTela("configuracoes")}>← Voltar</button>
        <h2 style={S.pageTitle}>📱 Verificar telefone</h2>
        {telefoneVerificado ? (
          <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:16, padding:"20px", textAlign:"center" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
            <div style={{ fontWeight:900, fontSize:16, color:"#166534", marginBottom:8 }}>Telefone verificado!</div>
            <div style={{ fontSize:13, color:"#16a34a", lineHeight:1.5 }}>Seu número foi confirmado. Você atingiu o Nível Básico de confiabilidade.</div>
          </div>
        ) : (
          <>
            <p style={{ color:"var(--text-2,#64748b)", fontSize:13, marginBottom:20, lineHeight:1.5 }}>
              Verificar seu telefone é o primeiro passo da progressão de confiabilidade.
              Receberá um SMS com um código de 6 dígitos.
            </p>
            {etapaVerifTel === "input" ? (
              <>
                <label style={S.label}>Seu número de celular (com DDD)</label>
                <input style={S.input} type="tel" placeholder="(67) 99999-9999" value={form.telefone}
                  onChange={e => setForm({...form, telefone: e.target.value})} />
                {authError && <p style={{ color:"#ef4444", fontSize:13, marginBottom:12 }}>{authError}</p>}
                <button style={{ ...S.btnPrimary, opacity: enviandoVerif ? .6 : 1 }}
                  disabled={enviandoVerif}
                  onClick={async () => {
                    setAuthError("");
                    if (!validarTelefone(form.telefone)) {
                      setAuthError("Telefone inválido. Use o formato (XX) 9XXXX-XXXX.");
                      return;
                    }
                    const e164 = formatarE164(form.telefone);
                    if (!e164) { setAuthError("Não consegui formatar o número."); return; }
                    setEnviandoVerif(true);
                    // Tenta enviar OTP real via Supabase. Se o provider de SMS
                    // não estiver configurado no Dashboard, cai no fallback.
                    const { error } = await supabase.auth.updateUser({ phone: e164 });
                    setEnviandoVerif(false);
                    if (error) {
                      const msg = error.message?.toLowerCase() || "";
                      if (msg.includes("sms") || msg.includes("phone") || msg.includes("provider")) {
                        setAuthError("📵 SMS ainda não disponível na plataforma. Em breve liberamos esta verificação. Continue usando o app normalmente.");
                      } else {
                        setAuthError("Erro: " + error.message);
                      }
                      return;
                    }
                    // Salva o telefone e marca aguardando código
                    await saveProfile({ telefone: form.telefone.trim() });
                    setEtapaVerifTel("codigo");
                    setToastSuccess("📲 Código enviado por SMS");
                  }}>
                  {enviandoVerif ? "Enviando..." : "📲 Enviar código por SMS"}
                </button>
              </>
            ) : (
              <>
                <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12, padding:"14px 16px", marginBottom:16, fontSize:13, color:"#166534", lineHeight:1.5 }}>
                  📲 Um código foi enviado por SMS para <strong>{form.telefone}</strong>. Pode levar até 1 minuto pra chegar.
                </div>
                <label style={S.label}>Código de verificação</label>
                <input style={{ ...S.input, letterSpacing:8, fontSize:20, textAlign:"center" as const }}
                  placeholder="000000" maxLength={6} value={codigoVerifInput}
                  onChange={e => setCodigoVerifInput(e.target.value.replace(/\D/g,"").slice(0,6))} />
                {authError && <p style={{ color:"#ef4444", fontSize:13, marginBottom:12 }}>{authError}</p>}
                <button style={{ ...S.btnPrimary, opacity: enviandoVerif ? .6 : 1 }}
                  disabled={enviandoVerif}
                  onClick={async () => {
                    setAuthError("");
                    if (codigoVerifInput.length < 6) { setAuthError("Digite o código de 6 dígitos."); return; }
                    const e164 = formatarE164(form.telefone);
                    if (!e164) { setAuthError("Erro ao reformatar número."); return; }
                    setEnviandoVerif(true);
                    // Valida o OTP de verdade no Supabase
                    const { error } = await supabase.auth.verifyOtp({
                      phone: e164,
                      token: codigoVerifInput,
                      type: "phone_change",
                    });
                    if (error) {
                      setEnviandoVerif(false);
                      setAuthError("Código inválido ou expirado. Tente novamente.");
                      return;
                    }
                    // Persiste no perfil: agora é oficialmente verificado
                    await saveProfile({ telefone: form.telefone.trim(), telefone_verificado: true } as any);
                    setTelefoneVerificado(true);
                    try { localStorage.setItem("diariaja_tel_verif","1"); } catch {}
                    hapticConfirm();
                    setEnviandoVerif(false);
                    setToastSuccess("✅ Telefone verificado — Nível Básico desbloqueado!");
                    setTela("configuracoes");
                  }}>
                  {enviandoVerif ? "Verificando..." : "Confirmar código"}
                </button>
                <button style={{ ...S.btnSecondary, marginTop:10 }} onClick={() => { setEtapaVerifTel("input"); setCodigoVerifInput(""); setAuthError(""); }}>
                  ← Voltar e corrigir número
                </button>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // POLÍTICA DE PRIVACIDADE (LGPD)
  if (tela === "politica-privacidade") {
    const secoes = [
      {
        titulo: "1. Quem somos",
        corpo: "O DiáriaJá é uma plataforma digital de intermediação de serviços de diária, operada por [Razão Social], CNPJ [nº], com sede em Campo Grande — MS. Contato: suporte@diariaja.com.br.",
      },
      {
        titulo: "2. Dados que coletamos",
        corpo: "Coletamos os seguintes dados pessoais:\n\n• Nome completo\n• E-mail e senha (criptografada)\n• CPF ou CNPJ (armazenado de forma privada, nunca exibido publicamente)\n• Número de telefone\n• Foto de perfil\n• Localização geográfica (GPS, apenas com seu consentimento)\n• Histórico de diárias, candidaturas e avaliações\n• Mensagens trocadas no chat\n• Dados de portfólio (fotos de trabalhos anteriores)",
      },
      {
        titulo: "3. Para que usamos seus dados",
        corpo: "Seus dados são utilizados exclusivamente para:\n\n• Criar e autenticar sua conta\n• Exibir seu perfil para outros usuários da plataforma\n• Conectar empregadores e diaristas\n• Calcular score de confiança e nível de gamificação\n• Enviar notificações relacionadas às suas diárias\n• Cumprir obrigações legais e regulatórias",
      },
      {
        titulo: "4. Compartilhamento de dados",
        corpo: "NÃO vendemos nem compartilhamos seus dados pessoais com terceiros para fins comerciais.\n\nCompartilhamos dados apenas:\n• Com a Supabase (infraestrutura segura, criptografada)\n• Com outros usuários da plataforma, apenas as informações que você tornou públicas no seu perfil\n• Quando exigido por lei ou ordem judicial",
      },
      {
        titulo: "5. Armazenamento e segurança",
        corpo: "Seus dados são armazenados na infraestrutura da Supabase (AWS/EUA) com:\n\n• Criptografia em trânsito (HTTPS/TLS)\n• Autenticação segura (JWT)\n• Políticas de acesso por linha (Row Level Security)\n• Backups automáticos\n\nSenhas nunca são armazenadas em texto claro.",
      },
      {
        titulo: "6. Seus direitos (LGPD — Lei 13.709/2018)",
        corpo: "Você tem direito a:\n\n• Acessar seus dados pessoais\n• Corrigir dados incorretos ou desatualizados\n• Solicitar a exclusão dos seus dados (\"direito ao esquecimento\")\n• Portabilidade dos seus dados\n• Revogar o consentimento a qualquer momento\n• Reclamar à ANPD (Autoridade Nacional de Proteção de Dados)\n\nPara exercer esses direitos: suporte@diariaja.com.br",
      },
      {
        titulo: "7. Retenção de dados",
        corpo: "Mantemos seus dados enquanto sua conta estiver ativa. Após a exclusão da conta, os dados são removidos em até 30 dias, exceto quando a retenção for obrigatória por lei (ex.: registros fiscais por 5 anos).",
      },
      {
        titulo: "8. Cookies e rastreamento",
        corpo: "O DiáriaJá utiliza localStorage do navegador apenas para preferências locais (dark mode, dados de sessão). Não utilizamos cookies de rastreamento de terceiros ou anúncios.",
      },
      {
        titulo: "9. Menores de idade",
        corpo: "O DiáriaJá é destinado exclusivamente a maiores de 18 anos. Não coletamos intencionalmente dados de menores. Caso identifiquemos cadastro de menor, a conta será removida imediatamente.",
      },
      {
        titulo: "10. Alterações nesta política",
        corpo: "Esta política pode ser atualizada periodicamente. Notificaremos usuários sobre mudanças relevantes pelo app. A data da última atualização está no rodapé desta página.",
      },
    ];
    const [secaoAberta, setSecaoAberta] = useState<number | null>(null);
    return (
      <div style={{ minHeight:"100vh", background:"var(--bg-app,#f0f2f5)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:60 }}>
        {/* Header */}
        <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", padding:"48px 20px 28px" }}>
          <button style={{ background:"none", border:"none", color:"#94a3b8", fontSize:15, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:0, marginBottom:16 }}
            onClick={() => setTela("configuracoes")}>← Voltar</button>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:48, height:48, background:"rgba(255,107,53,.2)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>🔒</div>
            <div>
              <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>Política de Privacidade</div>
              <div style={{ fontSize:12, color:"#64748b" }}>Atualizado em maio de 2026 · LGPD</div>
            </div>
          </div>
        </div>

        {/* Resumo rápido */}
        <div style={{ margin:"16px 16px 8px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:16, padding:"16px" }}>
          <div style={{ fontWeight:800, fontSize:14, color:"#166534", marginBottom:6 }}>✅ Resumo em 3 pontos</div>
          {["Seus dados nunca são vendidos nem compartilhados com anunciantes.",
            "CPF/CNPJ nunca são exibidos publicamente — ficam só no servidor.",
            "Você pode excluir sua conta e todos os seus dados a qualquer momento."
          ].map((p,i) => (
            <div key={i} style={{ fontSize:13, color:"#15803d", display:"flex", gap:8, marginBottom:4 }}>
              <span>•</span><span>{p}</span>
            </div>
          ))}
        </div>

        {/* Seções acordeão */}
        <div style={{ padding:"0 16px" }}>
          {secoes.map((s, i) => (
            <div key={i} style={{ background:"var(--bg-card,#fff)", borderRadius:14, marginBottom:8, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", cursor:"pointer" }}
                onClick={() => setSecaoAberta(secaoAberta === i ? null : i)}>
                <div style={{ fontWeight:700, fontSize:14, color:"var(--text-1,#0f172a)" }}>{s.titulo}</div>
                <span style={{ color:"#FF6B35", fontSize:18, transition:"transform .2s", transform: secaoAberta === i ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
              </div>
              {secaoAberta === i && (
                <div style={{ padding:"0 16px 16px", fontSize:13, color:"var(--text-2,#475569)", lineHeight:1.8, whiteSpace:"pre-line" as const }}>
                  {s.corpo}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Contato DPO */}
        <div style={{ margin:"8px 16px 0", background:"var(--bg-card,#fff)", borderRadius:14, padding:"16px", boxShadow:"0 2px 8px rgba(0,0,0,.06)", textAlign:"center" as const }}>
          <div style={{ fontSize:13, color:"var(--text-2,#64748b)", lineHeight:1.7 }}>
            Dúvidas sobre privacidade? Fale com nosso responsável de dados:<br />
            <strong style={{ color:"#FF6B35" }}>suporte@diariaja.com.br</strong>
          </div>
        </div>

        <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:11, marginTop:20 }}>
          DiáriaJá · Versão 1.0 · Campo Grande, MS<br />
          Em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018)
        </div>
      </div>
    );
  }

  // SUPORTE
  if (tela === "suporte") {
    const voltarTela = profile?.user_type === "empregador" ? "home-empregador" : profile?.user_type === "diarista" ? "home-diarista" : "splash";
    const faqItems = [
      { q:"Como funciona o DiáriaJá?", r:"Empregadores publicam vagas de diária e profissionais aceitam conforme sua disponibilidade. Tudo direto pelo app, sem intermediários." },
      { q:"Como recebo o pagamento?", r:"O pagamento é combinado diretamente entre o profissional e o empregador. Recomendamos acertar antes ou no dia da diária." },
      { q:"Como reportar um problema?", r:"Entre em contato pelo WhatsApp abaixo ou envie um e-mail para suporte@diariaja.com.br. Respondemos em até 24h." },
      { q:"Posso cancelar uma diária?", r:"Sim, mas recomendamos avisar com pelo menos 24h de antecedência pelo chat do app para manter uma boa reputação." },
      { q:"Meus dados estão seguros?", r:"Sim. Utilizamos o Supabase com criptografia e autenticação segura. Nunca compartilhamos seus dados com terceiros." },
    ];
    // faqAberta já está no topo do componente (BUG-C1 fix)
    return (
      <>
      <div style={{ minHeight:"100vh", background:"var(--bg-app,#f0f2f5)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:40 }}>

        {/* Header */}
        <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", padding:"48px 20px 24px", position:"relative" }}>
          <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:15, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:0, marginBottom:16 }} onClick={() => setTela(voltarTela)}>
            ← Voltar
          </button>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:48, height:48, background:"rgba(255,107,53,.2)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>🎧</div>
            <div>
              <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>Suporte</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)" }}>Estamos aqui para ajudar</div>
            </div>
          </div>
        </div>

        {/* Canais de contato */}
        <div style={{ padding:"16px 16px 8px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Falar conosco</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[
              { icon:"💬", label:"WhatsApp", sub:"Atendimento em até 1h", cor:"#22c55e", action:() => window.open("https://wa.me/5567999999999?text=Oi!%20Preciso%20de%20ajuda%20no%20DiáriaJá","_blank") },
              { icon:"📧", label:"E-mail", sub:"suporte@diariaja.com.br", cor:"#3A86FF", action:() => window.open("mailto:suporte@diariaja.com.br","_blank") },
              { icon:"📱", label:"Instagram", sub:"@diariaja.oficial", cor:"#e11d48", action:() => window.open("https://instagram.com","_blank") },
            ].map(c => (
              <div key={c.label}
                style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:14, cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}
                onClick={c.action}>
                <div style={{ width:46, height:46, background:c.cor+"18", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>
                  {c.icon}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{c.label}</div>
                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>{c.sub}</div>
                </div>
                <span style={{ color:"#cbd5e1", fontSize:18 }}>›</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div style={{ padding:"16px 16px 8px" }}>
          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Perguntas frequentes</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {faqItems.map((item, i) => (
              <div key={i} style={{ background:"var(--bg-card,#fff)", borderRadius:16, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
                <div
                  style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", cursor:"pointer" }}
                  onClick={() => setFaqAberta(faqAberta === i ? null : i)}>
                  <span style={{ fontWeight:700, fontSize:14, color:"var(--text-1,#0f172a)", flex:1, paddingRight:10 }}>{item.q}</span>
                  <span style={{ color:"#FF6B35", fontSize:18, fontWeight:900, flexShrink:0, transform: faqAberta===i ? "rotate(45deg)" : "none", transition:"transform .2s" }}>+</span>
                </div>
                {faqAberta === i && (
                  <div style={{ padding:"0 16px 14px", fontSize:13, color:"var(--text-label,#475569)", lineHeight:1.6, borderTop:"1px solid var(--border-sub,#f1f5f9)" }}>
                    {item.r}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Termos de Uso e Privacidade */}
        <div style={{ margin:"20px 16px 0", background:"var(--bg-card,#fff)", borderRadius:16, padding:"16px", border:"1px solid var(--border,#e2e8f0)" }}>
          <div style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)", marginBottom:10 }}>📄 Documentos legais</div>
          <button
            style={{ width:"100%", textAlign:"left" as const, background:"none", border:"none", padding:"10px 0", fontSize:13, color:"#FF6B35", fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", borderBottom:"1px solid var(--border-sub,#f1f5f9)", display:"flex", justifyContent:"space-between" }}
            onClick={() => setMostrarTermos(true)}>
            Termos de Uso e Política de Privacidade <span>→</span>
          </button>
          <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:10, lineHeight:1.5 }}>
            Você aceitou os Termos em: {(() => { try { const d = localStorage.getItem("diariaja_termos_data"); return d ? new Date(d).toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"}) : "—"; } catch { return "—"; } })()}
          </div>
        </div>

        {/* Versão */}
        <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:12, marginTop:24 }}>
          <div style={{ fontSize:20, marginBottom:4 }}>⚡</div>
          <strong style={{ color:"#FF6B35" }}>DiáriaJá</strong> v1.0.0 · Beta<br />
          Feito com ❤️ em Campo Grande, MS<br />
          suporte@diariaja.com.br
        </div>
      </div>

      {/* Tela de Termos completa (acessível aqui também) */}
      {mostrarTermos && (
        <div style={{ position:"fixed", inset:0, background:"var(--bg-card,#fff)", zIndex:999, overflowY:"auto", fontFamily:"Inter, system-ui, sans-serif" }}>
          <div style={{ position:"sticky", top:0, background:"var(--bg-card,#fff)", borderBottom:"1px solid var(--border,#e2e8f0)", padding:"16px 20px", display:"flex", alignItems:"center", gap:12, zIndex:1 }}>
            <button style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#FF6B35", padding:0 }} onClick={() => setMostrarTermos(false)}>←</button>
            <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)" }}>Termos de Uso — DiáriaJá</div>
          </div>
          <div style={{ padding:"20px 20px 60px", maxWidth:480, margin:"0 auto" }}>
            {[
              { titulo:"1. Apresentação", body:`O DiáriaJá é uma plataforma digital (PWA) que conecta trabalhadores autônomos (diaristas) a empregadores para contratação de serviços pontuais nas categorias: Doméstico, Supermercado, Restaurante, Construção, Eventos, Saúde & Cuidado, Logística e Pet & Animais.\n\nEste Termo observa: LGPD (Lei nº 13.709/2018), Marco Civil da Internet (Lei nº 12.965/2014), CDC (Lei nº 8.078/1990) e LC nº 150/2015.` },
              { titulo:"2. Natureza da Plataforma", body:`Somos um ambiente digital de intermediação. Não prestamos serviços diretamente, não somos empregador das diaristas e não garantimos qualidade, presença ou pagamento externo.\n\nA relação entre diarista e empregador, após o aceite, é de responsabilidade exclusiva das partes.` },
              { titulo:"3. Cadastro e Conta", body:`Exigimos dados verdadeiros e completos. O usuário declara ter mais de 18 anos e plena capacidade civil. É proibido: perfis falsos, CPF de terceiros, simular avaliações ou duplicar contas.` },
              { titulo:"4. Perfil e Verificação", body:`CPF/CNPJ são coletados para verificação interna e nunca exibidos publicamente. O badge "✅ Verificado" indica identidade verificada. O diarista pode publicar portfólio com até 3 fotos.` },
              { titulo:"5. Publicação de Diárias", body:`O empregador publica vagas com: data, função, valor, horário, local e observações. Diárias recorrentes (semanal/quinzenal) são suportadas. O cancelamento notifica candidatos automaticamente.` },
              { titulo:"6. Candidaturas, Convites e Aceite", body:`O diarista candidata-se a vagas. O empregador pode também enviar convites diretos. Após o aceite, demais candidatos são recusados. A confirmação de presença é feita via QR Code no app.` },
              { titulo:"7. Chat e Comunicação", body:`O chat é exclusivo para fins da diária. É proibido assédio, ameaças, spam e conteúdo ilegal. Mensagens são armazenadas para segurança e resolução de conflitos.` },
              { titulo:"8. Pagamentos e Taxa", body:`O DiáriaJá facilita o pagamento via PIX (chave: suporte@diariaja.com.br). A taxa de plataforma é de 1,5% sobre o valor da diária, devida pelo empregador. Não processamos pagamentos diretamente.\n\nPlanos de assinatura para empregadores oferecem funcionalidades diferenciadas.` },
              { titulo:"9. Avaliações e Reputação", body:`Avaliações devem refletir experiências reais. São proibidas avaliações falsas, compradas ou manipuladas. O DiáriaJá pode remover avaliações que violem este Termo.` },
              { titulo:"10. Dados Pessoais (LGPD)", body:`Tratamos: nome, e-mail, foto, CPF/CNPJ (privado), geolocalização, histórico e mensagens. O CPF nunca é exibido publicamente.\n\nVocê pode solicitar acesso, correção, exclusão ou portabilidade pelo e-mail suporte@diariaja.com.br.` },
              { titulo:"11. Condutas Proibidas", body:`São proibidas: fraude de dados, discriminação, assédio, atividades ilícitas, spam, engenharia reversa e conteúdo ofensivo. O descumprimento pode resultar em exclusão da conta e comunicação às autoridades.` },
              { titulo:"12. Limitação de Responsabilidade", body:`Não nos responsabilizamos por: informações falsas de usuários, descumprimento de acordos, qualidade do serviço, furtos, acidentes ou falhas de conexão. Os direitos previstos no CDC são preservados.` },
              { titulo:"13. Informações da Operadora", body:`DiáriaJá · Beta 1.0 · diariaja.vercel.app\nE-mail: suporte@diariaja.com.br\nData de vigência: 21 de maio de 2026\n\nForo: domicílio do consumidor (relações de consumo, conforme CDC). Demais casos: Campo Grande, MS.` },
            ].map(({ titulo, body }) => (
              <div key={titulo} style={{ marginBottom:24 }}>
                <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)", marginBottom:8, paddingBottom:6, borderBottom:"2px solid #FF6B35" }}>{titulo}</div>
                {body.split("\n\n").map((p, i) => (
                  <p key={i} style={{ fontSize:13, color:"var(--text-label,#475569)", lineHeight:1.7, marginBottom:10 }}>{p}</p>
                ))}
              </div>
            ))}
            <button
              style={{ width:"100%", padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:8 }}
              onClick={() => setMostrarTermos(false)}>
              ← Voltar
            </button>
          </div>
        </div>
      )}
      </>
    );
  }

  // CADASTRO EMPREGADOR
  if (tela === "cadastro-empregador") return (
    <div style={S.page}>
      <button style={S.back} onClick={() => setTela("cadastro-tipo")}>← Voltar</button>

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", borderRadius:20, padding:"20px 20px 18px", marginBottom:20, color:"#fff" }}>
        <div style={{ fontSize:22, fontWeight:900 }}>🏢 Dados do Contratante</div>
        <div style={{ fontSize:13, opacity:0.75, marginTop:4 }}>Preencha para criar sua conta</div>
      </div>

      {/* Tipo de pessoa */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:0.5 }}>👤 Tipo de pessoa *</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
        {([["fisica","👤","Pessoa Física","CPF"],["juridica","🏢","Pessoa Jurídica","CNPJ"]] as const).map(([tp, ic, lb, doc]) => (
          <div key={tp}
            style={{ background:form.pessoaTipo===tp?"#eff6ff":"#f8fafc", border:form.pessoaTipo===tp?"2px solid #3A86FF":"1.5px solid #e2e8f0", borderRadius:16, padding:"16px 12px", cursor:"pointer", textAlign:"center" as const }}
            onClick={() => setForm({...form, pessoaTipo:tp})}>
            <div style={{ fontSize:28 }}>{ic}</div>
            <div style={{ fontWeight:800, fontSize:14, color:form.pessoaTipo===tp?"#1d4ed8":"#0f172a", marginTop:4 }}>{lb}</div>
            <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:2 }}>Documento: {doc}</div>
          </div>
        ))}
      </div>

      {/* Identificação */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:0.5 }}>📋 Identificação</div>
      <label style={S.label}>Nome completo *</label>
      <input style={S.input} placeholder="Ex: Maria Oliveira" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} />
      <label style={S.label}>Telefone (WhatsApp) *</label>
      <input style={S.input} placeholder="(67) 99999-9999" value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} />

      {form.pessoaTipo === "fisica" ? (
        <>
          <label style={S.label}>CPF *</label>
          <input style={{ ...S.input, letterSpacing:1 }} placeholder="000.000.000-00" inputMode="numeric" maxLength={14}
            value={form.cpf} onChange={e=>setForm({...form,cpf:maskCPF(e.target.value)})} />
          <label style={S.label}>Nome do local / apelido *</label>
          <p style={{ color:"var(--text-3,#94a3b8)", fontSize:12, margin:"-6px 0 8px" }}>Como será identificado nas vagas? Ex: Família Silva, Residência Oliveira…</p>
          <input style={S.input} placeholder="Ex: Família Silva, Casa da Maria..." value={form.nomeNegocio} onChange={e=>setForm({...form,nomeNegocio:e.target.value})} />
        </>
      ) : (
        <>
          <label style={S.label}>CNPJ *</label>
          <input style={{ ...S.input, letterSpacing:1 }} placeholder="00.000.000/0000-00" inputMode="numeric" maxLength={18}
            value={form.cnpj} onChange={e=>setForm({...form,cnpj:maskCNPJ(e.target.value)})} />
          <label style={S.label}>Nome do estabelecimento *</label>
          <p style={{ color:"var(--text-3,#94a3b8)", fontSize:12, margin:"-6px 0 8px" }}>Nome da empresa/estabelecimento, não o seu nome pessoal.</p>
          <input style={S.input} placeholder="Ex: Restaurante do João, Bar Guinness, Mercado Silva..." value={form.nomeNegocio} onChange={e=>setForm({...form,nomeNegocio:e.target.value})} />
        </>
      )}

      {/* Endereço */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, marginTop:20, textTransform:"uppercase" as const, letterSpacing:0.5 }}>📍 Endereço do local *</div>
      <div style={{ background:"#f0f9ff", border:"1.5px solid #bae6fd", borderRadius:12, padding:"10px 14px", marginBottom:12, fontSize:12, color:"#0369a1" }}>
        Informe onde os serviços serão prestados (estabelecimento ou residência).
      </div>

      <label style={S.label}>CEP *</label>
      <div style={{ position:"relative" }}>
        <input style={{ ...S.input, letterSpacing:1, paddingRight: buscandoCEPEmp ? 110 : 14 }} placeholder="00000-000" inputMode="numeric" maxLength={9}
          value={form.cepEmp}
          onChange={e => {
            let v = e.target.value.replace(/\D/g,"").slice(0,8);
            if (v.length > 5) v = v.slice(0,5)+"-"+v.slice(5);
            setForm(prev => ({...prev, cepEmp: v}));
            if (v.replace(/\D/g,"").length === 8) buscarCEPEmp(v);
          }} />
        {buscandoCEPEmp && <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:"var(--text-2,#64748b)", fontWeight:600 }}>Buscando...</span>}
      </div>

      <label style={S.label}>Logradouro *</label>
      <input style={S.input} placeholder="Ex: Rua das Flores" value={form.ruaEmp} onChange={e=>setForm({...form,ruaEmp:e.target.value})} />

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr", gap:12 }}>
        <div>
          <label style={S.label}>Número *</label>
          <input style={S.input} placeholder="Ex: 123" value={form.numeroEmp} onChange={e=>setForm({...form,numeroEmp:e.target.value})} />
        </div>
        <div>
          <label style={S.label}>Complemento</label>
          <input style={S.input} placeholder="Sala, Bloco…" value={form.complementoEmp} onChange={e=>setForm({...form,complementoEmp:e.target.value})} />
        </div>
      </div>

      <label style={S.label}>Bairro *</label>
      <input style={S.input} placeholder="Ex: Centro" value={form.bairroEmp} onChange={e=>setForm({...form,bairroEmp:e.target.value})} />

      <div style={{ display:"grid", gridTemplateColumns:"1.5fr 0.8fr", gap:12 }}>
        <div>
          <label style={S.label}>Cidade *</label>
          <input style={S.input} placeholder="Campo Grande" value={form.cidadeEmp} onChange={e=>setForm({...form,cidadeEmp:e.target.value})} />
        </div>
        <div>
          <label style={S.label}>UF *</label>
          <input style={S.input} placeholder="MS" maxLength={2} value={form.estadoEmp} onChange={e=>setForm({...form,estadoEmp:e.target.value.toUpperCase().slice(0,2)})} />
        </div>
      </div>

      {authError && <p style={S.errorText}>{authError}</p>}
      <button style={{ ...S.btnPrimary, marginTop:20 }} onClick={async () => {
        setAuthError("");
        if (!form.nome.trim()) { setAuthError("Informe seu nome completo."); return; }
        { const erroNome = validarNome(form.nome); if (erroNome) { setAuthError(erroNome); return; } }
        if (form.pessoaTipo === "fisica" && !validarCPF(form.cpf)) { setAuthError("CPF inválido. Verifique os dígitos e tente novamente."); return; }
        if (form.pessoaTipo === "juridica" && form.cnpj.replace(/\D/g,"").length !== 14) { setAuthError("CNPJ inválido — deve ter 14 dígitos."); return; }
        if (!form.cepEmp || !form.ruaEmp.trim() || !form.numeroEmp.trim()) { setAuthError("Preencha CEP, logradouro e número."); return; }
        const endEmp = `${form.ruaEmp}, ${form.numeroEmp}${form.complementoEmp.trim()?` — ${form.complementoEmp}`:""},  ${form.bairroEmp}, ${form.cidadeEmp}/${form.estadoEmp} — CEP ${form.cepEmp}`;
        const ok = await saveProfile({
          nome_negocio: form.pessoaTipo === "juridica" ? form.nomeNegocio : form.nome,
          cpf: form.cpf,
          cnpj: form.cnpj,
          pessoa_tipo: form.pessoaTipo,
          endereco_empregador: endEmp,
          // Inclui lat/lng geocodificados do CEP se disponíveis
          ...(latPerfilCEP !== null ? { lat: latPerfilCEP, lng: lngPerfilCEP } : {}),
        });
        if (ok) setTela("escolha-negocio");
      }}>Continuar →</button>
    </div>
  );

  // ESCOLHA DE NEGÓCIO
  if (tela === "escolha-negocio") return (
    <div style={S.page}>
      {/* Se já tem perfil salvo, volta para home; senão volta para o cadastro */}
      <button style={S.back} onClick={() => setTela(profile ? "home-empregador" : "cadastro-empregador")}>← Voltar</button>
      <h2 style={S.pageTitle}>Qual é o seu negócio?</h2>
      <p style={S.subTexto}>Você verá apenas profissionais do seu setor.</p>
      <div style={S.negocioGrid}>
        {Object.entries(CATEGORIAS_NEGOCIO).map(([nome, info]) => (
          <div key={nome}
            style={{ ...S.negocioCard, ...(negocioSelecionado===nome ? { border:`2px solid ${info.cor}`, background:`${info.cor}18` } : {}) }}
            onClick={() => setNegocio(nome)}>
            <span style={S.negocioIcone}>{info.icone}</span>
            <span style={{ ...S.negocioLabel, color:negocioSelecionado===nome ? info.cor : "#0f172a" }}>{nome}</span>
            {('destaque' in info) && (info as {destaque:string}).destaque && (
              <span style={{ display:"inline-block", fontSize:10, fontWeight:800, color:info.cor, background:`${info.cor}18`, borderRadius:8, padding:"2px 7px", marginBottom:2 }}>
                {(info as {destaque:string}).destaque}
              </span>
            )}
            <span style={S.negocioFuncoes}>{info.funcoes.join(" · ")}</span>
          </div>
        ))}
      </div>
      {authError && <p style={S.errorText}>{authError}</p>}
      <button style={{ ...S.btnPrimary, opacity:negocioSelecionado?1:0.4 }} disabled={!negocioSelecionado}
        onClick={async () => {
          setAuthError("");
          const ok = await saveProfile({ segmento: negocioSelecionado! });
          if (ok) {
            // Sempre abre na aba de profissionais ao confirmar o ramo
            setTabEmpregador("inicio");
            trackEvento("cadastro_concluido", session?.user?.id, "empregador");
            // Pede localização apenas na primeira vez (perfil novo sem lat/lng)
            setTela(profile?.lat ? "home-empregador" : "pedir-localizacao");
          }
        }}>
        Ver profissionais disponíveis
      </button>
    </div>
  );

  // CADASTRO DIARISTA
  if (tela === "cadastro-diarista") return (
    <div style={S.page}>
      <button style={S.back} onClick={() => setTela("cadastro-tipo")}>← Voltar</button>

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", borderRadius:20, padding:"20px 20px 18px", marginBottom:20, color:"#fff" }}>
        <div style={{ fontSize:22, fontWeight:900 }}>👷 Perfil de Diarista</div>
        <div style={{ fontSize:13, opacity:0.75, marginTop:4 }}>Preencha seus dados para começar a trabalhar</div>
      </div>

      {/* Foto pessoal */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:0.5 }}>📷 Foto pessoal *</div>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20, padding:"14px 16px", background:"var(--bg-surface,#f8fafc)", borderRadius:16, border:"1.5px solid var(--border,#e2e8f0)" }}>
        {fotoUrl
          ? <img src={fotoUrl} style={{ width:72, height:72, borderRadius:36, objectFit:"cover" as const, flexShrink:0, border:"3px solid #FF6B35" }} alt="foto" />
          : <div style={{ width:72, height:72, borderRadius:36, background:"#e2e8f0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, flexShrink:0 }}>👤</div>
        }
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:13, color:"var(--text-1,#0f172a)", marginBottom:4 }}>
            {fotoUrl ? "✅ Foto adicionada!" : "Adicione sua foto"}
          </div>
          <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, lineHeight:1.4 }}>
            Perfis com foto recebem <strong>3× mais contratações</strong>
          </div>
          <label style={{ display:"inline-block", padding:"8px 16px", background:fotoUrl?"#f0fdf4":"#FF6B35", color:fotoUrl?"#16a34a":"#fff", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {uploadingFoto ? "Enviando..." : fotoUrl ? "Trocar foto" : "📷 Escolher foto"}
            <input type="file" accept="image/*" capture="user" style={{ display:"none" }} onChange={e=>e.target.files?.[0]&&handleFotoUpload(e.target.files[0])} />
          </label>
        </div>
      </div>

      {/* Dados pessoais */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:0.5 }}>📋 Dados pessoais</div>

      <label style={S.label}>Nome completo *</label>
      <input style={S.input} placeholder="Ex: João da Silva" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} />

      <label style={S.label}>Telefone (WhatsApp) *</label>
      <input style={S.input} placeholder="(67) 99999-9999" value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} />

      <label style={S.label}>CPF *</label>
      <input style={{ ...S.input, letterSpacing:1 }} placeholder="000.000.000-00" inputMode="numeric" maxLength={14}
        value={form.cpf} onChange={e=>setForm({...form,cpf:maskCPF(e.target.value)})} />
      <p style={{ color:"var(--text-2,#64748b)", fontSize:11, margin:"-6px 0 10px", display:"flex", alignItems:"center", gap:4 }}>
        🔒 Usado apenas para verificação de identidade. Nunca compartilhado.
      </p>

      <label style={S.label}>Sexo *</label>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:8 }}>
        {([["M","Masculino"],["F","Feminino"],["N","Não informar"]] as const).map(([val,label]) => (
          <button key={val}
            style={{ padding:"10px 6px", border:form.sexo===val?"2px solid #FF6B35":"1.5px solid #e2e8f0", borderRadius:12, background:form.sexo===val?"#fff7f3":"#f8fafc", color:form.sexo===val?"#FF6B35":"#475569", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
            onClick={() => setForm({...form,sexo:val})}>
            {label}
          </button>
        ))}
      </div>

      <label style={S.label}>Data de nascimento *</label>
      <input style={S.input} type="date"
        max={new Date(new Date().setFullYear(new Date().getFullYear()-16)).toISOString().split("T")[0]}
        value={form.dataNasc} onChange={e=>setForm({...form,dataNasc:e.target.value})} />

      {/* Especialidades com seção colapsável */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:6, marginTop:20, textTransform:"uppercase" as const, letterSpacing:0.5 }}>💼 Especialidades *</div>
      <p style={{ color:"var(--text-3,#94a3b8)", fontSize:12, margin:"0 0 4px" }}>Toque para selecionar. A <strong style={{ color:"#FF6B35" }}>primeira selecionada ⭐</strong> é sua especialidade principal.</p>
      {categoriasSelecionadas.length > 0 && (
        <p style={{ color:"#FF6B35", fontSize:12, margin:"0 0 8px", fontWeight:700 }}>
          {categoriasSelecionadas.length} selecionada{categoriasSelecionadas.length > 1 ? "s" : ""} · Principal: ⭐ {categoriasSelecionadas[0]}
        </p>
      )}
      {/* Botão expandir/recolher habilidades */}
      <button
        style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"2px dashed #e2e8f0", background:"var(--bg-surface,#f8fafc)", color:"#475569", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}
        onClick={() => setHabilidadesExpandidas(prev => !prev)}>
        <span>{habilidadesExpandidas ? "🔼 Recolher habilidades" : "🔽 Ver todas as habilidades"}</span>
        <span style={{ background:"#FF6B35", color:"#fff", borderRadius:20, padding:"2px 10px", fontSize:11 }}>{habilidadesExpandidas ? "−" : "+"}</span>
      </button>
      {habilidadesExpandidas && (
        <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8, marginBottom:12, background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"12px", border:"1px solid var(--border,#e2e8f0)" }}>
          {Object.entries(CATEGORIAS_NEGOCIO).flatMap(([, info]) =>
            info.funcoes.map(f => {
              const sel = categoriasSelecionadas.includes(f);
              const idx = categoriasSelecionadas.indexOf(f);
              return (
                <button key={f}
                  style={{ padding:"7px 14px", borderRadius:20, border:`2px solid ${sel?"#FF6B35":"#e2e8f0"}`,
                    background:sel?"#FF6B35":"#fff", color:sel?"#fff":"#475569",
                    fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", position:"relative" as const }}
                  onClick={() => setCategorias(prev => sel ? prev.filter(x=>x!==f) : [...prev, f])}>
                  {f}{sel && idx === 0 ? " ⭐" : ""}
                </button>
              );
            })
          )}
        </div>
      )}

      <label style={S.label}>Valor por diária (R$) *</label>
      <input style={S.input} placeholder="Ex: 150" type="number" value={form.valor} onChange={e=>setForm({...form,valor:e.target.value})} />
      {/* Banner de média de mercado por função */}
      {categoriasSelecionadas[0] && MEDIAS_CAMPO_GRANDE[categoriasSelecionadas[0]] && (() => {
        const med = MEDIAS_CAMPO_GRANDE[categoriasSelecionadas[0]];
        const valorNum = Number(form.valor);
        const abaixoMinimo = valorNum > 0 && !isNaN(valorNum) && valorNum < med.min;
        return (
          <>
            <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:10, padding:"9px 12px", marginBottom:6, fontSize:12, color:"#166534" }}>
              💡 Faixa em Campo Grande para <strong>{categoriasSelecionadas[0]}</strong>:{" "}
              R$ {med.min} — R$ {med.max}/dia (média R$ {med.media})
            </div>
            {abaixoMinimo && (
              <div style={{ background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:10, padding:"9px 12px", marginBottom:6, fontSize:12, color:"#9a3412", display:"flex", alignItems:"flex-start", gap:7 }}>
                <span style={{ fontSize:14, flexShrink:0, lineHeight:1.4 }}>⚠️</span>
                <span>Valor abaixo da faixa mínima de mercado. Ofertas assim costumam receber <strong>menos candidatos</strong>. Considere oferecer pelo menos R$ {med.min}.</span>
              </div>
            )}
          </>
        );
      })()}
      <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-2px 0 10px", display:"flex", alignItems:"center", gap:4 }}>
        📊 Média da região: <strong style={{ color:"var(--text-1,#0f172a)" }}>R$ 120 – R$ 250</strong> por diária
      </p>

      <label style={S.label}>Disponibilidade semanal</label>
      <div style={S.diasRow}>
        {DIAS.map(dia=>(
          <button key={dia} style={{ ...S.diaBtn, ...(agendaSelecionada.includes(dia)?S.diaBtnAtivo:{}) }} onClick={()=>toggleDia(dia)}>{DIAS_LABEL[dia]}</button>
        ))}
      </div>
      <div style={S.switchRow}>
        <span style={S.label}>Disponível agora</span>
        <div style={{ ...S.toggle, ...(disponivelAgora?S.toggleAtivo:{}) }} onClick={()=>setDisponivel(!disponivelAgora)}>
          <div style={{ ...S.toggleThumb, ...(disponivelAgora?S.toggleThumbAtivo:{}) }} />
        </div>
      </div>

      {authError && <p style={S.errorText}>{authError}</p>}
      <button style={{ ...S.btnPrimary, marginTop:16 }} onClick={async () => {
        setAuthError("");
        if (!form.nome.trim()) { setAuthError("Informe seu nome completo."); return; }
        { const erroNome = validarNome(form.nome); if (erroNome) { setAuthError(erroNome); return; } }
        if (!validarCPF(form.cpf)) { setAuthError("CPF inválido. Verifique os dígitos e tente novamente."); return; }
        if (!form.sexo) { setAuthError("Selecione seu sexo."); return; }
        if (!form.dataNasc) { setAuthError("Informe sua data de nascimento."); return; }
        if (categoriasSelecionadas.length === 0) { setAuthError("Selecione ao menos uma especialidade."); return; }
        const ok = await saveProfile({
          funcao: categoriasSelecionadas[0] || "",
          cpf: form.cpf,
          sexo: form.sexo,
          data_nascimento: form.dataNasc,
        });
        if (ok) setTela("pedir-localizacao");
      }}>Criar conta grátis →</button>
    </div>
  );

  // ── Chat Suporte DiáriaJá — Jájá IA (deve vir antes dos home-* para não ser bloqueado) ─
  if (chatSuporte) {
    const msgSupportEndRef = { current: null } as React.MutableRefObject<HTMLDivElement | null>;
    const enviarMensagemSuporte = () => {
      if (!inputSuporte.trim() || suporteDigitando) return;
      const txt = inputSuporte.trim();
      setMsgsSuporte(prev => [...prev, { de:"user", texto:txt }]);
      setInputSuporte("");
      void responderSuporte(txt);
    };
    return (
      <div style={{ position:"fixed", inset:0, background:"var(--bg-app,#f0f2f5)", zIndex:300, display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto", fontFamily:"Inter, system-ui, sans-serif" }}>
        {/* Header */}
        <div style={{ background:"linear-gradient(135deg,#8338EC,#FF6B35)", padding:"20px 16px 14px", display:"flex", alignItems:"center", gap:12 }}>
          <button style={{ background:"rgba(255,255,255,.2)", border:"none", color:"#fff", fontSize:20, cursor:"pointer", width:36, height:36, borderRadius:18, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setChatSuporte(false)}>←</button>
          {/* Avatar Jájá */}
          <div style={{ width:44, height:44, borderRadius:22, background:"linear-gradient(135deg,#FF6B35,#f59e0b)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,.25)" }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:900, fontSize:15, color:"#fff" }}>Jájá — IA do Trampojá</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,.8)" }}>{suporteDigitando ? "✍️ digitando..." : "Assistente inteligente · online"}</div>
          </div>
          <span style={{ background:"#22c55e", color:"#fff", fontSize:10, fontWeight:800, padding:"3px 8px", borderRadius:20 }}>IA</span>
        </div>

        {/* Sugestões rápidas (mostrar só quando conversa está vazia) */}
        {msgsSuporte.length <= 1 && (
          <div style={{ padding:"12px 16px 0", display:"flex", flexWrap:"wrap", gap:8 }}>
            {[
              "Como funciona o check-in? 📱",
              "Como pagar o diarista? 💰",
              "Como editar meu perfil? 👤",
              "Esqueci minha senha 🔑",
              "Como cancelar uma diária? ❌",
            ].map(s => (
              <button key={s}
                style={{ background:"#fff", border:"1.5px solid #8338EC", color:"#8338EC", borderRadius:20, padding:"6px 12px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => {
                  setMsgsSuporte(prev => [...prev, { de:"user", texto:s }]);
                  void responderSuporte(s);
                }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Mensagens */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10 }}>
          {msgsSuporte.map((m, i) => (
            <div key={i} style={{ display:"flex", justifyContent:m.de==="user"?"flex-end":"flex-start", alignItems:"flex-end", gap:8 }}>
              {m.de === "bot" && (
                <div style={{ width:28, height:28, borderRadius:14, background:"linear-gradient(135deg,#FF6B35,#f59e0b)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>🤖</div>
              )}
              <div style={{ background:m.de==="user"?"#8338EC":"var(--bg-card,#fff)", color:m.de==="user"?"#fff":"var(--text-1,#0f172a)", borderRadius:m.de==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px", padding:"10px 14px", maxWidth:"75%", fontSize:14, boxShadow:"0 1px 4px rgba(0,0,0,.1)", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
                {m.texto}
              </div>
            </div>
          ))}

          {/* Indicador de digitando */}
          {suporteDigitando && (
            <div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
              <div style={{ width:28, height:28, borderRadius:14, background:"linear-gradient(135deg,#FF6B35,#f59e0b)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🤖</div>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:"18px 18px 18px 4px", padding:"12px 16px", boxShadow:"0 1px 4px rgba(0,0,0,.1)", display:"flex", gap:5, alignItems:"center" }}>
                <span style={{ width:8, height:8, borderRadius:4, background:"#8338EC", display:"inline-block", animation:"bounce 1.2s infinite 0s" }} />
                <span style={{ width:8, height:8, borderRadius:4, background:"#8338EC", display:"inline-block", animation:"bounce 1.2s infinite .2s" }} />
                <span style={{ width:8, height:8, borderRadius:4, background:"#8338EC", display:"inline-block", animation:"bounce 1.2s infinite .4s" }} />
              </div>
            </div>
          )}
          <div ref={msgSupportEndRef} />
        </div>

        {/* Input */}
        <div style={{ background:"var(--bg-card,#fff)", padding:"12px 16px", display:"flex", gap:10, alignItems:"center", borderTop:"1px solid var(--border,#e2e8f0)" }}>
          <input
            style={{ flex:1, padding:"12px 16px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:24, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", outline:"none", background:"var(--input-bg,#fff)", color:"var(--text-1,#0f172a)" }}
            placeholder={suporteDigitando ? "Jájá está digitando..." : "Pergunte qualquer coisa..."}
            value={inputSuporte}
            disabled={suporteDigitando}
            onChange={e => setInputSuporte(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") enviarMensagemSuporte(); }}
          />
          <button
            style={{ width:44, height:44, borderRadius:22, background:inputSuporte.trim() && !suporteDigitando?"#8338EC":"#e2e8f0", border:"none", color:"#fff", fontSize:20, cursor:inputSuporte.trim() && !suporteDigitando?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"background .2s" }}
            disabled={!inputSuporte.trim() || suporteDigitando}
            onClick={enviarMensagemSuporte}>
            ➤
          </button>
        </div>
      </div>
    );
  }

  // ── MODAL: Termo de Ciência (Empregador seleciona candidato) ──────────────
  if (modalTermoCiencia) {
    const { diaria, diaristaId } = modalTermoCiencia;
    const dp = candidatosProfiles[diaristaId];
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.75)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center", fontFamily:"Inter, system-ui, sans-serif" }}>
        <div style={{ background:"var(--bg-card,#fff)", borderRadius:"20px 20px 0 0", padding:"24px 22px 40px", width:"100%", maxWidth:480 }}>
          <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
          <h3 style={{ fontSize:19, fontWeight:900, color:"var(--text-1,#0f172a)", marginBottom:12 }}>📋 Antes de confirmar...</h3>
          <p style={{ fontSize:14, color:"var(--text-label,#475569)", lineHeight:1.6, marginBottom:16 }}>
            Você está prestes a contratar <strong>{dp?.nome || "este profissional"}</strong> para <strong>{diaria.funcao}</strong>. Combinamos que:
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
            {[
              { icon:"✅", txt:"O DiáriaJá conecta profissionais e contratantes com facilidade" },
              { icon:"⚠️", txt:"Não verificamos ativamente as qualificações de cada profissional" },
              { icon:"💡", txt:"Recomendamos verificar referências pessoalmente quando possível" },
              { icon:"🤝", txt:"A negociação final é entre você e o profissional" },
            ].map(it => (
              <div key={it.icon} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:18, flexShrink:0 }}>{it.icon}</span>
                <span style={{ fontSize:13, color:"var(--text-label,#475569)", lineHeight:1.5 }}>{it.txt}</span>
              </div>
            ))}
          </div>
          <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", padding:"12px 14px", background:"#f8fafc", borderRadius:12, border:`1.5px solid ${termoCienciaCheck?"#FF6B35":"#e2e8f0"}`, marginBottom:16 }}>
            <input type="checkbox" checked={termoCienciaCheck} onChange={e => setTermoCienciaCheck(e.target.checked)} style={{ width:18, height:18, accentColor:"#FF6B35", flexShrink:0, marginTop:1 }} />
            <span style={{ fontSize:13, color:"var(--text-1,#0f172a)", lineHeight:1.5 }}>Entendi e quero selecionar este profissional</span>
          </label>
          <button
            style={{ width:"100%", padding:"15px", background:termoCienciaCheck?"#FF6B35":"#e2e8f0", color:termoCienciaCheck?"#fff":"#94a3b8", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:termoCienciaCheck && !selecionando?"pointer":"default", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, opacity: selecionando ? 0.7 : 1 }}
            disabled={!termoCienciaCheck || selecionando}
            onClick={() => { if (termoCienciaCheck && !selecionando) void executarSelecaoCandidato(diaria, diaristaId); }}>
            {selecionando ? "⏳ Confirmando..." : "✅ Confirmar seleção"}
          </button>
          <button
            style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
            onClick={() => { setModalTermoCiencia(null); setTermoCienciaCheck(false); }}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ── MODAL: Termo do Diarista (Diarista confirma presença) ─────────────────
  if (modalTermoDiarista) {
    const d = modalTermoDiarista;
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.75)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center", fontFamily:"Inter, system-ui, sans-serif" }}>
        <div style={{ background:"var(--bg-card,#fff)", borderRadius:"20px 20px 0 0", padding:"24px 22px 40px", width:"100%", maxWidth:480 }}>
          <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
          <h3 style={{ fontSize:19, fontWeight:900, color:"var(--text-1,#0f172a)", marginBottom:12 }}>🤝 Confirmar presença</h3>
          <div style={{ background:"#f8fafc", borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
            <div style={{ fontWeight:800, fontSize:15, color:"var(--text-1,#0f172a)", marginBottom:6 }}>{d.nome_negocio || d.segmento}</div>
            <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:4 }}>👷 {d.funcao}</div>
            <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:4 }}>📅 {new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR")} · 🕐 {d.horario_inicio.slice(0,5)}–{d.horario_fim.slice(0,5)}</div>
            <div style={{ fontSize:15, fontWeight:900, color:"#FF6B35", marginTop:6 }}>R$ {d.valor}/dia</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
            {[
              { icon:"📍", txt:"Você se compromete a comparecer no local e horário combinados" },
              { icon:"⏰", txt:"Em caso de imprevisto, avise o contratante com antecedência" },
              { icon:"💼", txt:"Cumpra o serviço acordado com profissionalismo" },
              { icon:"💬", txt:"O contratante será notificado da sua confirmação" },
            ].map(it => (
              <div key={it.icon} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:18, flexShrink:0 }}>{it.icon}</span>
                <span style={{ fontSize:13, color:"var(--text-label,#475569)", lineHeight:1.5 }}>{it.txt}</span>
              </div>
            ))}
          </div>
          <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", padding:"12px 14px", background:"#f8fafc", borderRadius:12, border:`1.5px solid ${termoDiaristaCheck?"#22c55e":"#e2e8f0"}`, marginBottom:16 }}>
            <input type="checkbox" checked={termoDiaristaCheck} onChange={e => setTermoDiaristaCheck(e.target.checked)} style={{ width:18, height:18, accentColor:"#22c55e", flexShrink:0, marginTop:1 }} />
            <span style={{ fontSize:13, color:"var(--text-1,#0f172a)", lineHeight:1.5 }}>Entendi e confirmo que compareço nessa diária</span>
          </label>
          <button
            style={{ width:"100%", padding:"15px", background:termoDiaristaCheck?"#22c55e":"#e2e8f0", color:termoDiaristaCheck?"#fff":"#94a3b8", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:termoDiaristaCheck?"pointer":"default", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
            disabled={!termoDiaristaCheck || confirmando}
            onClick={() => { if (termoDiaristaCheck) executarConfirmarPresenca(d); }}>
            {confirmando ? "Confirmando..." : "✅ Confirmar minha presença"}
          </button>
          <button
            style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
            onClick={() => { setModalTermoDiarista(null); setTermoDiaristaCheck(false); }}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ── MODAL: Recibo do Diarista ─────────────────────────────────────────────
  if (modalReciboDiarista) {
    const d = modalReciboDiarista;
    const [h1r, m1r] = d.horario_inicio.split(":").map(Number);
    const [h2r, m2r] = d.horario_fim.split(":").map(Number);
    const totalMinR = (h2r * 60 + m2r) - (h1r * 60 + m1r);
    const horasR = totalMinR > 0 ? `${Math.floor(totalMinR/60)}h${totalMinR%60>0?String(totalMinR%60).padStart(2,"0")+"min":""}` : "";
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.85)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"Inter, system-ui, sans-serif" }}>
        <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"28px 24px 32px", width:"100%", maxWidth:420 }}>
          <div style={{ textAlign:"center", marginBottom:20 }}>
            <div style={{ fontSize:48, marginBottom:8 }}>🧾</div>
            <h3 style={{ fontSize:20, fontWeight:900, color:"var(--text-1,#0f172a)", margin:0 }}>Recibo do Serviço</h3>
            <p style={{ fontSize:13, color:"var(--text-2,#64748b)", margin:"4px 0 0" }}>Guarde como comprovante</p>
          </div>
          <div style={{ background:"#f8fafc", borderRadius:16, padding:"16px 18px", marginBottom:20, display:"flex", flexDirection:"column", gap:10 }}>
            {([
              ["Serviço", d.funcao || d.descricao],
              ["Local", d.nome_negocio || d.segmento],
              ["Data", new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR")],
              ["Horário", `${d.horario_inicio.slice(0,5)} – ${d.horario_fim.slice(0,5)}${horasR ? ` (${horasR})` : ""}`],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:13, color:"var(--text-2,#64748b)" }}>{k}</span>
                <span style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)", textAlign:"right", maxWidth:220 }}>{v}</span>
              </div>
            ))}
            <div style={{ height:1, background:"#e2e8f0", margin:"4px 0" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:14, fontWeight:700, color:"var(--text-1,#0f172a)" }}>Total recebido</span>
              <span style={{ fontSize:20, fontWeight:900, color:"#22c55e" }}>R$ {d.valor_diarista ?? d.valor}</span>
            </div>
          </div>
          <button
            style={{ width:"100%", padding:"13px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
            onClick={() => {
              const texto = `🧾 RECIBO DE SERVIÇO - DiáriaJá\n\nServiço: ${d.funcao||d.descricao}\nLocal: ${d.nome_negocio||d.segmento}\nData: ${new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR")}\nHorário: ${d.horario_inicio.slice(0,5)} – ${d.horario_fim.slice(0,5)}\nTotal: R$ ${d.valor_diarista ?? d.valor}\n\nGerado em: ${new Date().toLocaleString("pt-BR")}`;
              if (navigator.share) { navigator.share({ title:"Recibo DiáriaJá", text:texto }).catch(()=>{}); }
              else { navigator.clipboard.writeText(texto).then(() => setToastSuccess("✅ Recibo copiado!")); }
            }}>
            📤 Compartilhar recibo
          </button>
          <button
            style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
            onClick={() => setModalReciboDiarista(null)}>
            Fechar
          </button>
        </div>
      </div>
    );
  }

  // HOME EMPREGADOR
  if (tela === "home-empregador") {
    if (!negocio) { setTimeout(() => setTela("escolha-negocio"), 0); return null; }
    // Usa constante global pré-computada (evita recalcular a cada render)
    const funcoes = TODAS_AS_FUNCOES;
    const iniciaisEmp = profile?.nome?.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "?";
    const hora = new Date().getHours();
    const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
    const primeiroNome = profile?.nome?.split(" ")[0] || "você";

    const statusCor: Record<string,{bg:string,color:string}> = {
      aberta:    { bg:"#dcfce7", color:"#16a34a" },
      aceita:    { bg:"#dbeafe", color:"#1d4ed8" },
      concluida: { bg:"#f1f5f9", color:"var(--text-2,#64748b)" },
      cancelada: { bg:"#fee2e2", color:"#dc2626" },
    };

    // Para o filtro de categoria: se filtroFuncao é uma função de uma categoria,
    // mostrar todos os diaristas dessa categoria (ou só aquela função específica)
    const catDoFiltro = filtroFuncao !== "Todos"
      ? Object.values(CATEGORIAS_NEGOCIO).find(info => (info.funcoes as readonly string[]).includes(filtroFuncao))
      : null;
    const diaristasReaisVisiveis = diaristasReais
      .filter(d => {
        if (filtroDisp && !d.disponivel) return false;
        if (filtroFuncao !== "Todos") {
          // Verifica se o diarista tem aquela função exata OU alguma função da mesma categoria
          const funcoesDiarista = (d.categorias?.length ? d.categorias : [d.funcao]).filter(Boolean);
          if (!funcoesDiarista.some(f => f === filtroFuncao || (catDoFiltro && (catDoFiltro.funcoes as readonly string[]).includes(f)))) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aD = (a as UserProfile & { plano_ativo?: string }).plano_ativo === "destaque" ? 1 : 0;
        const bD = (b as UserProfile & { plano_ativo?: string }).plano_ativo === "destaque" ? 1 : 0;
        return bD - aD;
      });

    return (
      <div style={{ ...S.appShell, paddingBottom:76, background:"var(--bg-app,#f0f2f5)" }}>

        {/* ── Header ── */}
        <div style={{ background:"var(--bg-card,#fff)", padding:"20px 20px 14px", boxShadow:"0 2px 8px rgba(0,0,0,.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            {/* Avatar + Nome */}
            <div style={{ display:"flex", alignItems:"center", gap:14, flex:1 }}>
              <div style={{ width:52, height:52, borderRadius:26, background:negocio.cor, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:18, border:`3px solid ${negocio.cor}`, flexShrink:0, position:"relative" }}>
                {iniciaisEmp}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", fontWeight:600 }}>{saudacao},</div>
                <div style={{ fontSize:20, fontWeight:900, color:"var(--text-1,#0f172a)", lineHeight:1.2 }}>
                  <span style={{ color:negocio.cor, cursor:"pointer" }} onClick={() => { setModalInfoPerfil(true); setBioDraft(profile?.bio || ""); }}>{primeiroNome}!</span> 👋
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:3 }}>
                  <span style={{ background:negocio.cor+"15", color:negocio.cor, fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>🏢 Empregador</span>
                </div>
              </div>
            </div>
            {/* Sino + botão trocar perfil */}
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {tipo === "ambos" && (
                <div style={{ background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer" }}
                  onClick={() => setMenuTrocarPerfil(true)}>🔄</div>
              )}
              <div style={{ position:"relative", background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer" }}
                onClick={() => { setModalNotif(true); setNotifNaoLidas(0); }}>
                🔔
                {(notifNaoLidas + suporteNaoLidos) > 0 && <div style={{ position:"absolute", top:-4, right:-4, background: suporteNaoLidos > 0 ? "#f59e0b" : "#ef4444", color:"#fff", borderRadius:10, minWidth:18, height:18, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, padding:"0 4px" }}>{(notifNaoLidas + suporteNaoLidos) > 9 ? "9+" : (notifNaoLidas + suporteNaoLidos)}</div>}
              </div>
            </div>
          </div>

          {/* Chip do segmento — clicável para trocar rapidamente */}
          <div style={{ display:"flex", gap:8, marginTop:14, alignItems:"center", flexWrap:"wrap" }}>
            <span
              style={{ display:"flex", alignItems:"center", gap:5, background:negocio.cor+"15", color:negocio.cor, padding:"7px 14px", borderRadius:20, fontSize:12, fontWeight:700, border:`1.5px solid ${negocio.cor}35`, cursor:"pointer" }}
              onClick={() => setTela("escolha-negocio")}
              title="Toque para trocar o tipo de serviço">
              {negocio.icone} {negocioSelecionado} <span style={{ fontSize:10, opacity:0.7 }}>✏️</span>
            </span>
          </div>
        </div>

        {authError && <div style={{ background:"#fef2f2", color:"#b91c1c", fontSize:13, padding:"8px 16px", borderTop:"1px solid #fecaca" }}>{authError}</div>}

        {/* Toasts auto-dismiss */}
        {toastSuccess && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#0f172a", color:"#fff", borderRadius:24, padding:"10px 22px", fontSize:14, fontWeight:700, zIndex:999, boxShadow:"0 4px 20px rgba(0,0,0,.25)", whiteSpace:"nowrap" }}>
            {toastSuccess}
          </div>
        )}
        {toastError && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#dc2626", color:"#fff", borderRadius:24, padding:"10px 22px", fontSize:14, fontWeight:700, zIndex:999, boxShadow:"0 4px 20px rgba(220,38,38,.4)", whiteSpace:"nowrap", maxWidth:"90vw", textAlign:"center" as const }}>
            {toastError}
          </div>
        )}

        {/* ── ABA INÍCIO ── */}
        {tabEmpregador === "inicio" && (
          <>
            {/* Filtro de habilidades */}
            <div style={{ background:"var(--bg-card,#fff)", borderBottom:"1px solid var(--border-sub,#f1f5f9)" }}>
              {/* Linha 1: disponíveis hoje + por categoria */}
              <div style={{ display:"flex", gap:8, padding:"10px 16px 6px", overflowX:"auto" }}>
                <button style={{ ...S.filtroBtn, ...(filtroDisp?{ background:negocio.cor, color:"#fff", borderColor:negocio.cor }:{}) }} onClick={()=>setFiltroDisp(!filtroDisp)}>
                  {filtroDisp?"✓ ":""}Disponíveis hoje
                </button>
                <button style={{ ...S.filtroBtn, ...(filtroFuncao==="Todos"?{ background:negocio.cor, color:"#fff", borderColor:negocio.cor }:{}) }} onClick={()=>setFiltroFuncao("Todos")}>Todos</button>
                {Object.entries(CATEGORIAS_NEGOCIO).map(([cat, info]) => (
                  <button key={cat}
                    style={{ ...S.filtroBtn, whiteSpace:"nowrap", ...(filtroFuncao !== "Todos" && (info.funcoes as readonly string[]).includes(filtroFuncao) ? { background:info.cor, color:"#fff", borderColor:info.cor } : {}) }}
                    onClick={() => setFiltroFuncao(filtroFuncao !== "Todos" && (info.funcoes as readonly string[]).includes(filtroFuncao) ? "Todos" : info.funcoes[0])}>
                    {info.icone} {cat}
                  </button>
                ))}
              </div>
              {/* Linha 2: funções da categoria selecionada */}
              {filtroFuncao !== "Todos" && (() => {
                const catEntry = Object.entries(CATEGORIAS_NEGOCIO).find(([, info]) => (info.funcoes as readonly string[]).includes(filtroFuncao));
                if (!catEntry) return null;
                const [, catInfo] = catEntry;
                return (
                  <div style={{ display:"flex", gap:6, padding:"0 16px 8px", overflowX:"auto" }}>
                    {(catInfo.funcoes as readonly string[]).map(f => (
                      <button key={f}
                        style={{ ...S.filtroBtn, fontSize:11, padding:"5px 10px", whiteSpace:"nowrap", ...(filtroFuncao===f?{ background:catInfo.cor, color:"#fff", borderColor:catInfo.cor }:{}) }}
                        onClick={() => setFiltroFuncao(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Lista de profissionais */}
            <div style={{ padding:"12px 16px 24px", display:"flex", flexDirection:"column", gap:12 }}>
                {/* Favoritos */}
                {favoritos.size > 0 && (() => {
                  const favList = diaristasReais.filter(d => favoritos.has(d.id));
                  if (favList.length === 0) return null;
                  return (
                    <div style={{ marginBottom:4 }}>
                      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:8 }}>❤️ Meus favoritos</div>
                      <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4 }}>
                        {favList.map(d => {
                          const ini = d.nome.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase();
                          return (
                            <div key={d.id} style={{ flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", gap:4, cursor:"pointer" }}
                              onClick={() => { setDiaristaSelecionadaReal(d); setModalContratoReal(false); setContratadoReal(false); setTela("perfil-diarista-real"); }}>
                              {d.foto_url
                                ? <img src={d.foto_url} style={{ width:52, height:52, borderRadius:26, objectFit:"cover", border:`2px solid ${negocio.cor}` }} alt="" />
                                : <div style={{ width:52, height:52, borderRadius:26, background:negocio.cor, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:14, border:`2px solid ${negocio.cor}` }}>{ini}</div>
                              }
                              <div style={{ fontSize:10, fontWeight:700, color:"var(--text-1,#0f172a)", maxWidth:60, textAlign:"center" as const, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{d.nome.split(" ")[0]}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {diaristasReaisVisiveis.length === 0 ? (
                  <div style={{ background:"var(--bg-card,#fff)", borderRadius:20, padding:"32px 24px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                    <div style={{ fontSize:56, marginBottom:12 }}>🔍</div>
                    <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)", marginBottom:8 }}>Nenhum profissional ainda</div>
                    <div style={{ color:"var(--text-2,#64748b)", fontSize:13, lineHeight:1.6, marginBottom:16 }}>
                      Ainda não há diaristas cadastrados na sua região. Convide um amigo e ajude a plataforma a crescer!
                    </div>
                    <button
                      style={{ background:negocio.cor, color:"#fff", border:"none", borderRadius:14, padding:"12px 24px", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:`0 4px 14px ${negocio.cor}55` }}
                      onClick={() => {
                        if (navigator.share) {
                          navigator.share({ title:"DiáriaJá", text:"Cadastre-se como diarista no DiáriaJá e ganhe dinheiro!", url:"https://diariaja.vercel.app" });
                        } else {
                          navigator.clipboard?.writeText("https://diariaja.vercel.app");
                          setToastSuccess("🔗 Link copiado!");
                        }
                      }}>
                      📨 Convidar diarista
                    </button>
                  </div>
                ) : (
                  diaristasReaisVisiveis.map((d, i) => {
                    const [bg, fg] = avatarColors[i % avatarColors.length];
                    const iniciais = d.nome.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase();
                    const funcCatEntry = Object.entries(CATEGORIAS_NEGOCIO).find(([, info]) => (info.funcoes as readonly string[]).includes(d.funcao));
                    const funcCor = funcCatEntry ? funcCatEntry[1].cor : bg;

                    return (
                      <div key={d.id}
                        style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,.07)", cursor:"pointer" }}
                        onClick={() => { setDiaristaSelecionadaReal(d); setModalContratoReal(false); setContratadoReal(false); setTela("perfil-diarista-real"); }}>

                        <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                          {/* Avatar */}
                          <div style={{ width:60, height:60, borderRadius:30, background:bg, color:fg, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:18, flexShrink:0, overflow:"hidden", boxShadow:`0 4px 12px ${bg}55` }}>
                            {d.foto_url
                              ? <img src={d.foto_url} style={{ width:"100%", height:"100%", objectFit:"cover" }} alt="" />
                              : iniciais}
                          </div>

                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)", lineHeight:1.3 }}>{d.nome}</div>
                                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5, flexWrap:"wrap" }}>
                                  <span style={{ background:funcCor+"18", color:funcCor, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, border:`1px solid ${funcCor}30` }}>
                                    {d.funcao}
                                  </span>
                                  {d.categorias?.slice(0,1).map(f => (
                                    <span key={f} style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>· {f}</span>
                                  ))}
                                </div>
                              </div>
                              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2, flexShrink:0 }}>
                                <div style={{ fontWeight:900, fontSize:22, color:"#FF6B35", lineHeight:1 }}>R$ {d.valor_diaria}</div>
                                <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>/dia</div>
                                <button
                                  style={{ background:"none", border:"none", padding:"2px 0", cursor:"pointer", fontSize:13, color:"#cbd5e1", lineHeight:1 }}
                                  title="Denunciar usuário"
                                  onClick={e => { e.stopPropagation(); setModalDenunciar({ tipo:"usuario", id:d.id, nome:d.nome }); setMotivoDenuncia(""); }}>
                                  ⚑
                                </button>
                              </div>
                            </div>

                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" as const }}>
                                <span style={{ ...S.badge, ...(d.disponivel ? S.badgeVerde : S.badgeCinza), fontSize:11 }}>
                                  {d.disponivel ? "● Disponível hoje" : "● Ocupado"}
                                </span>
                                {profile?.lat && profile?.lng && d.lat && d.lng && (
                                  <span style={{ fontSize:11, color:"var(--text-2,#64748b)", fontWeight:600 }}>
                                    📍 {haversineKm(profile.lat!, profile.lng!, d.lat!, d.lng!).toFixed(1)} km
                                  </span>
                                )}
                              </div>
                              <button
                                style={{ background:negocio.cor, color:"#fff", border:"none", borderRadius:12, padding:"9px 18px", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:`0 4px 10px ${negocio.cor}44` }}
                                onClick={e => { e.stopPropagation(); setDiaristaSelecionadaReal(d); setModalContratoReal(false); setContratadoReal(false); setTela("perfil-diarista-real"); }}>
                                Ver perfil
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
          </>
        )}

        {/* ── ABA DIÁRIAS ── */}
        {tabEmpregador === "diarias" && (() => {
          const statusLabel: Record<string,{bg:string,color:string,txt:string}> = {
            aberta:       { bg:"#f1f5f9", color:"var(--text-label,#475569)",  txt:"Aberta" },
            pendente:     { bg:"#fef3c7", color:"#d97706",  txt:"⏳ Aguardando confirmação" },
            aceita:       { bg:"#ede9fe", color:"#7c3aed",  txt:"✅ Confirmado — escaneie o QR" },
            em_andamento: { bg:"#fef3c7", color:"#d97706",  txt:"🔄 Em andamento" },
            concluida:    { bg:"#dcfce7", color:"#16a34a",  txt:"✅ Concluída" },
            cancelada:    { bg:"#fee2e2", color:"#dc2626",  txt:"✗ Cancelada" },
          };
          return (
            <div style={{ padding:"20px 16px" }}>
              {/* Botão escanear QR */}
              <button
                style={{ width:"100%", padding:"14px", background:"#0f172a", color:"#fff", border:"none", borderRadius:16, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:16, boxShadow:"0 4px 14px rgba(0,0,0,.2)" }}
                onClick={() => { setScannerAberto(true); setScanMsg(null); }}>
                📷 Escanear QR Code do diarista
              </button>

              {scanMsg && (
                <div style={{ background: scanMsg.ok ? "#dcfce7" : "#fee2e2", color: scanMsg.ok ? "#16a34a" : "#dc2626", borderRadius:12, padding:"12px 16px", fontSize:13, fontWeight:700, marginBottom:14, textAlign:"center" }}>
                  {scanMsg.txt}
                </div>
              )}

              {/* ── Convites: Aceitos ── */}
              {convitesEnviados.filter(c => c.status === "aceito").length > 0 && (
                <div style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>🎉 Convites aceitos</span>
                    <span style={{ background:"#dcfce7", color:"#16a34a", borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:800 }}>{convitesEnviados.filter(c=>c.status==="aceito").length}</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
                    {convitesEnviados.filter(c => c.status === "aceito").map(c => {
                      const jaLiberado = contatosLiberados.has(c.id);
                      const dataFmt = c.data_servico ? new Date(c.data_servico+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "";
                      return (
                        <div key={c.id} style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", boxShadow:"0 2px 10px rgba(0,0,0,.07)", borderLeft:"4px solid #22c55e" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                            <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{c.diarista_nome}</div>
                            <span style={{ background:"#dcfce7", color:"#16a34a", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800, whiteSpace:"nowrap" as const }}>✅ Aceito</span>
                          </div>
                          {c.funcao && <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:4 }}>🛠 {c.funcao}</div>}
                          <div style={{ fontSize:12, color:"var(--text-label,#475569)", display:"flex", flexWrap:"wrap" as const, gap:8, marginBottom:4 }}>
                            <span>📅 {dataFmt}</span>
                            <span>🕐 {c.horario_servico}</span>
                          </div>
                          <div style={{ fontSize:12, color:"var(--text-label,#475569)", marginBottom:12 }}>📍 {c.local_servico}</div>
                          <div style={{ background:"#f0fdf4", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#166534", fontWeight:700, marginBottom:10 }}>
                            🎉 {c.diarista_nome?.split(" ")[0]} aceitou! Pague para liberar o contato.
                          </div>
                          <div style={{ display:"flex", flexDirection:"column" as const, gap:8 }}>
                            {jaLiberado ? (
                              <button
                                style={{ width:"100%", padding:"11px", background:"#22c55e", color:"#fff", border:"none", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                                onClick={async () => {
                                  const { data: dp } = await supabase.from("user_profiles").select("*").eq("id", c.diarista_id).single();
                                  if (dp) { setDiaristaSelecionadaReal(dp); setModalContratoReal(false); setContratadoReal(false); setTela("perfil-diarista-real"); }
                                }}>
                                📱 Ver contato de {c.diarista_nome?.split(" ")[0]}
                              </button>
                            ) : (
                              <button
                                style={{ width:"100%", padding:"11px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                                onClick={() => { setModalPix(c as any); setContatosLiberados(prev => new Set([...prev, c.id])); }}>
                                💳 Pagar{c.valor ? ` R$ ${c.valor}` : ""} e liberar contato
                              </button>
                            )}
                            <button
                              style={{ width:"100%", padding:"9px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:12, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                              onClick={async () => {
                                const { data: dp } = await supabase.from("user_profiles").select("*").eq("id", c.diarista_id).single();
                                if (dp) { setDiaristaSelecionadaReal(dp); setModalContratoReal(false); setContratadoReal(false); setTela("perfil-diarista-real"); }
                              }}>
                              👤 Ver perfil completo
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Convites: Pendentes ── */}
              {convitesEnviados.filter(c => c.status === "pendente").length > 0 && (
                <div style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>⏳ Aguardando resposta</span>
                    <span style={{ background:"#fef3c7", color:"#d97706", borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:800 }}>{convitesEnviados.filter(c=>c.status==="pendente").length}</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
                    {convitesEnviados.filter(c => c.status === "pendente").map(c => {
                      const dataFmt = c.data_servico ? new Date(c.data_servico+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "";
                      return (
                        <div key={c.id} style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", boxShadow:"0 2px 10px rgba(0,0,0,.07)", borderLeft:"4px solid #f59e0b" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                            <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{c.diarista_nome}</div>
                            <span style={{ background:"#fef3c7", color:"#d97706", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800, whiteSpace:"nowrap" as const }}>⏳ Aguardando</span>
                          </div>
                          {c.funcao && <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:4 }}>🛠 {c.funcao}</div>}
                          <div style={{ fontSize:12, color:"var(--text-label,#475569)", display:"flex", flexWrap:"wrap" as const, gap:8 }}>
                            <span>📅 {dataFmt}</span>
                            <span>🕐 {c.horario_servico}</span>
                          </div>
                          <div style={{ fontSize:12, color:"var(--text-label,#475569)", marginTop:4 }}>📍 {c.local_servico}</div>
                          <div style={{ marginTop:10 }}>
                            {confirmCancelarConvite === c.id ? (
                              <div style={{ display:"flex", gap:8, alignItems:"center", background:"#fef2f2", borderRadius:10, padding:"8px 12px" }}>
                                <span style={{ fontSize:12, color:"#dc2626", fontWeight:700, flex:1 }}>Cancelar este convite?</span>
                                <button style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8, padding:"5px 12px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => cancelarConvite(c.id)}>Sim</button>
                                <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:8, padding:"5px 12px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setConfirmCancelarConvite(null)}>Não</button>
                              </div>
                            ) : (
                              <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:12, cursor:"pointer", textDecoration:"underline", padding:0 }} onClick={() => setConfirmCancelarConvite(c.id)}>
                                🗑️ Cancelar convite
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Convites: Recusados ── */}
              {convitesEnviados.filter(c => c.status === "recusado").length > 0 && (
                <div style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>✗ Recusados</span>
                    <span style={{ background:"#fee2e2", color:"#dc2626", borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:800 }}>{convitesEnviados.filter(c=>c.status==="recusado").length}</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
                    {convitesEnviados.filter(c => c.status === "recusado").map(c => {
                      const dataFmt = c.data_servico ? new Date(c.data_servico+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "";
                      return (
                        <div key={c.id} style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", boxShadow:"0 2px 10px rgba(0,0,0,.07)", borderLeft:"4px solid #ef4444", opacity:0.9 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                            <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{c.diarista_nome}</div>
                            <span style={{ background:"#fee2e2", color:"#dc2626", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800, whiteSpace:"nowrap" as const }}>✗ Recusado</span>
                          </div>
                          {c.funcao && <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:4 }}>🛠 {c.funcao}</div>}
                          <div style={{ fontSize:12, color:"var(--text-label,#475569)", display:"flex", flexWrap:"wrap" as const, gap:8 }}>
                            <span>📅 {dataFmt}</span>
                            <span>🕐 {c.horario_servico}</span>
                          </div>
                          <div style={{ fontSize:12, color:"var(--text-label,#475569)", marginTop:4, marginBottom:10 }}>📍 {c.local_servico}</div>
                          <div style={{ background:"#fef2f2", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#991b1b", fontWeight:700, marginBottom:10 }}>
                            😔 {c.diarista_nome?.split(" ")[0]} não pode neste dia. Tente outro profissional.
                          </div>
                          {/* Confirmar e excluir */}
                          {confirmCancelarConvite === c.id ? (
                            <div style={{ display:"flex", gap:8, alignItems:"center", background:"#fef2f2", borderRadius:10, padding:"8px 12px" }}>
                              <span style={{ fontSize:12, color:"#dc2626", fontWeight:700, flex:1 }}>Confirmar exclusão?</span>
                              <button style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8, padding:"5px 12px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => cancelarConvite(c.id)}>Excluir</button>
                              <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:8, padding:"5px 12px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setConfirmCancelarConvite(null)}>Cancelar</button>
                            </div>
                          ) : (
                            <button
                              style={{ width:"100%", padding:"9px", background:"#fee2e2", color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:12, fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                              onClick={() => setConfirmCancelarConvite(c.id)}>
                              🗑️ Confirmar e excluir
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)", marginBottom:12 }}>📋 Minhas diárias</div>

              {diarias.filter(d => d.status !== "cancelada").length === 0 ? (
                <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"20px 16px", textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:13 }}>
                  Nenhuma diária publicada ainda.
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {diarias.filter(d => d.status !== "cancelada").map(dia => {
                    const sl = statusLabel[dia.status] ?? statusLabel.aberta;
                    const [h1s, m1s] = dia.horario_inicio.split(":");
                    const [h2s, m2s] = dia.horario_fim.split(":");
                    const min = (parseInt(h2s)*60+parseInt(m2s)) - (parseInt(h1s)*60+parseInt(m1s));
                    const dur = min > 0 ? `${Math.floor(min/60)}h${min%60>0?String(min%60).padStart(2,"0")+"min":""}` : "";
                    const bordaCor = dia.status==="em_andamento" ? "#f59e0b" : dia.status==="aceita" ? "#3A86FF" : dia.status==="concluida" ? "#22c55e" : dia.status==="cancelada" ? "#ef4444" : "#e2e8f0";
                    const estaExpandida = detalhesDiaria?.id === dia.id;
                    return (
                      <div key={dia.id}
                        style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:"14px 16px", boxShadow:"0 2px 10px rgba(0,0,0,.07)", borderLeft:`4px solid ${bordaCor}`, cursor:"pointer", transition:"box-shadow .15s" }}
                        onClick={() => setDetalhesDiaria(estaExpandida ? null : dia)}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                            <span style={{ background:sl.bg, color:sl.color, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800 }}>{sl.txt}</span>
                            {/* Badge de pagamento */}
                            {dia.pagamento_status === "pago" && (
                              <span style={{ background:"#dcfce7", color:"#15803d", padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:800 }}>💳 Pago</span>
                            )}
                            {(dia.pagamento_status === "aguardando" || !dia.pagamento_status) && dia.diarista_aceite_id && (dia.status === "aceita" || dia.status === "em_andamento") && (
                              <span style={{ background:"#fef3c7", color:"#d97706", padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:800 }}>⏳ Pg. pendente</span>
                            )}
                            {/* Badge de dislikes */}
                            {dia.status === "aberta" && (dislikesPorVaga[dia.id] ?? 0) > 0 && (
                              <span style={{ background:"#fef2f2", color:"#dc2626", padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:800 }} title="Profissionais que não têm interesse nesta vaga">
                                👎 {dislikesPorVaga[dia.id]}
                              </span>
                            )}
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            {/* Botão editar — só para diárias abertas ou pendentes (aguardando confirmação) */}
                            {(dia.status === "aberta" || dia.status === "pendente") && (
                              <button
                                style={{ background:"#eff6ff", color:"#3A86FF", border:"none", borderRadius:8, padding:"4px 9px", fontSize:14, cursor:"pointer", lineHeight:1 }}
                                title="Editar diária"
                                onClick={e => { e.stopPropagation(); setModalEditarDiaria(dia); setFormEditarDiaria({ descricao:dia.descricao, horario_inicio:dia.horario_inicio, horario_fim:dia.horario_fim, valor:String(dia.valor) }); setAuthError(""); }}>
                                ✏️
                              </button>
                            )}
                            {/* Botão recibo + PIX — só para concluídas */}
                            {dia.status === "concluida" && (
                              <>
                                <button
                                  style={{ background:"#f0fdf4", color:"#16a34a", border:"none", borderRadius:8, padding:"4px 9px", fontSize:14, cursor:"pointer", lineHeight:1 }}
                                  title="Ver recibo"
                                  onClick={e => { e.stopPropagation(); setModalRecibo(dia); }}>
                                  🧾
                                </button>
                                <button
                                  style={{ background:"#f0fdf4", color:"#16a34a", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", lineHeight:1 }}
                                  title="Pagar via PIX"
                                  onClick={e => { e.stopPropagation(); setModalPix(dia); }}>
                                  PIX
                                </button>
                              </>
                            )}
                            {dia.status !== "em_andamento" && dia.status !== "concluida" && (
                              <button
                                style={{ background:"#fee2e2", color:"#ef4444", border:"none", borderRadius:8, padding:"4px 9px", fontSize:14, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", lineHeight:1 }}
                                title="Excluir diária"
                                onClick={e => { e.stopPropagation(); setModalExcluir(dia); }}>
                                🗑️
                              </button>
                            )}
                            <span style={{ fontWeight:900, fontSize:16, color:negocio.cor }}>R$ {dia.valor}</span>
                            {/* Indicador expand/collapse */}
                            <span style={{ fontSize:12, color:"var(--text-3,#94a3b8)", transition:"transform .2s", display:"inline-block", transform: estaExpandida ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                          </div>
                        </div>
                        <div style={{ fontWeight:700, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:6 }}>{dia.descricao}</div>
                        <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:4 }}>
                          {dia.funcao && <span>👷 {dia.funcao} · </span>}
                          <span>📅 {new Date(dia.data+"T12:00:00").toLocaleDateString("pt-BR")} · 🕐 {dia.horario_inicio.slice(0,5)}–{dia.horario_fim.slice(0,5)}{dur ? ` · ${dur}` : ""}</span>
                        </div>
                        {dia.endereco && <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginBottom:4 }}>📍 {dia.endereco.split(", ").slice(0,3).join(", ")}</div>}

                        {/* ── Painel de ações rápidas (aparece ao expandir o card) ── */}
                        {estaExpandida && (
                          <div style={{ display:"flex", gap:8, flexWrap:"wrap" as const, marginTop:10, paddingTop:10, borderTop:"1px solid var(--border,#f1f5f9)" }} onClick={e => e.stopPropagation()}>
                            {/* Chat — liberado após pagamento */}
                            {((dia.status === "aceita" && dia.pagamento_status === "pago") || dia.status === "em_andamento") && dia.diarista_aceite_id && (
                              <button
                                style={{ flex:1, minWidth:80, padding:"9px 12px", background:"#eff6ff", color:"#3A86FF", border:"1.5px solid #bfdbfe", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                                onClick={() => { setChatDiariaAtiva(dia); setTabEmpregador("chat"); setMsgNaoLidas(0); }}>
                                💬 Chat
                              </button>
                            )}
                            {/* Pagar via MP — só depois que o diarista confirmou (status "aceita") */}
                            {dia.diarista_aceite_id && dia.pagamento_status !== "pago" && dia.status === "aceita" && (
                              <button
                                style={{ flex:1, minWidth:80, padding:"9px 12px", background:"linear-gradient(135deg,#009ee3,#007eb5)", color:"#fff", border:"none", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                                onClick={e => { e.stopPropagation(); setModalPagamentoMP(dia); setAuthError(""); }}>
                                💳 Pagar
                              </button>
                            )}
                            {/* Ver candidatos — diária aberta */}
                            {dia.status === "aberta" && (() => {
                              const cands = candidaturas.filter(c => c.diaria_id === dia.id && c.status === "pendente");
                              return cands.length > 0 ? (
                                <button
                                  style={{ flex:1, minWidth:80, padding:"9px 12px", background:"#f5f3ff", color:"#7c3aed", border:"1.5px solid #ddd6fe", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                                  onClick={() => setModalCandidatos(dia)}>
                                  👥 {cands.length} candidato{cands.length>1?"s":""}
                                </button>
                              ) : null;
                            })()}
                            {/* Dislikes — diaristas que não têm interesse */}
                            {dia.status === "aberta" && (dislikesPorVaga[dia.id] ?? 0) > 0 && (
                              <div style={{ padding:"9px 12px", background:"#fef2f2", color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:12, fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:5, flexShrink:0 }}
                                title="Profissionais que não têm interesse nesta vaga">
                                👎 {dislikesPorVaga[dia.id]} não {dislikesPorVaga[dia.id]===1?"tem":"têm"} interesse
                              </div>
                            )}
                            {/* Editar */}
                            {(dia.status === "aberta" || dia.status === "pendente") && (
                              <button
                                style={{ flex:1, minWidth:80, padding:"9px 12px", background:"#fef3c7", color:"#92400e", border:"1.5px solid #fde68a", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                                onClick={() => { setModalEditarDiaria(dia); setFormEditarDiaria({ descricao:dia.descricao, horario_inicio:dia.horario_inicio, horario_fim:dia.horario_fim, valor:String(dia.valor) }); }}>
                                ✏️ Editar
                              </button>
                            )}
                            {/* Cancelar */}
                            {dia.status !== "concluida" && dia.status !== "cancelada" && (
                              <button
                                style={{ flex:1, minWidth:80, padding:"9px 12px", background:"#fef2f2", color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                                onClick={() => { setModalCancelar(dia); setMotivoCancelamento(""); }}>
                                ✕ Cancelar
                              </button>
                            )}
                            {/* Recibo (concluída) */}
                            {dia.status === "concluida" && (
                              <button
                                style={{ flex:1, minWidth:80, padding:"9px 12px", background:"#f0fdf4", color:"#15803d", border:"1.5px solid #bbf7d0", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                                onClick={() => setModalRecibo(dia)}>
                                🧾 Recibo
                              </button>
                            )}
                          </div>
                        )}
                        {/* Delivery info para empregador */}
                        {FUNCOES_DELIVERY.includes(dia.funcao) && (dia.valor_encostada || dia.valor_por_entrega || dia.ganho_estimado_dia) && (
                          <div style={{ display:"flex", gap:10, flexWrap:"wrap", background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:10, padding:"7px 10px", marginBottom: (dia.status==="aceita"||dia.status==="em_andamento") ? 12 : 4 }}>
                            {dia.valor_encostada && <span style={{ fontSize:11, color:"#92400e" }}>🏍️ Encostada: <strong>R$ {dia.valor_encostada}</strong></span>}
                            {dia.valor_por_entrega && <span style={{ fontSize:11, color:"#92400e" }}>📦 /entrega: <strong>R$ {dia.valor_por_entrega}</strong></span>}
                            {dia.ganho_estimado_dia && <span style={{ fontSize:11, color:"#92400e" }}>💰 Estimativa: <strong>R$ {dia.ganho_estimado_dia}</strong></span>}
                          </div>
                        )}
                        {/* Botão pagar via MP — só depois que o diarista confirmou (status "aceita") */}
                        {dia.diarista_aceite_id && dia.pagamento_status !== "pago" && dia.status === "aceita" && (
                          <button
                            style={{ width:"100%", padding:"13px", background:"linear-gradient(135deg,#009ee3,#007eb5)", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:10, boxShadow:"0 4px 16px rgba(0,158,227,.4)", opacity: criandoPagamento ? 0.7 : 1 }}
                            disabled={criandoPagamento}
                            onClick={e => { e.stopPropagation(); setModalPagamentoMP(dia); setAuthError(""); }}>
                            <svg width="20" height="20" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="#fff"/><text x="50%" y="60%" dominantBaseline="middle" textAnchor="middle" fontSize="28" fontWeight="900" fill="#009ee3">$</text></svg>
                            {criandoPagamento ? "Aguarde..." : "Pagar via Mercado Pago"}
                          </button>
                        )}

                        {/* Diarista confirmou presença (aceita = confirmou, aguardando QR scan) */}
                        {dia.status === "aceita" && dia.diarista_aceite_id && (() => {
                          const dp = diaristasAceites[dia.diarista_aceite_id];
                          const iniciais = dp?.nome?.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase() || "?";
                          const qtdDiarias = diaristasContagemDiarias[dia.diarista_aceite_id] ?? null;
                          const distAceito = (profile?.lat && profile?.lng && dp?.lat && dp?.lng)
                            ? haversineKm(profile.lat!, profile.lng!, dp.lat!, dp.lng!)
                            : null;
                          const distAceitoTxt = distAceito !== null
                            ? `${formatarDistancia(distAceito)} · ~${formatarTempo(tempoEstimadoMin(distAceito))} de moto`
                            : null;
                          return (
                            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                              {/* Card do profissional — clicável para ver perfil */}
                              <div
                                style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, border:"1.5px solid var(--border,#e2e8f0)", cursor:"pointer" }}
                                onClick={async () => {
                                  let perfil = dp;
                                  if (!perfil) {
                                    const { data: p } = await supabase.from("user_profiles").select("*").eq("id", dia.diarista_aceite_id!).single();
                                    if (p) { setDiaristasAceites(prev => ({ ...prev, [dia.diarista_aceite_id!]: p })); perfil = p; }
                                  }
                                  if (perfil) abrirPerfilCandidato(perfil);
                                }}>
                                <div style={{ position:"relative", width:52, height:52, flexShrink:0 }}>
                                  <div style={{ width:52, height:52, borderRadius:26, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:17 }}>{iniciais}</div>
                                  <img src={dp?.foto_url || supabase.storage.from("avatars").getPublicUrl(`${dia.diarista_aceite_id}.jpg`).data.publicUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display="none"; }} style={{ position:"absolute", inset:0, width:52, height:52, borderRadius:26, objectFit:"cover" as const, border:"2px solid #FF6B3540" }} />
                                </div>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)" }}>{dp?.nome || "Carregando..."}</div>
                                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2, display:"flex", alignItems:"center", gap:6 }}>
                                    {dp?.funcao && <span style={{ color:"#FF6B35", fontWeight:700 }}>{dp.funcao}</span>}
                                    {qtdDiarias !== null && <span>· ✅ {qtdDiarias} diária{qtdDiarias !== 1 ? "s" : ""}</span>}
                                  </div>
                                  {distAceitoTxt
                                    ? <div style={{ fontSize:11, color:"var(--text-2,#64748b)", marginTop:2 }}>📍 {distAceitoTxt}</div>
                                    : <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:2 }}>👆 Toque para ver perfil</div>
                                  }
                                </div>
                                <button
                                  style={{ background:negocio.cor, color:"#fff", border:"none", borderRadius:12, padding:"9px 14px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", flexShrink:0 }}
                                  onClick={e => { e.stopPropagation(); setChatDiariaAtiva(dia); setTabEmpregador("chat"); setMsgNaoLidas(0); }}>
                                  💬 Chat
                                </button>
                              </div>
                              <div style={{ background:"#ede9fe", borderRadius:10, padding:"10px 12px", fontSize:12, color:"#7c3aed", fontWeight:700 }}>
                                🟣 Diarista confirmou presença! <strong>Escaneie o QR Code</strong> dele acima quando ele chegar.
                              </div>
                              <button
                                style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:"4px 0", textAlign:"center" as const, width:"100%", textDecoration:"underline" }}
                                onClick={e => { e.stopPropagation(); setModalCancelar(dia); setMotivoCancelamento(""); }}>
                                Cancelar diária
                              </button>
                            </div>
                          );
                        })()}
                        {/* Diarista selecionado mas ainda não confirmou (status pendente + diarista_aceite_id) */}
                        {dia.status === "pendente" && dia.diarista_aceite_id && (() => {
                          const dp = diaristasAceites[dia.diarista_aceite_id];
                          const iniciais = dp?.nome?.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase() || "?";
                          const qtdDiarias = diaristasContagemDiarias[dia.diarista_aceite_id] ?? null;
                          return (
                            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                              <div style={{ background:"#fffbeb", border:"1.5px solid #fde68a", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#92400e", fontWeight:600 }}>
                                ⏳ Aguardando confirmação do profissional…
                              </div>
                              <div
                                style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, border:"1.5px solid var(--border,#e2e8f0)", cursor:"pointer" }}
                                onClick={async () => {
                                  let perfil = dp;
                                  if (!perfil) {
                                    const { data: p } = await supabase.from("user_profiles").select("*").eq("id", dia.diarista_aceite_id!).single();
                                    if (p) { setDiaristasAceites(prev => ({ ...prev, [dia.diarista_aceite_id!]: p })); perfil = p; }
                                  }
                                  if (perfil) abrirPerfilCandidato(perfil);
                                }}>
                                <div style={{ position:"relative", width:52, height:52, flexShrink:0 }}>
                                  <div style={{ width:52, height:52, borderRadius:26, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:17 }}>{iniciais}</div>
                                  <img src={dp?.foto_url || supabase.storage.from("avatars").getPublicUrl(`${dia.diarista_aceite_id}.jpg`).data.publicUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display="none"; }} style={{ position:"absolute", inset:0, width:52, height:52, borderRadius:26, objectFit:"cover" as const, border:"2px solid #FF6B3540" }} />
                                </div>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)" }}>{dp?.nome || "Carregando..."}</div>
                                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2, display:"flex", alignItems:"center", gap:6 }}>
                                    {dp?.funcao && <span style={{ color:"#FF6B35", fontWeight:700 }}>{dp.funcao}</span>}
                                    {qtdDiarias !== null && <span>· ✅ {qtdDiarias} diária{qtdDiarias !== 1 ? "s" : ""}</span>}
                                  </div>
                                  <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:2 }}>👆 Toque para ver perfil</div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Candidatos para diária aberta */}
                        {dia.status === "aberta" && (() => {
                          const cands = candidaturas.filter(c => c.diaria_id === dia.id && c.status === "pendente");
                          return (
                            <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
                              {cands.length > 0 ? (
                                <button
                                  style={{ width:"100%", padding:"11px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 12px rgba(93,95,239,.35)" }}
                                  onClick={e => { e.stopPropagation(); setModalCandidatos(dia); }}>
                                  👥 Ver {cands.length} candidato{cands.length > 1 ? "s" : ""} interessado{cands.length > 1 ? "s" : ""}
                                </button>
                              ) : (
                                <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:10, padding:"8px 12px", fontSize:12, color:"var(--text-3,#94a3b8)", textAlign:"center" }}>
                                  Aguardando candidatos…
                                </div>
                              )}
                              <button
                                style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:"4px 0", textAlign:"center" as const, width:"100%", textDecoration:"underline" }}
                                onClick={e => { e.stopPropagation(); setModalCancelar(dia); setMotivoCancelamento(""); }}>
                                Cancelar publicação
                              </button>
                            </div>
                          );
                        })()}
                        {/* Motivo do cancelamento */}
                        {dia.status === "cancelada" && dia.motivo_cancelamento && (
                          <div style={{ background:"#fee2e2", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#dc2626", marginTop:4 }}>
                            <strong>Motivo:</strong> {dia.motivo_cancelamento}
                          </div>
                        )}
                        {/* Botão concluir */}
                        {dia.status === "em_andamento" && (
                          <button
                            style={{ width:"100%", padding:"11px", background:"#22c55e", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 12px rgba(34,197,94,.4)" }}
                            onClick={e => { e.stopPropagation(); concluirDiaria(dia.id); }}>
                            ✅ Marcar como concluída
                          </button>
                        )}
                        {dia.status === "concluida" && (
                          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                            <div style={{ background:"#dcfce7", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#16a34a", fontWeight:700 }}>
                              ✅ Diária concluída! Lembre-se de efetuar o pagamento ao profissional.
                            </div>
                            {avaliadosDiarias.has(dia.id) ? (
                              <div style={{ textAlign:"center", fontSize:12, color:"#d97706", fontWeight:700 }}>⭐ Avaliação enviada!</div>
                            ) : dia.diarista_aceite_id ? (
                              <button
                                style={{ width:"100%", padding:"10px", background:"#fef3c7", color:"#d97706", border:"1.5px solid #fde68a", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                                onClick={() => { setModalAvalDiaristaReal(dia); setNotaDiaristaReal(0); setComentarioDiaristaReal(""); }}>
                                ⭐ Avaliar o diarista
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* ── Diárias canceladas (empregador) ── */}
              {diarias.filter(d => d.status === "cancelada").length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, margin:"20px 0 10px" }}>✗ Canceladas</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                    {diarias.filter(d => d.status === "cancelada").map(dia => (
                      <div key={dia.id} style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:"14px 16px", boxShadow:"0 2px 10px rgba(0,0,0,.07)", borderLeft:"4px solid #ef4444", opacity:0.85 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                          <span style={{ background:"#fee2e2", color:"#dc2626", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800 }}>✗ Cancelada</span>
                          {confirmExcluirDiariaCancelada === dia.id ? (
                            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                              <span style={{ fontSize:12, color:"#dc2626", fontWeight:700 }}>Excluir permanentemente?</span>
                              <button style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => excluirDiariaJaCancelada(dia.id)}>Sim</button>
                              <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setConfirmExcluirDiariaCancelada(null)}>Não</button>
                            </div>
                          ) : (
                            <button
                              style={{ background:"#fee2e2", color:"#ef4444", border:"none", borderRadius:8, padding:"4px 9px", fontSize:14, cursor:"pointer", lineHeight:1 }}
                              title="Excluir permanentemente"
                              onClick={() => setConfirmExcluirDiariaCancelada(dia.id)}>
                              🗑️
                            </button>
                          )}
                        </div>
                        <div style={{ fontWeight:700, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:4 }}>{dia.descricao}</div>
                        <div style={{ fontSize:12, color:"var(--text-3,#94a3b8)" }}>
                          {dia.funcao && <span>👷 {dia.funcao} · </span>}
                          <span>📅 {new Date(dia.data+"T12:00:00").toLocaleDateString("pt-BR")}</span>
                        </div>
                        {dia.motivo_cancelamento && (
                          <div style={{ background:"#fee2e2", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#dc2626", marginTop:8 }}>
                            <strong>Motivo:</strong> {dia.motivo_cancelamento}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <button
                style={{ ...S.btnPrimary, background:negocio.cor, marginTop:16 }}
                onClick={() => { setFormDiaria({ local:"", descricao:"", funcao:"", data:"", horario_inicio:"", horario_fim:"", valor:"", cep:"", rua:"", numero:"", complemento:"", bairro:"", cidade:"", estado:"", valor_encostada:"", valor_por_entrega:"", ganho_estimado_dia:"" }); setLatDiaria(null); setLngDiaria(null); setAuthError(""); setTela("criar-diaria"); }}>
                + Nova diária
              </button>
            </div>
          );
        })()}

        {/* ── Modal Avaliar Diarista Real ── */}
        {modalAvalDiaristaReal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }}>
              <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)", marginBottom:4 }}>⭐ Avaliar diarista</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:20 }}>
                Como foi a experiência com o profissional em <strong>{modalAvalDiaristaReal.nome_negocio || "sua diária"}</strong>?
              </div>
              <div style={{ display:"flex", justifyContent:"center", gap:12, marginBottom:20 }}>
                {[1,2,3,4,5].map(n => (
                  <span key={n} style={{ fontSize:38, cursor:"pointer", filter: n<=notaDiaristaReal ? "none" : "grayscale(1) opacity(.35)", transition:"filter .15s" }}
                    onClick={() => setNotaDiaristaReal(n)}>⭐</span>
                ))}
              </div>
              {notaDiaristaReal > 0 && (
                <div style={{ textAlign:"center", fontSize:14, fontWeight:700, color:"#d97706", marginBottom:16 }}>
                  {["","Ruim 😕","Regular 😐","Bom 🙂","Ótimo 😊","Excelente! 🤩"][notaDiaristaReal]}
                </div>
              )}
              <textarea
                style={{ width:"100%", padding:"12px 14px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", resize:"none", boxSizing:"border-box" as const, outline:"none", marginBottom:16, height:90 }}
                placeholder="Deixe um comentário (opcional)..."
                value={comentarioDiaristaReal}
                onChange={e => setComentarioDiaristaReal(e.target.value)}
              />
              <button
                style={{ width:"100%", padding:"14px", background: notaDiaristaReal===0 ? "#e2e8f0" : negocio?.cor || "#FF6B35", color: notaDiaristaReal===0 ? "#94a3b8" : "#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: notaDiaristaReal===0 ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, opacity: enviandoAvalMutua ? 0.6 : 1 }}
                disabled={notaDiaristaReal===0 || enviandoAvalMutua}
                onClick={enviarAvaliacaoDiaristaReal}>
                {enviandoAvalMutua ? "Enviando..." : "Enviar avaliação"}
              </button>
              <button style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => setModalAvalDiaristaReal(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal Cancelar Diária (empregador) ── */}
        {modalCancelar && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }}>
              <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)", marginBottom:4 }}>✕ Cancelar diária</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:20, lineHeight:1.6 }}>
                Informe o motivo do cancelamento. O diarista será notificado.
              </div>
              <textarea
                style={{ width:"100%", padding:"12px 14px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", resize:"none" as const, boxSizing:"border-box" as const, outline:"none", marginBottom:16, height:120 }}
                placeholder="Ex: Não precisarei mais do serviço nesta data..."
                value={motivoCancelamento}
                onChange={e => setMotivoCancelamento(e.target.value)}
              />
              <button
                style={{ width:"100%", padding:"14px", background: motivoCancelamento.trim() ? "#ef4444" : "#e2e8f0", color: motivoCancelamento.trim() ? "#fff" : "#94a3b8", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: motivoCancelamento.trim() ? "pointer" : "default", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, opacity: cancelando ? 0.6 : 1 }}
                disabled={!motivoCancelamento.trim() || cancelando}
                onClick={cancelarDiaria}>
                {cancelando ? "Cancelando..." : "Confirmar cancelamento"}
              </button>
              <button
                style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => { setModalCancelar(null); setMotivoCancelamento(""); }}>
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal Candidatos (empregador escolhe 1 de até 5) ── */}
        {modalCandidatos && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:310, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-app,#f0f2f5)", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:480, maxHeight:"82vh", overflow:"auto" }}>
              {/* Header fixo */}
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"22px 20px 16px", position:"sticky", top:0, zIndex:1 }}>
                <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)" }}>👥 Candidatos interessados</div>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginTop:3 }}>
                  Toque em um perfil para ver detalhes · vaga: <strong>{modalCandidatos.funcao || modalCandidatos.segmento}</strong>
                </div>
              </div>
              <div style={{ padding:"12px 16px 32px", display:"flex", flexDirection:"column", gap:12 }}>
                {candidaturas
                  .filter(c => c.diaria_id === modalCandidatos.id && c.status === "pendente")
                  .slice(0, 5)
                  .map(c => {
                    const dp = candidatosProfiles[c.diarista_id];
                    // diarista_info: dados embutidos na candidatura (independe de RLS)
                    const info = (c as any).diarista_info as { nome?:string; funcao?:string; foto_url?:string; lat?:number; lng?:number } | undefined;
                    const nome = dp?.nome || info?.nome || "Profissional";
                    const funcao = dp?.funcao || info?.funcao || "";
                    const latD = dp?.lat ?? info?.lat ?? null;
                    const lngD = dp?.lng ?? info?.lng ?? null;
                    const primeiroNome = nome.split(" ")[0];
                    const iniciais = nome !== "Profissional"
                      ? nome.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase()
                      : "?";
                    const distCand = (profile?.lat && profile?.lng && latD && lngD)
                      ? haversineKm(profile.lat!, profile.lng!, latD, lngD)
                      : null;
                    const distCandTxt = distCand !== null
                      ? `${formatarDistancia(distCand)} · ~${formatarTempo(tempoEstimadoMin(distCand))} de moto`
                      : null;
                    // Foto: prioridade → perfil carregado → info embutida → Storage pela URL do ID
                    const fotoStorageUrl = supabase.storage.from("avatars").getPublicUrl(`${c.diarista_id}.jpg`).data.publicUrl;
                    const fotoSrc = dp?.foto_url || info?.foto_url || fotoStorageUrl;
                    return (
                      <div key={c.id}
                        style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:"14px 16px", boxShadow:"0 2px 10px rgba(0,0,0,.07)", display:"flex", alignItems:"center", gap:14, cursor:"pointer", border:"1.5px solid transparent", transition:"border .15s" }}
                        onClick={async () => {
                          let perfil = candidatosProfiles[c.diarista_id];
                          if (!perfil) {
                            const { data: p } = await supabase.from("user_profiles").select("*").eq("id", c.diarista_id).single();
                            if (p) { setCandidatosProfiles(prev => ({ ...prev, [c.diarista_id]: p })); perfil = p; }
                          }
                          if (perfil) abrirPerfilCandidato(perfil);
                        }}>
                        {/* Foto: iniciais como fundo, img sobreposta — some via onError se não carregar */}
                        <div style={{ position:"relative", width:56, height:56, flexShrink:0 }}>
                          <div style={{ width:56, height:56, borderRadius:28, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:18 }}>{iniciais}</div>
                          <img
                            src={fotoSrc}
                            alt=""
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                            style={{ position:"absolute", inset:0, width:56, height:56, borderRadius:28, objectFit:"cover" as const, border:"2.5px solid #e2e8f0" }}
                          />
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{primeiroNome}</div>
                          {funcao && <div style={{ fontSize:12, color:"#FF6B35", fontWeight:700, marginTop:2 }}>{funcao}</div>}
                          {distCandTxt
                            ? <div style={{ fontSize:11, color:"var(--text-2,#64748b)", marginTop:2 }}>📍 {distCandTxt}</div>
                            : <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:2 }}>Toque para ver perfil completo →</div>
                          }
                        </div>
                        <button
                          style={{ background:"#22c55e", color:"#fff", border:"none", borderRadius:12, padding:"10px 16px", fontSize:13, fontWeight:800, cursor: selecionando ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", flexShrink:0, opacity:selecionando?0.6:1 }}
                          disabled={selecionando}
                          onClick={e => { e.stopPropagation(); selecionarCandidato(modalCandidatos, c.diarista_id); }}>
                          {selecionando ? "…" : "Selecionar"}
                        </button>
                      </div>
                    );
                  })}
                {candidaturas.filter(c => c.diaria_id === modalCandidatos.id && c.status === "pendente").length === 0 && (
                  <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:14, padding:"24px 0" }}>
                    Nenhum candidato disponível no momento.
                  </div>
                )}
                <button
                  style={{ width:"100%", padding:"13px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:4 }}
                  onClick={() => setModalCandidatos(null)}>
                  Fechar
                </button>
              </div>
            </div>

            {/* ── Perfil completo do candidato (abre sobre o modal de candidatos) ── */}
            {perfilCandidato && (() => {
              const dp = perfilCandidato;
              const iniciais = dp.nome?.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase() || "?";
              const mediaAvs = avaliacoesCandidato.length > 0
                ? (avaliacoesCandidato.reduce((s,a)=>s+a.nota,0)/avaliacoesCandidato.length)
                : null;
              // Idade
              const idade = dp.data_nascimento ? (() => {
                const nasc = new Date(dp.data_nascimento);
                const hoje = new Date();
                let i = hoje.getFullYear() - nasc.getFullYear();
                if (hoje.getMonth() < nasc.getMonth() || (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate())) i--;
                return i;
              })() : null;
              // Candidatura para esta vaga
              const candDesta = modalCandidatos && candidaturas.find(c => c.diaria_id === modalCandidatos.id && c.diarista_id === dp.id && c.status === "pendente");

              return (
                <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.6)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:10 }}
                  onClick={() => setPerfilCandidato(null)}>
                  <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:480, maxHeight:"90vh", overflow:"auto" }}
                    onClick={e => e.stopPropagation()}>

                    {/* Header do perfil */}
                    <div style={{ background:"linear-gradient(135deg,#0f172a 0%,#1e293b 100%)", borderRadius:"24px 24px 0 0", padding:"24px 20px 20px", position:"relative" }}>
                      <button style={{ background:"none", border:"none", color:"rgba(255,255,255,.6)", fontSize:22, cursor:"pointer", position:"absolute", top:16, right:20, lineHeight:1 }}
                        onClick={() => setPerfilCandidato(null)}>✕</button>
                      <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                        <div style={{ position:"relative", width:80, height:80, flexShrink:0 }}>
                          <div style={{ width:80, height:80, borderRadius:40, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:26 }}>{iniciais}</div>
                          <img
                            src={dp.foto_url || supabase.storage.from("avatars").getPublicUrl(`${dp.id}.jpg`).data.publicUrl}
                            alt=""
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                            style={{ position:"absolute", inset:0, width:80, height:80, borderRadius:40, objectFit:"cover" as const, border:"3px solid #FF6B35" }}
                          />
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:900, fontSize:20, color:"#fff", lineHeight:1.2 }}>{dp.nome}</div>
                          {dp.funcao && <div style={{ fontSize:13, color:"#FF6B35", fontWeight:700, marginTop:3 }}>{dp.funcao}</div>}
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6, flexWrap:"wrap" as const }}>
                            {idade && (
                              <span style={{ background:"rgba(255,255,255,.12)", color:"rgba(255,255,255,.8)", fontSize:12, fontWeight:600, padding:"2px 9px", borderRadius:20 }}>{idade} anos</span>
                            )}
                            {dp.sexo && dp.sexo !== "N" && (
                              <span style={{ background:"rgba(255,255,255,.12)", color:"rgba(255,255,255,.8)", fontSize:12, fontWeight:600, padding:"2px 9px", borderRadius:20 }}>
                                {dp.sexo === "M" ? "Masculino" : "Feminino"}
                              </span>
                            )}
                            <span style={{ background: dp.disponivel ? "rgba(34,197,94,.25)" : "rgba(148,163,184,.2)", color: dp.disponivel ? "#4ade80" : "rgba(255,255,255,.4)", fontSize:12, fontWeight:700, padding:"2px 9px", borderRadius:20 }}>
                              {dp.disponivel ? "● Disponível" : "● Indisponível"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ padding:"16px 20px 32px", display:"flex", flexDirection:"column", gap:14 }}>

                      {/* Stats rápidos */}
                      {(() => {
                        // Calcula tempo no app
                        const tempoNoApp = dp.created_at ? (() => {
                          const meses = Math.floor((Date.now() - new Date(dp.created_at).getTime()) / (1000*60*60*24*30));
                          if (meses < 1) return "< 1 mês";
                          if (meses === 1) return "1 mês";
                          if (meses < 12) return `${meses} meses`;
                          const anos = Math.floor(meses / 12);
                          return anos === 1 ? "1 ano" : `${anos} anos`;
                        })() : "—";
                        return (
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                            {[
                              { icone:"🏅", val: diariasCandidato, label:"Diárias feitas" },
                              { icone:"⭐", val: mediaAvs ? mediaAvs.toFixed(1) : "—", label:"Avaliação média" },
                              { icone:"💬", val: avaliacoesCandidato.length, label:"Avaliações" },
                              { icone:"📅", val: tempoNoApp, label:"No DiáriaJá" },
                            ].map(s => (
                              <div key={s.label} style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"12px 8px", textAlign:"center" as const }}>
                                <div style={{ fontSize:20, marginBottom:4 }}>{s.icone}</div>
                                <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)", lineHeight:1 }}>{loadingPerfil ? "…" : s.val}</div>
                                <div style={{ fontSize:10, color:"var(--text-3,#94a3b8)", marginTop:3, fontWeight:600 }}>{s.label}</div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Bio */}
                      {dp.bio && (
                        <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"14px 16px" }}>
                          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:8 }}>📝 Apresentação</div>
                          <p style={{ fontSize:14, color:"var(--text-label,#475569)", lineHeight:1.6, margin:0 }}>{dp.bio}</p>
                        </div>
                      )}

                      {/* Especialidades */}
                      {(dp.categorias || []).length > 0 && (
                        <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"14px 16px" }}>
                          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>💼 Especialidades</div>
                          <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8 }}>
                            {(dp.categorias||[]).map(f => {
                              const ce = Object.entries(CATEGORIAS_NEGOCIO).find(([,info])=>(info.funcoes as readonly string[]).includes(f));
                              const c = ce ? ce[1].cor : "#FF6B35";
                              return <span key={f} style={{ background:c+"20", color:c, padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700 }}>{f}</span>;
                            })}
                          </div>
                        </div>
                      )}

                      {/* Disponibilidade semanal */}
                      {(dp.agenda||[]).length > 0 && (
                        <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"14px 16px" }}>
                          <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>📅 Disponibilidade semanal</div>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" as const }}>
                            {DIAS.map(dia => (
                              <div key={dia} style={{ padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:700, background: dp.agenda?.includes(dia) ? "#FF6B35" : "#e2e8f0", color: dp.agenda?.includes(dia) ? "#fff" : "#94a3b8" }}>
                                {DIAS_LABEL[dia]}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Valor */}
                      {dp.valor_diaria > 0 && (
                        <div style={{ background:"#f0fdf4", borderRadius:14, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div style={{ fontSize:11, fontWeight:800, color:"#16a34a", textTransform:"uppercase" as const, letterSpacing:0.5 }}>💰 Valor por diária</div>
                            <div style={{ fontSize:11, color:"var(--text-2,#64748b)", marginTop:2 }}>Habitualmente cobrado</div>
                          </div>
                          <div style={{ fontWeight:900, fontSize:22, color:"#16a34a" }}>R$ {dp.valor_diaria}/dia</div>
                        </div>
                      )}

                      {/* Avaliações */}
                      {!loadingPerfil && avaliacoesCandidato.length > 0 && (
                        <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"14px 16px" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                            <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5 }}>⭐ Avaliações de empregadores</div>
                            {mediaAvs && (
                              <span style={{ fontWeight:900, fontSize:15, color:"#d97706" }}>
                                {mediaAvs.toFixed(1)} ⭐
                              </span>
                            )}
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                            {avaliacoesCandidato.slice(0, 5).map(av => (
                              <div key={av.id} style={{ paddingBottom:10, borderBottom:"1px solid var(--border,#e2e8f0)" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                                  <span style={{ fontSize:12 }}>{"⭐".repeat(av.nota)}{"☆".repeat(5-av.nota)}</span>
                                  <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>{new Date(av.created_at).toLocaleDateString("pt-BR")}</span>
                                </div>
                                {av.comentario && <p style={{ fontSize:13, color:"var(--text-label,#475569)", margin:0, lineHeight:1.5 }}>{av.comentario}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {!loadingPerfil && avaliacoesCandidato.length === 0 && (
                        <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:13, padding:"8px 0" }}>
                          Nenhuma avaliação ainda.
                        </div>
                      )}

                      {/* Botão selecionar */}
                      {candDesta && (
                        <button
                          style={{ width:"100%", padding:"15px", background:"#22c55e", color:"#fff", border:"none", borderRadius:16, fontSize:15, fontWeight:800, cursor: selecionando ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 14px rgba(34,197,94,.4)", opacity:selecionando?0.6:1 }}
                          disabled={selecionando}
                          onClick={() => { selecionarCandidato(modalCandidatos!, dp.id); setPerfilCandidato(null); }}>
                          {selecionando ? "Selecionando…" : `✅ Selecionar ${dp.nome.split(" ")[0]}`}
                        </button>
                      )}
                      <button
                        style={{ width:"100%", padding:"13px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={() => setPerfilCandidato(null)}>
                        ← Voltar à lista
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Modal Excluir Diária (empregador) ── */}
        {modalExcluir && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:310, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }}>
              <div style={{ fontSize:48, textAlign:"center", marginBottom:10, lineHeight:1 }}>🗑️</div>
              <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)", marginBottom:6, textAlign:"center" }}>Excluir diária?</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:16, lineHeight:1.6, textAlign:"center" }}>
                A diária de <strong>{modalExcluir.funcao || modalExcluir.descricao}</strong> será removida permanentemente.
              </div>
              {/* Aviso: notifica todos os candidatos, não só o aceito */}
              <div style={{ background:"#fef3c7", border:"1.5px solid #fde68a", borderRadius:12, padding:"12px 14px", fontSize:13, color:"#92400e", fontWeight:600, marginBottom:14, lineHeight:1.5 }}>
                ⚠️ Todos os diaristas com interesse ou que aceitaram serão <strong>notificados</strong> com o motivo informado abaixo.
              </div>
              {/* Campo de motivo obrigatório */}
              <label style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)", display:"block", marginBottom:6 }}>
                Motivo da exclusão *
              </label>
              <textarea
                style={{ width:"100%", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, padding:"10px 12px", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", resize:"none", height:72, outline:"none", color:"var(--text-1,#0f172a)", lineHeight:1.5, boxSizing:"border-box", marginBottom:16 }}
                placeholder="Ex: Contratei por outro canal, adiamos o evento..."
                value={motivoExclusao}
                onChange={e => setMotivoExclusao(e.target.value)}
              />
              {authError && <p style={{ color:"#dc2626", fontSize:12, marginBottom:8, textAlign:"center" }}>{authError}</p>}
              <button
                style={{ width:"100%", padding:"14px", background: (excluindo || !motivoExclusao.trim()) ? "#e2e8f0" : "#ef4444", color: (excluindo || !motivoExclusao.trim()) ? "#94a3b8" : "#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: (excluindo || !motivoExclusao.trim()) ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, opacity: (excluindo || !motivoExclusao.trim()) ? 0.6 : 1 }}
                disabled={excluindo || !motivoExclusao.trim()}
                onClick={excluirDiaria}>
                {excluindo ? "Excluindo..." : "Sim, excluir e notificar"}
              </button>
              <button
                style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => { setModalExcluir(null); setMotivoExclusao(""); setAuthError(""); }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal: Editar Diária (empregador) ── */}
        {modalEditarDiaria && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:310, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }}>
              <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", marginBottom:4 }}>✏️ Editar diária</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:16 }}>{modalEditarDiaria.funcao} · {new Date(modalEditarDiaria.data+"T12:00:00").toLocaleDateString("pt-BR")}</div>
              <label style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)", display:"block", marginBottom:6 }}>Descrição</label>
              <textarea
                style={{ width:"100%", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, padding:"10px 12px", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", resize:"none", height:72, outline:"none", color:"var(--text-1,#0f172a)", lineHeight:1.5, boxSizing:"border-box", marginBottom:14 }}
                value={formEditarDiaria.descricao}
                onChange={e => setFormEditarDiaria(p => ({...p, descricao:e.target.value}))}
              />
              <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)", display:"block", marginBottom:4 }}>Início</label>
                  <input type="time" style={{ width:"100%", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:10, padding:"10px 12px", fontSize:13, outline:"none", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" }}
                    value={formEditarDiaria.horario_inicio}
                    onChange={e => setFormEditarDiaria(p => ({...p, horario_inicio:e.target.value}))} />
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)", display:"block", marginBottom:4 }}>Fim</label>
                  <input type="time" style={{ width:"100%", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:10, padding:"10px 12px", fontSize:13, outline:"none", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" }}
                    value={formEditarDiaria.horario_fim}
                    onChange={e => setFormEditarDiaria(p => ({...p, horario_fim:e.target.value}))} />
                </div>
              </div>
              <label style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)", display:"block", marginBottom:4 }}>Valor (R$)</label>
              <input type="number" style={{ width:"100%", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:10, padding:"10px 12px", fontSize:13, outline:"none", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box", marginBottom:16 }}
                value={formEditarDiaria.valor}
                onChange={e => setFormEditarDiaria(p => ({...p, valor:e.target.value}))} />
              {authError && <p style={{ color:"#dc2626", fontSize:12, marginBottom:8 }}>{authError}</p>}
              <button
                style={{ width:"100%", padding:"14px", background: salvandoEdicao ? "#e2e8f0" : negocio?.cor || "#FF6B35", color: salvandoEdicao ? "#94a3b8" : "#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: salvandoEdicao ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
                disabled={salvandoEdicao}
                onClick={salvarEdicaoDiaria}>
                {salvandoEdicao ? "Salvando..." : "✅ Salvar alterações"}
              </button>
              <button
                style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => { setModalEditarDiaria(null); setAuthError(""); }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal: Recibo Digital ── */}
        {modalRecibo && (() => {
          const dp = modalRecibo.diarista_aceite_id ? diaristasAceites[modalRecibo.diarista_aceite_id] : null;
          const [h1, m1] = modalRecibo.horario_inicio.split(":").map(Number);
          const [h2, m2] = modalRecibo.horario_fim.split(":").map(Number);
          const minutos = (h2 * 60 + m2) - (h1 * 60 + m1);
          const horas = minutos > 0 ? `${Math.floor(minutos/60)}h${minutos%60>0?String(minutos%60).padStart(2,"0")+"min":""}` : "";
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"28px 24px 32px", width:"100%", maxWidth:380, boxShadow:"0 20px 60px rgba(0,0,0,.4)" }}>
                <div style={{ textAlign:"center", marginBottom:16 }}>
                  <div style={{ fontSize:48, lineHeight:1, marginBottom:8 }}>🧾</div>
                  <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)" }}>Recibo de Serviço</div>
                  <div style={{ fontSize:12, color:"var(--text-3,#94a3b8)", marginTop:4 }}>DiáriaJá · {new Date().toLocaleDateString("pt-BR")}</div>
                </div>
                <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:16, padding:"16px 18px", marginBottom:16 }}>
                  {[
                    ["Serviço", modalRecibo.funcao || modalRecibo.descricao],
                    ["Data", new Date(modalRecibo.data+"T12:00:00").toLocaleDateString("pt-BR")],
                    ["Horário", `${modalRecibo.horario_inicio.slice(0,5)} – ${modalRecibo.horario_fim.slice(0,5)}${horas ? ` (${horas})` : ""}`],
                    ["Local", modalRecibo.nome_negocio || modalRecibo.segmento],
                    ["Profissional", dp?.nome || "—"],
                    ["Empregador", profile?.nome_negocio || profile?.nome || "—"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"8px 0", borderBottom:"1px solid var(--border,#e2e8f0)" }}>
                      <span style={{ fontSize:13, color:"var(--text-2,#64748b)", fontWeight:600 }}>{k}</span>
                      <span style={{ fontSize:13, color:"var(--text-1,#0f172a)", fontWeight:700, textAlign:"right", maxWidth:"60%" }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:12, marginTop:4 }}>
                    <span style={{ fontSize:14, fontWeight:800, color:"var(--text-1,#0f172a)" }}>Total</span>
                    <span style={{ fontSize:20, fontWeight:900, color:"#22c55e" }}>R$ {modalRecibo.valor}</span>
                  </div>
                </div>
                <div style={{ background:"#fef3c7", borderRadius:12, padding:"10px 14px", fontSize:12, color:"#92400e", fontWeight:600, marginBottom:16, lineHeight:1.5 }}>
                  ⚠️ Este recibo não substitui documentos fiscais. Guarde como comprovante informal de prestação de serviço.
                </div>
                <button
                  style={{ width:"100%", padding:"13px", background:"#0f172a", color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
                  onClick={() => {
                    const texto = `🧾 RECIBO DE SERVIÇO - DiáriaJá\n\nServiço: ${modalRecibo.funcao||modalRecibo.descricao}\nData: ${new Date(modalRecibo.data+"T12:00:00").toLocaleDateString("pt-BR")}\nHorário: ${modalRecibo.horario_inicio.slice(0,5)} – ${modalRecibo.horario_fim.slice(0,5)}\nLocal: ${modalRecibo.nome_negocio||modalRecibo.segmento}\nProfissional: ${dp?.nome||"—"}\nValor: R$ ${modalRecibo.valor}\n\nGerado em: ${new Date().toLocaleString("pt-BR")}`;
                    if (navigator.share) { navigator.share({ title:"Recibo DiáriaJá", text:texto }); }
                    else { navigator.clipboard?.writeText(texto); setToastSuccess("📋 Recibo copiado!"); }
                  }}>
                  📤 Compartilhar recibo
                </button>
                <button
                  style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => setModalRecibo(null)}>
                  Fechar
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Modal: Pagamento Mercado Pago ── */}
        {modalPagamentoMP && (() => {
          const valorTotal  = modalPagamentoMP.valor;
          const taxa        = Math.round(valorTotal * 0.015 * 100) / 100;
          const valorDiar   = valorTotal - taxa;
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
              onClick={() => setModalPagamentoMP(null)}>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 48px", width:"100%", maxWidth:480 }}
                onClick={e => e.stopPropagation()}>
                <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 22px" }} />

                {/* Header */}
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:22 }}>
                  <div style={{ width:48, height:48, borderRadius:14, background:"#e8f4fd", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>🏦</div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)" }}>Pagar com Mercado Pago</div>
                    <div style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>Pagamento seguro com split automático</div>
                  </div>
                </div>

                {/* Resumo */}
                <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:16, padding:"16px 18px", marginBottom:16 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.8, marginBottom:12 }}>Resumo do pagamento</div>
                  {[
                    { k:"Serviço",             v: modalPagamentoMP.funcao || modalPagamentoMP.segmento },
                    { k:"Data",                v: new Date(modalPagamentoMP.data+"T12:00:00").toLocaleDateString("pt-BR") },
                    { k:"Valor do diarista",   v: `R$ ${valorDiar.toFixed(2)}` },
                    { k:"Taxa DiáriaJá (1,5%)",v: `R$ ${taxa.toFixed(2)}` },
                  ].map(r => (
                    <div key={r.k} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid var(--border,#e2e8f0)" }}>
                      <span style={{ fontSize:13, color:"var(--text-2,#64748b)" }}>{r.k}</span>
                      <span style={{ fontSize:13, fontWeight:700, color:"var(--text-1,#0f172a)" }}>{r.v}</span>
                    </div>
                  ))}
                  <div style={{ display:"flex", justifyContent:"space-between", paddingTop:12, marginTop:4 }}>
                    <span style={{ fontSize:15, fontWeight:800, color:"var(--text-1,#0f172a)" }}>Total</span>
                    <span style={{ fontSize:22, fontWeight:900, color:"#009ee3" }}>R$ {valorTotal.toFixed(2)}</span>
                  </div>
                </div>

                {/* Como funciona */}
                <div style={{ background:"#f0f9ff", border:"1.5px solid #bae6fd", borderRadius:14, padding:"12px 14px", marginBottom:18 }}>
                  <div style={{ fontSize:12, color:"#0369a1", lineHeight:1.7 }}>
                    <strong>Como funciona:</strong>
                    <br />1. Você paga agora via MP (cartão, PIX ou saldo)
                    <br />2. O diarista recebe <strong>R$ {valorDiar.toFixed(2)}</strong> automaticamente após a conclusão
                    <br />3. O DiáriaJá retém <strong>R$ {taxa.toFixed(2)}</strong> como taxa de conexão
                  </div>
                </div>

                {authError && <p style={{ color:"#ef4444", fontSize:13, fontWeight:700, marginBottom:12, textAlign:"center" }}>{authError}</p>}

                <button
                  style={{ width:"100%", padding:"15px", background:"linear-gradient(135deg,#009ee3,#007eb5)", color:"#fff", border:"none", borderRadius:16, fontSize:16, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, boxShadow:"0 4px 16px rgba(0,158,227,.4)", opacity: criandoPagamento ? 0.7 : 1 }}
                  disabled={criandoPagamento}
                  onClick={() => iniciarPagamentoMP(modalPagamentoMP)}>
                  {criandoPagamento ? "Gerando link..." : "💳 Ir para o pagamento"}
                </button>
                <button
                  style={{ width:"100%", padding:"13px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => { setModalPagamentoMP(null); setAuthError(""); }}>
                  Cancelar
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Modal: PIX ── */}
        {modalPix && (() => {
          // Suporta tanto Diaria (diarista_aceite_id) quanto Convite (diarista_id)
          const pixDiaristaId = (modalPix as any).diarista_aceite_id || (modalPix as any).diarista_id;
          const dp = pixDiaristaId ? diaristasAceites[pixDiaristaId] : null;
          const chavePix = dp?.telefone?.replace(/\D/g,"") || dp?.cpf?.replace(/\D/g,"") || "—";
          const isDeliveryPix = FUNCOES_DELIVERY.includes(modalPix.funcao);
          const valorEncostada = modalPix.valor_encostada;
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
              onClick={() => setModalPix(null)}>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 48px", width:"100%", maxWidth:480, boxShadow:"0 -8px 40px rgba(0,0,0,.3)" }}
                onClick={e => e.stopPropagation()}>

                {/* Handle */}
                <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 22px" }} />

                <div style={{ textAlign:"center", marginBottom:20 }}>
                  <div style={{ fontSize:44, lineHeight:1, marginBottom:8 }}>🏦</div>
                  <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)" }}>Pagar via PIX</div>
                  <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginTop:4 }}>
                    Serviço: <strong>{modalPix.funcao || modalPix.segmento}</strong>
                  </div>
                  <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:6, background:"var(--bg-surface,#f8fafc)", borderRadius:8, padding:"4px 10px", display:"inline-block" }}>
                    Pagamento direto • sem intermediação
                  </div>
                </div>

                {/* Pagar ao diarista */}
                <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:16, padding:"16px 18px", marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.8, marginBottom:12 }}>
                    👷 Pagamento ao profissional
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <span style={{ fontSize:13, color:"var(--text-label,#475569)" }}>Valor combinado</span>
                    <span style={{ fontSize:22, fontWeight:900, color:"#22c55e" }}>R$ {modalPix.valor}</span>
                  </div>
                  {dp ? (
                    <>
                      <div style={{ fontSize:13, color:"var(--text-label,#475569)", marginBottom:4 }}>Profissional: <strong style={{ color:"var(--text-1,#0f172a)" }}>{dp.nome}</strong></div>
                      <div style={{ background:"var(--bg-card,#fff)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, padding:"12px 14px", marginTop:10 }}>
                        <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:700, marginBottom:4 }}>CHAVE PIX (telefone/CPF)</div>
                        <div style={{ fontSize:17, fontWeight:900, color:"var(--text-1,#0f172a)", letterSpacing:0.5 }}>{chavePix}</div>
                        <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:4 }}>{dp.nome?.split(" ")[0]}</div>
                      </div>
                      <button
                        style={{ width:"100%", padding:"11px", background:"#22c55e", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:10 }}
                        onClick={() => { navigator.clipboard?.writeText(chavePix); setToastSuccess("✅ Chave PIX copiada!"); }}>
                        📋 Copiar chave PIX
                      </button>
                    </>
                  ) : pixDiaristaId ? (
                    /* Perfil ainda carregando (fetch em andamento) */
                    <div style={{ textAlign:"center", padding:"16px 0", color:"var(--text-3,#94a3b8)", fontSize:13 }}>
                      ⏳ Carregando dados do profissional…
                    </div>
                  ) : (
                    /* Nenhum diarista associado ainda */
                    <div style={{ background:"#fef3c7", borderRadius:10, padding:"10px 12px", fontSize:12, color:"#92400e", marginTop:8 }}>
                      ⚠️ Nenhum profissional confirmado ainda. Aguarde o aceite para liberar os dados de pagamento.
                    </div>
                  )}
                </div>

                {/* Taxa de plataforma — só para delivery */}
                {isDeliveryPix && valorEncostada && (
                  <div style={{ background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:16, padding:"16px 18px", marginBottom:12 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#92400e", textTransform:"uppercase" as const, letterSpacing:0.8, marginBottom:10 }}>
                      🏍️ Taxa de plataforma — DiáriaJá
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <span style={{ fontSize:13, color:"#92400e" }}>Valor da encostada</span>
                      <span style={{ fontSize:20, fontWeight:900, color:"#FF6B35" }}>R$ {valorEncostada}</span>
                    </div>
                    <div style={{ background:"var(--bg-card,#fff)", border:"1.5px solid #fed7aa", borderRadius:12, padding:"12px 14px" }}>
                      <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:700, marginBottom:4 }}>CHAVE PIX — DiáriaJá</div>
                      <div style={{ fontSize:16, fontWeight:900, color:"#FF6B35" }}>suporte@diariaja.com.br</div>
                      <div style={{ fontSize:12, color:"#92400e", marginTop:4 }}>Pagar separado do profissional</div>
                    </div>
                    <button
                      style={{ width:"100%", padding:"11px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:10 }}
                      onClick={() => { navigator.clipboard?.writeText("suporte@diariaja.com.br"); setToastSuccess("✅ Chave PIX DiáriaJá copiada!"); }}>
                      📋 Copiar chave DiáriaJá
                    </button>
                  </div>
                )}

                <div style={{ background:"#fef3c7", borderRadius:12, padding:"9px 13px", fontSize:12, color:"#92400e", lineHeight:1.5, marginBottom:16 }}>
                  ℹ️ Realize o pagamento pelo app do seu banco usando a chave PIX acima. O DiáriaJá não processa pagamentos — somos uma plataforma de anúncios.
                </div>

                <button
                  style={{ width:"100%", padding:"13px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => setModalPix(null)}>
                  Fechar
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Modal: Limite de vagas atingido ── */}
        {modalLimiteVagas && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:28, padding:"32px 24px", maxWidth:360, width:"100%", textAlign:"center" }}>
              <div style={{ fontSize:52, marginBottom:12 }}>🚀</div>
              <div style={{ fontWeight:900, fontSize:20, color:"var(--text-1,#0f172a)", marginBottom:8 }}>Limite do plano Grátis</div>
              <div style={{ fontSize:14, color:"var(--text-2,#64748b)", lineHeight:1.7, marginBottom:24 }}>
                Você usou as <strong>3 vagas gratuitas</strong> deste mês.<br />
                Faça upgrade para publicar vagas ilimitadas.
              </div>
              <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
                <button
                  style={{ padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 16px rgba(255,107,53,.4)" }}
                  onClick={() => { setModalLimiteVagas(false); setTela("planos"); }}>
                  Ver planos →
                </button>
                <button
                  style={{ padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => setModalLimiteVagas(false)}>
                  Agora não
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Limite de contatos atingido (R$ 1/contato adicional) ── */}
        {modalLimiteContato && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:28, padding:"32px 24px", maxWidth:370, width:"100%", textAlign:"center" }}>
              <div style={{ fontSize:48, marginBottom:10 }}>👥</div>
              <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)", marginBottom:6 }}>
                Limite de seleções gratuitas
              </div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", lineHeight:1.7, marginBottom:20 }}>
                Você usou as <strong>3 seleções gratuitas</strong> deste mês.<br />
                Escolha como continuar:
              </div>

              {/* Opção 1 — R$ 1 por este contato */}
              <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:16, padding:"16px", marginBottom:10, textAlign:"left" }}>
                <div style={{ fontWeight:800, fontSize:14, color:"#166534", marginBottom:4 }}>💳 Desbloquear este contato — R$ 1,00</div>
                <div style={{ fontSize:12, color:"#4b7c59", lineHeight:1.5, marginBottom:12 }}>
                  Pague R$ 1 via Mercado Pago (cartão, PIX ou saldo) para selecionar mais um candidato agora.
                </div>
                <button
                  style={{ width:"100%", padding:"12px", background:"#16a34a", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor: desbloqueandoContato ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", opacity: desbloqueandoContato ? 0.6 : 1 }}
                  disabled={desbloqueandoContato}
                  onClick={desbloquearContato}>
                  {desbloqueandoContato ? "Aguarde..." : "Pagar R$ 1,00 e selecionar →"}
                </button>
              </div>

              {/* Opção 2 — Assinar plano */}
              <div style={{ background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:16, padding:"16px", marginBottom:10, textAlign:"left" }}>
                <div style={{ fontWeight:800, fontSize:14, color:"#9a3412", marginBottom:4 }}>🚀 Assinar Essencial — R$ 49/mês</div>
                <div style={{ fontSize:12, color:"#7c3b15", lineHeight:1.5, marginBottom:12 }}>
                  Seleções ilimitadas + vagas em destaque + badge verificado. Ideal para restaurantes, eventos e comércios.
                </div>
                <button
                  style={{ width:"100%", padding:"12px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => { setModalLimiteContato(false); setTela("planos"); }}>
                  Ver planos →
                </button>
              </div>

              <button
                style={{ padding:"10px 20px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:12, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => setModalLimiteContato(false)}>
                Agora não
              </button>
            </div>
          </div>
        )}

        {/* ── Modal: Denúncia ── */}
        {modalDenunciar && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"28px 24px", maxWidth:380, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,.3)" }}>
              <div style={{ fontSize:32, textAlign:"center", marginBottom:8 }}>⚑</div>
              <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", textAlign:"center", marginBottom:4 }}>
                Denunciar {modalDenunciar.tipo === "vaga" ? "vaga" : "usuário"}
              </div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", textAlign:"center", marginBottom:20, lineHeight:1.5 }}>
                <strong style={{ color:"var(--text-1,#0f172a)" }}>{modalDenunciar.nome}</strong><br />
                Selecione o motivo e enviaremos para revisão.
              </div>
              {/* Motivos rápidos */}
              <div style={{ display:"flex", flexDirection:"column" as const, gap:8, marginBottom:16 }}>
                {(modalDenunciar.tipo === "vaga"
                  ? ["Informações falsas ou enganosas", "Vaga não condiz com a realidade", "Conteúdo ofensivo ou inapropriado", "Vaga duplicada", "Outro"]
                  : ["Comportamento inadequado", "Perfil falso ou fraude", "Assédio ou ameaça", "Dados incorretos", "Outro"]
                ).map(motivo => (
                  <button
                    key={motivo}
                    style={{ padding:"11px 14px", borderRadius:12, border:`1.5px solid ${motivoDenuncia===motivo?"#ef4444":"#e2e8f0"}`, background:motivoDenuncia===motivo?"#fef2f2":"#f8fafc", color:motivoDenuncia===motivo?"#dc2626":"#475569", fontSize:13, fontWeight:motivoDenuncia===motivo?800:600, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", textAlign:"left" as const }}
                    onClick={() => setMotivoDenuncia(motivo)}>
                    {motivoDenuncia === motivo ? "● " : "○ "}{motivo}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button
                  style={{ flex:1, padding:"13px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => { setModalDenunciar(null); setMotivoDenuncia(""); }}>
                  Cancelar
                </button>
                <button
                  disabled={!motivoDenuncia || enviandoDenuncia}
                  style={{ flex:1, padding:"13px", background: motivoDenuncia?"#ef4444":"#fca5a5", color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:800, cursor: motivoDenuncia?"pointer":"default", fontFamily:"Inter, system-ui, sans-serif", opacity: enviandoDenuncia ? 0.7 : 1 }}
                  onClick={enviarDenuncia}>
                  {enviandoDenuncia ? "Enviando..." : "Enviar denúncia"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal obrigatório: feedback de vaga expirada (sem aceite) ── */}
        {vagasExpFeedback.length > 0 && (() => {
          const vaga = vagasExpFeedback[0];
          const fila = vagasExpFeedback.length;
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"24px 22px", width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.4)" }}>
                <div style={{ fontSize:36, textAlign:"center", marginBottom:8 }}>⏰</div>
                <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", textAlign:"center", marginBottom:4 }}>
                  Vaga expirou sem ninguém aceitar
                </div>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", textAlign:"center", marginBottom:16, lineHeight:1.5 }}>
                  Sua vaga de <strong>{vaga.funcao || vaga.segmento}</strong> em{" "}
                  <strong>{new Date(vaga.data+"T12:00:00").toLocaleDateString("pt-BR")}</strong> passou do horário.
                  <br /><br />
                  Nos conte rapidinho o que aconteceu — ajuda muito a gente a melhorar.
                </div>
                {fila > 1 && (
                  <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", textAlign:"center", marginBottom:10 }}>
                    {fila - 1} outra{fila > 2 ? "s" : ""} vaga{fila > 2 ? "s" : ""} aguardando feedback
                  </div>
                )}
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
                  {MOTIVOS_VAGA_EXPIRADA.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setMotivoExpSelecionado(m.id)}
                      style={{
                        display:"flex", alignItems:"center", gap:10,
                        padding:"12px 14px", borderRadius:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                        background: motivoExpSelecionado === m.id ? "#fff4ec" : "var(--bg-subtle,#f8fafc)",
                        border: motivoExpSelecionado === m.id ? "2px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                        color: motivoExpSelecionado === m.id ? "#9a4218" : "var(--text-1,#0f172a)",
                        fontSize:13, fontWeight:700, textAlign:"left" as const,
                      }}>
                      <span style={{ fontSize:18 }}>{m.emoji}</span>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
                {motivoExpSelecionado === "outro" && (
                  <textarea
                    value={motivoExpTexto}
                    onChange={e => setMotivoExpTexto(e.target.value)}
                    placeholder="Conta um pouco mais (mínimo 10 caracteres)..."
                    maxLength={500}
                    style={{ width:"100%", minHeight:80, padding:12, borderRadius:12, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", resize:"vertical" as const, marginBottom:14, background:"var(--input-bg,#fff)", color:"var(--text-1,#0f172a)" }}
                  />
                )}
                <button
                  onClick={enviarFeedbackVagaExpirada}
                  disabled={!motivoExpSelecionado || enviandoFeedbackExp || (motivoExpSelecionado === "outro" && motivoExpTexto.trim().length < 10)}
                  style={{
                    width:"100%", padding:"14px",
                    background: !motivoExpSelecionado || enviandoFeedbackExp ? "#cbd5e1" : "#FF6B35",
                    color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:900,
                    cursor: !motivoExpSelecionado || enviandoFeedbackExp ? "not-allowed" : "pointer",
                    fontFamily:"Inter, system-ui, sans-serif",
                  }}>
                  {enviandoFeedbackExp ? "Enviando..." : "Enviar e continuar"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Modal obrigatório: pesquisa pós-conclusão ── */}
        {vagasExpFeedback.length === 0 && diariasPosFeedback.length > 0 && (() => {
          const diaria = diariasPosFeedback[0];
          const fila = diariasPosFeedback.length;
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"24px 22px", width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.4)" }}>
                <div style={{ fontSize:36, textAlign:"center", marginBottom:8 }}>⭐</div>
                <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", textAlign:"center", marginBottom:4 }}>
                  Como foi a diária?
                </div>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", textAlign:"center", marginBottom:18, lineHeight:1.5 }}>
                  <strong>{diaria.funcao || diaria.segmento}</strong> em{" "}
                  <strong>{new Date(diaria.data+"T12:00:00").toLocaleDateString("pt-BR")}</strong>
                </div>
                {fila > 1 && (
                  <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", textAlign:"center", marginBottom:10 }}>
                    {fila - 1} outra{fila > 2 ? "s" : ""} diária{fila > 2 ? "s" : ""} aguardando avaliação
                  </div>
                )}

                <div style={{ fontWeight:700, fontSize:13, color:"var(--text-label,#475569)", marginBottom:8 }}>
                  O profissional chegou no horário?
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  {[{v:true,t:"Sim, chegou"}, {v:false,t:"Não chegou no horário"}].map(o => (
                    <button key={String(o.v)} onClick={() => setPosChegouHorario(o.v)}
                      style={{
                        flex:1, padding:"12px 8px", borderRadius:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                        background: posChegouHorario === o.v ? "#fff4ec" : "var(--bg-subtle,#f8fafc)",
                        border: posChegouHorario === o.v ? "2px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                        color: posChegouHorario === o.v ? "#9a4218" : "var(--text-1,#0f172a)",
                        fontSize:12, fontWeight:700,
                      }}>{o.t}</button>
                  ))}
                </div>

                <div style={{ fontWeight:700, fontSize:13, color:"var(--text-label,#475569)", marginBottom:8 }}>
                  Qualidade do serviço
                </div>
                <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:16 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setPosNotaQualidade(n)}
                      style={{
                        width:44, height:44, fontSize:24, cursor:"pointer", border:"none",
                        background: "transparent", padding:0, lineHeight:1,
                        opacity: posNotaQualidade >= n ? 1 : 0.3,
                        color: posNotaQualidade >= n ? "#f59e0b" : "#94a3b8",
                      }}>★</button>
                  ))}
                </div>

                <div style={{ fontWeight:700, fontSize:13, color:"var(--text-label,#475569)", marginBottom:8 }}>
                  Recomendaria esse profissional?
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  {[{v:true,t:"👍 Sim"}, {v:false,t:"👎 Não"}].map(o => (
                    <button key={String(o.v)} onClick={() => setPosRecomendaria(o.v)}
                      style={{
                        flex:1, padding:"12px 8px", borderRadius:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                        background: posRecomendaria === o.v ? "#fff4ec" : "var(--bg-subtle,#f8fafc)",
                        border: posRecomendaria === o.v ? "2px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                        color: posRecomendaria === o.v ? "#9a4218" : "var(--text-1,#0f172a)",
                        fontSize:13, fontWeight:700,
                      }}>{o.t}</button>
                  ))}
                </div>

                <textarea
                  value={posComentario}
                  onChange={e => setPosComentario(e.target.value)}
                  placeholder="Quer deixar um comentário? (opcional)"
                  maxLength={500}
                  style={{ width:"100%", minHeight:60, padding:12, borderRadius:12, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", resize:"vertical" as const, marginBottom:14, background:"var(--input-bg,#fff)", color:"var(--text-1,#0f172a)" }}
                />

                <button
                  onClick={enviarFeedbackPosConclusao}
                  disabled={enviandoFeedbackPos || posChegouHorario === null || posNotaQualidade === 0 || posRecomendaria === null}
                  style={{
                    width:"100%", padding:"14px",
                    background: enviandoFeedbackPos || posChegouHorario === null || posNotaQualidade === 0 || posRecomendaria === null ? "#cbd5e1" : "#FF6B35",
                    color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:900,
                    cursor: enviandoFeedbackPos ? "not-allowed" : "pointer",
                    fontFamily:"Inter, system-ui, sans-serif",
                  }}>
                  {enviandoFeedbackPos ? "Enviando..." : "Enviar avaliação"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Modal: Diarista aceitou a vaga ── */}
        {alertaAceite && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:28, padding:"36px 24px 28px", width:"100%", maxWidth:380, textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,.35)" }}>
              <div style={{ fontSize:60, marginBottom:12, lineHeight:1 }}>🎉</div>
              <div style={{ fontWeight:900, fontSize:22, color:"var(--text-1,#0f172a)", marginBottom:6 }}>Diarista confirmado!</div>
              <div style={{ fontSize:14, color:"var(--text-2,#64748b)", lineHeight:1.7, marginBottom:24 }}>
                Alguém aceitou sua vaga de<br />
                <strong style={{ color:"var(--text-1,#0f172a)" }}>{alertaAceite.funcao || alertaAceite.segmento}</strong>
                {alertaAceite.data && (
                  <> em <strong style={{ color:"var(--text-1,#0f172a)" }}>{new Date(alertaAceite.data+"T12:00:00").toLocaleDateString("pt-BR")}</strong></>
                )}.
                <br /><br />
                Peça ao profissional o QR Code e escaneie para confirmar a chegada.
              </div>
              <button
                style={{ width:"100%", padding:"15px", background:negocio?.cor || "#FF6B35", color:"#fff", border:"none", borderRadius:16, fontSize:15, fontWeight:900, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, boxShadow:`0 4px 14px ${negocio?.cor || "#FF6B35"}55` }}
                onClick={() => { setTabEmpregador("diarias"); setAlertaAceite(null); }}>
                📋 Ver diária
              </button>
              <button
                style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => setAlertaAceite(null)}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal Scanner QR ── */}
        {scannerAberto && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.92)", zIndex:200, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"24px 20px", width:"100%", maxWidth:360 }}>
              <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)", marginBottom:4, textAlign:"center" as const }}>📷 Escanear QR Code</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", textAlign:"center" as const, marginBottom:16 }}>Aponte a câmera traseira para o QR Code do diarista</div>
              <QRScannerComponent onResult={confirmarInicio} onError={(msg) => setScanMsg({ ok:false, txt:msg })} onClose={() => setScannerAberto(false)} />
              <button style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:12, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:14 }}
                onClick={() => setScannerAberto(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── ABA CHAT EMPREGADOR ── */}
        {tabEmpregador === "chat" && (() => {
          // Se há chat ativo, mostra conversa
          if (chatDiariaAtiva) {
            const dp = chatDiariaAtiva.diarista_aceite_id ? diaristasAceites[chatDiariaAtiva.diarista_aceite_id] : null;
            const iniciais = dp?.nome?.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase() || "?";
            return (
              <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 130px)", position:"relative" }}>
                {/* Header do chat */}
                <div style={{ background:"var(--bg-card,#fff)", padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px rgba(0,0,0,.07)", flexShrink:0 }}>
                  <button style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", padding:"0 4px" }} onClick={() => { setChatDiariaAtiva(null); setConfirmExcluirChat(false); }}>←</button>
                  {dp?.foto_url
                    ? <img src={dp.foto_url} style={{ width:40, height:40, borderRadius:20, objectFit:"cover" }} alt="" />
                    : <div style={{ width:40, height:40, borderRadius:20, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:14, flexShrink:0 }}>{iniciais}</div>
                  }
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{dp?.nome || "Diarista"}</div>
                    <div style={{ fontSize:11, color: outroDigitando ? "#16a34a" : "var(--text-2,#64748b)", fontWeight: outroDigitando ? 700 : 400 }}>
                      {outroDigitando ? "digitando…" : `${chatDiariaAtiva.funcao} · ${new Date(chatDiariaAtiva.data+"T12:00:00").toLocaleDateString("pt-BR")}`}
                    </div>
                  </div>
                  {!confirmExcluirChat
                    ? <button style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", padding:"4px 6px", color:"var(--text-3,#94a3b8)" }} title="Excluir conversa" onClick={() => setConfirmExcluirChat(true)}>🗑️</button>
                    : <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                        <span style={{ fontSize:12, color:"#dc2626", fontWeight:700 }}>Excluir?</span>
                        <button style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => excluirChat(chatDiariaAtiva.id)}>Sim</button>
                        <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setConfirmExcluirChat(false)}>Não</button>
                      </div>
                  }
                </div>
                {/* Mensagens */}
                <div style={{ flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10, background:"var(--bg-app,#f0f2f5)" }}>
                  {mensagensReais.length === 0 && (
                    <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:13, marginTop:40 }}>Nenhuma mensagem ainda. Inicie a conversa! 👋</div>
                  )}
                  {mensagensReais.map(m => {
                    const isMeu = m.remetente_id === session?.user?.id;
                    return (
                      <div key={m.id} style={{ display:"flex", justifyContent: isMeu ? "flex-end" : "flex-start" }}>
                        <div style={{ background: isMeu ? negocio.cor : "var(--bg-card,#fff)", color: isMeu ? "#fff" : "var(--text-1,#0f172a)", borderRadius: isMeu ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding:"10px 14px", maxWidth:"75%", fontSize:14, boxShadow:"0 1px 4px rgba(0,0,0,.1)", lineHeight:1.5 }}>
                          {m.conteudo}
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4, fontSize:10, opacity:.7, marginTop:4 }}>
                            <span>{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" })}</span>
                            {isMeu && (
                              m.lida_em
                                ? <span title="Lida" style={{ display:"inline-flex", color:"#bbf7d0", fontSize:11, fontWeight:800 }}>✓✓</span>
                                : <span title="Enviada" style={{ display:"inline-flex", color:"#fff", opacity:.6, fontSize:11, fontWeight:800 }}>✓</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={mensagensEndRef} />
                </div>
                {/* Input */}
                <div style={{ background:"var(--bg-card,#fff)", padding:"12px 16px", display:"flex", gap:10, alignItems:"center", borderTop:"1px solid var(--border,#e2e8f0)", flexShrink:0 }}>
                  <input
                    style={{ flex:1, padding:"12px 16px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:24, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", outline:"none" }}
                    placeholder="Digite uma mensagem..."
                    value={msgInputReal}
                    onChange={e => { setMsgInputReal(e.target.value); sinalizarDigitando(); }}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && enviarMensagemReal()}
                  />
                  <button
                    aria-label="Enviar mensagem"
                    style={{ width:44, height:44, borderRadius:22, background: msgInputReal.trim() ? negocio.cor : "#e2e8f0", border:"none", color:"#fff", cursor: msgInputReal.trim() ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}
                    disabled={!msgInputReal.trim() || enviandoMsgReal}
                    onClick={enviarMensagemReal}>
                    <Send size={18} />
                  </button>
                </div>
                {/* Anti-exit aviso */}
                {antiExitAviso && (
                  <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.7)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                    <div style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"28px 24px 32px", width:"100%", maxWidth:480 }} onClick={e => e.stopPropagation()}>
                      <div style={{ fontSize:36, textAlign:"center", marginBottom:10 }}>🛡️</div>
                      <div style={{ fontWeight:900, fontSize:17, color:"#0f172a", textAlign:"center", marginBottom:8 }}>Proteção DiáriaJá</div>
                      <div style={{ fontSize:13, color:"#475569", textAlign:"center", lineHeight:1.6, marginBottom:20 }}>
                        Por segurança, <strong>não compartilhe telefones, WhatsApp ou contatos externos</strong> no chat. Todo acerto deve ser feito dentro do app para sua proteção.
                      </div>
                      <button style={{ width:"100%", padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
                        onClick={() => { setAntiExitAviso(false); setMsgInputReal(""); }}>
                        Entendi, vou apagar a mensagem
                      </button>
                      <button style={{ width:"100%", padding:"12px", background:"#f1f5f9", color:"#475569", border:"none", borderRadius:14, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={async () => {
                          setAntiExitAviso(false);
                          // Envia mesmo assim (contorna o filtro)
                          if (!session?.user || !chatDiariaAtiva) return;
                          if (tipo === "empregador" && !chatDiariaAtiva.diarista_aceite_id) return;
                          const destinatario2 = tipo === "empregador" ? chatDiariaAtiva.diarista_aceite_id! : chatDiariaAtiva.empregador_id;
                          const { data: novaMsg2 } = await supabase.from("mensagens").insert({ diaria_id:chatDiariaAtiva.id, remetente_id:session.user.id, destinatario_id:destinatario2, conteudo:msgInputReal.trim() }).select().single();
                          if (novaMsg2) { setMensagensReais(prev => [...prev, novaMsg2]); setMsgInputReal(""); }
                        }}>
                        Enviar mesmo assim
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          // Lista de conversas (diárias aceitas/em andamento)
          const conversas = diarias.filter(d => d.diarista_aceite_id && ["aceita","em_andamento","concluida"].includes(d.status) && !hiddenChats.has(d.id));
          return (
            <div style={{ padding:"16px" }}>
              <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)", marginBottom:16 }}>💬 Mensagens</div>
              {/* Suporte DiáriaJá — sempre no topo */}
              <div
                style={{ background:"linear-gradient(135deg,#8338EC,#FF6B35)", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 4px 14px rgba(131,56,236,.3)", cursor:"pointer", marginBottom:10 }}
                onClick={() => { setChatSuporte(true); }}>
                <div style={{ width:50, height:50, borderRadius:25, background:"rgba(255,255,255,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>💬</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:900, fontSize:15, color:"#fff" }}>Suporte DiáriaJá</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,.8)", marginTop:2 }}>Tire suas dúvidas instantaneamente</div>
                </div>
                <span style={{ background:"#22c55e", color:"#fff", fontSize:10, fontWeight:800, padding:"3px 8px", borderRadius:20 }}>Online</span>
              </div>
              {conversas.length === 0 ? (
                <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"32px 20px", textAlign:"center" }}>
                  <div style={{ fontSize:40, marginBottom:10 }}>💬</div>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:6 }}>Nenhuma conversa ainda</div>
                  <div style={{ color:"var(--text-3,#94a3b8)", fontSize:13 }}>Quando um diarista aceitar sua vaga, você poderá conversar aqui.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {conversas.map(dia => {
                    const dp = dia.diarista_aceite_id ? diaristasAceites[dia.diarista_aceite_id] : null;
                    const iniciais = dp?.nome?.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase() || "?";
                    const nLidas = naoLidasPorDiaria[dia.id] || 0;
                    return (
                      <div key={dia.id}
                        style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px rgba(0,0,0,.06)", cursor:"pointer" }}
                        onClick={() => { hapticTick(); setChatDiariaAtiva(dia); }}>
                        {dp?.foto_url
                          ? <img src={dp.foto_url} style={{ width:50, height:50, borderRadius:25, objectFit:"cover", flexShrink:0 }} alt="" />
                          : <div style={{ width:50, height:50, borderRadius:25, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:16, flexShrink:0 }}>{iniciais}</div>
                        }
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight: nLidas > 0 ? 900 : 800, fontSize:15, color:"var(--text-1,#0f172a)" }}>{dp?.nome || "Diarista"}</div>
                          <div style={{ fontSize:12, color: nLidas > 0 ? "var(--text-1,#0f172a)" : "var(--text-2,#64748b)", marginTop:2, fontWeight: nLidas > 0 ? 700 : 400 }}>{dia.funcao} · {new Date(dia.data+"T12:00:00").toLocaleDateString("pt-BR")}</div>
                        </div>
                        {nLidas > 0 && (
                          <span style={{ background:"#FF6B35", color:"#fff", borderRadius:11, minWidth:22, height:22, padding:"0 7px", fontSize:11, fontWeight:900, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                            {nLidas > 9 ? "9+" : nLidas}
                          </span>
                        )}
                        <ChevronRight size={18} color="var(--text-3,#94a3b8)" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── ABA PERFIL ── */}
        {tabEmpregador === "perfil" && (
          <>
            {/* Barra + ⚙️ */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 20px 8px", background:"var(--bg-card,#fff)", borderBottom:"1px solid var(--border-sub,#f1f5f9)" }}>
              <div style={{ fontSize:17, fontWeight:900, color:"var(--text-1,#0f172a)" }}>Meu Perfil</div>
              <button
                style={{ background:"var(--bg-subtle,#f1f5f9)", border:"none", borderRadius:12, padding:"8px 14px", fontSize:14, fontWeight:800, color:"var(--text-2,#64748b)", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", gap:6 }}
                onClick={() => setTela("configuracoes")}>
                ⚙️ <span style={{ fontSize:12 }}>Config.</span>
              </button>
            </div>

            {/* Foto + nome + rating */}
            <div style={S.perfilHeader}>
              <input ref={fotoInputRef} type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => e.target.files?.[0] && handleFotoUpload(e.target.files[0])} />
              <div style={{ position:"relative", cursor:"pointer", marginBottom:10 }} onClick={() => fotoInputRef.current?.click()}>
                {fotoUrl
                  ? <img src={fotoUrl} alt="foto" style={{ width:88, height:88, borderRadius:44, objectFit:"cover", border:`3px solid ${negocio.cor}`, display:"block" }} />
                  : <div style={{ width:88, height:88, borderRadius:44, background:negocio.cor, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:26, border:`3px dashed ${negocio.cor}99` }}>{iniciaisEmp}</div>
                }
                <div style={{ position:"absolute", bottom:0, right:0, background:negocio.cor, borderRadius:12, padding:"3px 8px", fontSize:11, color:"#fff", fontWeight:700 }}>
                  {uploadingFoto ? "⏳" : "📷"}
                </div>
              </div>
              <h2 style={{ ...S.perfilNome, marginBottom:2 }}>{profile?.nome || "—"}</h2>
              <div style={S.perfilRamo}>
                {/* Mostra nome_negocio só se for diferente do nome; senão mostra o segmento */}
                {profile?.nome_negocio && profile.nome_negocio !== profile?.nome
                  ? profile.nome_negocio
                  : negocioSelecionado || "Empregador"}
              </div>
              {mediaEmpregadorPerfil !== null && (
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:6 }}>
                  <span style={{ fontSize:16 }}>⭐</span>
                  <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{mediaEmpregadorPerfil.toFixed(1)}</span>
                  <span style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>avaliação dos diaristas</span>
                </div>
              )}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8 }}>
                <span style={{ background:negocio.cor+"18", color:negocio.cor, padding:"4px 14px", borderRadius:20, fontSize:12, fontWeight:700, border:`1px solid ${negocio.cor}30` }}>
                  {negocio.icone} {negocioSelecionado}
                </span>
                {profile?.pessoa_tipo === "juridica" && (
                  <span style={{ background:"#3A86FF18", color:"#3A86FF", padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>🏢 Empresa</span>
                )}
              </div>
            </div>

            {/* Bio */}
            <div style={S.section}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={S.sectionTitle}>Apresentação</div>
                <button style={S.btnEditarPerfil} onClick={() => { setBioDraft(profile?.bio||""); setEditandoBio(true); }}>✏️ Editar</button>
              </div>
              {editandoBio ? (
                <>
                  <textarea style={{ width:"100%", border:`1.5px solid ${negocio.cor}`, borderRadius:10, padding:"10px 12px", fontSize:13, lineHeight:1.6, resize:"none" as const, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, minHeight:80, background:"var(--bg-card,#fff)", color:"var(--text-1,#0f172a)" }}
                    value={bioDraft} onChange={e => setBioDraft(e.target.value)} placeholder="Fale sobre seu negócio..." autoFocus />
                  <div style={{ display:"flex", gap:8, marginTop:8 }}>
                    <button style={{ flex:1, background:negocio.cor, color:"#fff", border:"none", borderRadius:10, padding:"9px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                      onClick={async () => { const ok = await saveProfile({ bio: bioDraft }); if (ok) { setToastSuccess("✅ Bio salva!"); setEditandoBio(false); } }}>Salvar</button>
                    <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                      onClick={() => setEditandoBio(false)}>Cancelar</button>
                  </div>
                </>
              ) : (
                <p style={{ color:"var(--text-label,#475569)", fontSize:13, lineHeight:1.6, margin:0 }}>
                  {profile?.bio || <span style={{ color:"var(--text-3,#94a3b8)", fontStyle:"italic" }}>Nenhuma apresentação ainda.</span>}
                </p>
              )}
            </div>

            {/* Plano atual */}
            {(() => {
              const planoAtivo = assinatura?.plano || "gratis";
              const planoInfo = PLANOS_EMPREGADOR.find(p => p.id === planoAtivo);
              return (
                <div style={{ margin:"8px 16px 0", background: planoAtivo === "gratis" ? "var(--bg-surface,#f8fafc)" : "linear-gradient(135deg,#FF6B35,#e85d2e)", borderRadius:16, padding:"14px 16px", border: planoAtivo === "gratis" ? "1.5px solid var(--border,#e2e8f0)" : "none" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color: planoAtivo === "gratis" ? "var(--text-3,#94a3b8)" : "rgba(255,255,255,.75)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:4 }}>Plano atual</div>
                      <div style={{ fontSize:15, fontWeight:900, color: planoAtivo === "gratis" ? "var(--text-1,#0f172a)" : "#fff" }}>
                        {planoInfo?.nome || "Grátis"}{planoAtivo !== "gratis" && " ✅"}
                      </div>
                      {planoAtivo === "gratis" && (
                        <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>
                          {(() => {
                            const n = Math.max(0, 3 - diarias.filter(d => d.created_at && d.created_at.slice(0,7) === new Date().toISOString().slice(0,7)).length);
                            return `${n} vaga${n !== 1 ? "s" : ""} restante${n !== 1 ? "s" : ""} este mês`;
                          })()}
                        </div>
                      )}
                    </div>
                    <button style={{ padding:"8px 14px", background: planoAtivo === "gratis" ? "#FF6B35" : "rgba(255,255,255,.25)", color:"#fff", border:"none", borderRadius:12, fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                      onClick={() => setTela("planos")}>
                      {planoAtivo === "gratis" ? "Upgrade →" : "Ver planos"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Ações */}
            <div style={{ padding:"12px 16px 24px", display:"flex", flexDirection:"column", gap:10 }}>
              <button style={{ ...S.btnSecondary, color:negocio.cor, borderColor:negocio.cor }}
                onClick={() => setTela("escolha-negocio")}>
                🔄 Trocar tipo de negócio
              </button>
              <button style={{ ...S.btnSecondary, color:"#FF6B35", borderColor:"#FF6B35" }} onClick={() => { carregarTopicos(filtroComunidade); setTopicoAtivo(null); setTela("comunidade"); }}>
                🏘️ Comunidade
              </button>
              <button style={{ ...S.btnSecondary, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)" }} onClick={handleLogout}>
                Sair da conta
              </button>
            </div>
          </>
        )}

        {/* ── Modal info do perfil (empregador) ── */}
        {modalInfoPerfil && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:350, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={() => { setModalInfoPerfil(false); setEditandoBio(false); }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }} onClick={e => e.stopPropagation()}>
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:20 }}>
                <div style={{ width:72, height:72, borderRadius:36, background:negocio.cor, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:24, border:`3px solid ${negocio.cor}`, marginBottom:12 }}>
                  {iniciaisEmp}
                </div>
                <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)" }}>{profile?.nome}</div>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginTop:2 }}>{negocioSelecionado}</div>
                {mediaEmpregadorPerfil !== null && (
                  <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:8 }}>
                    <span style={{ fontSize:16 }}>⭐</span>
                    <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{mediaEmpregadorPerfil.toFixed(1)}</span>
                    <span style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>avaliação dos diaristas</span>
                  </div>
                )}
              </div>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:6, textTransform:"uppercase" as const, letterSpacing:0.5 }}>Apresentação</div>
                {editandoBio ? (
                  <>
                    <textarea
                      style={{ width:"100%", border:"1.5px solid #FF6B35", borderRadius:10, padding:"10px 12px", fontSize:13, lineHeight:1.6, resize:"none" as const, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, minHeight:80 }}
                      value={bioDraft}
                      onChange={e => setBioDraft(e.target.value)}
                      placeholder="Escreva uma apresentação..."
                      autoFocus
                    />
                    <div style={{ display:"flex", gap:8, marginTop:8 }}>
                      <button
                        style={{ flex:1, background:"#FF6B35", color:"#fff", border:"none", borderRadius:10, padding:"9px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={async () => { const ok = await saveProfile({ bio: bioDraft }); if (ok) { setToastSuccess("✅ Bio salva!"); setEditandoBio(false); setModalInfoPerfil(false); } }}>
                        Salvar
                      </button>
                      <button
                        style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={() => setEditandoBio(false)}>
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                    <p style={{ color:"var(--text-label,#475569)", fontSize:13, lineHeight:1.6, margin:0, flex:1 }}>{profile?.bio || "Nenhuma apresentação adicionada."}</p>
                    <button
                      style={{ background:"none", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, color:"#FF6B35", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", flexShrink:0 }}
                      onClick={() => setEditandoBio(true)}>
                      ✏️ Editar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Bottom nav — 5 abas ── */}
        <div style={S.bottomNav}>
          <button style={{ ...S.bottomNavBtn, ...(tabEmpregador==="inicio"?{ ...S.bottomNavAtivo, color:negocio.cor }:{}) }} onClick={()=>{ hapticTick(); setTabEmpregador("inicio"); }}>
            <Home size={22} strokeWidth={tabEmpregador==="inicio"?2.5:2} />
            <span>Home</span>
          </button>
          <button style={{ ...S.bottomNavBtn, ...(tabEmpregador==="diarias"?{ ...S.bottomNavAtivo, color:negocio.cor }:{}) }} onClick={()=>{ hapticTick(); setTabEmpregador("diarias"); }}>
            <Briefcase size={22} strokeWidth={tabEmpregador==="diarias"?2.5:2} />
            <span>Diárias</span>
          </button>
          <button style={{ ...S.bottomNavBtn, position:"relative" }}>
            <div style={{ width:52, height:52, borderRadius:26, background:negocio.cor, display:"flex", alignItems:"center", justifyContent:"center", marginTop:-20, boxShadow:`0 4px 14px ${negocio.cor}66`, border:"3px solid #f0f2f5" }}
              onClick={() => { hapticTick(); setFormDiaria({ local:"", descricao:"", funcao:"", data:"", horario_inicio:"", horario_fim:"", valor:"", cep:"", rua:"", numero:"", complemento:"", bairro:"", cidade:"", estado:"", valor_encostada:"", valor_por_entrega:"", ganho_estimado_dia:"" }); setLatDiaria(null); setLngDiaria(null); setAuthError(""); setTela("criar-diaria"); }}>
              <Plus size={26} color="#fff" strokeWidth={2.8} />
            </div>
            <span style={{ marginTop:2 }}>Publicar</span>
          </button>
          <button style={{ ...S.bottomNavBtn, position:"relative", ...(tabEmpregador==="chat"?{ ...S.bottomNavAtivo, color:negocio.cor }:{}) }} onClick={()=>{ hapticTick(); setTabEmpregador("chat"); setMsgNaoLidas(0); }}>
            <span style={{ position:"relative", display:"inline-flex", alignItems:"center" }}>
              <MessageCircle size={22} strokeWidth={tabEmpregador==="chat"?2.5:2} />
              {msgNaoLidas > 0 && (
                <span style={{ position:"absolute", top:-6, right:-10, background:"#ef4444", color:"#fff", borderRadius:"50%", minWidth:16, height:16, padding:"0 4px", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:"16px" }}>
                  {msgNaoLidas > 9 ? "9+" : msgNaoLidas}
                </span>
              )}
            </span>
            <span>Chat</span>
          </button>
          <button style={{ ...S.bottomNavBtn, ...(tabEmpregador==="perfil"?{ ...S.bottomNavAtivo, color:negocio.cor }:{}) }} onClick={()=>{ hapticTick(); setTabEmpregador("perfil"); }}>
            <User size={22} strokeWidth={tabEmpregador==="perfil"?2.5:2} />
            <span>Perfil</span>
          </button>
        </div>

        {/* ── Painel de Notificações (empregador) ── */}
        {modalNotif && (
          <div style={S.modalOverlay} onClick={() => setModalNotif(false)}>
            <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"20px 20px 40px", boxShadow:"0 -8px 32px rgba(0,0,0,.15)", maxHeight:"70vh", overflow:"auto" }} onClick={e => e.stopPropagation()}>
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 16px" }} />
              <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)", marginBottom:16 }}>🔔 Notificações</div>
              {/* Banner de suporte para admin */}
              {profile?.is_admin && suporteNaoLidos > 0 && (
                <div style={{ background:"#fef3c7", border:"1.5px solid #f59e0b", borderRadius:14, padding:"12px 14px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}
                  onClick={() => { setModalNotif(false); setSuporteNaoLidos(0); setFiltroComunidade("suporte"); carregarTopicos("suporte"); setTopicoAtivo(null); setTela("comunidade"); }}>
                  <span style={{ fontSize:24 }}>🔧</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:13, color:"#92400e" }}>{suporteNaoLidos} novo{suporteNaoLidos > 1 ? "s" : ""} pedido{suporteNaoLidos > 1 ? "s" : ""} de suporte</div>
                    <div style={{ fontSize:12, color:"#b45309", marginTop:2 }}>Toque para ver na Comunidade →</div>
                  </div>
                </div>
              )}
              {listaNotif.length === 0 && !(profile?.is_admin && suporteNaoLidos > 0) ? (
                <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", padding:"32px 0", fontSize:14 }}>
                  <div style={{ fontSize:40, marginBottom:8 }}>🔕</div>
                  Nenhuma notificação ainda
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {listaNotif.map((n, i) => (
                    <div key={i} style={{ background: n.tipo==="ok" ? "#f0fdf4" : "#fef2f2", borderRadius:12, padding:"10px 14px", display:"flex", gap:10, alignItems:"flex-start", border:`1px solid ${n.tipo==="ok"?"#bbf7d0":"#fecaca"}` }}>
                      <span style={{ fontSize:18 }}>{n.tipo==="ok" ? "✅" : "⚠️"}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, color:"var(--text-1,#0f172a)", lineHeight:1.4 }}>{n.msg.replace(/^[✅❌⚠️🎉🔔]+\s*/,"")}</div>
                        <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:3 }}>{new Date(n.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {listaNotif.length > 0 && (
                <button style={{ width:"100%", marginTop:16, padding:"10px", background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:13, color:"var(--text-2,#64748b)", fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => { setListaNotif([]); setModalNotif(false); }}>
                  🗑️ Limpar notificações
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Bottom sheet: trocar de perfil ── */}
        {menuTrocarPerfil && (
          <div style={S.modalOverlay} onClick={() => setMenuTrocarPerfil(false)}>
            <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"8px 0 32px", boxShadow:"0 -8px 32px rgba(0,0,0,.15)" }} onClick={e => e.stopPropagation()}>
              {/* Alça */}
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
              {/* Modo atual */}
              <div style={{ padding:"0 20px 16px", borderBottom:"1px solid var(--border-sub,#f1f5f9)" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:8 }}>Modo atual</div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:44, height:44, borderRadius:22, background:negocio.cor, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{negocio.icone}</div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)" }}>Empregador</div>
                    <div style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>{profile?.nome_negocio || negocioSelecionado}</div>
                  </div>
                  <span style={{ marginLeft:"auto", background:"#dcfce7", color:"#16a34a", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>✓ Ativo</span>
                </div>
              </div>
              {/* Opção de trocar — empresas (pessoa_tipo === "juridica") NÃO podem virar diarista */}
              <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:12 }}>Trocar para</div>
                {profile?.pessoa_tipo === "juridica" ? (
                  <div style={{ background:"#f8fafc", border:"1.5px dashed #cbd5e1", borderRadius:14, padding:"16px", textAlign:"center" as const }}>
                    <div style={{ fontSize:28, marginBottom:6 }}>🏢</div>
                    <div style={{ fontWeight:700, fontSize:13, color:"var(--text-2,#64748b)", lineHeight:1.4 }}>
                      Contas empresa não podem ter perfil de diarista.
                    </div>
                  </div>
                ) : (
                  <button
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:14, background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:16, padding:"14px 16px", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", textAlign:"left" as const }}
                    onClick={() => {
                      setMenuTrocarPerfil(false);
                      setAuthError("");
                      if (profile?.funcao && profile?.valor_diaria) {
                        setModoAtual("diarista"); setTela("home-diarista");
                      } else {
                        setForm({ ...form, funcao: profile?.funcao || "", valor: String(profile?.valor_diaria || "") });
                        setTela("setup-diarista");
                      }
                    }}>
                    <div style={{ width:44, height:44, borderRadius:22, background:"#8338EC18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>👷</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:800, fontSize:15, color:"var(--text-1,#0f172a)" }}>Diarista</div>
                      <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>
                        {profile?.funcao ? `${profile.funcao} · R$ ${profile.valor_diaria}/dia` : "Cadastrar perfil de diarista"}
                      </div>
                    </div>
                    <span style={{ fontSize:20, color:"var(--text-3,#94a3b8)" }}>›</span>
                  </button>
                )}
              </div>
              <div style={{ padding:"0 20px" }}>
                <button style={{ ...S.btnSecondary, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)", width:"100%" }} onClick={() => setMenuTrocarPerfil(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // perfil-diarista mock: removido — redireciona para home-empregador
  if (tela === "perfil-diarista") {
    setTela("home-empregador");
    return null;
  }

  // HOME DIARISTA
  if (tela === "home-diarista") {
    const hora = new Date().getHours();
    const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
    const primeiroNome = profile?.nome?.split(" ")[0] || "você";
    const iniciaisNome = profile?.nome?.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "?";

    const hojeFmtV = new Date().toISOString().split("T")[0];
    const amanhaFmtV = (() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split("T")[0]; })();

    // ── Helper de distância (retorna Infinity se faltar lat/lng) ─────────────
    const distKm = (d: Diaria): number => {
      if (!profile?.lat || !profile?.lng || !d.lat || !d.lng) return Infinity;
      return haversineKm(profile.lat!, profile.lng!, d.lat!, d.lng!);
    };

    const vagasFiltradas = vagasReais
      .filter(d => !vagasIgnoradas.has(d.id))   // oculta vagas marcadas como sem interesse
      .filter(d => !d.funcao || categoriasSelecionadas.length === 0 || categoriasSelecionadas.includes(d.funcao))
      .filter(d => filtroDataVaga === "hoje" ? d.data === hojeFmtV : filtroDataVaga === "amanha" ? d.data === amanhaFmtV : true)
      .filter(d => Number(d.valor) >= filtroValorMin)
      .filter(d => distKm(d) <= filtroRaioKm || distKm(d) === Infinity)
      .sort((a, b) => {
        // Atalhos do menu de ordenação
        if (sortVagas === "menor_valor") return a.valor - b.valor;
        if (sortVagas === "maior_valor") return b.valor - a.valor;
        if (sortVagas === "recentes")
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortVagas === "proximas") return distKm(a) - distKm(b);
        // Default "feed": (1) distância → (2) recência → (3) valor desc
        const dDist = distKm(a) - distKm(b);
        if (Math.abs(dDist) > 0.5) return dDist;                           // diferença <500m empata
        const dRec = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (Math.abs(dRec) > 6 * 60 * 60 * 1000) return dRec;              // <6h empata
        return b.valor - a.valor;                                           // desempate por valor
      });

    // Contador "X novas hoje na sua região" — vagas criadas após 00:00 hoje + dentro do raio
    const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
    const novasHoje = vagasReais
      .filter(d => new Date(d.created_at) >= inicioHoje)
      .filter(d => distKm(d) <= filtroRaioKm || distKm(d) === Infinity)
      .length;

    const empresaIniciais = (nome: string) =>
      nome.split(" ").filter(Boolean).map(n=>n[0]).join("").slice(0,2).toUpperCase() || "🏢";

    const formatData = (data: string) => {
      const hoje = new Date();
      const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);
      const d = new Date(data + "T12:00:00");
      if (d.toDateString() === hoje.toDateString()) return "Hoje";
      if (d.toDateString() === amanha.toDateString()) return "Amanhã";
      return d.toLocaleDateString("pt-BR");
    };

    return (
      <div style={{ ...S.appShell, paddingBottom: 76, background: "#f0f2f5" }}>

        {/* ── Header novo estilo ── */}
        <div style={{ background:"var(--bg-card,#fff)", padding:"20px 20px 14px", boxShadow:"0 2px 8px rgba(0,0,0,.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            {/* Avatar + Nome */}
            <div style={{ display:"flex", alignItems:"center", gap:14, flex:1 }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                {fotoUrl
                  ? <img src={fotoUrl} style={{ width:52, height:52, borderRadius:26, objectFit:"cover", border:"3px solid #FF6B35", display:"block" }} alt="" />
                  : <div style={{ width:52, height:52, borderRadius:26, background:"#0f172a", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:18, border:"3px solid #FF6B35" }}>{iniciaisNome}</div>
                }
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", fontWeight:600 }}>{saudacao},</div>
                <div style={{ fontSize:20, fontWeight:900, color:"var(--text-1,#0f172a)", lineHeight:1.2 }}>
                  <span style={{ color:"#FF6B35", cursor:"pointer" }} onClick={() => { setModalInfoPerfil(true); setBioDraft(profile?.bio || ""); }}>{primeiroNome}!</span> 👋
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:3 }}>
                  <span style={{ background:"#FF6B3515", color:"#FF6B35", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>👷 Diarista</span>
                </div>
              </div>
            </div>
            {/* Sino + botão trocar perfil */}
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {tipo === "ambos" && (
                <div style={{ background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer" }}
                  onClick={() => setMenuTrocarPerfil(true)}>🔄</div>
              )}
              <div style={{ position:"relative", background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer" }}
                onClick={() => { setModalNotif(true); setNotifNaoLidas(0); }}>
                🔔
                {(notifNaoLidas + suporteNaoLidos) > 0 && <div style={{ position:"absolute", top:-4, right:-4, background: suporteNaoLidos > 0 ? "#f59e0b" : "#ef4444", color:"#fff", borderRadius:10, minWidth:18, height:18, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, padding:"0 4px" }}>{(notifNaoLidas + suporteNaoLidos) > 9 ? "9+" : (notifNaoLidas + suporteNaoLidos)}</div>}
              </div>
            </div>
          </div>

          {/* Chips de especialidades + switcher de modo */}
          <div style={{ position:"relative", marginTop:14 }}>
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2, paddingRight:32 }}>
            {categoriasSelecionadas.map(func => {
              const catEntry = Object.entries(CATEGORIAS_NEGOCIO).find(([, info]) => (info.funcoes as readonly string[]).includes(func));
              const cor = catEntry ? catEntry[1].cor : "#FF6B35";
              const icone = catEntry ? catEntry[1].icone : "⚡";
              return (
                <span key={func} style={{ display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap", background:cor+"15", color:cor, padding:"7px 14px", borderRadius:20, fontSize:12, fontWeight:700, border:`1.5px solid ${cor}35`, flexShrink:0 }}>
                  {icone} {func}
                </span>
              );
            })}
          </div>
          {/* Fade + seta indicando scroll */}
          <div style={{ position:"absolute", top:0, right:0, height:"100%", width:48, background:"linear-gradient(to right, transparent, #fff)", pointerEvents:"none", display:"flex", alignItems:"center", justifyContent:"flex-end", paddingRight:4 }}>
            <span style={{ color:"var(--text-3,#94a3b8)", fontSize:14, fontWeight:900 }}>›</span>
          </div>
          </div>
        </div>

        {/* Toasts auto-dismiss */}
        {toastSuccess && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#0f172a", color:"#fff", borderRadius:24, padding:"10px 22px", fontSize:14, fontWeight:700, zIndex:999, boxShadow:"0 4px 20px rgba(0,0,0,.25)", whiteSpace:"nowrap" }}>
            {toastSuccess}
          </div>
        )}
        {toastError && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#dc2626", color:"#fff", borderRadius:24, padding:"10px 22px", fontSize:14, fontWeight:700, zIndex:999, boxShadow:"0 4px 20px rgba(220,38,38,.4)", whiteSpace:"nowrap", maxWidth:"90vw", textAlign:"center" as const }}>
            {toastError}
          </div>
        )}

        {/* ── Banner: selecionado aguardando confirmação ── */}
        {minhasDiarias.filter(d => d.status === "pendente").length > 0 && (
          <div
            style={{ background:"linear-gradient(135deg,#FF6B35,#f59e0b)", margin:"12px 16px 0", borderRadius:18, padding:"16px 18px", display:"flex", alignItems:"center", gap:14, cursor:"pointer", boxShadow:"0 4px 20px rgba(255,107,53,.4)" }}
            onClick={() => setTabDiarista("vagas")}>
            <div style={{ fontSize:32 }}>🎯</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:900, fontSize:16, color:"#fff", lineHeight:1.2 }}>
                Você foi selecionado!
              </div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,.9)", marginTop:3 }}>
                {minhasDiarias.find(d => d.status === "pendente")?.nome_negocio || "Um contratante"} escolheu você — confirme sua presença agora.
              </div>
            </div>
            <div style={{ background:"var(--bg-card,#fff)", color:"#FF6B35", fontWeight:900, fontSize:13, borderRadius:12, padding:"8px 14px", whiteSpace:"nowrap" as const, flexShrink:0 }}>
              Confirmar →
            </div>
          </div>
        )}

        {/* ── Convites diretos pendentes ── */}
        {convitesRecebidos.filter(c => c.status === "pendente").length > 0 && (
          <div style={{ margin:"12px 16px 0" }}>
            <div style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)", marginBottom:8 }}>
              📨 Convites diretos ({convitesRecebidos.filter(c => c.status === "pendente").length})
            </div>
            {convitesRecebidos.filter(c => c.status === "pendente").map(c => (
              <div key={c.id} style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", marginBottom:10, boxShadow:"0 2px 10px rgba(0,0,0,.07)", border:"1.5px solid #FF6B3530" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
                  <div>
                    <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{c.contratante_nome || "Contratante"}</div>
                    <div style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>quer contratar você para <strong>{c.funcao}</strong></div>
                  </div>
                  <span style={{ background:"#fff7ed", color:"#FF6B35", fontSize:10, fontWeight:800, padding:"3px 8px", borderRadius:20, flexShrink:0 }}>Pendente</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:4, fontSize:13, color:"var(--text-label,#475569)", marginBottom:12 }}>
                  <span>📍 {c.local_servico}</span>
                  <span>📅 {new Date(c.data_servico + "T12:00:00").toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" })}</span>
                  <span>🕐 {c.horario_servico}</span>
                  {c.valor && <span>💰 R$ {c.valor}/dia</span>}
                  {c.observacoes && <span>📝 {c.observacoes}</span>}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button
                    style={{ flex:1, background:"#dcfce7", color:"#16a34a", border:"none", borderRadius:10, padding:"10px", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                    onClick={() => responderConvite(c.id, "aceito")}>
                    ✅ Aceitar
                  </button>
                  <button
                    style={{ flex:1, background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:10, padding:"10px", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                    onClick={() => responderConvite(c.id, "recusado")}>
                    ❌ Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── ABA INÍCIO ── */}
        {tabDiarista === "inicio" && (
          <>
            {/* Toggle de disponibilidade — fixo no topo da aba */}
            <div style={{ margin:"12px 16px 0", background:"var(--bg-card,#fff)", borderRadius:14, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 6px rgba(0,0,0,.07)", border:"1.5px solid var(--border,#e2e8f0)" }}>
              <div>
                <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>
                  {disponivelAgora ? "🟢 Disponível agora" : "⚫ Indisponível"}
                </div>
                <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>
                  {disponivelAgora ? "Você aparece para os empregadores" : "Toque para aparecer para empregadores"}
                </div>
              </div>
              <div style={{ ...S.toggle, ...(disponivelAgora ? S.toggleAtivo : {}) }} onClick={handleToggleDisponivel}>
                <div style={{ ...S.toggleThumb, ...(disponivelAgora ? S.toggleThumbAtivo : {}) }} />
              </div>
            </div>

            {/* Stats rápidas: nível + ganhos do mês */}
            {(() => {
              const concl = minhasDiarias.filter(d => d.status === "concluida");
              const mesAtual = new Date().toISOString().slice(0,7);
              const ganhoMes = concl.filter(d => d.data.slice(0,7) === mesAtual).reduce((s,d)=>s+d.valor,0);
              const nivel = nivelDiarista(concl.length);
              // Ranking local: top 5 diaristas por diárias concluídas
              const top5 = Object.entries(diaristasContagemDiarias).sort((a,b)=>b[1]-a[1]).slice(0,5);
              const meuRank = top5.findIndex(([id]) => id === session?.user?.id);
              return (
                <div style={{ margin:"8px 16px 0", display:"flex", gap:8 }}>
                  <div style={{ flex:1, background:"var(--bg-card,#fff)", borderRadius:14, padding:"12px 14px", border:"1.5px solid var(--border,#e2e8f0)", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
                    <div style={{ fontSize:10, color:"var(--text-3,#94a3b8)", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.5 }}>Nível</div>
                    <div style={{ fontWeight:900, fontSize:16, color:nivel.cor, marginTop:2 }}>{nivel.icone} {nivel.nome}</div>
                    <div style={{ fontSize:10, color:"var(--text-2,#64748b)", marginTop:2 }}>{concl.length} diária{concl.length!==1?"s":""} feita{concl.length!==1?"s":""}</div>
                  </div>
                  <div style={{ flex:1, background:"linear-gradient(135deg,#0f172a,#1e3a5f)", borderRadius:14, padding:"12px 14px", border:"none" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,.5)", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.5 }}>Este mês</div>
                    <div style={{ fontWeight:900, fontSize:16, color:"#4ade80", marginTop:2 }}>R$ {ganhoMes.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,.4)", marginTop:2 }}>ganhos do mês</div>
                  </div>
                  {meuRank >= 0 && (
                    <div style={{ flex:1, background:"linear-gradient(135deg,#7c3aed,#FF6B35)", borderRadius:14, padding:"12px 14px" }}>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,.5)", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.5 }}>Ranking CG</div>
                      <div style={{ fontWeight:900, fontSize:16, color:"#fbbf24", marginTop:2 }}>#{meuRank+1}</div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,.4)", marginTop:2 }}>na cidade</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Cabeçalho com contador de novas vagas + filtros ── */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 20px 10px" }}>
              <div>
                <div style={{ fontSize:17, fontWeight:900, color:"var(--text-1,#0f172a)" }}>Vagas pra você</div>
                <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>
                  {novasHoje > 0 ? (
                    <span style={{ color:"#16a34a", fontWeight:800 }}>
                      {novasHoje === 1 ? "1 nova vaga hoje" : `${novasHoje} novas vagas hoje`} na sua região
                    </span>
                  ) : (
                    `${vagasFiltradas.length} ${vagasFiltradas.length === 1 ? "vaga" : "vagas"}`
                  )}
                </div>
              </div>
              <button
                aria-label="Abrir filtros avançados"
                style={{ display:"inline-flex", alignItems:"center", gap:6, background: (sortVagas!=="feed"||filtroDataVaga!=="todas"||filtroRaioKm!==50||filtroValorMin>0) ? "#FF6B35" : "#fff", border:`1.5px solid ${(sortVagas!=="feed"||filtroDataVaga!=="todas"||filtroRaioKm!==50||filtroValorMin>0)?"#FF6B35":"#e2e8f0"}`, borderRadius:10, padding:"8px 14px", fontSize:12, fontWeight:700, color:(sortVagas!=="feed"||filtroDataVaga!=="todas"||filtroRaioKm!==50||filtroValorMin>0)?"#fff":"#475569", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}
                onClick={() => { hapticTick(); setModalFiltro(true); }}>
                <Filter size={14} /> Filtros
              </button>
            </div>

            {/* ── Chips de filtros rápidos (scroll horizontal) ── */}
            <div style={{ padding:"0 16px 8px", display:"flex", gap:6, overflowX:"auto", scrollbarWidth:"none" }}>
              {/* Tipo / função — usa o próprio TODAS_AS_FUNCOES filtrado nas mais comuns */}
              {["Diarista / Faxineira", "Passadeira", "Cozinheira", "Babá", "Motoboy"].map(f => {
                const ativo = categoriasSelecionadas.includes(f);
                return (
                  <button
                    key={f}
                    onClick={() => {
                      hapticTick();
                      setCategorias(prev => ativo ? prev.filter(c => c !== f) : [...prev, f]);
                    }}
                    style={{
                      flexShrink:0, padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
                      border: ativo ? "1.5px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                      background: ativo ? "#FF6B35" : "var(--bg-card,#fff)",
                      color: ativo ? "#fff" : "var(--text-2,#64748b)",
                      fontFamily:"Inter, system-ui, sans-serif",
                    }}>
                    {f}
                  </button>
                );
              })}
              {/* Distância */}
              {[1, 5, 15, 50].map(km => {
                const ativo = filtroRaioKm === km;
                return (
                  <button
                    key={`km${km}`}
                    onClick={() => { hapticTick(); setFiltroRaioKm(km); }}
                    style={{
                      flexShrink:0, padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
                      border: ativo ? "1.5px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                      background: ativo ? "#FF6B35" : "var(--bg-card,#fff)",
                      color: ativo ? "#fff" : "var(--text-2,#64748b)",
                      fontFamily:"Inter, system-ui, sans-serif",
                    }}>
                    até {km} km
                  </button>
                );
              })}
              {/* Valor mínimo */}
              {[0, 100, 150, 200].map(v => {
                const ativo = filtroValorMin === v;
                return (
                  <button
                    key={`val${v}`}
                    onClick={() => { hapticTick(); setFiltroValorMin(v); }}
                    style={{
                      flexShrink:0, padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
                      border: ativo ? "1.5px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                      background: ativo ? "#FF6B35" : "var(--bg-card,#fff)",
                      color: ativo ? "#fff" : "var(--text-2,#64748b)",
                      fontFamily:"Inter, system-ui, sans-serif",
                    }}>
                    {v === 0 ? "Qualquer valor" : `≥ R$ ${v}`}
                  </button>
                );
              })}
            </div>

            <div
              style={{ padding:"0 16px 24px", display:"flex", flexDirection:"column", gap:12, transform:`translateY(${puxando}px)`, transition: puxando === 0 ? "transform .3s" : "none" }}
              onTouchStart={e => {
                if (window.scrollY > 0) return;     // só ativa no topo da página
                ptrStartY.current = e.touches[0].clientY;
              }}
              onTouchMove={e => {
                if (ptrStartY.current === null) return;
                const dy = e.touches[0].clientY - ptrStartY.current;
                if (dy > 0 && window.scrollY === 0) {
                  setPuxando(Math.min(100, dy / 2));   // resistência
                }
              }}
              onTouchEnd={async () => {
                if (puxando > 60 && !recarregandoFeed) {
                  hapticTick();
                  setRecarregandoFeed(true);
                  await carregarFeedVagas();
                  setRecarregandoFeed(false);
                }
                setPuxando(0);
                ptrStartY.current = null;
              }}>
              {/* Indicador de pull-to-refresh */}
              {(puxando > 0 || recarregandoFeed) && (
                <div style={{ position:"absolute", top:-40, left:0, right:0, display:"flex", justifyContent:"center", alignItems:"center", height:36, color:"var(--text-2,#64748b)", fontSize:12, fontWeight:700 }}>
                  {recarregandoFeed
                    ? <><Loader2 size={14} style={{ animation:"loadingSlide 1s linear infinite", marginRight:6 }} /> Atualizando…</>
                    : puxando > 60
                      ? "↑ Solte para atualizar"
                      : "Puxe para atualizar"
                  }
                </div>
              )}
              {vagasFiltradas.length === 0 ? (
                <div style={{ background:"var(--bg-card,#fff)", borderRadius:20, padding:"36px 24px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                  <div style={{ width:80, height:80, borderRadius:40, background:"var(--bg-subtle,#f1f5f9)", display:"inline-flex", alignItems:"center", justifyContent:"center", marginBottom:12 }}>
                    <Inbox size={36} color="var(--text-3,#94a3b8)" strokeWidth={1.5} />
                  </div>
                  <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)", marginBottom:8 }}>Nenhuma vaga no momento</div>
                  <div style={{ color:"var(--text-2,#64748b)", fontSize:13, lineHeight:1.6, marginBottom:16 }}>
                    Ainda não há vagas para sua especialidade por aqui. Indique a plataforma para empregadores da sua cidade!
                  </div>
                  <button
                    style={{ background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, padding:"12px 24px", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 14px rgba(255,107,53,.4)" }}
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({ title:"DiáriaJá", text:"Encontre mão de obra qualificada no DiáriaJá!", url:"https://diariaja.vercel.app" });
                      } else {
                        navigator.clipboard?.writeText("https://diariaja.vercel.app");
                        setToastSuccess("🔗 Link copiado!");
                      }
                    }}>
                    📨 Indicar para empregadores
                  </button>
                </div>
              ) : (
                vagasFiltradas.map(dia => {
                  const segInfo = CATEGORIAS_NEGOCIO[dia.segmento as keyof typeof CATEGORIAS_NEGOCIO];
                  const cor = segInfo?.cor || "#FF6B35";
                  const iniciais = empresaIniciais(dia.nome_negocio || dia.segmento);
                  const dataFmt = formatData(dia.data);
                  const [h1, m1] = dia.horario_inicio.split(":");
                  const [h2, m2] = dia.horario_fim.split(":");
                  const minTotal = (parseInt(h2)*60+parseInt(m2)) - (parseInt(h1)*60+parseInt(m1));
                  const duracao = minTotal > 0 ? ` · ${Math.floor(minTotal/60)}h${minTotal%60>0?String(minTotal%60).padStart(2,"0")+"min":""}` : "";
                  const funcCatEntry = Object.entries(CATEGORIAS_NEGOCIO).find(([, info]) => (info.funcoes as readonly string[]).includes(dia.funcao));
                  const funcCor = funcCatEntry ? funcCatEntry[1].cor : "#64748b";

                  return (
                    <div key={dia.id}
                      style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,.07)", cursor:"pointer" }}
                      onClick={() => { setVagaConfirm(dia); setVagaConfirmada(false); }}>

                      <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                        {/* Logo empresa — foto ou iniciais */}
                        {(() => {
                          const emp = empregadoresProfiles[dia.empregador_id];
                          const fotoEmpStorage = supabase.storage.from("avatars").getPublicUrl(`${dia.empregador_id}.jpg`).data.publicUrl;
                          const fotoEmpSrc = emp?.foto_url || fotoEmpStorage;
                          return (
                            <button
                              aria-label={`Ver perfil de ${emp?.nome || dia.nome_negocio || "contratante"}`}
                              onClick={e => { e.stopPropagation(); abrirPerfilEmpregador(dia.empregador_id); }}
                              style={{ position:"relative", width:60, height:60, flexShrink:0, padding:0, background:"transparent", border:"none", cursor:"pointer", borderRadius:30 }}>
                              <div style={{ width:60, height:60, borderRadius:30, background:cor, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:iniciais.length > 2 ? 18 : 22, boxShadow:`0 4px 12px ${cor}55`, letterSpacing:"-1px" }}>
                                {iniciais}
                              </div>
                              <img src={fotoEmpSrc} alt="" onError={e => { (e.target as HTMLImageElement).style.display="none"; }}
                                style={{ position:"absolute", inset:0, width:60, height:60, borderRadius:30, objectFit:"cover" as const, border:`3px solid ${cor}` }} />
                            </button>
                          );
                        })()}

                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)", lineHeight:1.3 }}>
                                {dia.nome_negocio || dia.segmento}
                              </div>
                              {/* Bairro + tempo desde publicação */}
                              <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--text-2,#64748b)", marginTop:2 }}>
                                {dia.bairro && (
                                  <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                                    <MapPin size={11} /> {dia.bairro}
                                  </span>
                                )}
                                {dia.bairro && dia.created_at && <span>·</span>}
                                {dia.created_at && (
                                  <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                                    <Clock size={11} /> {formatTempoRelativo(dia.created_at)}
                                  </span>
                                )}
                              </div>
                              {/* Reputação pública do empregador — só aparece com >=1 avaliação */}
                              {(() => {
                                const rep = reputacaoEmp[dia.empregador_id];
                                if (!rep || !rep.total_avaliacoes) {
                                  return (
                                    <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:600, marginTop:3 }}>
                                      <Clock size={11} /> Contratante novo
                                    </div>
                                  );
                                }
                                return (
                                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:3, flexWrap:"wrap" }}>
                                    <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:12, fontWeight:800, color:"#d97706" }}>
                                      <Star size={12} fill="#d97706" strokeWidth={0} /> {rep.nota_media?.toFixed?.(1) ?? rep.nota_media}
                                    </span>
                                    <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>
                                      ({rep.total_avaliacoes})
                                    </span>
                                    {typeof rep.pct_pagou_combinado === "number" && rep.pct_pagou_combinado >= 80 && (
                                      <span title="Paga o combinado" style={{ display:"inline-flex", alignItems:"center", gap:3, background:"#dcfce7", color:"#16a34a", borderRadius:10, padding:"2px 7px", fontSize:10, fontWeight:800 }}>
                                        <Wallet size={10} /> Paga certo
                                      </span>
                                    )}
                                    {typeof rep.pct_cumpriu_combinado === "number" && rep.pct_cumpriu_combinado >= 80 && (
                                      <span title="Cumpre o combinado" style={{ display:"inline-flex", alignItems:"center", gap:3, background:"#dbeafe", color:"#1d4ed8", borderRadius:10, padding:"2px 7px", fontSize:10, fontWeight:800 }}>
                                        <CheckCircle2 size={10} /> Cumpre
                                      </span>
                                    )}
                                    {typeof rep.pct_pagou_combinado === "number" && rep.pct_pagou_combinado < 50 && (
                                      <span title="Histórico de não pagamento" style={{ display:"inline-flex", alignItems:"center", gap:3, background:"#fee2e2", color:"#dc2626", borderRadius:10, padding:"2px 7px", fontSize:10, fontWeight:800 }}>
                                        <AlertTriangle size={10} /> Atenção
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5, flexWrap:"wrap" }}>
                                {dia.funcao && (
                                  <span style={{ background:funcCor+"18", color:funcCor, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, border:`1px solid ${funcCor}30` }}>
                                    {dia.funcao}
                                  </span>
                                )}
                                <span style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>· {dia.segmento}</span>
                              </div>
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                              <div style={{ fontWeight:900, fontSize:22, color:"#FF6B35", lineHeight:1 }}>R$ {dia.valor}</div>
                              <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>/dia</div>
                            </div>
                          </div>

                          <div style={{ color:"var(--text-2,#64748b)", fontSize:12, marginTop:8, display:"flex", alignItems:"center", gap:4 }}>
                            <span>📅</span>
                            <span>{dataFmt} · {dia.horario_inicio.slice(0,5)} às {dia.horario_fim.slice(0,5)}{duracao}</span>
                          </div>

                          <div style={{ color:"var(--text-3,#94a3b8)", fontSize:12, marginTop:4, display:"flex", alignItems:"center", gap:4 }}>
                            <span>📍</span>
                            {(() => {
                              const partes = (dia.endereco || "").split(", ");
                              const localHint = partes.length >= 3 ? partes.slice(2, 4).join(", ").split(" — ")[0] : "";
                              if (profile?.lat && profile?.lng && dia.lat && dia.lng) {
                                const km = haversineKm(profile.lat!, profile.lng!, dia.lat!, dia.lng!);
                                const distTxt = `${formatarDistancia(km)} · ~${formatarTempo(tempoEstimadoMin(km))} de moto`;
                                return (
                                  <span>
                                    <span style={{ fontWeight:800, color:"#FF6B35" }}>{distTxt}</span>
                                    {localHint ? <span style={{ color:"var(--text-3,#94a3b8)" }}> · {localHint}</span> : null}
                                  </span>
                                );
                              }
                              // Sem GPS: mostra bairro/cidade se disponível
                              if (localHint) return <span style={{ color:"var(--text-2,#64748b)", fontWeight:600 }}>{localHint}</span>;
                              return <span style={{ fontStyle:"italic", color:"var(--text-3,#94a3b8)" }}>Bairro liberado após aceitar</span>;
                            })()}
                          </div>

                          {/* Delivery info block */}
                          {FUNCOES_DELIVERY.includes(dia.funcao) && (dia.valor_encostada || dia.valor_por_entrega || dia.ganho_estimado_dia) && (
                            <div style={{ background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:12, padding:"9px 12px", marginTop:10, display:"flex", gap:12, flexWrap:"wrap" }}>
                              {dia.valor_por_entrega && (
                                <div style={{ textAlign:"center" }}>
                                  <div style={{ fontSize:11, color:"#92400e", fontWeight:600 }}>Por entrega</div>
                                  <div style={{ fontSize:15, fontWeight:900, color:"#ea580c" }}>R$ {dia.valor_por_entrega}</div>
                                </div>
                              )}
                              {dia.ganho_estimado_dia && (
                                <div style={{ textAlign:"center" }}>
                                  <div style={{ fontSize:11, color:"#92400e", fontWeight:600 }}>Estimativa/dia</div>
                                  <div style={{ fontSize:15, fontWeight:900, color:"#ea580c" }}>R$ {dia.ganho_estimado_dia}</div>
                                </div>
                              )}
                            </div>
                          )}

                          <div style={{ marginTop:12 }}>
                            {(() => {
                              const st = meuInteresse[dia.id];
                              if (st === "pendente") return (
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ background:"#dcfce7", color:"#15803d", borderRadius:12, padding:"10px 14px", fontWeight:700, fontSize:13, flex:1, textAlign:"center" as const }}>
                                    ✅ Interesse enviado
                                  </div>
                                  <button
                                    style={{ background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:12, padding:"10px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                                    title="Retirar candidatura"
                                    onClick={e => { e.stopPropagation(); retirarInteresse(dia.id); }}>
                                    Desistir
                                  </button>
                                </div>
                              );
                              if (st === "selecionado") return (
                                <button
                                  style={{ width:"100%", background:"linear-gradient(135deg,#FF6B35,#f59e0b)", color:"#fff", border:"none", borderRadius:12, padding:"12px 18px", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 12px rgba(255,107,53,.4)" }}
                                  onClick={e => { e.stopPropagation(); setVagaConfirm(dia); setVagaConfirmada(false); }}>
                                  🎯 Confirmar presença!
                                </button>
                              );
                              if (st === "rejeitado") return (
                                <div style={{ background:"#fee2e2", color:"#dc2626", borderRadius:12, padding:"10px 18px", fontWeight:700, fontSize:12, textAlign:"center" as const }}>
                                  Não selecionado desta vez
                                </div>
                              );
                              if (st === "confirmado") return (
                                <div style={{ background:"#dcfce7", color:"#16a34a", borderRadius:12, padding:"10px 18px", fontWeight:700, fontSize:13, textAlign:"center" as const }}>
                                  ✅ Presença confirmada
                                </div>
                              );
                              // Sem ação ainda: botão principal + ações secundárias
                              return (
                                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                                  <button
                                    style={{ width:"100%", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, padding:"12px 22px", fontWeight:800, fontSize:14, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 12px rgba(255,107,53,.4)" }}
                                    onClick={e => { e.stopPropagation(); setVagaConfirm(dia); setVagaConfirmada(false); }}>
                                    ✋ Tenho interesse
                                  </button>
                                  <div style={{ display:"flex", gap:8 }}>
                                    <button
                                      style={{ flex:1, background:"#f1f5f9", color:"#64748b", border:"1.5px solid #e2e8f0", borderRadius:12, padding:"9px 10px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}
                                      onClick={e => { e.stopPropagation(); marcarNaoInteresse(dia.id); }}>
                                      👎 Não tenho interesse
                                    </button>
                                    <button
                                      style={{ background:"#fef2f2", color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:12, padding:"9px 12px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}
                                      onClick={e => { e.stopPropagation(); setModalDenunciar({ tipo:"vaga", id:dia.id, nome: dia.nome_negocio || dia.segmento }); setMotivoDenuncia(""); }}>
                                      ⚑ Denunciar
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── ABA MINHAS DIÁRIAS ── */}
        {tabDiarista === "vagas" && (() => {
          const paraConfirmar = minhasDiarias.filter(d => d.status === "pendente");
          const pendentes    = minhasDiarias.filter(d => d.status === "aceita");
          const emAndamento  = minhasDiarias.filter(d => d.status === "em_andamento");
          const concluidas   = minhasDiarias.filter(d => d.status === "concluida");
          // Canceladas: só mostra se o cancelamento ocorreu nas últimas 24h (via localStorage)
          // Leitura feita UMA VEZ por render da aba, não por item
          const VINTE_QUATRO_H = 24 * 60 * 60 * 1000;
          const agora = Date.now();
          let cancelTimestamps: Record<string,number> = {};
          try { cancelTimestamps = JSON.parse(localStorage.getItem("diariaja_cancels") || "{}"); } catch {}
          const canceladas = minhasDiarias.filter(d => {
            if (d.status !== "cancelada") return false;
            const ts = cancelTimestamps[d.id];
            if (!ts) return false; // sem timestamp = já passou ou nunca registrado → não mostra
            return agora - ts < VINTE_QUATRO_H;
          });
          const ganhoTotal   = concluidas.reduce((s, d) => s + d.valor, 0);

          const fmtData = (data: string) => {
            const d = new Date(data + "T12:00:00");
            const hj = new Date(); hj.setHours(0,0,0,0);
            const am = new Date(hj); am.setDate(hj.getDate()+1);
            if (d.toDateString()===hj.toDateString()) return "Hoje";
            if (d.toDateString()===am.toDateString()) return "Amanhã";
            return d.toLocaleDateString("pt-BR");
          };

          const stMap: Record<string,{bg:string,color:string,txt:string,borda:string}> = {
            pendente:     { bg:"#fef3c7", color:"#d97706", txt:"🎯 Confirme sua presença",       borda:"#f59e0b" },
            aceita:       { bg:"#ede9fe", color:"#7c3aed", txt:"✅ Confirmado — aguardando QR",   borda:"#8b5cf6" },
            em_andamento: { bg:"#fef3c7", color:"#d97706", txt:"🔄 Em andamento",                borda:"#f59e0b" },
            concluida:    { bg:"#dcfce7", color:"#16a34a", txt:"✅ Concluída",                    borda:"#22c55e" },
            cancelada:    { bg:"#fee2e2", color:"#dc2626", txt:"✗ Cancelada",                    borda:"#ef4444" },
          };

          const CardDiaria = ({ dia }: { dia: Diaria }) => {
            const segInfo = CATEGORIAS_NEGOCIO[dia.segmento as keyof typeof CATEGORIAS_NEGOCIO];
            const cor = segInfo?.cor || "#FF6B35";
            const [h1,m1] = dia.horario_inicio.split(":");
            const [h2,m2] = dia.horario_fim.split(":");
            const min = (parseInt(h2)*60+parseInt(m2))-(parseInt(h1)*60+parseInt(m1));
            const dur = min>0 ? `${Math.floor(min/60)}h${min%60>0?String(min%60).padStart(2,"0")+"min":""}` : "";
            const st = stMap[dia.status] ?? stMap.aceita;
            const mostrarQR = dia.status === "aceita" || dia.status === "em_andamento";
            return (
              <div
                style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,.07)", borderLeft:`4px solid ${st.borda}`, cursor:"pointer" }}
                onClick={() => setDetalhesDiaria(dia)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                  <div style={{ flex:1, paddingRight:8 }}>
                    <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)", lineHeight:1.3 }}>{dia.nome_negocio || dia.segmento}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5, flexWrap:"wrap" as const }}>
                      {dia.funcao && (
                        <span style={{ background:cor+"18", color:cor, padding:"2px 9px", borderRadius:20, fontSize:11, fontWeight:700 }}>{dia.funcao}</span>
                      )}
                      <span style={{ background:st.bg, color:st.color, padding:"2px 9px", borderRadius:20, fontSize:11, fontWeight:700 }}>{st.txt}</span>
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontWeight:900, fontSize:20, color: dia.status==="concluida" ? "#22c55e" : "#FF6B35", lineHeight:1 }}>R$ {dia.valor}</div>
                    <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>/dia</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:14, fontSize:12, color:"var(--text-2,#64748b)", flexWrap:"wrap" as const }}>
                  <span>📅 {fmtData(dia.data)}</span>
                  <span>🕐 {dia.horario_inicio.slice(0,5)}–{dia.horario_fim.slice(0,5)}{dur ? ` · ${dur}` : ""}</span>
                </div>
                {/* Endereço — visível apenas após aceitar */}
                {dia.endereco && (dia.status === "aceita" || dia.status === "em_andamento" || dia.status === "concluida") && (
                  <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginTop:8, background:"#f0fdf4", borderRadius:10, padding:"8px 12px" }}>
                    <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>📍</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, color:"var(--text-1,#0f172a)", fontWeight:600, lineHeight:1.4 }}>{dia.endereco}</div>
                      {dia.lat && dia.lng && (
                        <a
                          href={`https://www.google.com/maps?q=${dia.lat},${dia.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize:11, color:"#16a34a", fontWeight:700, textDecoration:"none", marginTop:2, display:"inline-block" }}>
                          🗺️ Abrir no Google Maps →
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {/* Separador antes dos botões */}
                {mostrarQR && <div style={{ marginBottom:8 }} />}
                {/* Botão QR para diárias pendentes e em andamento */}
                {mostrarQR && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <button
                      style={{ width:"100%", padding:"11px", background:"#0f172a", color:"#fff", border:"none", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
                      onClick={e => { e.stopPropagation(); setQrDiaria(dia); }}>
                      📲 Mostrar QR Code para o empregador
                    </button>
                    {dia.status === "aceita" && (
                      <button
                        style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:"4px 0", textAlign:"center" as const, width:"100%", textDecoration:"underline" }}
                        onClick={e => { e.stopPropagation(); setModalDesistir(dia); setMotivoDesistencia(""); }}>
                        Cancelar diária
                      </button>
                    )}
                  </div>
                )}
                {/* Motivo do cancelamento + lixeirinha */}
                {dia.status === "cancelada" && (
                  <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginTop:4 }}>
                    {dia.motivo_cancelamento && (
                      <div style={{ flex:1, background:"#fee2e2", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#dc2626" }}>
                        <strong>Motivo:</strong> {dia.motivo_cancelamento}
                      </div>
                    )}
                    <button
                      style={{ background:"#fee2e2", border:"none", borderRadius:10, padding:"8px 10px", fontSize:15, cursor:"pointer", flexShrink:0, color:"#dc2626" }}
                      title="Excluir permanentemente"
                      onClick={e => { e.stopPropagation(); excluirDiariaLocal(dia.id); }}>
                      🗑️
                    </button>
                  </div>
                )}
                {/* Botão avaliar empregador e recibo após conclusão */}
                {dia.status === "concluida" && (
                  <>
                    <button
                      style={{ width:"100%", padding:"10px", background:"#f0fdf4", color:"#16a34a", border:"1.5px solid #86efac", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:4, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                      onClick={e => { e.stopPropagation(); setModalReciboDiarista(dia); }}>
                      🧾 Meu Recibo
                    </button>
                    {avaliadosDiarias.has(dia.id) ? (
                      <div style={{ textAlign:"center", fontSize:12, color:"#16a34a", fontWeight:700, marginTop:4 }}>⭐ Avaliação enviada!</div>
                    ) : (
                      <button
                        style={{ width:"100%", padding:"10px", background:"#fef3c7", color:"#d97706", border:"1.5px solid #fde68a", borderRadius:12, fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:4 }}
                        onClick={e => { e.stopPropagation(); setModalAvalEmp(dia); setNotaEmp(0); setComentarioEmp(""); }}>
                        ⭐ Avaliar o empregador
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          };

          return (
            <div style={{ padding:"16px 16px 32px" }}>

              {/* Banner de ganho acumulado */}
              <div style={{ background:"linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)", borderRadius:22, padding:"22px 20px 18px", marginBottom:20, position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:-30, right:-30, width:110, height:110, background:"rgba(255,107,53,.15)", borderRadius:"50%", pointerEvents:"none" }} />
                <div style={{ position:"absolute", bottom:-20, left:-20, width:80, height:80, background:"rgba(93,95,239,.15)", borderRadius:"50%", pointerEvents:"none" }} />
                <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.8, marginBottom:4 }}>💰 Ganho acumulado</div>
                {concluidas.length === 0 ? (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:16, fontWeight:900, color:"#fff", lineHeight:1.4, marginBottom:4 }}>
                      Sua primeira diária pode render <span style={{ color:"#FF6B35" }}>R$ 150!</span>
                    </div>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,.55)", lineHeight:1.5 }}>
                      Ative sua disponibilidade e comece a receber propostas.
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize:40, fontWeight:900, color:"#FF6B35", lineHeight:1, marginBottom:16 }}>
                    R$ {ganhoTotal.toLocaleString("pt-BR", { minimumFractionDigits:2 })}
                  </div>
                )}
                <div style={{ display:"flex", gap:0 }}>
                  {(() => {
                    const hojeFmt = new Date().toISOString().split("T")[0];
                    const aceitasHoje = minhasDiarias.filter(d => d.data === hojeFmt && (d.status === "aceita" || d.status === "em_andamento"));
                    return [
                      { n:concluidas.length,  label:"Concluídas",  cor:"#4ade80" },
                      { n:aceitasHoje.length, label:"Aceitas hoje", cor:"#60a5fa" },
                    ].map((item, i) => (
                      <div key={item.label} style={{ flex:1, textAlign:"center", borderLeft: i>0 ? "1px solid rgba(255,255,255,.1)" : "none", padding:"0 8px" }}>
                        <div style={{ fontWeight:900, fontSize:22, color:item.cor, lineHeight:1 }}>{item.n}</div>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginTop:3 }}>{item.label}</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Aguardando confirmação — selecionado pelo empregador */}
              {paraConfirmar.length > 0 && (
                <>
                  <div style={{ background:"linear-gradient(135deg,#FF6B35,#f59e0b)", borderRadius:16, padding:"14px 16px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
                    <span style={{ fontSize:28 }}>🎯</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:900, fontSize:15, color:"#fff" }}>Você foi selecionado!</div>
                      <div style={{ fontSize:12, color:"rgba(255,255,255,.85)", marginTop:2 }}>Confirme sua presença para garantir a vaga</div>
                    </div>
                    <span style={{ background:"var(--bg-card,#fff)", color:"#FF6B35", fontWeight:900, fontSize:14, borderRadius:20, padding:"2px 10px" }}>{paraConfirmar.length}</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
                    {paraConfirmar.map(d => (
                      <div key={d.id} style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,.1)", border:"2px solid #f59e0b" }}>
                        <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)", marginBottom:4 }}>{d.nome_negocio || d.segmento}</div>
                        <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:12 }}>
                          {d.funcao && <span>👷 {d.funcao} · </span>}
                          📅 {new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR")} · 🕐 {d.horario_inicio.slice(0,5)}–{d.horario_fim.slice(0,5)}
                        </div>
                        <div style={{ fontWeight:900, fontSize:18, color:"#FF6B35", marginBottom:12 }}>R$ {d.valor}/dia</div>
                        <button
                          style={{ width:"100%", padding:"13px", background:"#22c55e", color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:"0 4px 12px rgba(34,197,94,.4)", opacity:confirmando?0.6:1 }}
                          disabled={confirmando}
                          onClick={() => confirmarPresenca(d)}>
                          {confirmando ? "Confirmando..." : "✅ Confirmar minha presença"}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Em andamento */}
              {emAndamento.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:800, color:"#d97706", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>🔄 Em andamento agora</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
                    {emAndamento.map(d => <CardDiaria key={d.id} dia={d} />)}
                  </div>
                </>
              )}

              {/* Aguardando início */}
              {pendentes.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>⏳ Aguardando início</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
                    {pendentes.map(d => <CardDiaria key={d.id} dia={d} />)}
                  </div>
                </>
              )}

              {/* Concluídas */}
              {concluidas.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>✅ Concluídas</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
                    {concluidas.map(d => <CardDiaria key={d.id} dia={d} />)}
                  </div>
                </>
              )}

              {/* Canceladas */}
              {canceladas.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>✗ Canceladas</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {canceladas.map(d => <CardDiaria key={d.id} dia={d} />)}
                  </div>
                </>
              )}

              {minhasDiarias.length === 0 && (
                <div style={{ background:"var(--bg-card,#fff)", borderRadius:20, padding:"36px 20px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                  <div style={{ fontSize:52, marginBottom:12 }}>📋</div>
                  <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)", marginBottom:6 }}>Nenhuma diária ainda</div>
                  <div style={{ color:"var(--text-3,#94a3b8)", fontSize:13, lineHeight:1.5 }}>
                    Aceite vagas na aba <strong>Home</strong> e elas aparecerão aqui com seu histórico de ganhos.
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── ABA AGENDA ── */}
        {tabDiarista === "agenda" && (() => {
          // Separa diárias agendadas (aceitas e em andamento) por data
          const agendadas = [...minhasDiarias]
            .filter(d => d.status === "aceita" || d.status === "em_andamento")
            .sort((a, b) => a.data.localeCompare(b.data));

          const hoje = new Date(); hoje.setHours(0,0,0,0);

          const fmtDiaSemana = (data: string) => {
            const d = new Date(data + "T12:00:00");
            const hj = new Date(); hj.setHours(0,0,0,0);
            const am = new Date(hj); am.setDate(hj.getDate()+1);
            if (d.toDateString()===hj.toDateString()) return "Hoje";
            if (d.toDateString()===am.toDateString()) return "Amanhã";
            return d.toLocaleDateString("pt-BR", { weekday:"long" });
          };
          const fmtData = (data: string) =>
            new Date(data + "T12:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"long" });

          // Agrupa por mês para exibição
          const porMes: Record<string, Diaria[]> = {};
          agendadas.forEach(d => {
            const mes = new Date(d.data + "T12:00:00").toLocaleDateString("pt-BR", { month:"long", year:"numeric" });
            if (!porMes[mes]) porMes[mes] = [];
            porMes[mes].push(d);
          });

          return (
            <div style={{ padding:"16px 16px 32px" }}>

              {/* Toggle disponibilidade */}
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>Disponível agora</div>
                  <div style={{ fontSize:12, color:"var(--text-3,#94a3b8)", marginTop:2 }}>Apareça para os empregadores</div>
                </div>
                <div style={{ ...S.toggle, ...(disponivelAgora?S.toggleAtivo:{}) }} onClick={handleToggleDisponivel}>
                  <div style={{ ...S.toggleThumb, ...(disponivelAgora?S.toggleThumbAtivo:{}) }} />
                </div>
              </div>

              {/* Dias disponíveis */}
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", marginBottom:20, boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>Dias que costumo trabalhar</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" as const }}>
                  {DIAS.map(dia=>(
                    <button key={dia} style={{ ...S.diaBtn, ...(agendaSelecionada.includes(dia)?S.diaBtnAtivo:{}) }} onClick={()=>handleToggleDia(dia)}>{DIAS_LABEL[dia]}</button>
                  ))}
                </div>
              </div>

              {/* Diárias agendadas */}
              <div style={{ fontSize:11, fontWeight:800, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:12 }}>
                📅 Diárias agendadas · {agendadas.length}
              </div>

              {agendadas.length === 0 ? (
                <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"32px 20px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                  <div style={{ fontSize:40, marginBottom:10 }}>📭</div>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:6 }}>Nenhuma diária agendada</div>
                  <div style={{ color:"var(--text-3,#94a3b8)", fontSize:13, lineHeight:1.5 }}>Quando aceitar vagas, elas aparecerão aqui como compromissos.</div>
                </div>
              ) : (
                Object.entries(porMes).map(([mes, dias]) => (
                  <div key={mes} style={{ marginBottom:20 }}>
                    {/* Cabeçalho do mês */}
                    <div style={{ fontSize:12, fontWeight:800, color:"#FF6B35", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10, paddingLeft:4 }}>
                      {mes}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                      {dias.map(dia => {
                        const segInfo = CATEGORIAS_NEGOCIO[dia.segmento as keyof typeof CATEGORIAS_NEGOCIO];
                        const cor = segInfo?.cor || "#FF6B35";
                        const diaSemana = fmtDiaSemana(dia.data);
                        const dataFmt = fmtData(dia.data);
                        const isHoje = new Date(dia.data + "T12:00:00").toDateString() === hoje.toDateString();
                        const [h1,m1] = dia.horario_inicio.split(":");
                        const [h2,m2] = dia.horario_fim.split(":");
                        const min = (parseInt(h2)*60+parseInt(m2))-(parseInt(h1)*60+parseInt(m1));
                        const dur = min>0 ? `${Math.floor(min/60)}h${min%60>0?String(min%60).padStart(2,"0")+"min":""}` : "";
                        return (
                          <div key={dia.id} style={{ background:"var(--bg-card,#fff)", borderRadius:18, overflow:"hidden", boxShadow:"0 2px 10px rgba(0,0,0,.07)", display:"flex" }}>
                            {/* Coluna de data */}
                            <div style={{ width:64, background: isHoje ? "#FF6B35" : cor, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"14px 8px", flexShrink:0 }}>
                              <div style={{ fontSize:22, fontWeight:900, color:"#fff", lineHeight:1 }}>
                                {new Date(dia.data + "T12:00:00").getDate()}
                              </div>
                              <div style={{ fontSize:10, color:"rgba(255,255,255,.8)", fontWeight:700, marginTop:2, textTransform:"uppercase" as const }}>
                                {new Date(dia.data + "T12:00:00").toLocaleDateString("pt-BR", { month:"short" }).replace(".","").toUpperCase()}
                              </div>
                              {isHoje && <div style={{ fontSize:9, color:"#fff", fontWeight:900, marginTop:4, background:"rgba(0,0,0,.2)", borderRadius:8, padding:"1px 5px" }}>HOJE</div>}
                            </div>
                            {/* Conteúdo */}
                            <div style={{ flex:1, padding:"12px 14px" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                                <div style={{ flex:1 }}>
                                  <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)", lineHeight:1.3 }}>
                                    {dia.nome_negocio || dia.segmento}
                                  </div>
                                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:3 }}>
                                    {diaSemana}{!isHoje && `, ${dataFmt}`}
                                  </div>
                                </div>
                                <span style={{ background: dia.status==="em_andamento" ? "#fef3c7" : "#dbeafe", color: dia.status==="em_andamento" ? "#d97706" : "#1d4ed8", padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:800, flexShrink:0, marginLeft:8 }}>
                                  {dia.status==="em_andamento" ? "🔄 Agora" : "✓ Conf."}
                                </span>
                              </div>
                              <div style={{ display:"flex", gap:10, marginTop:8, flexWrap:"wrap" as const }}>
                                <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:12, color:"var(--text-label,#475569)" }}>
                                  🕐 {dia.horario_inicio.slice(0,5)}–{dia.horario_fim.slice(0,5)}{dur ? ` · ${dur}` : ""}
                                </span>
                                {dia.funcao && (
                                  <span style={{ background:cor+"18", color:cor, padding:"1px 8px", borderRadius:20, fontSize:11, fontWeight:700 }}>{dia.funcao}</span>
                                )}
                              </div>
                              {/* Endereço no card da Agenda */}
                              {dia.endereco && (
                                <div style={{ display:"flex", alignItems:"flex-start", gap:5, marginTop:8, background:"#f0fdf4", borderRadius:8, padding:"6px 10px" }}>
                                  <span style={{ fontSize:12, flexShrink:0 }}>📍</span>
                                  <div style={{ flex:1 }}>
                                    <div style={{ fontSize:12, color:"var(--text-1,#0f172a)", fontWeight:600, lineHeight:1.3 }}>{dia.endereco}</div>
                                    {dia.lat && dia.lng && (
                                      <a
                                        href={`https://www.google.com/maps?q=${dia.lat},${dia.lng}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ fontSize:10, color:"#16a34a", fontWeight:700, textDecoration:"none" }}>
                                        Abrir no Maps →
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
                              {dia.descricao && (
                                <div style={{ marginTop:8, fontSize:12, color:"var(--text-2,#64748b)", lineHeight:1.5, background:"var(--bg-surface,#f8fafc)", borderRadius:8, padding:"6px 10px" }}>
                                  📝 {dia.descricao}
                                </div>
                              )}
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
                                <span style={{ fontWeight:900, fontSize:15, color:"#FF6B35" }}>R$ {dia.valor}<span style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:400 }}>/dia</span></span>
                                <button
                                  style={{ background:"#0f172a", color:"#fff", border:"none", borderRadius:10, padding:"6px 12px", fontSize:11, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                                  onClick={() => setQrDiaria(dia)}>
                                  📲 QR Code
                                </button>
                              </div>
                              {/* Botão Desistir — só para diárias ainda não iniciadas */}
                              {dia.status === "aceita" && (
                                <button
                                  style={{ width:"100%", marginTop:10, padding:"9px", background:"var(--bg-card,#fff)", color:"#ef4444", border:"1.5px solid #fca5a5", borderRadius:10, fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                                  onClick={() => { setModalDesistir(dia); setMotivoDesistencia(""); }}>
                                  🚪 Desistir desta diária
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })()}

        {/* ── ABA CHAT DIARISTA ── */}
        {tabDiarista === "chat" && (() => {
          if (chatDiariaAtiva) {
            return (
              <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 130px)", position:"relative" }}>
                {/* Header */}
                <div style={{ background:"var(--bg-card,#fff)", padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px rgba(0,0,0,.07)", flexShrink:0 }}>
                  <button style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", padding:"0 4px" }} onClick={() => { setChatDiariaAtiva(null); setConfirmExcluirChat(false); }}>←</button>
                  <div style={{ width:40, height:40, borderRadius:20, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:14, flexShrink:0 }}>
                    {(chatDiariaAtiva.nome_negocio || chatDiariaAtiva.segmento).slice(0,2).toUpperCase()}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{chatDiariaAtiva.nome_negocio || chatDiariaAtiva.segmento}</div>
                    <div style={{ fontSize:11, color: outroDigitando ? "#16a34a" : "var(--text-2,#64748b)", fontWeight: outroDigitando ? 700 : 400 }}>
                      {outroDigitando ? "digitando…" : `${chatDiariaAtiva.funcao} · ${new Date(chatDiariaAtiva.data+"T12:00:00").toLocaleDateString("pt-BR")}`}
                    </div>
                  </div>
                  {!confirmExcluirChat
                    ? <button style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", padding:"4px 6px", color:"var(--text-3,#94a3b8)" }} title="Excluir conversa" onClick={() => setConfirmExcluirChat(true)}>🗑️</button>
                    : <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                        <span style={{ fontSize:12, color:"#dc2626", fontWeight:700 }}>Excluir?</span>
                        <button style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => excluirChat(chatDiariaAtiva.id)}>Sim</button>
                        <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setConfirmExcluirChat(false)}>Não</button>
                      </div>
                  }
                </div>
                {/* Mensagens */}
                <div style={{ flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10, background:"var(--bg-app,#f0f2f5)" }}>
                  {mensagensReais.length === 0 && (
                    <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:13, marginTop:40 }}>Nenhuma mensagem ainda. 👋</div>
                  )}
                  {mensagensReais.map(m => {
                    const isMeu = m.remetente_id === session?.user?.id;
                    return (
                      <div key={m.id} style={{ display:"flex", justifyContent: isMeu ? "flex-end" : "flex-start" }}>
                        <div style={{ background: isMeu ? "#FF6B35" : "var(--bg-card,#fff)", color: isMeu ? "#fff" : "var(--text-1,#0f172a)", borderRadius: isMeu ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding:"10px 14px", maxWidth:"75%", fontSize:14, boxShadow:"0 1px 4px rgba(0,0,0,.1)", lineHeight:1.5 }}>
                          {m.conteudo}
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4, fontSize:10, opacity:.7, marginTop:4 }}>
                            <span>{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" })}</span>
                            {isMeu && (
                              m.lida_em
                                ? <span title="Lida" style={{ display:"inline-flex", color:"#bbf7d0", fontSize:11, fontWeight:800 }}>✓✓</span>
                                : <span title="Enviada" style={{ display:"inline-flex", color:"#fff", opacity:.6, fontSize:11, fontWeight:800 }}>✓</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={mensagensEndRef} />
                </div>
                {/* Input */}
                <div style={{ background:"var(--bg-card,#fff)", padding:"12px 16px", display:"flex", gap:10, alignItems:"center", borderTop:"1px solid var(--border,#e2e8f0)", flexShrink:0 }}>
                  <input
                    style={{ flex:1, padding:"12px 16px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:24, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", outline:"none" }}
                    placeholder="Digite uma mensagem..."
                    value={msgInputReal}
                    onChange={e => { setMsgInputReal(e.target.value); sinalizarDigitando(); }}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && enviarMensagemReal()}
                  />
                  <button
                    aria-label="Enviar mensagem"
                    style={{ width:44, height:44, borderRadius:22, background: msgInputReal.trim() ? "#FF6B35" : "#e2e8f0", border:"none", color:"#fff", cursor: msgInputReal.trim() ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}
                    disabled={!msgInputReal.trim() || enviandoMsgReal}
                    onClick={enviarMensagemReal}>
                    <Send size={18} />
                  </button>
                </div>
                {antiExitAviso && (
                  <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.7)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                    <div style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"28px 24px 32px", width:"100%", maxWidth:480 }}>
                      <div style={{ fontSize:36, textAlign:"center", marginBottom:10 }}>🛡️</div>
                      <div style={{ fontWeight:900, fontSize:17, color:"#0f172a", textAlign:"center", marginBottom:8 }}>Proteção DiáriaJá</div>
                      <div style={{ fontSize:13, color:"#475569", textAlign:"center", lineHeight:1.6, marginBottom:20 }}>
                        Por segurança, <strong>não compartilhe telefones, WhatsApp ou contatos externos</strong> no chat. Todo acerto deve ser feito dentro do app para sua proteção.
                      </div>
                      <button style={{ width:"100%", padding:"14px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10 }}
                        onClick={() => { setAntiExitAviso(false); setMsgInputReal(""); }}>
                        Entendi, vou apagar a mensagem
                      </button>
                      <button style={{ width:"100%", padding:"12px", background:"#f1f5f9", color:"#475569", border:"none", borderRadius:14, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={async () => {
                          setAntiExitAviso(false);
                          if (!session?.user || !chatDiariaAtiva) return;
                          const dest = chatDiariaAtiva.empregador_id;
                          const { data: nm } = await supabase.from("mensagens").insert({ diaria_id:chatDiariaAtiva.id, remetente_id:session.user.id, destinatario_id:dest, conteudo:msgInputReal.trim() }).select().single();
                          if (nm) { setMensagensReais(prev => [...prev, nm]); setMsgInputReal(""); }
                        }}>
                        Enviar mesmo assim
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          // Lista de conversas
          const conversas = minhasDiarias.filter(d => ["aceita","em_andamento","concluida"].includes(d.status) && !hiddenChats.has(d.id));
          return (
            <div style={{ padding:"16px" }}>
              <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)", marginBottom:16 }}>💬 Mensagens</div>
              {/* Suporte DiáriaJá — sempre no topo */}
              <div
                style={{ background:"linear-gradient(135deg,#FF6B35,#f59e0b)", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 4px 14px rgba(255,107,53,.3)", cursor:"pointer", marginBottom:10 }}
                onClick={() => { setChatSuporte(true); }}>
                <div style={{ width:50, height:50, borderRadius:25, background:"rgba(255,255,255,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>💬</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:900, fontSize:15, color:"#fff" }}>Suporte DiáriaJá</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,.8)", marginTop:2 }}>Tire suas dúvidas instantaneamente</div>
                </div>
                <span style={{ background:"#22c55e", color:"#fff", fontSize:10, fontWeight:800, padding:"3px 8px", borderRadius:20 }}>Online</span>
              </div>
              {conversas.length === 0 ? (
                <div style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"32px 20px", textAlign:"center" }}>
                  <div style={{ fontSize:40, marginBottom:10 }}>💬</div>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:6 }}>Nenhuma conversa ainda</div>
                  <div style={{ color:"var(--text-3,#94a3b8)", fontSize:13 }}>Quando aceitar uma vaga, você poderá conversar com o empregador aqui.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {conversas.map(dia => {
                    const nLidas = naoLidasPorDiaria[dia.id] || 0;
                    return (
                      <div key={dia.id}
                        style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px rgba(0,0,0,.06)", cursor:"pointer" }}
                        onClick={() => { hapticTick(); setChatDiariaAtiva(dia); }}>
                        <div style={{ width:50, height:50, borderRadius:25, background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:16, flexShrink:0 }}>
                          {(dia.nome_negocio || dia.segmento).slice(0,2).toUpperCase()}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight: nLidas > 0 ? 900 : 800, fontSize:15, color:"var(--text-1,#0f172a)" }}>{dia.nome_negocio || dia.segmento}</div>
                          <div style={{ fontSize:12, color: nLidas > 0 ? "var(--text-1,#0f172a)" : "var(--text-2,#64748b)", marginTop:2, fontWeight: nLidas > 0 ? 700 : 400 }}>{dia.funcao} · {new Date(dia.data+"T12:00:00").toLocaleDateString("pt-BR")}</div>
                        </div>
                        {nLidas > 0 && (
                          <span style={{ background:"#FF6B35", color:"#fff", borderRadius:11, minWidth:22, height:22, padding:"0 7px", fontSize:11, fontWeight:900, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                            {nLidas > 9 ? "9+" : nLidas}
                          </span>
                        )}
                        <ChevronRight size={18} color="var(--text-3,#94a3b8)" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── ABA PERFIL ── */}
        {tabDiarista === "perfil" && (() => {
          const diariasConc = minhasDiarias.filter(d => d.status === "concluida");
          const totalConc = diariasConc.length;
          const nivel = nivelDiarista(totalConc);
          const avals = avaliacoesDiaristaReal;
          const mediaAval = avals.length > 0 ? avals.reduce((s,a)=>s+a.nota,0)/avals.length : null;
          const score = calcScore(profile || {}, totalConc, mediaAval);
          const mesAtual = new Date().toISOString().slice(0,7);
          const ganhoMes = diariasConc.filter(d => d.data.slice(0,7) === mesAtual).reduce((s,d)=>s+d.valor,0);
          const mpConectado = !!profile?.mp_user_id;
          const mpClientId = import.meta.env.VITE_MP_CLIENT_ID as string;
          const oauthUrl = `https://auth.mercadopago.com.br/authorization?client_id=${mpClientId}&response_type=code&platform_id=mp&state=${session?.user?.id}&redirect_uri=${SUPABASE_URL}/functions/v1/mp-oauth`;
          return (
          <>
            {/* Barra de boas-vindas + ⚙️ */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 20px 8px", background:"var(--bg-card,#fff)", borderBottom:"1px solid var(--border-sub,#f1f5f9)" }}>
              <div style={{ fontSize:17, fontWeight:900, color:"var(--text-1,#0f172a)" }}>Meu Perfil</div>
              <button
                style={{ background:"var(--bg-subtle,#f1f5f9)", border:"none", borderRadius:12, padding:"8px 14px", fontSize:14, fontWeight:800, color:"var(--text-2,#64748b)", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", gap:6 }}
                onClick={() => setTela("configuracoes")}>
                ⚙️ <span style={{ fontSize:12 }}>Config.</span>
              </button>
            </div>

            {/* Banner foto */}
            {!fotoUrl && (
              <div style={{ background:"linear-gradient(135deg,#FF6B35,#f59e0b)", padding:"12px 20px", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}
                onClick={() => fotoInputRef.current?.click()}>
                <span style={{ fontSize:24 }}>📸</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:13, color:"#fff" }}>Adicione sua foto!</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,.85)" }}>Perfis com foto são 3× mais contratados</div>
                </div>
                <span style={{ color:"#fff", fontSize:18, opacity:.8 }}>›</span>
              </div>
            )}

            {/* Card de perfil */}
            <div style={{ ...S.perfilHeader, paddingBottom:20 }}>
              <input ref={fotoInputRef} type="file" accept="image/*" style={{ display:"none" }}
                onChange={e => e.target.files?.[0] && handleFotoUpload(e.target.files[0])} />
              <div style={{ position:"relative", cursor:"pointer", marginBottom:10 }} onClick={() => fotoInputRef.current?.click()}>
                {fotoUrl
                  ? <img src={fotoUrl} alt="foto" style={{ width:88, height:88, borderRadius:44, objectFit:"cover", border:"3px solid #FF6B35", display:"block" }} />
                  : <div style={{ ...S.perfilAvatar, background:"#0f172a", color:"#fff", border:"3px dashed #FF6B35", width:88, height:88 }}>{iniciaisNome}</div>
                }
                <div style={{ position:"absolute", bottom:0, right:0, background:"#FF6B35", borderRadius:12, padding:"3px 8px", fontSize:11, color:"#fff", fontWeight:700 }}>
                  {uploadingFoto ? "⏳" : "📷"}
                </div>
              </div>

              <h2 style={{ ...S.perfilNome, marginBottom:2 }}>{profile?.nome}</h2>
              <div style={S.perfilRamo}>{profile?.funcao}</div>

              {/* Nível profissional (Bronze/Prata/Ouro/Elite) */}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:6 }}>
                <span style={{ background:nivel.cor+"22", color:nivel.cor, padding:"4px 14px", borderRadius:20, fontSize:12, fontWeight:800, border:`1px solid ${nivel.cor}44` }}>
                  {nivel.icone} {nivel.nome}
                  {nivel.proximo > 0 && <span style={{ opacity:.7, fontWeight:600 }}> · {totalConc}/{nivel.proximo} diárias</span>}
                </span>
              </div>

              {/* Nível de confiabilidade (Básico → Premium) */}
              {(() => {
                const nivelConf = calcularNivelConfiabilidade({
                  telefone_verificado: profile?.telefone_verificado || telefoneVerificado,
                  email_confirmado: !!session?.user?.email_confirmed_at,
                  cpf: profile?.cpf, cnpj: profile?.cnpj,
                  documento_status: profile?.documento_status,
                  mfa_enabled: false, // 2FA ainda não integrado
                });
                return (
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:6 }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background: nivelConf.cor+"22", color: nivelConf.cor, padding:"4px 14px", borderRadius:20, fontSize:12, fontWeight:800, border:`1px solid ${nivelConf.cor}44` }}>
                      <ShieldCheck size={12} /> Nível {nivelConf.nivel} · {nivelConf.nome}
                    </span>
                  </div>
                );
              })()}

              {/* Rating */}
              {mediaAval !== null && (
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8 }}>
                  <span style={{ fontSize:16 }}>⭐</span>
                  <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{mediaAval.toFixed(1)}</span>
                  <span style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>({avals.length} avaliação{avals.length!==1?"s":""})</span>
                </div>
              )}

              {/* Disponibilidade */}
              <div style={{ ...S.badge, ...(disponivelAgora?S.badgeVerde:S.badgeCinza), fontSize:13, marginTop:8 }}>
                {disponivelAgora ? "● Disponível agora" : "● Indisponível"}
              </div>
            </div>

            {/* Score de confiança */}
            <div style={{ margin:"8px 16px 0", background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", border:"1.5px solid var(--border,#e2e8f0)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)" }}>🛡️ Score de confiança</div>
                <div style={{ fontWeight:900, fontSize:18, color: score >= 70 ? "#16a34a" : score >= 40 ? "#d97706" : "#dc2626" }}>{score}%</div>
              </div>
              <div style={{ background:"var(--bg-subtle,#f1f5f9)", borderRadius:20, height:8, overflow:"hidden" }}>
                <div style={{ background: score >= 70 ? "#16a34a" : score >= 40 ? "#f59e0b" : "#ef4444", height:8, width:`${score}%`, borderRadius:20, transition:"width .4s" }} />
              </div>
              <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" as const }}>
                {[
                  { ok: !!profile?.foto_url, label:"Foto", icone:"📸" },
                  { ok: !!profile?.cpf,      label:"CPF",  icone:"🪪" },
                  { ok: telefoneVerificado,   label:"Telefone", icone:"📱" },
                  { ok: totalConc >= 1,       label:"1ª diária", icone:"✅" },
                ].map(item => (
                  <div key={item.label} style={{ display:"flex", alignItems:"center", gap:4, background: item.ok ? "#dcfce7" : "var(--bg-subtle,#f1f5f9)", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color: item.ok ? "#16a34a" : "var(--text-3,#94a3b8)" }}>
                    {item.icone} {item.label} {item.ok ? "✓" : "×"}
                  </div>
                ))}
              </div>
            </div>

            {/* Bio */}
            <div style={{ ...S.section, margin:"8px 0 0" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={S.sectionTitle}>Apresentação</div>
                <button style={S.btnEditarPerfil} onClick={() => { setBioDraft(profile?.bio||""); setEditandoBio(true); }}>✏️ Editar</button>
              </div>
              {editandoBio ? (
                <>
                  <textarea
                    style={{ width:"100%", border:"1.5px solid #FF6B35", borderRadius:10, padding:"10px 12px", fontSize:13, lineHeight:1.6, resize:"none" as const, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, minHeight:80, background:"var(--bg-card,#fff)", color:"var(--text-1,#0f172a)" }}
                    value={bioDraft} onChange={e => setBioDraft(e.target.value)}
                    placeholder="Ex: Sou diarista com 5 anos de experiência, pontual e dedicado..." autoFocus />
                  <div style={{ display:"flex", gap:8, marginTop:8 }}>
                    <button style={{ flex:1, background:"#FF6B35", color:"#fff", border:"none", borderRadius:10, padding:"9px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                      onClick={async () => { const ok = await saveProfile({ bio: bioDraft }); if (ok) { setToastSuccess("✅ Bio salva!"); setEditandoBio(false); } }}>Salvar</button>
                    <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                      onClick={() => setEditandoBio(false)}>Cancelar</button>
                  </div>
                </>
              ) : (
                <p style={{ color:"var(--text-label,#475569)", fontSize:13, lineHeight:1.6, margin:0 }}>
                  {profile?.bio || <span style={{ color:"var(--text-3,#94a3b8)", fontStyle:"italic" }}>Nenhuma apresentação ainda. Adicione uma para se destacar!</span>}
                </p>
              )}
            </div>

            {/* Plano atual */}
            {(() => {
              const planoAtivo = assinatura?.plano || "gratis";
              const planoInfo = PLANOS_DIARISTA.find(p => p.id === planoAtivo);
              return (
                <div style={{ margin:"8px 16px 0", background: planoAtivo === "gratis" ? "var(--bg-surface,#f8fafc)" : "linear-gradient(135deg,#FF6B35,#e85d2e)", borderRadius:16, padding:"14px 16px", border: planoAtivo === "gratis" ? "1.5px solid var(--border,#e2e8f0)" : "none" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color: planoAtivo === "gratis" ? "var(--text-3,#94a3b8)" : "rgba(255,255,255,.75)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:4 }}>Plano atual</div>
                      <div style={{ fontSize:15, fontWeight:900, color: planoAtivo === "gratis" ? "var(--text-1,#0f172a)" : "#fff" }}>{planoInfo?.nome || "Grátis"}</div>
                    </div>
                    <button style={{ padding:"8px 14px", background: planoAtivo === "gratis" ? "#FF6B35" : "rgba(255,255,255,.25)", color:"#fff", border:"none", borderRadius:12, fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                      onClick={() => setTela("planos")}>
                      {planoAtivo === "gratis" ? "Fazer upgrade →" : "Ver planos"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Ganhos do mês (compacto) */}
            {diariasConc.length > 0 && (
              <div style={{ margin:"8px 16px 0", background:"linear-gradient(135deg,#0f172a,#1e3a5f)", borderRadius:16, padding:"14px 16px" }}>
                <div style={{ fontWeight:900, fontSize:13, color:"#fff", marginBottom:10 }}>💰 Ganhos do mês</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div style={{ background:"rgba(255,255,255,.08)", borderRadius:10, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,.5)", fontWeight:600 }}>Este mês</div>
                    <div style={{ fontWeight:900, fontSize:18, color:"#4ade80" }}>R$ {ganhoMes.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                  </div>
                  <div style={{ background:"rgba(255,255,255,.08)", borderRadius:10, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,.5)", fontWeight:600 }}>Total</div>
                    <div style={{ fontWeight:900, fontSize:18, color:"#FF6B35" }}>R$ {diariasConc.reduce((s,d)=>s+d.valor,0).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Pagamento info */}
            <div style={{ margin:"8px 16px 0", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:16, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ fontSize:22, flexShrink:0 }}>💸</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)" }}>Recebimento via PIX</div>
                  <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>O contratante paga via Mercado Pago e o repasse chega no seu PIX em até 1 dia útil.</div>
                </div>
              </div>
            </div>

            {/* Ações */}
            <div style={{ padding:"12px 16px 24px", display:"flex", flexDirection:"column", gap:10 }}>
              <button
                style={{ ...S.btnSecondary, color:"#FF6B35", borderColor:"#FF6B35", fontWeight:800 }}
                onClick={() => {
                  setAuthError("");
                  if (tipo === "ambos" && profile?.segmento) {
                    setNegocio(profile.segmento); setModoAtual("empregador"); setTela("home-empregador");
                  } else {
                    setForm({ ...form, nomeNegocio: profile?.nome_negocio || "" }); setNegocio(null); setTela("setup-empregador");
                  }
                }}>
                🏢 {tipo === "ambos" ? "Mudar para modo Empregador" : "Também sou empregador"}
              </button>
              <button style={{ ...S.btnSecondary, color:"#FF6B35", borderColor:"#FF6B35" }} onClick={() => { carregarTopicos(filtroComunidade); setTopicoAtivo(null); setTela("comunidade"); }}>
                🏘️ Comunidade
              </button>
              <button style={{ ...S.btnSecondary, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)" }} onClick={handleLogout}>
                Sair da conta
              </button>
            </div>
          </>
          );
        })()}

        {/* ── Modal detalhes da diária aceita ── */}
        {detalhesDiaria && (() => {
          const d = detalhesDiaria;
          const segInfo = CATEGORIAS_NEGOCIO[d.segmento as keyof typeof CATEGORIAS_NEGOCIO];
          const corD = segInfo?.cor || "#FF6B35";
          const [dh1,,dm1] = [d.horario_inicio.split(":")[0], "", d.horario_inicio.split(":")[1]];
          const [dh2,,dm2] = [d.horario_fim.split(":")[0], "", d.horario_fim.split(":")[1]];
          const minD = (parseInt(dh2)*60+parseInt(dm2))-(parseInt(dh1)*60+parseInt(dm1));
          const durD = minD>0 ? `${Math.floor(minD/60)}h${minD%60>0?String(minD%60).padStart(2,"0")+"min":""}` : "";
          const dataFmtD = new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
          const valorHora = minD > 0 ? (d.valor / (minD/60)).toFixed(2) : null;
          const stMapD: Record<string,{bg:string,color:string,txt:string}> = {
            aceita:       { bg:"#dbeafe", color:"#1d4ed8", txt:"⏳ Aguardando início" },
            em_andamento: { bg:"#fef3c7", color:"#d97706", txt:"🔄 Em andamento" },
            concluida:    { bg:"#dcfce7", color:"#16a34a", txt:"✅ Concluída" },
            cancelada:    { bg:"#fee2e2", color:"#dc2626", txt:"✗ Cancelada" },
          };
          const stD = stMapD[d.status] ?? stMapD.aceita;
          const enderecoLiberado = d.status === "aceita" || d.status === "em_andamento" || d.status === "concluida";
          return (
            <div style={S.modalOverlay} onClick={() => setDetalhesDiaria(null)}>
              <div style={{ ...S.modal, maxHeight:"90vh", overflowY:"auto", padding:0 }} onClick={e => e.stopPropagation()}>

                {/* Header colorido */}
                <div style={{ background:`linear-gradient(135deg,${corD} 0%,${corD}cc 100%)`, borderRadius:"20px 20px 0 0", padding:"20px 20px 18px", display:"flex", alignItems:"center", gap:14 }}>
                  <div style={{ width:52, height:52, borderRadius:26, background:"rgba(255,255,255,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>
                    {segInfo?.icone || "🏢"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:900, fontSize:17, color:"#fff", lineHeight:1.2 }}>{d.nome_negocio || d.segmento}</div>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,.75)", marginTop:3 }}>{d.segmento}</div>
                  </div>
                  <span style={{ background:"rgba(255,255,255,.2)", color:"#fff", padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700, flexShrink:0 }}>{stD.txt}</span>
                </div>

                <div style={{ padding:"16px 20px 20px" }}>

                  {/* Blocos rápidos de info */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                    {[
                      { icone:"📅", label:"Data", val: new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) },
                      { icone:"💰", label:"Valor", val: `R$ ${d.valor}` },
                      { icone:"🕐", label:"Entrada", val: d.horario_inicio.slice(0,5) },
                      { icone:"🕔", label:"Saída", val: d.horario_fim.slice(0,5) },
                    ].map(b => (
                      <div key={b.label} style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"12px 14px" }}>
                        <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:600, marginBottom:2 }}>{b.icone} {b.label}</div>
                        <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)" }}>{b.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Carga horária */}
                  <div style={{ background:`${corD}12`, border:`1.5px solid ${corD}30`, borderRadius:12, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div>
                      <div style={{ fontSize:11, color:`${corD}cc`, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.5 }}>⏱ Carga horária</div>
                      <div style={{ fontWeight:900, fontSize:22, color:corD, lineHeight:1.1, marginTop:2 }}>{durD || "—"}</div>
                    </div>
                    {valorHora && (
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:600 }}>Equivale a</div>
                        <div style={{ fontWeight:800, fontSize:15, color:"#FF6B35" }}>R$ {valorHora}/h</div>
                      </div>
                    )}
                  </div>

                  {/* Função */}
                  {d.funcao && (
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                      <span style={{ background:corD+"18", color:corD, padding:"5px 14px", borderRadius:20, fontSize:13, fontWeight:700, border:`1px solid ${corD}30` }}>
                        👷 {d.funcao}
                      </span>
                    </div>
                  )}

                  {/* O que precisa ser feito */}
                  {d.descricao && (
                    <div style={{ background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:6 }}>📋 O que precisa ser feito</div>
                      <div style={{ fontSize:14, color:"#334155", lineHeight:1.65 }}>{d.descricao}</div>
                    </div>
                  )}

                  {/* Local — só liberado após aceitar */}
                  {enderecoLiberado && d.endereco ? (
                    <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:"#16a34a", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:6 }}>📍 Local (liberado após aceitar)</div>
                      <div style={{ fontWeight:700, fontSize:14, color:"var(--text-1,#0f172a)", lineHeight:1.4 }}>{d.endereco}</div>
                      {d.lat && d.lng && (
                        <a
                          href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ display:"inline-flex", alignItems:"center", gap:6, marginTop:10, background:"#16a34a", color:"#fff", padding:"8px 16px", borderRadius:10, fontSize:13, fontWeight:700, textDecoration:"none" }}>
                          🗺️ Abrir no Google Maps
                        </a>
                      )}
                    </div>
                  ) : !enderecoLiberado && (
                    <div style={{ background:"var(--bg-subtle,#f1f5f9)", borderRadius:12, padding:"12px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
                      <span style={{ fontSize:20 }}>🔒</span>
                      <div style={{ fontSize:13, color:"var(--text-2,#64748b)" }}>Endereço liberado apenas após aceitar a vaga</div>
                    </div>
                  )}

                  {/* Motivo cancelamento/desistência */}
                  {d.motivo_cancelamento && (
                    <div style={{ background:"#fee2e2", border:"1.5px solid #fca5a5", borderRadius:12, padding:"12px 14px", marginBottom:14, fontSize:13, color:"#dc2626", lineHeight:1.5 }}>
                      <strong>Motivo do cancelamento:</strong> {d.motivo_cancelamento}
                    </div>
                  )}

                  <button
                    style={{ ...S.btnSecondary, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)", width:"100%" }}
                    onClick={() => setDetalhesDiaria(null)}>
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Modal desistir da diária ── */}
        {modalDesistir && (
          <div style={S.modalOverlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>🚪 Desistir da diária?</h3>
              <p style={S.modalText}>
                Ao desistir, a vaga ficará <strong>disponível para outros diaristas</strong>. O contratante será notificado.
              </p>
              <div style={{ ...S.modalRow, flexDirection:"column" as const, alignItems:"flex-start", gap:4 }}>
                <span style={{ fontWeight:700, fontSize:13, color:"var(--text-1,#0f172a)" }}>{modalDesistir.nome_negocio || modalDesistir.segmento}</span>
                <span style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>{new Date(modalDesistir.data+"T12:00:00").toLocaleDateString("pt-BR")} · {modalDesistir.horario_inicio.slice(0,5)}–{modalDesistir.horario_fim.slice(0,5)}</span>
              </div>
              <label style={{ ...S.label, marginTop:12 }}>Motivo da desistência *</label>
              <textarea
                style={{ ...S.input, height:80, resize:"none" as const, lineHeight:1.6 }}
                placeholder="Ex: Surgiu um imprevisto pessoal..."
                value={motivoDesistencia}
                onChange={e => setMotivoDesistencia(e.target.value)}
              />
              {authError && <p style={S.errorText}>{authError}</p>}
              <button
                style={{ ...S.btnPrimary, background:"#ef4444", marginTop:12, opacity: (!motivoDesistencia.trim() || desistindo) ? 0.5 : 1 }}
                disabled={!motivoDesistencia.trim() || desistindo}
                onClick={desistirDiaria}>
                {desistindo ? "Processando..." : "Confirmar desistência"}
              </button>
              <button
                style={{ ...S.btnSecondary, marginTop:8, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)" }}
                onClick={() => { setModalDesistir(null); setMotivoDesistencia(""); }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal aceitar vaga ── */}
        {vagaConfirm && (
          <div style={S.modalOverlay}>
            <div style={S.modal}>
              {!vagaConfirmada ? (
                <>
                  {/* Confirmação de presença (selecionado pelo empregador) */}
                  {meuInteresse[vagaConfirm.id] === "selecionado" ? (
                    <>
                      <div style={{ fontSize:52, textAlign:"center", marginBottom:8 }}>🎯</div>
                      <h3 style={{ ...S.modalTitle, textAlign:"center" }}>Você foi selecionado!</h3>
                      <p style={{ ...S.modalText, textAlign:"center" }}>
                        O contratante <strong>{vagaConfirm.nome_negocio || vagaConfirm.segmento}</strong> escolheu você. Confirme sua presença para garantir a vaga.
                      </p>
                      <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                        {[
                          { k:"Local",   v: vagaConfirm.nome_negocio || vagaConfirm.segmento },
                          { k:"Função",  v: vagaConfirm.funcao || "—" },
                          { k:"Data",    v: new Date(vagaConfirm.data+"T12:00:00").toLocaleDateString("pt-BR") },
                          { k:"Horário", v: `${vagaConfirm.horario_inicio.slice(0,5)} – ${vagaConfirm.horario_fim.slice(0,5)}` },
                          { k:"Valor",   v: `R$ ${vagaConfirm.valor}/dia` },
                        ].map(r => (
                          <div key={r.k} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"4px 0" }}>
                            <span style={{ color:"var(--text-2,#64748b)" }}>{r.k}</span>
                            <strong style={{ color:"var(--text-1,#0f172a)" }}>{r.v}</strong>
                          </div>
                        ))}
                      </div>
                      {authError && <p style={S.errorText}>{authError}</p>}
                      <button style={{ ...S.btnPrimary, background:"#22c55e", marginTop:8, opacity:confirmando?0.6:1 }}
                        disabled={confirmando}
                        onClick={() => { setVagaConfirm(null); confirmarPresenca(vagaConfirm); }}>
                        {confirmando ? "Confirmando..." : "✅ Confirmar minha presença"}
                      </button>
                      <button style={{ ...S.btnSecondary, marginTop:8, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)" }} onClick={() => setVagaConfirm(null)}>
                        Ainda não
                      </button>
                    </>
                  ) : (
                    /* Modal de interesse */
                    <>
                      <h3 style={S.modalTitle}>✋ Demonstrar interesse</h3>
                      {/* Foto + nome do empregador */}
                      {(() => {
                        const emp = empregadoresProfiles[vagaConfirm.empregador_id];
                        const empNome = emp?.nome || vagaConfirm.nome_negocio || vagaConfirm.segmento || "Contratante";
                        const empIniciais = empNome.split(" ").filter(Boolean).map((n:string)=>n[0]).join("").slice(0,2).toUpperCase();
                        const segInfo = CATEGORIAS_NEGOCIO[vagaConfirm.segmento as keyof typeof CATEGORIAS_NEGOCIO];
                        const cor = segInfo?.cor || "#FF6B35";
                        const fotoEmpSrc = emp?.foto_url || supabase.storage.from("avatars").getPublicUrl(`${vagaConfirm.empregador_id}.jpg`).data.publicUrl;
                        return (
                          <div style={{ display:"flex", alignItems:"center", gap:12, background:"var(--bg-surface,#f8fafc)", borderRadius:14, padding:"12px 14px", marginBottom:14 }}>
                            <div style={{ position:"relative", width:52, height:52, flexShrink:0 }}>
                              <div style={{ width:52, height:52, borderRadius:26, background:cor, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:17 }}>{empIniciais}</div>
                              <img src={fotoEmpSrc} alt="" onError={e => { (e.target as HTMLImageElement).style.display="none"; }}
                                style={{ position:"absolute", inset:0, width:52, height:52, borderRadius:26, objectFit:"cover" as const, border:`2.5px solid ${cor}` }} />
                            </div>
                            <div>
                              <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)" }}>{empNome}</div>
                              <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>{vagaConfirm.segmento}</div>
                            </div>
                          </div>
                        );
                      })()}
                      {/* Bloco de reputação do contratante */}
                      {(() => {
                        const rep = reputacaoEmp[vagaConfirm.empregador_id];
                        if (!rep || !rep.total_avaliacoes) {
                          return (
                            <div style={{ background:"var(--bg-subtle,#f1f5f9)", borderRadius:12, padding:"12px 14px", marginBottom:14, fontSize:12, color:"var(--text-2,#64748b)" }}>
                              🆕 <strong>Contratante novo</strong> — ainda não tem avaliações de outros diaristas.
                            </div>
                          );
                        }
                        const alerta = (typeof rep.pct_pagou_combinado === "number" && rep.pct_pagou_combinado < 50)
                                     || (typeof rep.pct_cumpriu_combinado === "number" && rep.pct_cumpriu_combinado < 50);
                        return (
                          <div style={{
                            background: alerta ? "#fef2f2" : "#fff4ec",
                            border: alerta ? "1.5px solid #fecaca" : "1.5px solid #fed7aa",
                            borderRadius:12, padding:"12px 14px", marginBottom:14,
                          }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                              <strong style={{ fontSize:13, color: alerta ? "#991b1b" : "#9a4218" }}>
                                Reputação do contratante
                              </strong>
                              <span style={{ fontSize:14, fontWeight:900, color: alerta ? "#991b1b" : "#d97706" }}>
                                ★ {rep.nota_media?.toFixed?.(1) ?? rep.nota_media} <span style={{ color:"var(--text-3,#94a3b8)", fontSize:11, fontWeight:600 }}>· {rep.total_avaliacoes} avaliações</span>
                              </span>
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", gap:6, fontSize:12 }}>
                              {typeof rep.pct_pagou_combinado === "number" && (
                                <div style={{ display:"flex", justifyContent:"space-between" }}>
                                  <span style={{ color:"var(--text-2,#64748b)" }}>💰 Paga o combinado</span>
                                  <strong style={{ color: rep.pct_pagou_combinado >= 80 ? "#16a34a" : rep.pct_pagou_combinado >= 50 ? "#d97706" : "#dc2626" }}>
                                    {rep.pct_pagou_combinado}%
                                  </strong>
                                </div>
                              )}
                              {typeof rep.pct_cumpriu_combinado === "number" && (
                                <div style={{ display:"flex", justifyContent:"space-between" }}>
                                  <span style={{ color:"var(--text-2,#64748b)" }}>✅ Cumpre o combinado</span>
                                  <strong style={{ color: rep.pct_cumpriu_combinado >= 80 ? "#16a34a" : rep.pct_cumpriu_combinado >= 50 ? "#d97706" : "#dc2626" }}>
                                    {rep.pct_cumpriu_combinado}%
                                  </strong>
                                </div>
                              )}
                            </div>
                            {alerta && (
                              <div style={{ marginTop:10, fontSize:11, color:"#991b1b", fontWeight:700, lineHeight:1.4 }}>
                                ⚠️ Outros diaristas relataram problemas — leia as avaliações antes de aceitar.
                              </div>
                            )}
                            <button
                              onClick={() => { setVagaConfirm(null); abrirPerfilEmpregador(vagaConfirm.empregador_id); }}
                              style={{
                                marginTop:10, width:"100%", padding:"10px",
                                background:"transparent",
                                border: alerta ? "1.5px solid #fecaca" : "1.5px solid #fed7aa",
                                color: alerta ? "#991b1b" : "#9a4218",
                                borderRadius:10, fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                              }}>
                              👤 Ver perfil completo do contratante
                            </button>
                          </div>
                        );
                      })()}
                      <p style={S.modalText}>
                        Ao demonstrar interesse, o contratante receberá seu perfil e poderá te selecionar para a vaga.
                      </p>
                      <div style={S.modalRow}><span>Local</span><strong>{vagaConfirm.nome_negocio || vagaConfirm.segmento}</strong></div>
                      <div style={S.modalRow}><span>Função</span><strong>{vagaConfirm.funcao || "—"}</strong></div>
                      <div style={S.modalRow}><span>Data</span><strong>{new Date(vagaConfirm.data+"T12:00:00").toLocaleDateString("pt-BR")}</strong></div>
                      <div style={S.modalRow}><span>Horário</span><strong>{vagaConfirm.horario_inicio.slice(0,5)} – {vagaConfirm.horario_fim.slice(0,5)}</strong></div>
                      {/* Distância até a vaga */}
                      {profile?.lat && profile?.lng && vagaConfirm.lat && vagaConfirm.lng && (() => {
                        const km = haversineKm(profile.lat!, profile.lng!, vagaConfirm.lat!, vagaConfirm.lng!);
                        const txt = `${formatarDistancia(km)} · ~${formatarTempo(tempoEstimadoMin(km))} de moto`;
                        return (
                          <div style={S.modalRow}><span>Distância</span><strong style={{ color:"#FF6B35" }}>📍 {txt}</strong></div>
                        );
                      })()}
                      <div style={{ ...S.modalRow, borderTop:"2px solid #0f172a", paddingTop:8 }}>
                        <strong>Valor oferecido</strong>
                        <strong style={{ color:"#FF6B35", fontSize:17 }}>R$ {vagaConfirm.valor}/dia</strong>
                      </div>
                      <div style={{ background:"var(--bg-subtle,#f1f5f9)", borderRadius:10, padding:"10px 12px", fontSize:12, color:"#1d4ed8", marginTop:12 }}>
                        💡 O endereço completo só será revelado após o contratante te selecionar e você confirmar a presença.
                      </div>
                      {authError && <p style={S.errorText}>{authError}</p>}
                      <button style={{ ...S.btnPrimary, background:"#FF6B35", marginTop:16 }} onClick={() => demonstrarInteresse(vagaConfirm)}>
                        ✋ Confirmar interesse
                      </button>
                      <button style={{ ...S.btnSecondary, marginTop:8, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)" }} onClick={() => setVagaConfirm(null)}>
                        Cancelar
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div style={{ ...S.sucesso, textAlign:"center" }}>
                  <div style={{ fontSize:52 }}>🙌</div>
                  <h3 style={S.modalTitle}>Interesse registrado!</h3>
                  <p style={S.modalText}>O contratante receberá seu perfil. Se ele te selecionar, você será notificado para confirmar a presença.</p>
                  <button style={{ ...S.btnPrimary, background:"#FF6B35" }}
                    onClick={() => { setVagaConfirm(null); setVagaConfirmada(false); setAuthError(""); }}>
                    Entendido 👍
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Modal Cancelar Diária (diarista) ── */}
        {modalCancelar && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }}>
              <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)", marginBottom:4 }}>✕ Cancelar diária</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:20, lineHeight:1.6 }}>
                Informe o motivo para <strong>{modalCancelar.nome_negocio || modalCancelar.segmento}</strong>. O contratante será notificado.
              </div>
              <textarea
                style={{ width:"100%", padding:"12px 14px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", resize:"none" as const, boxSizing:"border-box" as const, outline:"none", marginBottom:16, height:120 }}
                placeholder="Ex: Tive um imprevisto e não poderei comparecer..."
                value={motivoCancelamento}
                onChange={e => setMotivoCancelamento(e.target.value)}
              />
              <button
                style={{ width:"100%", padding:"14px", background: motivoCancelamento.trim() ? "#ef4444" : "#e2e8f0", color: motivoCancelamento.trim() ? "#fff" : "#94a3b8", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: motivoCancelamento.trim() ? "pointer" : "default", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, opacity: cancelando ? 0.6 : 1 }}
                disabled={!motivoCancelamento.trim() || cancelando}
                onClick={cancelarDiaria}>
                {cancelando ? "Cancelando..." : "Confirmar cancelamento"}
              </button>
              <button
                style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => { setModalCancelar(null); setMotivoCancelamento(""); }}>
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal obrigatório: diarista avalia o empregador (pós-conclusão) ── */}
        {diariasAvaliarEmp.length > 0 && (() => {
          const diaria = diariasAvaliarEmp[0];
          const empNome = empregadoresProfiles[diaria.empregador_id]?.nome || diaria.nome_negocio || diaria.segmento || "o empregador";
          const fila = diariasAvaliarEmp.length;
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"24px 22px", width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.4)" }}>
                <div style={{ fontSize:36, textAlign:"center", marginBottom:8 }}>⭐</div>
                <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)", textAlign:"center", marginBottom:4 }}>
                  Como foi trabalhar com {empNome}?
                </div>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", textAlign:"center", marginBottom:18, lineHeight:1.5 }}>
                  Sua avaliação ajuda outros diaristas a decidirem se aceitam vagas desse contratante.
                </div>
                {fila > 1 && (
                  <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", textAlign:"center", marginBottom:10 }}>
                    {fila - 1} outra{fila > 2 ? "s" : ""} diária{fila > 2 ? "s" : ""} aguardando avaliação
                  </div>
                )}

                <div style={{ fontWeight:700, fontSize:13, color:"var(--text-label,#475569)", marginBottom:8 }}>
                  Nota geral
                </div>
                <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:18 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setAvalEmpNota(n)}
                      style={{
                        width:44, height:44, fontSize:24, cursor:"pointer", border:"none",
                        background: "transparent", padding:0, lineHeight:1,
                        opacity: avalEmpNota >= n ? 1 : 0.3,
                        color: avalEmpNota >= n ? "#f59e0b" : "#94a3b8",
                      }}>★</button>
                  ))}
                </div>

                <div style={{ fontWeight:700, fontSize:13, color:"var(--text-label,#475569)", marginBottom:8 }}>
                  Pagou o valor combinado?
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  {[{v:true,t:"💰 Sim, pagou certo"}, {v:false,t:"😕 Não pagou"}].map(o => (
                    <button key={String(o.v)} onClick={() => setAvalEmpPagou(o.v)}
                      style={{
                        flex:1, padding:"12px 8px", borderRadius:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                        background: avalEmpPagou === o.v ? "#fff4ec" : "var(--bg-subtle,#f8fafc)",
                        border: avalEmpPagou === o.v ? "2px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                        color: avalEmpPagou === o.v ? "#9a4218" : "var(--text-1,#0f172a)",
                        fontSize:12, fontWeight:700,
                      }}>{o.t}</button>
                  ))}
                </div>

                <div style={{ fontWeight:700, fontSize:13, color:"var(--text-label,#475569)", marginBottom:8 }}>
                  Cumpriu o que combinou? (horário, escopo, tratamento)
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  {[{v:true,t:"✅ Sim, cumpriu"}, {v:false,t:"❌ Não cumpriu"}].map(o => (
                    <button key={String(o.v)} onClick={() => setAvalEmpCumpriu(o.v)}
                      style={{
                        flex:1, padding:"12px 8px", borderRadius:12, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif",
                        background: avalEmpCumpriu === o.v ? "#fff4ec" : "var(--bg-subtle,#f8fafc)",
                        border: avalEmpCumpriu === o.v ? "2px solid #FF6B35" : "1.5px solid var(--border,#e2e8f0)",
                        color: avalEmpCumpriu === o.v ? "#9a4218" : "var(--text-1,#0f172a)",
                        fontSize:12, fontWeight:700,
                      }}>{o.t}</button>
                  ))}
                </div>

                <textarea
                  value={avalEmpComentario}
                  onChange={e => setAvalEmpComentario(e.target.value)}
                  placeholder="Quer deixar um comentário público? (opcional)"
                  maxLength={500}
                  style={{ width:"100%", minHeight:60, padding:12, borderRadius:12, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", resize:"vertical" as const, marginBottom:14, background:"var(--input-bg,#fff)", color:"var(--text-1,#0f172a)" }}
                />

                <button
                  onClick={enviarAvaliacaoEmpObrigatoria}
                  disabled={enviandoAvalEmpOb || avalEmpNota === 0 || avalEmpPagou === null || avalEmpCumpriu === null}
                  style={{
                    width:"100%", padding:"14px",
                    background: enviandoAvalEmpOb || avalEmpNota === 0 || avalEmpPagou === null || avalEmpCumpriu === null ? "#cbd5e1" : "#FF6B35",
                    color:"#fff", border:"none", borderRadius:14, fontSize:14, fontWeight:900,
                    cursor: enviandoAvalEmpOb ? "not-allowed" : "pointer",
                    fontFamily:"Inter, system-ui, sans-serif",
                  }}>
                  {enviandoAvalEmpOb ? "Enviando..." : "Enviar avaliação"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Modal Avaliar Empregador ── */}
        {modalAvalEmp && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }}>
              <div style={{ fontWeight:900, fontSize:19, color:"var(--text-1,#0f172a)", marginBottom:4 }}>⭐ Avaliar empregador</div>
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:20 }}>
                Como foi trabalhar em <strong>{modalAvalEmp.nome_negocio || modalAvalEmp.segmento}</strong>?
              </div>
              {/* Estrelas */}
              <div style={{ display:"flex", justifyContent:"center", gap:12, marginBottom:20 }}>
                {[1,2,3,4,5].map(n => (
                  <span key={n} style={{ fontSize:38, cursor:"pointer", filter: n<=notaEmp ? "none" : "grayscale(1) opacity(.35)", transition:"filter .15s" }}
                    onClick={() => setNotaEmp(n)}>⭐</span>
                ))}
              </div>
              {notaEmp > 0 && (
                <div style={{ textAlign:"center", fontSize:14, fontWeight:700, color:"#d97706", marginBottom:16 }}>
                  {["","Ruim 😕","Regular 😐","Bom 🙂","Ótimo 😊","Excelente! 🤩"][notaEmp]}
                </div>
              )}
              <textarea
                style={{ width:"100%", padding:"12px 14px", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:14, fontFamily:"Inter, system-ui, sans-serif", resize:"none", boxSizing:"border-box" as const, outline:"none", marginBottom:16, height:90 }}
                placeholder="Deixe um comentário (opcional)..."
                value={comentarioEmp}
                onChange={e => setComentarioEmp(e.target.value)}
              />
              <button
                style={{ width:"100%", padding:"14px", background: notaEmp===0 ? "#e2e8f0" : "#FF6B35", color: notaEmp===0 ? "#94a3b8" : "#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor: notaEmp===0 ? "default" : "pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:10, opacity: enviandoAvalMutua ? 0.6 : 1 }}
                disabled={notaEmp===0 || enviandoAvalMutua}
                onClick={enviarAvaliacaoEmpregador}>
                {enviandoAvalMutua ? "Enviando..." : "Enviar avaliação"}
              </button>
              <button style={{ width:"100%", padding:"12px", background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-2,#64748b)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => setModalAvalEmp(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal QR Code ── */}
        {qrDiaria && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:200, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24 }}
            onClick={() => setQrDiaria(null)}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:24, padding:"28px 24px", width:"100%", maxWidth:360, textAlign:"center" }}
              onClick={e => e.stopPropagation()}>
              {/* Instrução */}
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginBottom:16, lineHeight:1.5 }}>
                Mostre este QR Code para o <strong>empregador escanear</strong> e confirmar sua chegada
              </div>
              {/* QR */}
              <div style={{ display:"flex", justifyContent:"center", background:"var(--bg-surface,#f8fafc)", borderRadius:16, padding:20, marginBottom:16 }}>
                <Suspense fallback={<div style={{ width:200, height:200, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text-3,#94a3b8)", fontSize:13 }}>Carregando QR…</div>}>
                  <QRCodeSVG
                    value={`DIARIAJA:${qrDiaria.id}`}
                    size={200}
                    bgColor="#f8fafc"
                    fgColor="#0f172a"
                    level="H"
                  />
                </Suspense>
              </div>
              {/* Info da diária */}
              <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"12px 14px", marginBottom:16, textAlign:"left" }}>
                <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:4 }}>{qrDiaria.nome_negocio || qrDiaria.segmento}</div>
                <div style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>📅 {new Date(qrDiaria.data+"T12:00:00").toLocaleDateString("pt-BR")} · 🕐 {qrDiaria.horario_inicio.slice(0,5)}–{qrDiaria.horario_fim.slice(0,5)}</div>
                <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>💰 R$ {qrDiaria.valor}/dia</div>
              </div>
              {qrDiaria.status === "em_andamento" && (
                <div style={{ background:"#fef3c7", color:"#d97706", borderRadius:12, padding:"10px 14px", fontSize:13, fontWeight:700, marginBottom:12 }}>
                  🔄 Diária em andamento — aguardando conclusão pelo empregador
                </div>
              )}
              <button style={{ width:"100%", padding:"12px", background:"#0f172a", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => setQrDiaria(null)}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* ── Modal info do perfil (diarista) ── */}
        {modalInfoPerfil && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:350, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={() => { setModalInfoPerfil(false); setEditandoBio(false); }}>
            <div style={{ background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480 }} onClick={e => e.stopPropagation()}>
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:20 }}>
                {fotoUrl
                  ? <img src={fotoUrl} style={{ width:72, height:72, borderRadius:36, objectFit:"cover", border:"3px solid #FF6B35", display:"block", marginBottom:12 }} alt="" />
                  : <div style={{ width:72, height:72, borderRadius:36, background:"#0f172a", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:24, border:"3px solid #FF6B35", marginBottom:12 }}>{iniciaisNome}</div>
                }
                <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)" }}>{profile?.nome}</div>
                <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginTop:2 }}>{profile?.funcao}</div>
                {avaliacoesDiaristaReal.length > 0 && (
                  <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:8 }}>
                    <span style={{ fontSize:16 }}>⭐</span>
                    <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>{(avaliacoesDiaristaReal.reduce((s,a)=>s+a.nota,0)/avaliacoesDiaristaReal.length).toFixed(1)}</span>
                    <span style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>({avaliacoesDiaristaReal.length} avaliação{avaliacoesDiaristaReal.length!==1?"s":""})</span>
                  </div>
                )}
              </div>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:6, textTransform:"uppercase" as const, letterSpacing:0.5 }}>Apresentação</div>
                {editandoBio ? (
                  <>
                    <textarea
                      style={{ width:"100%", border:"1.5px solid #FF6B35", borderRadius:10, padding:"10px 12px", fontSize:13, lineHeight:1.6, resize:"none" as const, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const, minHeight:80 }}
                      value={bioDraft}
                      onChange={e => setBioDraft(e.target.value)}
                      placeholder="Escreva uma apresentação..."
                      autoFocus
                    />
                    <div style={{ display:"flex", gap:8, marginTop:8 }}>
                      <button
                        style={{ flex:1, background:"#FF6B35", color:"#fff", border:"none", borderRadius:10, padding:"9px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={async () => { const ok = await saveProfile({ bio: bioDraft }); if (ok) { setToastSuccess("✅ Bio salva!"); setEditandoBio(false); setModalInfoPerfil(false); } }}>
                        Salvar
                      </button>
                      <button
                        style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={() => setEditandoBio(false)}>
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                    <p style={{ color:"var(--text-label,#475569)", fontSize:13, lineHeight:1.6, margin:0, flex:1 }}>{profile?.bio || "Nenhuma apresentação adicionada."}</p>
                    <button
                      style={{ background:"none", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight:700, color:"#FF6B35", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", flexShrink:0 }}
                      onClick={() => setEditandoBio(true)}>
                      ✏️ Editar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Bottom nav — 5 abas ── */}
        <div style={S.bottomNav}>
          <button style={{ ...S.bottomNavBtn, ...(tabDiarista==="inicio"?{ ...S.bottomNavAtivo, borderTop:"2px solid #FF6B35" }:{}) }} onClick={()=>{ hapticTick(); setTabDiarista("inicio"); }}>
            <Home size={22} strokeWidth={tabDiarista==="inicio"?2.5:2} />
            <span>Home</span>
          </button>
          <button style={{ ...S.bottomNavBtn, ...(tabDiarista==="vagas"?{ ...S.bottomNavAtivo, borderTop:"2px solid #FF6B35" }:{}) }} onClick={()=>{ hapticTick(); setTabDiarista("vagas"); }}>
            <Briefcase size={22} strokeWidth={tabDiarista==="vagas"?2.5:2} />
            <span>Diárias</span>
          </button>
          <button style={{ ...S.bottomNavBtn, ...(tabDiarista==="agenda"?{ ...S.bottomNavAtivo, borderTop:"2px solid #FF6B35" }:{}) }} onClick={()=>{ hapticTick(); setTabDiarista("agenda"); }}>
            <Clock size={22} strokeWidth={tabDiarista==="agenda"?2.5:2} />
            <span>Agenda</span>
          </button>
          <button style={{ ...S.bottomNavBtn, position:"relative", ...(tabDiarista==="chat"?{ ...S.bottomNavAtivo, borderTop:"2px solid #FF6B35" }:{}) }} onClick={()=>{ hapticTick(); setTabDiarista("chat"); setMsgNaoLidas(0); }}>
            <span style={{ position:"relative", display:"inline-flex", alignItems:"center" }}>
              <MessageCircle size={22} strokeWidth={tabDiarista==="chat"?2.5:2} />
              {msgNaoLidas > 0 && (
                <span style={{ position:"absolute", top:-6, right:-10, background:"#ef4444", color:"#fff", borderRadius:"50%", minWidth:16, height:16, padding:"0 4px", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:"16px" }}>
                  {msgNaoLidas > 9 ? "9+" : msgNaoLidas}
                </span>
              )}
            </span>
            <span>Chat</span>
          </button>
          <button style={{ ...S.bottomNavBtn, ...(tabDiarista==="perfil"?{ ...S.bottomNavAtivo, borderTop:"2px solid #FF6B35" }:{}) }} onClick={()=>{ hapticTick(); setTabDiarista("perfil"); }}>
            <User size={22} strokeWidth={tabDiarista==="perfil"?2.5:2} />
            <span>Perfil</span>
          </button>
        </div>

        {/* ── Bottom sheet: trocar de perfil ── */}
        {menuTrocarPerfil && (
          <div style={S.modalOverlay} onClick={() => setMenuTrocarPerfil(false)}>
            <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"8px 0 32px", boxShadow:"0 -8px 32px rgba(0,0,0,.15)" }} onClick={e => e.stopPropagation()}>
              {/* Alça */}
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 20px" }} />
              {/* Modo atual */}
              <div style={{ padding:"0 20px 16px", borderBottom:"1px solid var(--border-sub,#f1f5f9)" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:8 }}>Modo atual</div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:44, height:44, borderRadius:22, background:"#FF6B3518", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>👷</div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)" }}>Diarista</div>
                    <div style={{ fontSize:12, color:"var(--text-2,#64748b)" }}>{profile?.funcao || "—"}{profile?.valor_diaria ? ` · R$ ${profile.valor_diaria}/dia` : ""}</div>
                  </div>
                  <span style={{ marginLeft:"auto", background:"#dcfce7", color:"#16a34a", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>✓ Ativo</span>
                </div>
              </div>
              {/* Opção de trocar */}
              <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:12 }}>Trocar para</div>
                <button
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:14, background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:16, padding:"14px 16px", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", textAlign:"left" as const }}
                  onClick={() => {
                    setMenuTrocarPerfil(false);
                    setAuthError("");
                    if (profile?.nome_negocio && profile?.segmento) {
                      setNegocio(profile.segmento); setModoAtual("empregador"); setTela("home-empregador");
                    } else {
                      setForm({ ...form, nomeNegocio: profile?.nome_negocio || "" });
                      setNegocio(null);
                      setTela("setup-empregador");
                    }
                  }}>
                  <div style={{ width:44, height:44, borderRadius:22, background:"#3A86FF18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🏢</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:15, color:"var(--text-1,#0f172a)" }}>Empregador</div>
                    <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginTop:2 }}>
                      {profile?.nome_negocio ? `${profile.nome_negocio} · ${profile.segmento}` : "Cadastrar perfil de empregador"}
                    </div>
                  </div>
                  <span style={{ fontSize:20, color:"var(--text-3,#94a3b8)" }}>›</span>
                </button>
              </div>
              <div style={{ padding:"0 20px" }}>
                <button style={{ ...S.btnSecondary, color:"var(--text-2,#64748b)", borderColor:"var(--border,#e2e8f0)", width:"100%" }} onClick={() => setMenuTrocarPerfil(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Painel de Notificações (diarista) ── */}
        {modalNotif && (
          <div style={S.modalOverlay} onClick={() => setModalNotif(false)}>
            <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"20px 20px 40px", boxShadow:"0 -8px 32px rgba(0,0,0,.15)", maxHeight:"70vh", overflow:"auto" }} onClick={e => e.stopPropagation()}>
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 16px" }} />
              <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)", marginBottom:16 }}>🔔 Notificações</div>
              {/* Banner de suporte para admin */}
              {profile?.is_admin && suporteNaoLidos > 0 && (
                <div style={{ background:"#fef3c7", border:"1.5px solid #f59e0b", borderRadius:14, padding:"12px 14px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}
                  onClick={() => { setModalNotif(false); setSuporteNaoLidos(0); setFiltroComunidade("suporte"); carregarTopicos("suporte"); setTopicoAtivo(null); setTela("comunidade"); }}>
                  <span style={{ fontSize:24 }}>🔧</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:13, color:"#92400e" }}>{suporteNaoLidos} novo{suporteNaoLidos > 1 ? "s" : ""} pedido{suporteNaoLidos > 1 ? "s" : ""} de suporte</div>
                    <div style={{ fontSize:12, color:"#b45309", marginTop:2 }}>Toque para ver na Comunidade →</div>
                  </div>
                </div>
              )}
              {listaNotif.length === 0 && !(profile?.is_admin && suporteNaoLidos > 0) ? (
                <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", padding:"32px 0", fontSize:14 }}>
                  <div style={{ fontSize:40, marginBottom:8 }}>🔕</div>
                  Nenhuma notificação ainda
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {listaNotif.map((n, i) => (
                    <div key={i} style={{ background: n.tipo==="ok" ? "#f0fdf4" : "#fef2f2", borderRadius:12, padding:"10px 14px", display:"flex", gap:10, alignItems:"flex-start", border:`1px solid ${n.tipo==="ok"?"#bbf7d0":"#fecaca"}` }}>
                      <span style={{ fontSize:18 }}>{n.tipo==="ok" ? "✅" : "⚠️"}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, color:"var(--text-1,#0f172a)", lineHeight:1.4 }}>{n.msg.replace(/^[✅❌⚠️🎉🔔]+\s*/,"")}</div>
                        <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:3 }}>{new Date(n.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {listaNotif.length > 0 && (
                <button style={{ width:"100%", marginTop:16, padding:"10px", background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:13, color:"var(--text-2,#64748b)", fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => { setListaNotif([]); setModalNotif(false); }}>
                  🗑️ Limpar notificações
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Modal Filtro de Vagas ── */}
        {modalFiltro && (
          <div style={S.modalOverlay} onClick={() => setModalFiltro(false)}>
            <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderRadius:"24px 24px 0 0", padding:"20px 20px 40px", boxShadow:"0 -8px 32px rgba(0,0,0,.15)" }} onClick={e => e.stopPropagation()}>
              <div style={{ width:40, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 16px" }} />
              <div style={{ fontWeight:900, fontSize:17, color:"var(--text-1,#0f172a)", marginBottom:20 }}>⚙️ Filtrar vagas</div>
              <div style={{ fontWeight:700, fontSize:13, color:"var(--text-2,#64748b)", marginBottom:10 }}>📅 Data</div>
              <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                {(["todas","hoje","amanha"] as const).map(v => (
                  <button key={v}
                    style={{ flex:1, padding:"9px 4px", borderRadius:10, border:`2px solid ${filtroDataVaga===v?"#FF6B35":"#e2e8f0"}`, background:filtroDataVaga===v?"#FF6B35":"#fff", color:filtroDataVaga===v?"#fff":"#475569", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                    onClick={() => setFiltroDataVaga(v)}>
                    {v==="todas"?"Todas":v==="hoje"?"Hoje":"Amanhã"}
                  </button>
                ))}
              </div>
              <div style={{ fontWeight:700, fontSize:13, color:"var(--text-2,#64748b)", marginBottom:10 }}>↕️ Ordenar por</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
                {([
                  ["recentes","🕐 Mais recentes"],
                  ["proximas","📍 Mais próximas"],
                  ["menor_valor","💚 Menor valor"],
                  ["maior_valor","💰 Maior valor"],
                ] as const).map(([v,l]) => (
                  <button key={v}
                    style={{ padding:"11px 16px", borderRadius:12, border:`2px solid ${sortVagas===v?"#FF6B35":"#e2e8f0"}`, background:sortVagas===v?"#FF6B3518":"#fff", color:sortVagas===v?"#FF6B35":"#475569", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", textAlign:"left" as const }}
                    onClick={() => setSortVagas(v)}>
                    {l} {sortVagas===v ? "✓" : ""}
                  </button>
                ))}
              </div>
              {/* Raio de distância */}
              {profile?.lat && profile?.lng && (
                <>
                  <div style={{ fontWeight:700, fontSize:13, color:"var(--text-2,#64748b)", marginBottom:8 }}>📍 Distância máxima</div>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
                    <input
                      type="range" min={5} max={100} step={5}
                      value={filtroRaioKm}
                      onChange={e => setFiltroRaioKm(Number(e.target.value))}
                      style={{ flex:1, accentColor:"#FF6B35" }}
                    />
                    <span style={{ fontWeight:800, fontSize:14, color:"#FF6B35", minWidth:48 }}>{filtroRaioKm} km</span>
                  </div>
                </>
              )}
              <div style={{ display:"flex", gap:10 }}>
                <button style={{ flex:1, padding:"11px", background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:13, fontWeight:700, color:"var(--text-2,#64748b)", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => { setSortVagas("recentes"); setFiltroDataVaga("todas"); setFiltroRaioKm(50); }}>
                  Limpar filtros
                </button>
                <button style={{ flex:2, padding:"11px", background:"#FF6B35", border:"none", borderRadius:12, fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => setModalFiltro(false)}>
                  ✓ Aplicar
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // EDITAR PERFIL DIARISTA
  if (tela === "editar-perfil") return (
    <div style={S.page}>
      <button style={S.back} onClick={() => setTela("configuracoes")}>← Voltar</button>
      <h2 style={S.pageTitle}>Editar perfil</h2>

      {/* Foto de perfil */}
      <input ref={fotoInputRef} type="file" accept="image/*" style={{ display:"none" }}
        onChange={e => e.target.files?.[0] && handleFotoUpload(e.target.files[0])} />
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", margin:"12px 0 20px" }}>
        <div style={{ position:"relative", cursor:"pointer" }} onClick={() => fotoInputRef.current?.click()}>
          {fotoUrl
            ? <img src={fotoUrl} alt="foto" style={{ width:90, height:90, borderRadius:45, objectFit:"cover", border:"3px solid #FF6B35", display:"block" }} />
            : <div style={{ width:90, height:90, borderRadius:45, background:"var(--bg-subtle,#f1f5f9)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36 }}>👤</div>
          }
          <div style={{ position:"absolute", bottom:0, right:0, background:"#FF6B35", borderRadius:14, padding:"4px 8px", fontSize:12, color:"#fff", fontWeight:700 }}>
            {uploadingFoto ? "⏳" : "📷"}
          </div>
        </div>
        <button
          style={{ marginTop:10, background:"none", border:"1.5px solid #FF6B35", borderRadius:20, padding:"6px 20px", fontSize:13, fontWeight:700, color:"#FF6B35", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
          onClick={() => fotoInputRef.current?.click()}>
          {uploadingFoto ? "Enviando..." : fotoUrl ? "📷 Trocar foto" : "📷 Adicionar foto"}
        </button>
      </div>

      <label style={S.label}>Nome completo</label>
      <input style={S.input} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} />

      <label style={S.label}>Telefone (WhatsApp)</label>
      <input style={S.input} value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} />

      <label style={S.label}>CPF</label>
      <input style={S.input} placeholder="000.000.000-00" value={form.cpf}
        onChange={e => setForm({...form, cpf: maskCPF(e.target.value)})} />
      <p style={{ color:"var(--text-2,#64748b)", fontSize:11, margin:"-6px 0 10px", display:"flex", alignItems:"center", gap:4 }}>
        🔒 Usado apenas para verificação de identidade. Nunca compartilhado.
      </p>

      <label style={S.label}>Sexo</label>
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        {[["M","Masculino"],["F","Feminino"],["N","Prefiro não dizer"]].map(([v,l])=>(
          <button key={v}
            style={{ flex:1, padding:"10px 4px", borderRadius:10, border:`2px solid ${form.sexo===v?"#FF6B35":"#e2e8f0"}`,
              background:form.sexo===v?"#FF6B35":"#fff", color:form.sexo===v?"#fff":"#475569",
              fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
            onClick={()=>setForm({...form,sexo:v})}>{l}</button>
        ))}
      </div>

      <label style={S.label}>Data de nascimento</label>
      <input style={S.input} type="date" value={form.dataNasc}
        onChange={e=>setForm({...form,dataNasc:e.target.value})} />

      <label style={S.label}>Suas especialidades</label>
      <p style={{ color:"var(--text-3,#94a3b8)", fontSize:12, margin:"2px 0 4px" }}>Toque para selecionar. A <strong style={{ color:"#FF6B35" }}>primeira ⭐</strong> será sua especialidade principal.</p>
      {categoriasSelecionadas.length > 0 && (
        <p style={{ color:"#FF6B35", fontSize:12, margin:"0 0 8px", fontWeight:700 }}>
          {categoriasSelecionadas.length} selecionada{categoriasSelecionadas.length > 1 ? "s" : ""} · Principal: ⭐ {categoriasSelecionadas[0]}
        </p>
      )}
      <button
        style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:"2px dashed #e2e8f0", background:"var(--bg-surface,#f8fafc)", color:"#475569", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}
        onClick={() => setHabilidadesExpandidas(prev => !prev)}>
        <span>{habilidadesExpandidas ? "🔼 Recolher habilidades" : "🔽 Ver todas as habilidades"}</span>
        <span style={{ background:"#FF6B35", color:"#fff", borderRadius:20, padding:"2px 10px", fontSize:11 }}>{habilidadesExpandidas ? "−" : "+"}</span>
      </button>
      {habilidadesExpandidas && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8, background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"12px", border:"1px solid var(--border,#e2e8f0)" }}>
          {Object.entries(CATEGORIAS_NEGOCIO).flatMap(([, info]) =>
            info.funcoes.map(f => {
              const sel = categoriasSelecionadas.includes(f);
              const idx = categoriasSelecionadas.indexOf(f);
              return (
                <button key={f}
                  style={{ padding:"7px 14px", borderRadius:20, border:`2px solid ${sel ? "#FF6B35" : "#e2e8f0"}`,
                    background: sel ? "#FF6B35" : "#fff", color: sel ? "#fff" : "#475569",
                    fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                  onClick={() => setCategorias(prev => sel ? prev.filter(x=>x!==f) : [...prev, f])}>
                  {f}{sel && idx === 0 ? " ⭐" : ""}
                </button>
              );
            })
          )}
        </div>
      )}

      <label style={S.label}>Valor por diária (R$)</label>
      <input style={S.input} type="number" value={form.valor} onChange={e=>setForm({...form,valor:e.target.value})} />
      {categoriasSelecionadas[0] && MEDIAS_CAMPO_GRANDE[categoriasSelecionadas[0]] && (() => {
        const med = MEDIAS_CAMPO_GRANDE[categoriasSelecionadas[0]];
        return (
          <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:10, padding:"9px 12px", marginBottom:8, fontSize:12, color:"#166534" }}>
            💡 Média em Campo Grande para <strong>{categoriasSelecionadas[0]}</strong>:{" "}
            R$ {med.min} — R$ {med.max}/dia (média R$ {med.media})
          </div>
        );
      })()}
      <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-6px 0 10px", display:"flex", alignItems:"center", gap:4 }}>
        📊 Média da região: <strong style={{ color:"var(--text-1,#0f172a)" }}>R$ 120 – R$ 250</strong> por diária
      </p>

      <label style={S.label}>Apresentação pessoal</label>
      <textarea
        style={{ ...S.input, height:100, resize:"none", lineHeight:1.5 }}
        placeholder="Ex: Sou garçom com 5 anos de experiência, pontual e dedicado..."
        value={form.bio}
        onChange={e=>setForm({...form,bio:e.target.value})}
      />

      <label style={S.label}>Seu CEP (para cálculo de distância)</label>
      <p style={{ color:"var(--text-3,#94a3b8)", fontSize:12, margin:"-2px 0 6px", lineHeight:1.5 }}>
        Usamos seu CEP para mostrar vagas próximas a você. Não compartilhamos seu endereço exato.
      </p>
      <div style={{ display:"flex", gap:8, marginBottom:4 }}>
        <input
          style={{ ...S.input, flex:1, marginBottom:0 }}
          placeholder="00000-000"
          maxLength={9}
          value={form.cep}
          onChange={e => {
            const raw = e.target.value.replace(/\D/g,"");
            const masked = raw.length > 5 ? raw.slice(0,5)+"-"+raw.slice(5,8) : raw;
            setForm({ ...form, cep: masked });
            if (raw.length === 8) buscarCEPPerfil(raw);
          }}
        />
        <button
          style={{ padding:"0 18px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", flexShrink:0, opacity: buscandoCEPPerfil ? 0.6 : 1 }}
          disabled={buscandoCEPPerfil}
          onClick={() => buscarCEPPerfil(form.cep)}>
          {buscandoCEPPerfil ? "…" : "Buscar"}
        </button>
      </div>
      {form.bairro && form.cidade && (
        <p style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:4 }}>📍 {form.bairro}, {form.cidade}</p>
      )}
      {latPerfilCEP && (
        <p style={{ fontSize:12, color:"#16a34a", marginBottom:8, fontWeight:700 }}>✅ Localização definida pelo CEP</p>
      )}
      {!latPerfilCEP && profile?.lat && (
        <p style={{ fontSize:12, color:"#16a34a", marginBottom:8 }}>✅ Localização já salva no perfil</p>
      )}

      {/* Portfólio de trabalhos */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", margin:"20px 0 8px", textTransform:"uppercase" as const, letterSpacing:0.5 }}>📸 Portfólio (até 3 fotos)</div>
      <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-4px 0 12px" }}>Fotos de trabalhos anteriores aumentam suas chances de contratação</p>
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        {portfolioUrls.map((url, i) => (
          <div key={i} style={{ position:"relative", width:88, height:88, flexShrink:0 }}>
            <img src={url} alt={`portfolio ${i+1}`} style={{ width:88, height:88, borderRadius:12, objectFit:"cover" as const, border:"2px solid var(--border,#e2e8f0)", display:"block" }} />
            <button
              style={{ position:"absolute", top:-6, right:-6, background:"#ef4444", color:"#fff", border:"none", borderRadius:10, width:22, height:22, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900 }}
              onClick={() => removerFotoPortfolio(i)}>×</button>
          </div>
        ))}
        {portfolioUrls.length < 3 && (
          <label style={{ width:88, height:88, borderRadius:12, border:"2px dashed #e2e8f0", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", background:"var(--bg-surface,#f8fafc)", gap:4, flexShrink:0 }}>
            <span style={{ fontSize:28 }}>{uploadingPortfolio ? "⏳" : "📷"}</span>
            <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:700 }}>{uploadingPortfolio ? "Enviando" : "Adicionar"}</span>
            <input ref={portfolioInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => e.target.files?.[0] && handlePortfolioUpload(e.target.files[0])} />
          </label>
        )}
      </div>

      {authError && <p style={{ ...S.errorText, color: authError.startsWith("✅") ? "#16a34a" : "#ef4444" }}>{authError}</p>}
      <button style={{ ...S.btnPrimary, marginTop:16, opacity: salvandoPerfil ? 0.6 : 1 }} onClick={async () => {
        setAuthError("");
        const erroNome = validarNome(form.nome);
        if (erroNome) { setAuthError(erroNome); return; }
        if (!fotoUrl) { setAuthError("⚠️ Adicione uma foto de perfil para continuar."); return; }
        if (!form.cpf || !validarCPF(form.cpf)) { setAuthError("⚠️ CPF obrigatório e deve ser válido (dígitos verificadores conferidos)."); return; }
        const ok = await saveProfile({
          nome: form.nome,
          telefone: form.telefone,
          funcao: categoriasSelecionadas[0] || form.funcao,
          valor_diaria: Number(form.valor),
          bio: form.bio,
          categorias: categoriasSelecionadas,
          cpf: form.cpf,
          sexo: form.sexo,
          data_nascimento: form.dataNasc,
          // Inclui lat/lng do CEP se o usuário geocodificou
          ...(latPerfilCEP !== null ? { lat: latPerfilCEP, lng: lngPerfilCEP } : {}),
        });
        if (ok) {
          setLatPerfilCEP(null); setLngPerfilCEP(null); // limpa estado temporário
          trackEvento("cadastro_concluido", session?.user?.id, "diarista");
          setTela("home-diarista");
        }
      }}
      disabled={salvandoPerfil}
    >{salvandoPerfil ? "Salvando..." : "Salvar alterações"}</button>
    </div>
  );

  // PEDIR LOCALIZAÇÃO (aparece após cadastro de qualquer tipo)
  if (tela === "pedir-localizacao") {
    const telaDestino = tipo === "diarista" ? "home-diarista" : "home-empregador";
    const corTela = tipo === "diarista" ? "#FF6B35" : (negocio?.cor || "#FF6B35");
    // Captura o segmento de forma síncrona ANTES do callback async de geolocalização,
    // evitando stale closure que zeraria negocioSelecionado ao voltar para home-empregador
    const segmentoAtual = negocioSelecionado || profile?.segmento || null;

    // Garante que negocioSelecionado está definido ao entrar em home-empregador
    // para que o useEffect de guarda não redirecione de volta para escolha-negocio
    const irParaDestino = () => {
      if (tipo === "empregador" && segmentoAtual) setNegocio(segmentoAtual);
      setTela(telaDestino);
    };

    // Estado local para o CEP de localização (nesta tela)
    const [cepLoc, setCepLoc] = [form.cep, (v: string) => setForm(p => ({ ...p, cep: v }))];
    const [geocodOk, setGeocodOk] = [!!latPerfilCEP, (_: boolean) => {}];

    const handleSalvarCEP = async () => {
      const cep = form.cep.replace(/\D/g, "");
      if (cep.length !== 8) return;
      await buscarCEPPerfil(cep);
    };

    const handleContinuar = async () => {
      if (latPerfilCEP) {
        await saveProfile({ lat: latPerfilCEP, lng: lngPerfilCEP });
        setLatPerfilCEP(null); setLngPerfilCEP(null);
      }
      irParaDestino();
    };

    return (
      <div style={S.splash}>
        <div style={{ ...S.splashInner, maxWidth: 360, width:"100%" }}>
          <div style={{ fontSize:64 }}>📍</div>
          <h2 style={{ color:"#fff", fontSize:22, fontWeight:900, textAlign:"center", margin:"8px 0" }}>
            Informe seu CEP
          </h2>
          <p style={{ color:"var(--text-3,#94a3b8)", textAlign:"center", fontSize:14, lineHeight:1.6, marginBottom:20 }}>
            Usamos seu CEP para mostrar vagas e profissionais próximos a você. Não compartilhamos seu endereço exato.
          </p>

          {/* CEP input */}
          <div style={{ display:"flex", gap:8, width:"100%", marginBottom:8 }}>
            <input
              style={{ ...S.input, flex:1, marginBottom:0, background:"#1e293b", color:"#fff", borderColor:"#334155" }}
              placeholder="00000-000"
              maxLength={9}
              value={cepLoc}
              onChange={e => {
                const raw = e.target.value.replace(/\D/g,"");
                const masked = raw.length > 5 ? raw.slice(0,5)+"-"+raw.slice(5,8) : raw;
                setCepLoc(masked);
              }}
            />
            <button
              style={{ padding:"0 18px", background: corTela, color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", flexShrink:0, opacity: buscandoCEPPerfil ? 0.6 : 1 }}
              disabled={buscandoCEPPerfil}
              onClick={handleSalvarCEP}>
              {buscandoCEPPerfil ? "..." : "Buscar"}
            </button>
          </div>

          {/* Feedback */}
          {geocodOk && (
            <div style={{ display:"flex", alignItems:"center", gap:8, background:"#052e16", border:"1.5px solid #16a34a", borderRadius:12, padding:"10px 14px", width:"100%", marginBottom:8 }}>
              <span>✅</span>
              <div>
                <p style={{ color:"#4ade80", fontSize:13, fontWeight:700, margin:0 }}>Localização definida!</p>
                {form.bairro && form.cidade && <p style={{ color:"#86efac", fontSize:12, margin:"2px 0 0" }}>📍 {form.bairro}, {form.cidade}</p>}
              </div>
            </div>
          )}

          <button
            style={{ ...S.btnPrimary, background: corTela, marginTop:8, width:"100%", opacity: (!geocodOk && !profile?.lat) ? 0.5 : 1 }}
            onClick={handleContinuar}>
            {geocodOk || profile?.lat ? "Entrar no app →" : "Pular por agora"}
          </button>
          <p style={{ color:"var(--text-3,#94a3b8)", fontSize:11, textAlign:"center", marginTop:8, lineHeight:1.5 }}>
            Você pode atualizar o CEP a qualquer momento no seu perfil.
          </p>
        </div>
      </div>
    );
  }

  // PERFIL DO EMPREGADOR (diarista vê quem está contratando, com reputação e
  // comentários de outros diaristas que já trabalharam com ele)
  if (tela === "perfil-empregador" && empregadorAberto) {
    const emp = empregadorAberto;
    const rep = reputacaoEmp[emp.id];
    const corE = negocio?.cor || "#FF6B35";
    const iniciaisEmp = (emp.nome || "?").split(" ").filter(Boolean).map(n => n[0]).join("").slice(0, 2).toUpperCase();
    const fotoStorageEmp = supabase.storage.from("avatars").getPublicUrl(`${emp.id}.jpg`).data.publicUrl;
    const fotoEmp = emp.foto_url || fotoStorageEmp;
    const alerta = !!(rep && (
      (typeof rep.pct_pagou_combinado === "number" && rep.pct_pagou_combinado < 50) ||
      (typeof rep.pct_cumpriu_combinado === "number" && rep.pct_cumpriu_combinado < 50)
    ));
    return (
      <div style={S.appShell}>
        <div style={{ padding:"12px 16px 0" }}>
          <button style={S.back} onClick={() => { setEmpregadorAberto(null); setAvaliacoesEmpAbertas([]); setTela("home-diarista"); }}>← Voltar</button>
        </div>

        <div style={{ padding:"12px 18px 100px" }}>
          {/* Cabeçalho */}
          <div style={{ background:"var(--bg-card,#fff)", borderRadius:20, padding:"22px 18px", boxShadow:"0 2px 12px rgba(0,0,0,.07)", textAlign:"center" as const }}>
            <div style={{ position:"relative", width:88, height:88, margin:"0 auto 12px" }}>
              <div style={{ width:88, height:88, borderRadius:44, background:corE, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:28, boxShadow:`0 6px 18px ${corE}55` }}>
                {iniciaisEmp}
              </div>
              <img src={fotoEmp} alt={`Foto de ${emp.nome}`} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                style={{ position:"absolute", inset:0, width:88, height:88, borderRadius:44, objectFit:"cover" as const, border:`3px solid ${corE}` }} />
            </div>
            <div style={{ fontWeight:900, fontSize:18, color:"var(--text-1,#0f172a)" }}>{emp.nome}</div>
            {emp.segmento && (
              <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginTop:4 }}>{emp.segmento}</div>
            )}
            {emp.plano_ativo && emp.plano_ativo !== "gratis" && (
              <div style={{ display:"inline-block", marginTop:8, background:"#dbeafe", color:"#1d4ed8", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800 }}>
                ✅ Contratante verificado
              </div>
            )}
          </div>

          {/* Bloco de reputação */}
          <div style={{
            background: rep ? (alerta ? "#fef2f2" : "#fff4ec") : "var(--bg-card,#fff)",
            border: rep ? (alerta ? "1.5px solid #fecaca" : "1.5px solid #fed7aa") : "1px solid var(--border,#e2e8f0)",
            borderRadius:18, padding:"16px 18px", marginTop:14,
          }}>
            <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:10 }}>
              Reputação
            </div>
            {!rep || !rep.total_avaliacoes ? (
              <div style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:13, color:"var(--text-2,#64748b)", lineHeight:1.5 }}>
                <Clock size={16} style={{ flexShrink:0, marginTop:2 }} />
                <span>Contratante novo — nenhuma avaliação ainda. Vá com cautela e combine tudo por escrito antes.</span>
              </div>
            ) : (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:28, fontWeight:900, color: alerta ? "#991b1b" : "#d97706" }}>
                    <Star size={24} fill={alerta ? "#991b1b" : "#d97706"} strokeWidth={0} />
                    {rep.nota_media?.toFixed?.(1) ?? rep.nota_media}
                  </span>
                  <span style={{ fontSize:12, color:"var(--text-3,#94a3b8)" }}>
                    {rep.total_avaliacoes} avaliaç{rep.total_avaliacoes === 1 ? "ão" : "ões"}
                  </span>
                </div>
                {typeof rep.pct_pagou_combinado === "number" && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, padding:"6px 0", borderTop:"1px solid rgba(0,0,0,.05)" }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6, color:"var(--text-2,#64748b)" }}>
                      <Wallet size={14} /> Paga o combinado
                    </span>
                    <strong style={{ color: rep.pct_pagou_combinado >= 80 ? "#16a34a" : rep.pct_pagou_combinado >= 50 ? "#d97706" : "#dc2626" }}>
                      {rep.pct_pagou_combinado}%
                    </strong>
                  </div>
                )}
                {typeof rep.pct_cumpriu_combinado === "number" && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, padding:"6px 0", borderTop:"1px solid rgba(0,0,0,.05)" }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6, color:"var(--text-2,#64748b)" }}>
                      <CheckCircle2 size={14} /> Cumpre o combinado
                    </span>
                    <strong style={{ color: rep.pct_cumpriu_combinado >= 80 ? "#16a34a" : rep.pct_cumpriu_combinado >= 50 ? "#d97706" : "#dc2626" }}>
                      {rep.pct_cumpriu_combinado}%
                    </strong>
                  </div>
                )}
                {alerta && (
                  <div style={{ display:"flex", gap:8, alignItems:"flex-start", marginTop:10, fontSize:12, color:"#991b1b", fontWeight:700, lineHeight:1.4 }}>
                    <AlertTriangle size={14} style={{ flexShrink:0, marginTop:2 }} />
                    <span>Outros diaristas relataram problemas. Leia os comentários abaixo antes de aceitar.</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Comentários */}
          <div style={{ background:"var(--bg-card,#fff)", borderRadius:18, padding:"16px 18px", marginTop:14, boxShadow:"0 2px 12px rgba(0,0,0,.07)" }}>
            <div style={{ fontWeight:900, fontSize:14, color:"var(--text-1,#0f172a)", marginBottom:10 }}>
              Comentários de outros diaristas
            </div>
            {carregandoEmpAberto ? (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }} aria-busy="true" aria-label="Carregando avaliações">
                {[0,1,2].map(i => (
                  <div key={i} style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"10px 12px" }}>
                    <div className="dj-skel" style={{ width:120, height:12, marginBottom:8 }} />
                    <div className="dj-skel" style={{ width:"100%", height:10, marginBottom:6 }} />
                    <div className="dj-skel" style={{ width:"80%", height:10 }} />
                  </div>
                ))}
              </div>
            ) : avaliacoesEmpAbertas.length === 0 ? (
              <div style={{ fontSize:12, color:"var(--text-3,#94a3b8)", textAlign:"center" as const, padding:"12px 0" }}>
                Nenhum comentário ainda.
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {avaliacoesEmpAbertas.map(av => (
                  <div key={av.id} style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"10px 12px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ color:"#d97706", fontWeight:900, fontSize:13 }}>
                          {"★".repeat(av.nota)}{"☆".repeat(5 - av.nota)}
                        </span>
                        <span style={{ fontSize:11, color:"var(--text-2,#64748b)", fontWeight:700 }}>
                          {av.diarista_nome?.split(" ")[0]}
                        </span>
                      </div>
                      <span style={{ fontSize:10, color:"var(--text-3,#94a3b8)" }}>
                        {new Date(av.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {(av.pagou_combinado !== null && av.pagou_combinado !== undefined) || (av.cumpriu_combinado !== null && av.cumpriu_combinado !== undefined) ? (
                      <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                        {av.pagou_combinado !== null && av.pagou_combinado !== undefined && (
                          <span style={{
                            fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:10,
                            background: av.pagou_combinado ? "#dcfce7" : "#fee2e2",
                            color: av.pagou_combinado ? "#16a34a" : "#dc2626",
                          }}>
                            {av.pagou_combinado ? "💰 Pagou" : "💸 Não pagou"}
                          </span>
                        )}
                        {av.cumpriu_combinado !== null && av.cumpriu_combinado !== undefined && (
                          <span style={{
                            fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:10,
                            background: av.cumpriu_combinado ? "#dbeafe" : "#fee2e2",
                            color: av.cumpriu_combinado ? "#1d4ed8" : "#dc2626",
                          }}>
                            {av.cumpriu_combinado ? "✅ Cumpriu" : "❌ Não cumpriu"}
                          </span>
                        )}
                      </div>
                    ) : null}
                    {av.comentario && (
                      <div style={{ fontSize:12, color:"var(--text-1,#0f172a)", lineHeight:1.5 }}>
                        "{av.comentario}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // PERFIL DIARISTA REAL (usuário cadastrado no banco)
  if (tela === "perfil-diarista-real" && diaristaSelecionadaReal) {
    const d = diaristaSelecionadaReal;
    const cor = negocio?.cor || "#FF6B35";
    const iniciais = d.nome.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase();
    const isFavorito = favoritos.has(d.id);
    const diariasDaPerfilConc = diaristasContagemDiarias[d.id] || 0;
    const nivelD = nivelDiarista(diariasDaPerfilConc);
    return (
      <div style={S.appShell}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px 0" }}>
          <button style={S.back} onClick={() => setTela("home-empregador")}>← Voltar</button>
          <button
            style={{ background:"none", border:"none", fontSize:28, cursor:"pointer", padding:"8px", lineHeight:1 }}
            onClick={() => {
              const newFavs = new Set(favoritos);
              if (isFavorito) newFavs.delete(d.id); else newFavs.add(d.id);
              setFavoritos(newFavs);
              try { localStorage.setItem("diariaja_favoritos", JSON.stringify([...newFavs])); } catch {}
              setToastSuccess(isFavorito ? "Removido dos favoritos" : "❤️ Adicionado aos favoritos!");
            }}>
            {isFavorito ? "❤️" : "🤍"}
          </button>
        </div>

        <div style={S.perfilHeader}>
          {d.foto_url
            ? <img src={d.foto_url} alt="foto" style={{ width:76, height:76, borderRadius:38, objectFit:"cover", border:`3px solid ${cor}`, marginBottom:10 }} />
            : <div style={{ ...S.perfilAvatar, background:cor, color:"#fff" }}>{iniciais}</div>
          }
          <h2 style={S.perfilNome}>{d.nome}</h2>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const, justifyContent:"center", marginTop:4 }}>
            <div style={S.perfilRamo}>{d.funcao}</div>
            {(d.cpf || d.cnpj) && (
              <span style={{ background:"#dcfce7", color:"#16a34a", fontSize:11, fontWeight:800, padding:"2px 9px", borderRadius:20, display:"inline-flex", alignItems:"center", gap:3 }}>
                ✅ Verificado
              </span>
            )}
            <span style={{ background:nivelD.cor+"22", color:nivelD.cor, fontSize:11, fontWeight:800, padding:"2px 9px", borderRadius:20 }}>
              {nivelD.icone} {nivelD.nome}
            </span>
            {diariasDaPerfilConc >= 30 && (
              <span style={{ background:"#7c3aed22", color:"#7c3aed", fontSize:11, fontWeight:800, padding:"2px 9px", borderRadius:20 }}>
                🏅 Destaque da Cidade
              </span>
            )}
          </div>
          {avaliacoesDiaristaReal.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:6 }}>
              <span style={{ fontSize:16 }}>⭐</span>
              <span style={{ fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)" }}>
                {(avaliacoesDiaristaReal.reduce((s,a)=>s+a.nota,0)/avaliacoesDiaristaReal.length).toFixed(1)}
              </span>
              <span style={{ color:"var(--text-3,#94a3b8)", fontSize:13 }}>({avaliacoesDiaristaReal.length} avaliação{avaliacoesDiaristaReal.length!==1?"s":""})</span>
            </div>
          )}
          <div style={{ ...S.badge, ...(d.disponivel ? S.badgeVerde : S.badgeCinza), fontSize:13, marginTop:8 }}>
            {d.disponivel ? "● Disponível hoje" : "● Indisponível hoje"}
          </div>
        </div>

        {d.bio && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Apresentação</div>
            <p style={{ color:"var(--text-label,#475569)", fontSize:14, lineHeight:1.6, margin:0 }}>{d.bio}</p>
          </div>
        )}

        <div style={S.section}>
          <div style={S.sectionTitle}>Especialidades</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:4 }}>
            {(d.categorias || []).map(f => {
              const ce = Object.entries(CATEGORIAS_NEGOCIO).find(([, info]) => (info.funcoes as readonly string[]).includes(f));
              const c = ce ? ce[1].cor : "#FF6B35";
              return <span key={f} style={{ background:c+"22", color:c, padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700 }}>{f}</span>;
            })}
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Disponibilidade semanal</div>
          <div style={S.diasRow}>
            {DIAS.map(dia => (
              <div key={dia} style={{ ...S.diaBtn, ...(d.agenda?.includes(dia) ? { ...S.diaBtnAtivo, background:cor, border:`2px solid ${cor}` } : {}), cursor:"default" }}>
                {DIAS_LABEL[dia]}
              </div>
            ))}
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Valor por diária</div>
          <div style={S.valorGrande}>R$ {d.valor_diaria}<span style={{ fontSize:16, color:"var(--text-2,#64748b)" }}> /dia</span></div>
        </div>

        {/* Avaliações do diarista */}
        {avaliacoesDiaristaReal.length > 0 && (
          <div style={S.section}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={S.sectionTitle}>Avaliações</div>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:16 }}>⭐</span>
                <span style={{ fontWeight:900, fontSize:15, color:"var(--text-1,#0f172a)" }}>
                  {(avaliacoesDiaristaReal.reduce((s,a)=>s+a.nota,0)/avaliacoesDiaristaReal.length).toFixed(1)}
                </span>
                <span style={{ color:"var(--text-3,#94a3b8)", fontSize:12 }}>/ 5</span>
              </div>
            </div>
            {avaliacoesDiaristaReal.slice(0,5).map(av => (
              <div key={av.id} style={{ paddingBottom:12, marginBottom:12, borderBottom:"1px solid var(--border-sub,#f1f5f9)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:13 }}>{"⭐".repeat(av.nota)}{"☆".repeat(5-av.nota)}</span>
                  <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>{new Date(av.created_at).toLocaleDateString("pt-BR")}</span>
                </div>
                {av.comentario && <p style={{ fontSize:13, color:"var(--text-label,#475569)", margin:0, lineHeight:1.5 }}>{av.comentario}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Botão denunciar */}
        <div style={{ padding:"0 20px 4px" }}>
          <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:12, cursor:"pointer", textDecoration:"underline" }}
            onClick={() => setModalDenunciar({ tipo:"usuario", id:d.id, nome:d.nome })}>
            ⚑ Denunciar perfil
          </button>
        </div>

        {/* ── Área de ação — muda conforme status do convite ── */}
        {(() => {
          // Busca o convite mais recente enviado para este diarista
          const conviteAtivo = convitesEnviados
            .filter(c => c.diarista_id === d.id)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

          const statusConvite = conviteAtivo?.status;

          if (statusConvite === "pendente") {
            // ── Estado: aguardando resposta ──
            return (
              <div style={{ padding:"0 20px 32px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ background:"#fef3c7", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ fontSize:28 }}>⏳</span>
                  <div>
                    <div style={{ fontWeight:800, fontSize:14, color:"#92400e" }}>Aguardando confirmação</div>
                    <div style={{ fontSize:12, color:"#a16207", marginTop:2 }}>
                      {d.nome.split(" ")[0]} ainda não respondeu ao convite.
                    </div>
                  </div>
                </div>
                <button
                  style={{ ...S.btnSecondary, color:"#d97706", borderColor:"#f59e0b", opacity:0.7, cursor:"not-allowed" }}
                  disabled>
                  ⏳ Convite enviado — aguardando resposta
                </button>
                {conviteAtivo && (
                  confirmCancelarConvite === conviteAtivo.id ? (
                    <div style={{ display:"flex", gap:8, alignItems:"center", background:"#fef2f2", borderRadius:12, padding:"10px 14px" }}>
                      <span style={{ fontSize:12, color:"#dc2626", fontWeight:700, flex:1 }}>Confirmar cancelamento?</span>
                      <button style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => cancelarConvite(conviteAtivo.id)}>Sim</button>
                      <button style={{ background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-label,#475569)", border:"none", borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }} onClick={() => setConfirmCancelarConvite(null)}>Não</button>
                    </div>
                  ) : (
                    <button
                      style={{ ...S.btnSecondary, color:"#dc2626", borderColor:"#fca5a5", fontSize:12 }}
                      onClick={() => setConfirmCancelarConvite(conviteAtivo.id)}>
                      🗑️ Cancelar convite
                    </button>
                  )
                )}
              </div>
            );
          }

          if (statusConvite === "aceito") {
            // ── Estado: aceito — contato liberado apenas após pagamento ──
            const contatoJaLiberado = conviteAtivo && contatosLiberados.has(conviteAtivo.id);
            return (
              <div style={{ padding:"0 20px 32px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ background:"#dcfce7", borderRadius:16, padding:"14px 16px", display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ fontSize:28 }}>🎉</span>
                  <div>
                    <div style={{ fontWeight:800, fontSize:14, color:"#166534" }}>Convite aceito!</div>
                    <div style={{ fontSize:12, color:"#15803d", marginTop:2 }}>
                      {d.nome.split(" ")[0]} confirmou presença. Efetue o pagamento para ver o contato.
                    </div>
                  </div>
                </div>

                {/* Contato — bloqueado até pagamento */}
                {contatoJaLiberado ? (
                  d.telefone ? (
                    <a
                      href={`https://wa.me/55${d.telefone.replace(/\D/g,"")}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...S.btnPrimary, background:"#22c55e", textDecoration:"none", textAlign:"center" as const }}>
                      📱 WhatsApp: {d.telefone}
                    </a>
                  ) : (
                    <div style={{ background:"var(--bg-subtle,#f1f5f9)", borderRadius:12, padding:"12px 16px", fontSize:13, color:"var(--text-2,#64748b)", textAlign:"center" as const }}>
                      📞 Contato não cadastrado pelo profissional
                    </div>
                  )
                ) : (
                  <div style={{ background:"#fef3c7", borderRadius:14, padding:"14px 16px", textAlign:"center" as const }}>
                    <div style={{ fontSize:20, marginBottom:6 }}>🔒</div>
                    <div style={{ fontWeight:800, fontSize:13, color:"#92400e", marginBottom:4 }}>Contato bloqueado</div>
                    <div style={{ fontSize:12, color:"#a16207", lineHeight:1.5 }}>
                      Pague para desbloquear o WhatsApp de {d.nome.split(" ")[0]}.
                    </div>
                  </div>
                )}

                {/* Botão pagamento + desbloquear contato */}
                {!contatoJaLiberado && (
                  <button
                    style={{ ...S.btnPrimary, background:cor }}
                    onClick={() => {
                      if (conviteAtivo) {
                        setModalPix(conviteAtivo as any);
                        // Marca o contato como liberado ao clicar em pagar (simula confirmação)
                        setContatosLiberados(prev => new Set([...prev, conviteAtivo.id]));
                      }
                    }}>
                    💳 Pagar e desbloquear contato{conviteAtivo?.valor ? ` — R$ ${conviteAtivo.valor}` : ""}
                  </button>
                )}

                <button
                  style={{ ...S.btnSecondary, color:cor, borderColor:cor, fontSize:12 }}
                  onClick={() => { setModalConvite(true); }}>
                  📨 Enviar novo convite
                </button>
              </div>
            );
          }

          // ── Estado padrão: sem convite ativo (ou recusado) ──
          return (
            <div style={{ padding:"0 20px 32px", display:"flex", flexDirection:"column", gap:10 }}>
              {statusConvite === "recusado" && (
                <div style={{ background:"#fee2e2", borderRadius:12, padding:"10px 14px", fontSize:13, color:"#991b1b", fontWeight:700, textAlign:"center" as const }}>
                  😔 {d.nome.split(" ")[0]} não pôde nesta data. Tente outra data ou horário.
                </div>
              )}
              <button style={{ ...S.btnPrimary, background:cor }} onClick={() => { setModalConvite(true); setContratadoReal(false); }}>
                📨 Convidar para diária
              </button>
            </div>
          );
        })()}

        {/* Modal de convite com local/data/horário */}
        {modalConvite && (
          <div style={S.modalOverlay}>
            <div style={{ ...S.modal, maxHeight:"90vh", overflowY:"auto" as const }}>
              {true && (
                <>
                  <h3 style={S.modalTitle}>Convidar {d.nome}</h3>
                  <p style={S.modalText}>Informe onde e quando você precisa do serviço. O profissional vai confirmar se pode ir.</p>

                  <div style={S.modalRow}>
                    <span>Especialidade</span><strong>{d.funcao}</strong>
                  </div>
                  {d.valor_diaria && (
                    <div style={{ ...S.modalRow, marginBottom:16 }}>
                      <span>Valor combinado</span>
                      <strong style={{ color:"#16a34a" }}>R$ {d.valor_diaria}/dia</strong>
                    </div>
                  )}

                  <div style={{ display:"flex", flexDirection:"column" as const, gap:12 }}>
                    {/* ── CEP com busca automática ── */}
                    <div>
                      <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>📮 CEP *</label>
                      <div style={{ position:"relative" }}>
                        <input
                          value={formConvite.cep}
                          onChange={e => {
                            const v = e.target.value.replace(/\D/g,"").slice(0,8);
                            const fmt = v.length > 5 ? v.slice(0,5)+"-"+v.slice(5) : v;
                            setFormConvite(p => ({ ...p, cep: fmt }));
                            if (v.length === 8) buscarCEPConvite(v);
                          }}
                          placeholder="00000-000"
                          inputMode="numeric"
                          maxLength={9}
                          style={{ width:"100%", padding:"10px 12px", paddingRight: buscandoCEPConvite ? 110 : 12, borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }}
                        />
                        {buscandoCEPConvite && (
                          <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"#FF6B35", fontWeight:700 }}>Buscando...</span>
                        )}
                      </div>
                    </div>
                    {/* Campos preenchidos automaticamente pelo CEP */}
                    {formConvite.rua ? (
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"grid", gridTemplateColumns:"3fr 1fr", gap:8 }}>
                          <div>
                            <label style={{ fontSize:11, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:3 }}>Rua</label>
                            <input value={formConvite.rua} onChange={e => setFormConvite(p => ({ ...p, rua: e.target.value }))} style={{ width:"100%", padding:"9px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }} />
                          </div>
                          <div>
                            <label style={{ fontSize:11, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:3 }}>Nº *</label>
                            <input value={formConvite.numero} onChange={e => setFormConvite(p => ({ ...p, numero: e.target.value }))} placeholder="Ex: 42" style={{ width:"100%", padding:"9px 10px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }} />
                          </div>
                        </div>
                        <input value={formConvite.complemento} onChange={e => setFormConvite(p => ({ ...p, complemento: e.target.value }))} placeholder="Complemento (apto, bloco...)" style={{ width:"100%", padding:"9px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }} />
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <div>
                            <label style={{ fontSize:11, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:3 }}>Bairro</label>
                            <input value={formConvite.bairro} onChange={e => setFormConvite(p => ({ ...p, bairro: e.target.value }))} style={{ width:"100%", padding:"9px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }} />
                          </div>
                          <div>
                            <label style={{ fontSize:11, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:3 }}>Cidade</label>
                            <input value={formConvite.cidade} onChange={e => setFormConvite(p => ({ ...p, cidade: e.target.value }))} style={{ width:"100%", padding:"9px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>📍 Endereço completo *</label>
                        <input
                          value={formConvite.endereco}
                          onChange={e => setFormConvite(p => ({ ...p, endereco: e.target.value }))}
                          placeholder="Ou digite o endereço completo"
                          style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }}
                        />
                      </div>
                    )}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <div>
                        <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>📅 Data *</label>
                        <input
                          type="date"
                          value={formConvite.data}
                          min={new Date().toISOString().split("T")[0]}
                          onChange={e => setFormConvite(p => ({ ...p, data: e.target.value }))}
                          style={{ width:"100%", padding:"10px 8px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>🕐 Horário de início *</label>
                        <input
                          type="time"
                          value={formConvite.horario}
                          onChange={e => setFormConvite(p => ({ ...p, horario: e.target.value }))}
                          style={{ width:"100%", padding:"10px 8px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>⏱️ Carga horária *</label>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" as const }}>
                        {["4", "6", "8", "10", "12"].map(h => (
                          <button key={h}
                            style={{ background: formConvite.cargaHoraria === h ? cor : "#f1f5f9", color: formConvite.cargaHoraria === h ? "#fff" : "#475569", border:"none", borderRadius:10, padding:"8px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                            onClick={() => setFormConvite(p => ({ ...p, cargaHoraria: h }))}>
                            {h}h
                          </button>
                        ))}
                        <input
                          type="number" min="1" max="24"
                          value={!["4","6","8","10","12"].includes(formConvite.cargaHoraria) ? formConvite.cargaHoraria : ""}
                          onChange={e => setFormConvite(p => ({ ...p, cargaHoraria: e.target.value }))}
                          placeholder="Outro"
                          style={{ width:70, padding:"8px 10px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:13, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>📝 Observações (opcional)</label>
                      <textarea
                        value={formConvite.observacoes}
                        onChange={e => setFormConvite(p => ({ ...p, observacoes: e.target.value }))}
                        placeholder="Materiais necessários, tarefas específicas, etc."
                        rows={3}
                        style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", resize:"none" as const, boxSizing:"border-box" as const }}
                      />
                    </div>
                  </div>

                  <button
                    style={{ ...S.btnPrimary, background:cor, marginTop:18, opacity: enviandoConvite ? 0.7 : 1 }}
                    onClick={enviarConvite}
                    disabled={enviandoConvite}
                  >
                    {enviandoConvite ? "Enviando..." : "📨 Enviar convite"}
                  </button>
                  <button style={{ ...S.btnSecondary, marginTop:8, color:cor, borderColor:cor }} onClick={() => setModalConvite(false)}>Cancelar</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── SETUP: adicionar perfil de DIARISTA (usuário que era só empregador) ──
  if (tela === "setup-diarista") {
    const todasFuncoes = [...new Set(Object.values(CATEGORIAS_NEGOCIO).flatMap(c => c.funcoes))].sort();
    return (
      <div style={S.page}>
        <button style={S.back} onClick={() => { setAuthError(""); setTela("home-empregador"); }}>← Voltar</button>
        <div style={{ textAlign:"center", margin:"8px 0 24px" }}>
          <div style={{ fontSize:48 }}>👷</div>
          <h2 style={{ ...S.pageTitle, marginBottom:4 }}>Perfil de Diarista</h2>
          <p style={{ color:"var(--text-2,#64748b)", fontSize:13, margin:0 }}>Preencha seus dados para aparecer como diarista disponível.</p>
        </div>

        <label style={S.label}>Sua especialidade *</label>
        <select style={S.input} value={form.funcao} onChange={e => setForm({ ...form, funcao: e.target.value })}>
          <option value="">Selecione sua função</option>
          {todasFuncoes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <label style={S.label}>Valor que cobra por dia (R$) *</label>
        <input style={S.input} type="number" placeholder="Ex: 150"
          value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} />

        <label style={S.label}>Uma breve apresentação (opcional)</label>
        <textarea style={{ ...S.input, height:80, resize:"none" as const, lineHeight:1.6 }}
          placeholder="Ex: Tenho 5 anos de experiência como garçom..."
          value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} />

        {authError && <p style={S.errorText}>{authError}</p>}

        <button
          style={{ ...S.btnPrimary, background:"#8338EC", marginTop:16 }}
          onClick={async () => {
            if (!form.funcao || !form.valor) { setAuthError("Preencha especialidade e valor."); return; }
            setAuthError("");
            const ok = await saveProfile({
              funcao: form.funcao,
              valor_diaria: Number(form.valor),
              bio: form.bio || profile?.bio || "",
              user_type: "ambos",
            });
            if (ok) {
              setTipo("ambos");
              setModoAtual("diarista");
              setTela("home-diarista");
            }
          }}>
          ✅ Salvar e usar como Diarista
        </button>
      </div>
    );
  }

  // ── SETUP: adicionar perfil de EMPREGADOR (usuário que era só diarista) ──
  if (tela === "setup-empregador") {
    return (
      <div style={S.page}>
        <button style={S.back} onClick={() => { setAuthError(""); setNegocio(null); setTela("home-diarista"); }}>← Voltar</button>
        <div style={{ textAlign:"center", margin:"8px 0 24px" }}>
          <div style={{ fontSize:48 }}>🏢</div>
          <h2 style={{ ...S.pageTitle, marginBottom:4 }}>Perfil de Empregador</h2>
          <p style={{ color:"var(--text-2,#64748b)", fontSize:13, margin:0 }}>Preencha os dados do seu negócio para publicar vagas.</p>
        </div>

        <label style={S.label}>Nome do negócio *</label>
        <input style={S.input} placeholder="Ex: Restaurante do João, Família Silva..."
          value={form.nomeNegocio} onChange={e => setForm({ ...form, nomeNegocio: e.target.value })} />

        <label style={S.label}>Tipo de negócio *</label>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
          {Object.entries(CATEGORIAS_NEGOCIO).map(([key, info]) => (
            <div key={key}
              style={{ background: negocioSelecionado===key ? `${info.cor}18` : "rgba(0,0,0,.03)", border: negocioSelecionado===key ? `2px solid ${info.cor}` : "1.5px solid #e2e8f0", borderRadius:16, padding:"18px 10px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, cursor:"pointer" }}
              onClick={() => setNegocio(key)}>
              <span style={{ fontSize:30 }}>{info.icone}</span>
              <span style={{ fontWeight:800, fontSize:13, color: negocioSelecionado===key ? info.cor : "#0f172a" }}>{key}</span>
            </div>
          ))}
        </div>

        {authError && <p style={S.errorText}>{authError}</p>}

        <button
          style={{ ...S.btnPrimary, background:"#3A86FF", marginTop:4 }}
          onClick={async () => {
            if (!form.nomeNegocio.trim() || !negocioSelecionado) { setAuthError("Preencha o nome do negócio e selecione o tipo."); return; }
            setAuthError("");
            const ok = await saveProfile({
              nome_negocio: form.nomeNegocio.trim(),
              segmento: negocioSelecionado,
              user_type: "ambos",
            });
            if (ok) {
              setTipo("ambos");
              setModoAtual("empregador");
              setTela("home-empregador");
            }
          }}>
          ✅ Salvar e usar como Empregador
        </button>
      </div>
    );
  }

  // CRIAR DIÁRIA
  if (tela === "criar-diaria") {
    const cor = negocio?.cor || "#FF6B35";
    // Sempre mostra TODAS as habilidades do app, organizadas por categoria
    const funcoesDisponiveis = Object.entries(CATEGORIAS_NEGOCIO);

    // Calcula duração automaticamente
    const calcHoras = () => {
      if (!formDiaria.horario_inicio || !formDiaria.horario_fim) return null;
      const [h1, m1] = formDiaria.horario_inicio.split(":").map(Number);
      const [h2, m2] = formDiaria.horario_fim.split(":").map(Number);
      const min = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (min <= 0) return null;
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m > 0 ? `${h}h${String(m).padStart(2,"0")}min` : `${h}h`;
    };
    const duracao = calcHoras();

    // Helper para separador de seção
    const Secao = ({ icone, titulo, sub }: { icone:string, titulo:string, sub?:string }) => (
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"20px 0 12px", paddingBottom:10, borderBottom:`2px solid ${cor}25` }}>
        <div style={{ width:34, height:34, borderRadius:10, background:`${cor}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>
          {icone}
        </div>
        <div>
          <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" }}>{titulo}</div>
          {sub && <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginTop:1 }}>{sub}</div>}
        </div>
      </div>
    );

    return (
      <div style={S.page}>
        <button style={S.back} onClick={() => { setAuthError(""); setTabEmpregador("perfil"); setTela("home-empregador"); }}>← Voltar</button>

        {/* Cabeçalho */}
        <div style={{ background:`linear-gradient(135deg,${cor} 0%,${cor}cc 100%)`, borderRadius:20, padding:"20px 20px 18px", marginBottom:8, color:"#fff" }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.8, opacity:0.8, marginBottom:4 }}>
            {negocio?.icone} {negocioSelecionado}
          </div>
          <div style={{ fontSize:22, fontWeight:900, lineHeight:1.2 }}>Nova Diária</div>
          <div style={{ fontSize:13, opacity:0.85, marginTop:4 }}>
            Preencha todos os campos — o endereço só será revelado ao diarista após ele aceitar.
          </div>
        </div>

        {/* ── SEÇÃO 1: O serviço ── */}
        <Secao icone="📋" titulo="O serviço" />

        <label style={S.label}>Nome do local *</label>
        <input
          style={S.input}
          placeholder="Ex: Minha residência, Restaurante do João, Fazenda São Paulo…"
          value={formDiaria.local}
          onChange={e => setFormDiaria({ ...formDiaria, local: e.target.value })}
        />

        <label style={S.label}>O que precisa ser feito *</label>
        <textarea
          style={{ ...S.input, height:96, resize:"none" as const, lineHeight:1.6 }}
          placeholder="Ex: Organizar prateleiras do setor de laticínios, reposição de estoque..."
          value={formDiaria.descricao}
          onChange={e => setFormDiaria({ ...formDiaria, descricao: e.target.value })}
        />

        <label style={S.label}>Habilidade necessária</label>
        <select style={S.input} value={formDiaria.funcao} onChange={e => setFormDiaria({ ...formDiaria, funcao: e.target.value })}>
          <option value="">— Selecione uma habilidade —</option>
          {funcoesDisponiveis.map(([categoria, info]) => (
            <optgroup key={categoria} label={`${info.icone} ${categoria}`}>
              {info.funcoes.map(f => <option key={f} value={f}>{f}</option>)}
            </optgroup>
          ))}
        </select>

        {/* ── SEÇÃO DELIVERY (só aparece quando função é Motoboy/Entregador) ── */}
        {FUNCOES_DELIVERY.includes(formDiaria.funcao) && (
          <>
            <Secao icone="🏍️" titulo="Informações de Delivery" sub="Preencha os valores para o entregador" />

            <div style={{ background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:14, padding:"12px 14px", marginBottom:16, fontSize:13, color:"#92400e", lineHeight:1.6 }}>
              <strong>💡 Como funciona:</strong> O <em>valor por encostada</em> é a taxa de conexão paga ao DiáriaJá por cada entregador alocado. Os demais valores são informativos para o entregador estimar o ganho do dia.
            </div>

            <label style={S.label}>Valor por encostada (R$) *</label>
            <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-4px 0 8px" }}>
              Taxa de alocação cobrada pelo DiáriaJá por entregador contratado.
            </p>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--text-2,#64748b)", fontWeight:700, fontSize:15 }}>R$</span>
              <input
                style={{ ...S.input, paddingLeft:40, borderColor: formDiaria.valor_encostada ? "#FF6B35" : undefined }}
                type="number"
                placeholder="Ex: 15,00"
                value={formDiaria.valor_encostada}
                onChange={e => setFormDiaria(prev => ({ ...prev, valor_encostada: e.target.value }))}
              />
            </div>

            <label style={{ ...S.label, marginTop:12 }}>Valor médio por entrega (R$)</label>
            <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-4px 0 8px" }}>
              Quanto o entregador receberá por pedido (motoboys visualizam isso na vaga).
            </p>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--text-2,#64748b)", fontWeight:700, fontSize:15 }}>R$</span>
              <input
                style={{ ...S.input, paddingLeft:40 }}
                type="number"
                placeholder="Ex: 6,00"
                value={formDiaria.valor_por_entrega}
                onChange={e => setFormDiaria(prev => ({ ...prev, valor_por_entrega: e.target.value }))}
              />
            </div>

            <label style={{ ...S.label, marginTop:12 }}>Estimativa de ganho no dia (R$)</label>
            <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-4px 0 8px" }}>
              Média de ganho total do entregador (ajuda a atrair bons profissionais).
            </p>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--text-2,#64748b)", fontWeight:700, fontSize:15 }}>R$</span>
              <input
                style={{ ...S.input, paddingLeft:40 }}
                type="number"
                placeholder="Ex: 180,00"
                value={formDiaria.ganho_estimado_dia}
                onChange={e => setFormDiaria(prev => ({ ...prev, ganho_estimado_dia: e.target.value }))}
              />
            </div>

            {formDiaria.valor_encostada && formDiaria.valor_por_entrega && (
              <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12, padding:"10px 14px", marginTop:8, fontSize:13, color:"#166534" }}>
                🏍️ <strong>Resumo delivery:</strong> Encostada R$ {formDiaria.valor_encostada} · Por entrega R$ {formDiaria.valor_por_entrega}
                {formDiaria.ganho_estimado_dia && ` · Estimativa/dia R$ ${formDiaria.ganho_estimado_dia}`}
              </div>
            )}
          </>
        )}

        {/* ── SEÇÃO 2: Data e carga horária ── */}
        <Secao icone="📅" titulo="Data e carga horária" />

        <label style={S.label}>Data *</label>
        <input
          style={S.input} type="date"
          value={formDiaria.data}
          min={new Date().toISOString().split("T")[0]}
          onChange={e => setFormDiaria({ ...formDiaria, data: e.target.value })}
        />

        <label style={S.label}>Repetição</label>
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          {([["nao","Uma vez"],["semanal","Semanal"],["quinzenal","Quinzenal"]] as const).map(([v,l]) => (
            <button key={v}
              style={{ flex:1, padding:"10px 4px", borderRadius:10, border:`2px solid ${dirariaRepetir===v?cor:"#e2e8f0"}`, background:dirariaRepetir===v?cor:"#fff", color:dirariaRepetir===v?"#fff":"#475569", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
              onClick={() => setDiariaRepetir(v)}>{l}</button>
          ))}
        </div>
        {dirariaRepetir !== "nao" && (
          <div style={{ background:`${cor}14`, border:`1.5px solid ${cor}30`, borderRadius:12, padding:"10px 14px", marginBottom:14, fontSize:13, color:cor, fontWeight:600 }}>
            🔄 Será criada uma diária {dirariaRepetir === "semanal" ? "por semana" : "a cada 2 semanas"} com os mesmos dados.
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div>
            <label style={S.label}>Início *</label>
            <input style={S.input} type="time" value={formDiaria.horario_inicio}
              onChange={e => setFormDiaria({ ...formDiaria, horario_inicio: e.target.value })} />
          </div>
          <div>
            <label style={S.label}>Término *</label>
            <input style={S.input} type="time" value={formDiaria.horario_fim}
              onChange={e => setFormDiaria({ ...formDiaria, horario_fim: e.target.value })} />
          </div>
        </div>

        {/* Carga horária calculada */}
        <div style={{ background: duracao ? `${cor}14` : "#f1f5f9", border: duracao ? `1.5px solid ${cor}40` : "1.5px solid #e2e8f0", borderRadius:12, padding:"11px 16px", marginTop:6, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18 }}>⏱</span>
          <div>
            <div style={{ fontSize:11, color:"var(--text-3,#94a3b8)", fontWeight:600 }}>Carga horária</div>
            <div style={{ fontSize:15, fontWeight:900, color: duracao ? cor : "#cbd5e1" }}>
              {duracao || "— Preencha início e término"}
            </div>
          </div>
        </div>

        {/* ── SEÇÃO 3: Pagamento ── */}
        <Secao icone="💰" titulo="Pagamento" />

        <label style={S.label}>Valor a pagar pelo dia (R$) *</label>
        <p style={{ color:"var(--text-2,#64748b)", fontSize:12, margin:"-4px 0 8px", display:"flex", alignItems:"center", gap:4 }}>
          📊 Média da região: <strong style={{ color:"var(--text-1,#0f172a)" }}>R$ 120 – R$ 250</strong> por diária
        </p>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--text-2,#64748b)", fontWeight:700, fontSize:15 }}>R$</span>
          <input
            style={{ ...S.input, paddingLeft:40 }}
            type="number"
            placeholder="0,00"
            value={formDiaria.valor}
            onChange={e => setFormDiaria({ ...formDiaria, valor: e.target.value })}
          />
        </div>
        {formDiaria.valor && duracao && (() => {
          const minsTot = (parseInt(formDiaria.horario_fim?.split(":")[0]||"0")*60+parseInt(formDiaria.horario_fim?.split(":")[1]||"0"))-(parseInt(formDiaria.horario_inicio?.split(":")[0]||"0")*60+parseInt(formDiaria.horario_inicio?.split(":")[1]||"0"));
          const vlrHora = minsTot > 0 ? Number(formDiaria.valor) / (minsTot/60) : 0;
          const baixo = vlrHora > 0 && vlrHora < 15;
          return (
            <div>
              <div style={{ fontSize:12, color: baixo ? "#d97706" : "#64748b", marginTop:4, textAlign:"right" as const, fontWeight: baixo ? 700 : 400 }}>
                ≈ R$ {vlrHora.toFixed(2)}/hora {baixo ? "⚠️" : ""}
              </div>
              {baixo && (
                <div style={{ background:"#fffbeb", border:"1.5px solid #fde68a", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#92400e", marginTop:6, lineHeight:1.5 }}>
                  <strong>Atenção:</strong> Valor abaixo de R$ 15/h pode dificultar encontrar profissionais. O mercado pratica entre R$ 15–25/h.
                </div>
              )}
            </div>
          );
        })()}

        {/* ── SEÇÃO 4: Local (privado até aceitar) ── */}
        <Secao icone="🔒" titulo="Local da diária" sub="Só revelado ao diarista após ele aceitar" />

        {/* Aviso de privacidade */}
        <div style={{ background:"#fef3c7", border:"1.5px solid #fde68a", borderRadius:12, padding:"10px 14px", marginBottom:12, display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:16, flexShrink:0 }}>🔒</span>
          <div style={{ fontSize:12, color:"#92400e", lineHeight:1.5 }}>
            <strong>Endereço privado:</strong> o diarista só verá o endereço completo e a localização no mapa depois de aceitar a vaga. Na listagem pública aparece apenas <em>"Endereço liberado após aceitar"</em>.
          </div>
        </div>

        {/* CEP */}
        <label style={S.label}>CEP *</label>
        <div style={{ position:"relative" }}>
          <input
            style={{ ...S.input, paddingRight: buscandoCEP ? 110 : 14, letterSpacing:1 }}
            placeholder="00000-000"
            maxLength={9}
            inputMode="numeric"
            value={formDiaria.cep}
            onChange={e => {
              // Máscara CEP: 00000-000
              let v = e.target.value.replace(/\D/g,"").slice(0,8);
              if (v.length > 5) v = v.slice(0,5) + "-" + v.slice(5);
              setFormDiaria(prev => ({ ...prev, cep: v }));
              if (v.replace(/\D/g,"").length === 8) buscarCEP(v);
            }}
          />
          {buscandoCEP && (
            <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:"var(--text-2,#64748b)", fontWeight:600 }}>
              Buscando...
            </span>
          )}
        </div>

        {/* Rua */}
        <label style={{ ...S.label, marginTop:10 }}>Logradouro (rua/avenida) *</label>
        <input
          style={S.input}
          placeholder="Ex: Rua das Flores"
          value={formDiaria.rua}
          onChange={e => setFormDiaria(prev => ({ ...prev, rua: e.target.value }))}
        />

        {/* Número e Complemento lado a lado */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr", gap:12 }}>
          <div>
            <label style={{ ...S.label, marginTop:10 }}>Número *</label>
            <input
              style={S.input}
              placeholder="Ex: 123"
              value={formDiaria.numero}
              onChange={e => setFormDiaria(prev => ({ ...prev, numero: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ ...S.label, marginTop:10 }}>Complemento</label>
            <input
              style={S.input}
              placeholder="Sala, Bloco, Casa…"
              value={formDiaria.complemento}
              onChange={e => setFormDiaria(prev => ({ ...prev, complemento: e.target.value }))}
            />
          </div>
        </div>

        {/* Bairro */}
        <label style={{ ...S.label, marginTop:10 }}>Bairro *</label>
        <input
          style={S.input}
          placeholder="Ex: Centro"
          value={formDiaria.bairro}
          onChange={e => setFormDiaria(prev => ({ ...prev, bairro: e.target.value }))}
        />

        {/* Cidade e Estado lado a lado */}
        <div style={{ display:"grid", gridTemplateColumns:"1.5fr 0.8fr", gap:12 }}>
          <div>
            <label style={{ ...S.label, marginTop:10 }}>Cidade *</label>
            <input
              style={S.input}
              placeholder="Ex: Campo Grande"
              value={formDiaria.cidade}
              onChange={e => setFormDiaria(prev => ({ ...prev, cidade: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ ...S.label, marginTop:10 }}>UF *</label>
            <input
              style={S.input}
              placeholder="MS"
              maxLength={2}
              value={formDiaria.estado}
              onChange={e => setFormDiaria(prev => ({ ...prev, estado: e.target.value.toUpperCase().slice(0,2) }))}
            />
          </div>
        </div>

        {/* Localização automática via CEP */}
        {latDiaria ? (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, padding:"10px 14px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12 }}>
            <span style={{ fontSize:18 }}>✅</span>
            <div>
              <span style={{ fontSize:13, fontWeight:700, color:"#16a34a" }}>Localização obtida pelo CEP</span>
              <p style={{ fontSize:11, color:"#15803d", margin:"2px 0 0" }}>O diarista poderá abrir o endereço no mapa</p>
            </div>
          </div>
        ) : buscandoCEP ? (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, padding:"10px 14px", background:"#f8fafc", border:"1.5px solid #e2e8f0", borderRadius:12 }}>
            <span style={{ fontSize:18 }}>📡</span>
            <span style={{ fontSize:13, color:"var(--text-2,#64748b)", fontWeight:600 }}>Buscando coordenadas do CEP...</span>
          </div>
        ) : formDiaria.cep.replace(/\D/g,"").length === 8 ? (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, padding:"10px 14px", background:"#fef3c7", border:"1.5px solid #fde68a", borderRadius:12 }}>
            <span style={{ fontSize:18 }}>⚠️</span>
            <span style={{ fontSize:12, color:"#92400e" }}>Coordenadas não obtidas. O endereço será salvo em texto.</span>
          </div>
        ) : null}

        {/* Resumo antes de publicar */}
        {(() => {
          const endCompleto = formDiaria.rua && formDiaria.numero && formDiaria.bairro && formDiaria.cidade
            ? `${formDiaria.rua}, ${formDiaria.numero}${formDiaria.complemento ? ` — ${formDiaria.complemento}` : ""}, ${formDiaria.bairro}, ${formDiaria.cidade}/${formDiaria.estado}`
            : "";
          if (!formDiaria.local || !formDiaria.descricao || !formDiaria.data || !formDiaria.horario_inicio || !formDiaria.horario_fim || !formDiaria.valor || !endCompleto) return null;
          return (
            <div style={{ background:"var(--bg-surface,#f8fafc)", border:"1.5px solid var(--border,#e2e8f0)", borderRadius:16, padding:"14px 16px", marginTop:20 }}>
              <div style={{ fontSize:11, fontWeight:800, color:"var(--text-2,#64748b)", textTransform:"uppercase" as const, letterSpacing:0.5, marginBottom:10 }}>📋 Resumo da diária</div>
              <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                {[
                  { k:"Local",    v: formDiaria.local },
                  { k:"Função",   v: formDiaria.funcao || "Qualquer profissional" },
                  { k:"Data",     v: new Date(formDiaria.data+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"}) },
                  { k:"Horário",  v: `${formDiaria.horario_inicio} às ${formDiaria.horario_fim}${duracao ? ` · ${duracao}` : ""}` },
                  { k:"Valor",    v: `R$ ${Number(formDiaria.valor).toLocaleString("pt-BR")}/dia` },
                  { k:"CEP",      v: formDiaria.cep },
                  { k:"Endereço", v: "🔒 " + endCompleto },
                ].map(r => (
                  <div key={r.k} style={{ display:"flex", justifyContent:"space-between", fontSize:12, gap:8 }}>
                    <span style={{ color:"var(--text-3,#94a3b8)", flexShrink:0 }}>{r.k}</span>
                    <span style={{ fontWeight:700, color:"var(--text-1,#0f172a)", textAlign:"right" }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {authError && <p style={S.errorText}>{authError}</p>}

        <button
          style={{ ...S.btnPrimary, background:cor, marginTop:16, opacity:salvandoDiaria?0.6:1, fontSize:16 }}
          disabled={salvandoDiaria}
          onClick={salvarDiaria}>
          {salvandoDiaria ? "Publicando..." : "📋 Publicar diária"}
        </button>
        <p style={{ fontSize:11, color:"var(--text-3,#94a3b8)", textAlign:"center", marginTop:8 }}>
          Campos com * são obrigatórios
        </p>
      </div>
    );
  }

  // EDITAR PERFIL EMPREGADOR
  if (tela === "editar-perfil-empregador") return (
    <div style={S.page}>
      <button style={S.back} onClick={() => setTela("configuracoes")}>← Voltar</button>
      <h2 style={S.pageTitle}>Editar perfil</h2>

      {/* Foto/logo do negócio */}
      <div style={{ fontWeight:800, fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:0.5 }}>📷 Foto / Logo do negócio</div>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20, padding:"14px 16px", background:"var(--bg-surface,#f8fafc)", borderRadius:16, border:"1.5px solid var(--border,#e2e8f0)" }}>
        {fotoUrl
          ? <img src={fotoUrl} style={{ width:72, height:72, borderRadius:36, objectFit:"cover" as const, flexShrink:0, border:`3px solid ${negocio?.cor||"#FF6B35"}` }} alt="foto" />
          : <div style={{ width:72, height:72, borderRadius:36, background:"#e2e8f0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, flexShrink:0 }}>🏢</div>
        }
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:13, color:"var(--text-1,#0f172a)", marginBottom:4 }}>
            {fotoUrl ? "✅ Foto adicionada!" : "Adicione uma foto"}
          </div>
          <div style={{ fontSize:12, color:"var(--text-2,#64748b)", marginBottom:8, lineHeight:1.4 }}>Aparece no card da vaga para os diaristas</div>
          <label style={{ display:"inline-block", padding:"8px 16px", background:fotoUrl ? "#f0fdf4" : (negocio?.cor||"#FF6B35"), color:fotoUrl ? "#16a34a" : "#fff", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {uploadingFoto ? "Enviando..." : fotoUrl ? "Trocar foto" : "📷 Escolher foto"}
            <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>e.target.files?.[0]&&handleFotoUpload(e.target.files[0])} />
          </label>
        </div>
      </div>

      <label style={S.label}>Nome completo</label>
      <input style={S.input} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} />

      <label style={S.label}>Telefone (WhatsApp)</label>
      <input style={S.input} placeholder="(67) 99999-9999" value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} />

      <label style={S.label}>Nome do negócio / local</label>
      <p style={{ color:"var(--text-3,#94a3b8)", fontSize:12, margin:"-6px 0 8px" }}>Nome do estabelecimento ou local — não coloque seu nome pessoal aqui.</p>
      <input style={S.input} placeholder="Ex: Restaurante do João, Família Silva, Bar Guinness..." value={form.nomeNegocio} onChange={e=>setForm({...form,nomeNegocio:e.target.value})} />

      {/* Tipo de pessoa */}
      <label style={S.label}>Tipo de pessoa</label>
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        {[["fisica","👤 Pessoa Física"],["juridica","🏢 Pessoa Jurídica"]].map(([v,l])=>(
          <button key={v}
            style={{ flex:1, padding:"12px 8px", borderRadius:12, border:`2px solid ${form.pessoaTipo===v?(negocio?.cor||"#FF6B35"):"#e2e8f0"}`,
              background:form.pessoaTipo===v?(negocio?.cor||"#FF6B35"):"#fff",
              color:form.pessoaTipo===v?"#fff":"#475569",
              fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
            onClick={()=>setForm({...form,pessoaTipo:v})}>{l}</button>
        ))}
      </div>

      {/* CPF ou CNPJ */}
      {form.pessoaTipo === "fisica" ? (
        <>
          <label style={S.label}>CPF</label>
          <input style={S.input} placeholder="000.000.000-00" value={form.cpf}
            onChange={e=>setForm({...form,cpf:maskCPF(e.target.value)})} />
        </>
      ) : (
        <>
          <label style={S.label}>CNPJ</label>
          <input style={S.input} placeholder="00.000.000/0000-00" value={form.cnpj}
            onChange={e=>setForm({...form,cnpj:maskCNPJ(e.target.value)})} />
        </>
      )}

      {/* Endereço atual */}
      {profile?.endereco_empregador && (
        <div style={{ background:"var(--bg-surface,#f8fafc)", borderRadius:10, padding:"10px 14px", marginBottom:12, border:"1px solid var(--border,#e2e8f0)" }}>
          <p style={{ fontSize:12, color:"var(--text-2,#64748b)", margin:0, fontWeight:600 }}>Endereço atual:</p>
          <p style={{ fontSize:13, color:"#334155", margin:"4px 0 0" }}>{profile.endereco_empregador}</p>
        </div>
      )}

      {/* Novo endereço via CEP */}
      <label style={S.label}>Atualizar endereço — CEP</label>
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <input style={{ ...S.input, flex:1, marginBottom:0 }} placeholder="00000-000" value={form.cepEmp}
          onChange={e => {
            const v = e.target.value.replace(/\D/g,"").slice(0,8);
            const masked = v.length > 5 ? v.slice(0,5)+"-"+v.slice(5) : v;
            setForm({...form,cepEmp:masked});
            if (v.length === 8) buscarCEPEmp(v);
          }} />
        <button style={{ ...S.btnSecondary, whiteSpace:"nowrap", padding:"10px 14px" }}
          onClick={() => buscarCEPEmp(form.cepEmp)}>
          {buscandoCEPEmp ? "..." : "Buscar"}
        </button>
      </div>
      <input style={S.input} placeholder="Rua / Av." value={form.ruaEmp} onChange={e=>setForm({...form,ruaEmp:e.target.value})} />
      <div style={{ display:"flex", gap:8 }}>
        <input style={{ ...S.input, flex:"0 0 100px" }} placeholder="Número" value={form.numeroEmp} onChange={e=>setForm({...form,numeroEmp:e.target.value})} />
        <input style={{ ...S.input, flex:1 }} placeholder="Complemento (opcional)" value={form.complementoEmp} onChange={e=>setForm({...form,complementoEmp:e.target.value})} />
      </div>
      <input style={S.input} placeholder="Bairro" value={form.bairroEmp} onChange={e=>setForm({...form,bairroEmp:e.target.value})} />
      <div style={{ display:"flex", gap:8 }}>
        <input style={{ ...S.input, flex:1 }} placeholder="Cidade" value={form.cidadeEmp} onChange={e=>setForm({...form,cidadeEmp:e.target.value})} />
        <input style={{ ...S.input, flex:"0 0 70px" }} placeholder="UF" value={form.estadoEmp} onChange={e=>setForm({...form,estadoEmp:e.target.value})} />
      </div>

      {/* Feedback de geocodificação */}
      {latPerfilCEP ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, padding:"10px 14px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12, marginBottom:4 }}>
          <span>✅</span>
          <span style={{ fontSize:13, fontWeight:700, color:"#16a34a" }}>Localização obtida pelo CEP</span>
        </div>
      ) : profile?.lat ? (
        <p style={{ color:"#16a34a", fontSize:12, marginTop:4 }}>✅ Localização já salva no perfil</p>
      ) : null}

      {authError && <p style={{ ...S.errorText, color: authError.startsWith("✅") ? "#16a34a" : "#ef4444" }}>{authError}</p>}
      <button style={{ ...S.btnPrimary, marginTop:16, opacity: salvandoPerfil ? 0.6 : 1 }} onClick={async () => {
        setAuthError("");
        const erroNomeEmp = validarNome(form.nome);
        if (erroNomeEmp) { setAuthError(erroNomeEmp); return; }
        const enderecoAtualizado = form.ruaEmp
          ? `${form.ruaEmp}, ${form.numeroEmp}${form.complementoEmp ? `, ${form.complementoEmp}` : ""} - ${form.bairroEmp}, ${form.cidadeEmp}/${form.estadoEmp} - CEP: ${form.cepEmp}`
          : undefined;
        const ok = await saveProfile({
          nome: form.nome,
          telefone: form.telefone,
          nome_negocio: form.nomeNegocio,
          cpf: form.pessoaTipo === "fisica" ? form.cpf : "",
          cnpj: form.pessoaTipo === "juridica" ? form.cnpj : "",
          pessoa_tipo: form.pessoaTipo,
          ...(enderecoAtualizado ? { endereco_empregador: enderecoAtualizado } : {}),
          // Inclui lat/lng do CEP se geocodificado
          ...(latPerfilCEP !== null ? { lat: latPerfilCEP, lng: lngPerfilCEP } : {}),
        });
        if (ok) { setLatPerfilCEP(null); setLngPerfilCEP(null); setTela("configuracoes"); }
      }}
      disabled={salvandoPerfil}
    >{salvandoPerfil ? "Salvando..." : "Salvar alterações"}</button>
    </div>
  );

  // chat mock: removido — use o chat real em home-empregador/home-diarista
  if (tela === "chat") { setTela("home-empregador"); return null; }

  // ── COMUNIDADE ──────────────────────────────────────────────────────────────
  if (tela === "comunidade") {
    const isAdmin = !!profile?.is_admin;
    const corAcento = modoAtual === "empregador" ? (negocio?.cor || "#FF6B35") : "#FF6B35";
    const CATS = [
      { key:"todos",      label:"Todos",      icone:"🌐" },
      { key:"geral",      label:"Geral",       icone:"💬" },
      { key:"dicas",      label:"Dicas",       icone:"💡" },
      { key:"duvidas",    label:"Dúvidas",     icone:"❓" },
      { key:"conquistas", label:"Conquistas",  icone:"🎉" },
      { key:"suporte",    label:"Suporte",     icone:"🔧" },
    ];
    const catLabel: Record<string,string> = { geral:"💬 Geral", dicas:"💡 Dica", duvidas:"❓ Dúvida", conquistas:"🎉 Conquista", suporte:"🔧 Suporte" };
    const agoraStr = (iso: string) => {
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 60) return "agora";
      if (diff < 3600) return `${Math.floor(diff/60)}min`;
      if (diff < 86400) return `${Math.floor(diff/3600)}h`;
      return `${Math.floor(diff/86400)}d`;
    };

    // Tela de detalhe do tópico
    if (topicoAtivo) {
      return (
        <div style={{ ...S.appShell, paddingBottom:80, background:"var(--bg-app,#f0f2f5)" }}>
          <div style={{ background:corAcento, padding:"16px 20px", display:"flex", alignItems:"center", gap:12 }}>
            <button style={{ background:"none", border:"none", color:"#fff", fontSize:22, cursor:"pointer", padding:0 }} onClick={() => setTopicoAtivo(null)}>←</button>
            <div style={{ flex:1 }}>
              <div style={{ color:"rgba(255,255,255,.8)", fontSize:11, fontWeight:700 }}>{catLabel[topicoAtivo.categoria] || "💬 Geral"}</div>
              <div style={{ color:"#fff", fontSize:15, fontWeight:800, lineHeight:1.3, marginTop:2 }}>{topicoAtivo.titulo}</div>
            </div>
          </div>

          <div style={{ background:"var(--bg-card,#fff)", margin:"12px 16px", borderRadius:16, padding:"16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div>
                <span style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)" }}>{topicoAtivo.autor_nome}</span>
                <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginLeft:6 }}>• {agoraStr(topicoAtivo.created_at)}</span>
                {topicoAtivo.autor_tipo === "diarista" && <span style={{ marginLeft:6, background:"#FF6B3515", color:"#FF6B35", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>Diarista</span>}
                {topicoAtivo.autor_tipo === "empregador" && <span style={{ marginLeft:6, background:"#FF6B3515", color:"#FF6B35", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>Contratante</span>}
              </div>
              {isAdmin && (
                <div style={{ display:"flex", gap:6 }}>
                  <button style={{ background:"none", border:"none", fontSize:16, cursor:"pointer" }} onClick={() => fixarTopico(topicoAtivo)} title="Fixar">
                    {topicoAtivo.pinned ? "📌" : "📍"}
                  </button>
                  <button style={{ background:"none", border:"none", fontSize:16, cursor:"pointer" }} onClick={() => deletarTopico(topicoAtivo.id)} title="Excluir">🗑️</button>
                </div>
              )}
            </div>
            <p style={{ color:"#334155", fontSize:14, lineHeight:1.7, margin:0, whiteSpace:"pre-wrap" as const }}>{topicoAtivo.conteudo}</p>
            <div style={{ display:"flex", alignItems:"center", gap:16, marginTop:14, paddingTop:10, borderTop:"1px solid var(--border-sub,#f1f5f9)" }}>
              <button style={{ background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4, color:"var(--text-2,#64748b)", fontSize:13, fontWeight:700, fontFamily:"Inter, system-ui, sans-serif" }}
                onClick={() => curtirTopico(topicoAtivo.id)}>
                ❤️ {topicoAtivo.likes}
              </button>
              <span style={{ color:"var(--text-3,#94a3b8)", fontSize:13 }}>💬 {comentariosTopico.length} comentários</span>
            </div>
          </div>

          {/* Comentários */}
          <div style={{ margin:"0 16px" }}>
            <div style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)", marginBottom:10 }}>Comentários</div>
            {comentariosTopico.length === 0 && (
              <div style={{ textAlign:"center" as const, color:"var(--text-3,#94a3b8)", fontSize:14, padding:"24px 0" }}>Seja o primeiro a comentar! 👇</div>
            )}
            {comentariosTopico.map(c => (
              <div key={c.id} style={{ background:"var(--bg-card,#fff)", borderRadius:14, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <div>
                    <span style={{ fontWeight:800, fontSize:13, color:"var(--text-1,#0f172a)" }}>{c.autor_nome}</span>
                    {c.autor_tipo === "diarista" && <span style={{ marginLeft:6, background:"#FF6B3515", color:"#FF6B35", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>Diarista</span>}
                    {c.autor_tipo === "empregador" && <span style={{ marginLeft:6, background:"#FF6B3515", color:"#FF6B35", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>Contratante</span>}
                    {isAdmin && <span style={{ marginLeft:6, background:"#fef3c715", color:"#d97706", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>👑 Admin</span>}
                    <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)", marginLeft:6 }}>• {agoraStr(c.created_at)}</span>
                  </div>
                  {(isAdmin || c.autor_id === session?.user?.id) && (
                    <button style={{ background:"none", border:"none", fontSize:14, cursor:"pointer", color:"var(--text-3,#94a3b8)" }} onClick={() => deletarComentario(c.id)}>🗑️</button>
                  )}
                </div>
                <p style={{ color:"var(--text-label,#475569)", fontSize:13, lineHeight:1.6, margin:0 }}>{c.conteudo}</p>
              </div>
            ))}
          </div>

          {/* Input de novo comentário */}
          <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderTop:"1px solid var(--border,#e2e8f0)", padding:"12px 16px", display:"flex", gap:10, boxSizing:"border-box" as const }}>
            <input
              value={novoComentario}
              onChange={e => setNovoComentario(e.target.value)}
              placeholder="Escreva um comentário..."
              style={{ flex:1, padding:"10px 14px", borderRadius:24, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", outline:"none" }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); criarComentario(); } }}
            />
            <button
              style={{ background:corAcento, color:"#fff", border:"none", borderRadius:24, padding:"10px 18px", fontWeight:800, fontSize:14, cursor:"pointer", opacity: enviandoComentario ? 0.7 : 1, fontFamily:"Inter, system-ui, sans-serif" }}
              onClick={criarComentario} disabled={enviandoComentario}>
              {enviandoComentario ? "..." : "→"}
            </button>
          </div>
        </div>
      );
    }

    // Lista de tópicos
    return (
      <div style={{ ...S.appShell, paddingBottom:76, background:"var(--bg-app,#f0f2f5)" }}>
        {/* Header */}
        <div style={{ background:corAcento, padding:"20px 20px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <button style={{ background:"none", border:"none", color:"#fff", fontSize:22, cursor:"pointer", padding:0 }}
              onClick={() => setTela(modoAtual === "empregador" ? "home-empregador" : "home-diarista")}>←</button>
            <div>
              <div style={{ color:"rgba(255,255,255,.8)", fontSize:12, fontWeight:700 }}>🏘️ TRAMPOJÁ</div>
              <div style={{ color:"#fff", fontSize:20, fontWeight:900 }}>Comunidade</div>
            </div>
          </div>
          {/* Filtros de categoria */}
          <div style={{ display:"flex", gap:8, overflowX:"auto" as const, paddingBottom:4 }}>
            {CATS.map(c => (
              <button key={c.key}
                style={{ background: filtroComunidade === c.key ? "#fff" : "rgba(255,255,255,.2)", color: filtroComunidade === c.key ? corAcento : "#fff", border:"none", borderRadius:20, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" as const, fontFamily:"Inter, system-ui, sans-serif", flexShrink:0 }}
                onClick={async () => { setFiltroComunidade(c.key); await carregarTopicos(c.key); }}>
                {c.icone} {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Toasts */}
        {toastSuccess && <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#0f172a", color:"#fff", borderRadius:24, padding:"10px 22px", fontSize:14, fontWeight:700, zIndex:999, whiteSpace:"nowrap" }}>{toastSuccess}</div>}
        {toastError   && <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#dc2626", color:"#fff", borderRadius:24, padding:"10px 22px", fontSize:14, fontWeight:700, zIndex:999 }}>{toastError}</div>}

        {/* Lista */}
        <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column" as const, gap:10 }}>
          {topicos.length === 0 && (
            <div style={{ textAlign:"center" as const, color:"var(--text-3,#94a3b8)", padding:"48px 0" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>🏘️</div>
              <div style={{ fontWeight:700, color:"var(--text-label,#475569)" }}>Nenhum tópico ainda</div>
              <div style={{ fontSize:13, marginTop:6 }}>Seja o primeiro a publicar!</div>
            </div>
          )}
          {topicos.map(t => (
            <div key={t.id}
              style={{ background:"var(--bg-card,#fff)", borderRadius:16, padding:"14px 16px", cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.06)", border: t.pinned ? `2px solid ${corAcento}` : "none" }}
              onClick={async () => { setTopicoAtivo(t); await carregarComentarios(t.id); }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                <div style={{ flex:1 }}>
                  {t.pinned && <span style={{ fontSize:11, fontWeight:700, color:corAcento, display:"block", marginBottom:4 }}>📌 FIXADO</span>}
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)", lineHeight:1.4 }}>{t.titulo}</div>
                </div>
                <span style={{ background:corAcento+"15", color:corAcento, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:20, flexShrink:0, marginLeft:8 }}>
                  {catLabel[t.categoria] || "💬 Geral"}
                </span>
              </div>
              <p style={{ color:"var(--text-2,#64748b)", fontSize:13, margin:"0 0 10px", lineHeight:1.5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" as const }}>{t.conteudo}</p>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)" }}>{t.autor_nome}</span>
                  <span style={{ fontSize:10, color:"#cbd5e1" }}>•</span>
                  <span style={{ fontSize:11, color:"var(--text-3,#94a3b8)" }}>{agoraStr(t.created_at)}</span>
                </div>
                <div style={{ display:"flex", gap:12 }}>
                  <span style={{ fontSize:12, color:"var(--text-3,#94a3b8)" }}>❤️ {t.likes}</span>
                  <span style={{ fontSize:12, color:"var(--text-3,#94a3b8)" }}>💬 {t.total_comentarios}</span>
                  {isAdmin && (
                    <button style={{ background:"none", border:"none", fontSize:14, cursor:"pointer" }} onClick={e => { e.stopPropagation(); deletarTopico(t.id); }}>🗑️</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* FAB: novo tópico */}
        <button
          style={{ position:"fixed", bottom:84, right:"calc(50% - 228px)", background:corAcento, color:"#fff", border:"none", borderRadius:28, padding:"14px 20px", fontSize:14, fontWeight:800, cursor:"pointer", boxShadow:`0 4px 20px ${corAcento}66`, display:"flex", alignItems:"center", gap:8, fontFamily:"Inter, system-ui, sans-serif", zIndex:40 }}
          onClick={() => { setModalNovoTopico(true); setFormTopico({ titulo:"", conteudo:"", categoria:"geral" }); }}>
          ✏️ Novo tópico
        </button>

        {/* Modal: novo tópico */}
        {modalNovoTopico && (
          <div style={S.modalOverlay}>
            <div style={{ ...S.modal, maxHeight:"90vh", overflowY:"auto" as const }}>
              <h3 style={S.modalTitle}>📝 Novo tópico</h3>
              <div style={{ display:"flex", flexDirection:"column" as const, gap:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>Categoria</label>
                  <div style={{ display:"flex", flexWrap:"wrap" as const, gap:6 }}>
                    {CATS.filter(c => c.key !== "todos").map(c => (
                      <button key={c.key}
                        style={{ background: formTopico.categoria === c.key ? corAcento : "#f1f5f9", color: formTopico.categoria === c.key ? "#fff" : "#475569", border:"none", borderRadius:20, padding:"6px 12px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
                        onClick={() => setFormTopico(p => ({ ...p, categoria: c.key }))}>
                        {c.icone} {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>Título *</label>
                  <input value={formTopico.titulo} onChange={e => setFormTopico(p => ({ ...p, titulo: e.target.value }))}
                    placeholder="Sobre o que é este tópico?" maxLength={120}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box" as const }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", display:"block", marginBottom:4 }}>Conteúdo *</label>
                  <textarea value={formTopico.conteudo} onChange={e => setFormTopico(p => ({ ...p, conteudo: e.target.value }))}
                    placeholder="Escreva com detalhes. Quanto mais claro, melhor!" rows={5}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1.5px solid var(--border,#e2e8f0)", fontSize:14, fontFamily:"Inter, system-ui, sans-serif", resize:"none" as const, boxSizing:"border-box" as const }} />
                </div>
              </div>
              <button style={{ ...S.btnPrimary, background:corAcento, marginTop:16, opacity: enviandoTopico ? 0.7 : 1 }} onClick={criarTopico} disabled={enviandoTopico}>
                {enviandoTopico ? "Publicando..." : "📢 Publicar tópico"}
              </button>
              <button style={{ ...S.btnSecondary, marginTop:8 }} onClick={() => setModalNovoTopico(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── TELA DE PLANOS ──────────────────────────────────────────────────────────
  if (tela === "planos") {
    const isEmp = modoAtual === "empregador";
    const planos = isEmp ? PLANOS_EMPREGADOR : PLANOS_DIARISTA;
    const planoAtivo = assinatura?.plano || "gratis";

    return (
      <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#060d1f 0%,#0d1a35 80%)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:40 }}>

        {/* Header */}
        <div style={{ padding:"52px 24px 0" }}>
          <button style={{ background:"none", border:"none", color:"var(--text-3,#94a3b8)", fontSize:15, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginBottom:24, padding:0 }}
            onClick={() => setTela(isEmp ? "home-empregador" : "home-diarista")}>← Voltar</button>
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:44, marginBottom:10 }}>🚀</div>
            <div style={{ fontSize:26, fontWeight:900, color:"#fff", lineHeight:1.2, marginBottom:8 }}>Escolha seu plano</div>
            <div style={{ fontSize:14, color:"var(--text-3,#94a3b8)", lineHeight:1.6 }}>
              {isEmp ? "Publique mais vagas e encontre os melhores profissionais de CG." : "Apareça em primeiro e receba mais oportunidades de trabalho."}
            </div>
            {planoAtivo !== "gratis" && (
              <div style={{ display:"inline-block", background:"rgba(255,107,53,.2)", border:"1px solid rgba(255,107,53,.4)", borderRadius:20, padding:"5px 16px", fontSize:12, color:"#FF6B35", fontWeight:800, marginTop:12 }}>
                Plano atual: {planoAtivo.charAt(0).toUpperCase() + planoAtivo.slice(1)} ✅
              </div>
            )}
          </div>
        </div>

        {/* Cards dos planos */}
        <div style={{ padding:"0 20px", display:"flex", flexDirection:"column" as const, gap:16 }}>
          {(planos as readonly { id: string; nome: string; valor: number; cor: string; recursos: readonly string[]; destaque: boolean; popular?: boolean }[]).map(p => {
            const ativo = planoAtivo === p.id;
            return (
              <div key={p.id} style={{ background: ativo ? "rgba(255,107,53,.15)" : "rgba(255,255,255,.06)", border: ativo ? `2px solid ${p.cor}` : `1px solid rgba(255,255,255,.12)`, borderRadius:22, padding:"22px 20px", position:"relative" as const }}>

                {/* Badge popular */}
                {(p as {popular?: boolean}).popular && !ativo && (
                  <div style={{ position:"absolute" as const, top:-12, left:"50%", transform:"translateX(-50%)", background:"#FF6B35", color:"#fff", borderRadius:20, padding:"4px 16px", fontSize:12, fontWeight:800, whiteSpace:"nowrap" as const }}>
                    🔥 Mais popular
                  </div>
                )}
                {ativo && (
                  <div style={{ position:"absolute" as const, top:-12, left:"50%", transform:"translateX(-50%)", background:"#22c55e", color:"#fff", borderRadius:20, padding:"4px 16px", fontSize:12, fontWeight:800, whiteSpace:"nowrap" as const }}>
                    ✅ Plano ativo
                  </div>
                )}

                {/* Cabeçalho do plano */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:900, color:"#fff" }}>{p.nome}</div>
                    {p.valor === 0
                      ? <div style={{ fontSize:13, color:"var(--text-2,#64748b)", marginTop:2 }}>Sempre grátis</div>
                      : <div style={{ fontSize:13, color:"var(--text-3,#94a3b8)", marginTop:2 }}>por mês</div>
                    }
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {p.valor === 0
                      ? <div style={{ fontSize:28, fontWeight:900, color:"var(--text-2,#64748b)" }}>R$ 0</div>
                      : <div style={{ fontSize:28, fontWeight:900, color:p.cor }}>R$ {p.valor}</div>
                    }
                  </div>
                </div>

                {/* Recursos */}
                <div style={{ display:"flex", flexDirection:"column" as const, gap:8, marginBottom: p.valor > 0 ? 18 : 0 }}>
                  {p.recursos.map(r => (
                    <div key={r} style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:18, height:18, borderRadius:9, background:`${p.cor}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1,5 4,8 9,2" stroke={p.cor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span style={{ fontSize:13, color:"#cbd5e1", lineHeight:1.4 }}>{r}</span>
                    </div>
                  ))}
                </div>

                {/* Botão de ação */}
                {p.valor > 0 && !ativo && (
                  <button
                    style={{ width:"100%", padding:"14px", background:p.cor, color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", boxShadow:`0 4px 16px ${p.cor}44`, opacity: criandoAssinatura ? 0.7 : 1 }}
                    disabled={criandoAssinatura}
                    onClick={() => { setAuthError(""); iniciarAssinatura(p.id); }}>
                    {criandoAssinatura ? "Aguarde..." : `Assinar ${p.nome} — R$ ${p.valor}/mês`}
                  </button>
                )}
                {ativo && p.valor > 0 && (
                  <div style={{ textAlign:"center", fontSize:13, color:"#4ade80", fontWeight:700, marginTop:4 }}>
                    ✅ Você já está neste plano
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {authError && <p style={{ color:"#f87171", fontSize:13, fontWeight:700, textAlign:"center", marginTop:16, padding:"0 24px" }}>{authError}</p>}

        {/* FAQ rápido */}
        <div style={{ margin:"28px 20px 0", background:"rgba(255,255,255,.05)", borderRadius:18, padding:"18px 20px" }}>
          <div style={{ fontWeight:800, fontSize:13, color:"var(--text-3,#94a3b8)", marginBottom:14, textTransform:"uppercase" as const, letterSpacing:0.5 }}>Dúvidas</div>
          {[
            { p:"Posso cancelar a qualquer momento?", r:"Sim. Você cancela pelo Mercado Pago quando quiser, sem multa." },
            { p:"Como é cobrado?", r:"Mensalmente via Mercado Pago — cartão, PIX ou saldo." },
            { p:"O plano ativa na hora?", r:"Sim. Após o pagamento confirmado, seu plano é ativado imediatamente." },
          ].map(f => (
            <div key={f.p} style={{ marginBottom:12, paddingBottom:12, borderBottom:"1px solid rgba(255,255,255,.08)" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#f1f5f9", marginBottom:4 }}>{f.p}</div>
              <div style={{ fontSize:12, color:"var(--text-2,#64748b)", lineHeight:1.6 }}>{f.r}</div>
            </div>
          ))}
        </div>

        <p style={{ textAlign:"center", color:"#334155", fontSize:11, margin:"20px 24px 0", lineHeight:1.6 }}>
          Os planos são gerenciados pelo Mercado Pago. O DiáriaJá não armazena dados de cartão.
        </p>
      </div>
    );
  }

  // Fallback de segurança: se nenhuma tela encaixar, mostra splash em vez de tela branca
  return (
    <div style={{ minHeight:"100vh", background:"#0f172a", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Inter, system-ui, sans-serif" }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:32 }}>
        <div style={{ fontSize:48 }}>⚡</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Diária<span style={{ color:"#FF6B35" }}>Já</span></div>
        <p style={{ color:"var(--text-2,#64748b)", fontSize:14 }}>Algo deu errado. Toque para voltar ao início.</p>
        <button
          style={{ background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, padding:"12px 28px", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" }}
          onClick={() => { setProfile(null); setTela("splash"); setLoading(false); }}>
          Voltar ao início
        </button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  splash:           { minHeight:"100vh", background:"#0f172a", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Inter, system-ui, sans-serif" },
  splashInner:      { display:"flex", flexDirection:"column", alignItems:"center", gap:20, padding:32 },
  logo:             { display:"flex", alignItems:"center", gap:10 },
  logoIcon:         { fontSize:40 },
  logoText:         { fontSize:42, fontWeight:900, color:"#FF6B35", letterSpacing:-1 },
  splashSub:        { color:"var(--text-3,#94a3b8)", fontSize:20, textAlign:"center", lineHeight:1.5, margin:"8px 0 24px" },
  page:             { minHeight:"100vh", background:"var(--bg-surface,#f8fafc)", padding:"24px 20px", fontFamily:"Inter, system-ui, sans-serif", display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto" },
  pageTitle:        { fontSize:26, fontWeight:900, color:"var(--text-1,#0f172a)", margin:"16px 0 8px" },
  subTexto:         { color:"var(--text-2,#64748b)", fontSize:14, marginBottom:20 },
  back:             { background:"none", border:"none", color:"#FF6B35", fontSize:16, cursor:"pointer", padding:0, marginBottom:8, fontFamily:"Inter, system-ui, sans-serif" },
  label:            { fontSize:12, fontWeight:700, color:"var(--text-label,#475569)", marginBottom:4, marginTop:12, textTransform:"uppercase", letterSpacing:0.5 },
  input:            { width:"100%", padding:"13px 16px", border:"2px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:16, background:"var(--input-bg,#fff)", color:"var(--text-1,#0f172a)", fontFamily:"Inter, system-ui, sans-serif", boxSizing:"border-box", marginBottom:4, outline:"none" },
  btnPrimary:       { width:"100%", padding:"15px", background:"#FF6B35", color:"#fff", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", marginTop:8 },
  btnSecondary:     { width:"100%", padding:"13px", background:"transparent", color:"#FF6B35", border:"2px solid #FF6B35", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" },
  btnGoogle:        { width:"100%", padding:"13px", background:"var(--bg-card,#fff)", color:"var(--text-1,#0f172a)", border:"2px solid var(--border,#e2e8f0)", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", display:"flex", alignItems:"center", justifyContent:"center", marginTop:4 },
  divider:          { display:"flex", alignItems:"center", gap:10, margin:"16px 0 8px" },
  dividerLine:      { flex:1, height:1, background:"var(--border,#e2e8f0)" },
  dividerText:      { color:"var(--text-3,#94a3b8)", fontSize:13, whiteSpace:"nowrap" },
  errorText:        { color:"#ef4444", fontSize:13, fontWeight:600, marginTop:8, textAlign:"center" },
  link:             { color:"#FF6B35", textAlign:"center", cursor:"pointer", fontSize:15 },
  tipoGrid:         { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, margin:"8px 0 24px" },
  tipoCard:         { background:"var(--bg-card,#fff)", border:"2px solid var(--border,#e2e8f0)", borderRadius:16, padding:"24px 12px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, cursor:"pointer" },
  tipoCardAtivo:    { border:"2px solid #FF6B35", background:"#FF6B3518" },
  tipoIcon:         { fontSize:36 },
  tipoLabel:        { fontWeight:800, fontSize:15, color:"var(--text-1,#0f172a)" },
  tipoDesc:         { fontSize:11, color:"var(--text-3,#94a3b8)", textAlign:"center" },
  negocioGrid:      { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, margin:"8px 0 20px" },
  negocioCard:      { background:"var(--bg-card,#fff)", border:"2px solid var(--border,#e2e8f0)", borderRadius:16, padding:"18px 12px", display:"flex", flexDirection:"column", alignItems:"center", gap:6, cursor:"pointer" },
  negocioIcone:     { fontSize:32 },
  negocioLabel:     { fontWeight:800, fontSize:15, color:"var(--text-1,#0f172a)" },
  negocioFuncoes:   { fontSize:10, color:"var(--text-3,#94a3b8)", textAlign:"center", lineHeight:1.4 },
  diasRow:          { display:"flex", gap:8, flexWrap:"wrap", margin:"8px 0" },
  diaBtn:           { padding:"8px 11px", borderRadius:8, border:"2px solid var(--border,#e2e8f0)", background:"var(--bg-card,#fff)", fontSize:12, fontWeight:700, cursor:"pointer", color:"var(--text-label,#475569)", fontFamily:"Inter, system-ui, sans-serif" },
  diaBtnAtivo:      { background:"#FF6B35", color:"#fff", border:"2px solid #FF6B35" },
  switchRow:        { display:"flex", alignItems:"center", justifyContent:"space-between", margin:"12px 0" },
  toggle:           { width:48, height:28, borderRadius:14, background:"var(--border,#e2e8f0)", cursor:"pointer", position:"relative", transition:"background .2s" },
  toggleAtivo:      { background:"#FF6B35" },
  toggleThumb:      { width:22, height:22, borderRadius:11, background:"var(--bg-card,#fff)", position:"absolute", top:3, left:3, transition:"left .2s", boxShadow:"0 1px 4px rgba(0,0,0,.2)" },
  toggleThumbAtivo: { left:23 },
  appShell:         { minHeight:"100vh", background:"var(--bg-app,#f0f2f5)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:32 },
  header:           { padding:"20px 20px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" },
  headerSub:        { color:"rgba(255,255,255,0.75)", fontSize:11, textTransform:"uppercase", letterSpacing:1 },
  headerTitle:      { color:"#fff", fontSize:20, fontWeight:900 },
  headerBack:       { background:"rgba(255,255,255,0.2)", border:"none", color:"#fff", fontSize:20, cursor:"pointer", width:36, height:36, borderRadius:18, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Inter, system-ui, sans-serif" },
  logoutBtn:        { background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", padding:"6px 14px", borderRadius:8, fontFamily:"Inter, system-ui, sans-serif" },
  avatar:           { width:40, height:40, borderRadius:20, background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:900, fontSize:14 },
  tabs:             { display:"flex", background:"var(--bg-card,#fff)", borderBottom:"2px solid var(--border,#e2e8f0)" },
  tab:              { flex:1, padding:"13px", borderTopWidth:0, borderLeftWidth:0, borderRightWidth:0, borderBottomWidth:3, borderBottomStyle:"solid", borderBottomColor:"transparent", background:"none", fontSize:14, fontWeight:700, color:"var(--text-3,#94a3b8)", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" },
  tabAtivo:         { borderBottomWidth:3, borderBottomStyle:"solid", borderBottomColor:"#FF6B35", color:"#FF6B35" },
  filtrosRow:       { display:"flex", gap:8, padding:"10px 16px", overflowX:"auto", background:"var(--bg-card,#fff)" },
  filtroBtn:        { whiteSpace:"nowrap", padding:"6px 13px", borderRadius:20, border:"2px solid var(--border,#e2e8f0)", background:"var(--bg-surface,#f8fafc)", fontSize:12, fontWeight:700, cursor:"pointer", color:"var(--text-label,#475569)", fontFamily:"Inter, system-ui, sans-serif" },
  filtroBtnAtivo:   { background:"var(--text-1,#0f172a)", color:"#fff", border:"2px solid var(--text-1,#0f172a)" },
  lista:            { padding:"12px 16px", display:"flex", flexDirection:"column", gap:12 },
  vazio:            { textAlign:"center", color:"var(--text-3,#94a3b8)", padding:"32px 0", fontSize:15 },
  card:             { background:"var(--bg-card,#fff)", borderRadius:16, padding:14, display:"flex", gap:12, alignItems:"center", boxShadow:"0 2px 8px rgba(0,0,0,.06)", cursor:"pointer" },
  cardAvatar:       { width:50, height:50, borderRadius:25, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:15, flexShrink:0 },
  cardInfo:         { flex:1 },
  cardNome:         { fontWeight:800, fontSize:14, color:"var(--text-1,#0f172a)" },
  cardRamo:         { color:"var(--text-2,#64748b)", fontSize:12, margin:"2px 0" },
  cardMeta:         { color:"var(--text-3,#94a3b8)", fontSize:11, display:"flex", gap:4, alignItems:"center" },
  cardRight:        { display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 },
  cardValor:        { fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)" },
  cardDia:          { fontSize:10, color:"var(--text-3,#94a3b8)" },
  star:             { color:"#f59e0b" },
  dot:              { color:"var(--border,#e2e8f0)" },
  badge:            { padding:"3px 8px", borderRadius:20, fontSize:10, fontWeight:700 },
  badgeVerde:       { background:"#dcfce7", color:"#16a34a" },
  badgeCinza:       { background:"var(--bg-subtle,#f1f5f9)", color:"var(--text-3,#94a3b8)" },
  mapaContainer:    { margin:16, height:400, borderRadius:20, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,.1)" },
  perfilHeader:     { display:"flex", flexDirection:"column", alignItems:"center", padding:"20px 20px 14px", background:"var(--bg-card,#fff)", borderBottom:"1px solid var(--border-sub,#f1f5f9)" },
  perfilAvatar:     { width:76, height:76, borderRadius:38, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:24, marginBottom:10 },
  perfilNome:       { fontSize:22, fontWeight:900, color:"var(--text-1,#0f172a)", margin:0 },
  perfilRamo:       { color:"var(--text-2,#64748b)", fontSize:14, margin:"3px 0" },
  perfilMeta:       { color:"var(--text-3,#94a3b8)", fontSize:12, display:"flex", gap:6, alignItems:"center" },
  section:          { padding:"14px 20px", borderBottom:"1px solid var(--border-sub,#f1f5f9)", background:"var(--bg-card,#fff)", marginTop:8 },
  sectionTitle:     { fontWeight:800, fontSize:11, color:"var(--text-3,#94a3b8)", textTransform:"uppercase", letterSpacing:1, marginBottom:10 },
  valorGrande:      { fontSize:30, fontWeight:900, color:"var(--text-1,#0f172a)" },
  avaliacaoItem:    { display:"flex", alignItems:"center", padding:"7px 0", borderBottom:"1px solid var(--border-sub,#f1f5f9)" },
  modalOverlay:     { position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100 },
  modal:            { background:"var(--bg-card,#fff)", borderRadius:"20px 20px 0 0", padding:"24px 22px 36px", width:"100%", maxWidth:480 },
  modalTitle:       { fontSize:19, fontWeight:900, color:"var(--text-1,#0f172a)", marginBottom:10 },
  modalText:        { color:"var(--text-label,#475569)", fontSize:14, marginBottom:18 },
  modalRow:         { display:"flex", justifyContent:"space-between", padding:"7px 0", color:"var(--text-label,#475569)", fontSize:14 },
  sucesso:          { display:"flex", flexDirection:"column", alignItems:"center", gap:10 },
  diaristaDash:     { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, padding:"14px", background:"var(--bg-card,#fff)", borderBottom:"1px solid var(--border-sub,#f1f5f9)" },
  dashCard:         { background:"var(--bg-surface,#f8fafc)", borderRadius:12, padding:"12px 6px", textAlign:"center" },
  dashNum:          { fontWeight:900, fontSize:16, color:"var(--text-1,#0f172a)" },
  dashLabel:        { fontSize:10, color:"var(--text-3,#94a3b8)", marginTop:3 },
  propostaCard:     { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 0", borderBottom:"1px solid var(--border-sub,#f1f5f9)" },
  btnAceitar:       { background:"#dcfce7", color:"#16a34a", border:"none", borderRadius:8, padding:"6px 12px", fontWeight:700, fontSize:12, cursor:"pointer" },
  btnEditarPerfil:  { background:"var(--btn-edit-bg,#f1f5f9)", border:"none", borderRadius:10, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", color:"var(--btn-edit-cl,#475569)", fontFamily:"Inter, system-ui, sans-serif" },
  perfilInfoRow:    { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid var(--border-sub,#f1f5f9)" },
  perfilInfoLabel:  { fontSize:12, color:"var(--text-3,#94a3b8)", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:0.5 },
  perfilInfoVal:    { fontSize:14, color:"var(--text-1,#0f172a)", fontWeight:600 },
  bottomNav:        { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"var(--bg-card,#fff)", borderTop:"1px solid var(--border,#e2e8f0)", display:"flex", zIndex:50 },
  bottomNavBtn:     { flex:1, padding:"10px 0", border:"none", background:"none", display:"flex", flexDirection:"column" as const, alignItems:"center", gap:2, fontSize:11, fontWeight:700, color:"var(--text-3,#94a3b8)", cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif" },
  bottomNavAtivo:   { color:"#FF6B35" },
};
