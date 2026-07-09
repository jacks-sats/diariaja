import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import type { Diaria, UserProfile } from "../../types";
import { CampoData } from "../../components/CampoData";
import { CampoHora } from "../../components/CampoHora";
import {
  ATIVIDADES_SERVICO_EMPRESA,
  CHECKLIST_SERVICO_EMPRESA_PADRAO,
  MODELOS_SERVICO_EMPRESA,
  SERVICOS_EMPRESARIAIS,
} from "../../constants";

type LojaForm = {
  nome_loja: string;
  cep: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  janela_inicio: string;
  janela_fim: string;
  lat: number | null;
  lng: number | null;
  geo_preciso: boolean;
  buscando: boolean;
};

type ChecklistForm = {
  pergunta: string;
  tipo: "sim_nao" | "texto" | "numero" | "foto";
  obrigatorio: boolean;
};

type Props = {
  session: Session | null;
  profile: UserProfile | null;
  negocioSelecionado: string | null;
  isDesktop: boolean;
  onVoltar: () => void;
  onPublicado: (diaria: Diaria) => void;
  onErro: (mensagem: string) => void;
};

const lojaVazia = (): LojaForm => ({
  nome_loja: "",
  cep: "",
  endereco: "",
  bairro: "",
  cidade: "",
  estado: "",
  janela_inicio: "",
  janela_fim: "",
  lat: null,
  lng: null,
  geo_preciso: false,
  buscando: false,
});

const checklistPadraoInicial = (): ChecklistForm[] =>
  CHECKLIST_SERVICO_EMPRESA_PADRAO.map((pergunta) => ({
    pergunta,
    tipo: pergunta === "Observações gerais" ? "texto" : "sim_nao",
    obrigatorio: pergunta !== "Observações gerais",
  }));

const checklistInicial = (tipoServico?: string): ChecklistForm[] => {
  const modelo = tipoServico ? MODELOS_SERVICO_EMPRESA[tipoServico] : null;
  if (modelo?.checklist?.length) {
    return modelo.checklist.map((item) => ({
      pergunta: item.pergunta,
      tipo: item.tipo,
      obrigatorio: item.obrigatorio ?? item.tipo !== "texto",
    }));
  }
  return checklistPadraoInicial();
};

const atividadesIniciais = (tipoServico: string): string[] =>
  MODELOS_SERVICO_EMPRESA[tipoServico]?.atividades || [
    "Abastecer gôndola",
    "Organizar produtos",
    "Verificar validade",
    "Tirar fotos",
  ];

const inputBase: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1.5px solid var(--border,#e2e8f0)",
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 14,
  color: "var(--text-1,#0f172a)",
  background: "var(--bg-card,#fff)",
  fontFamily: "Inter, system-ui, sans-serif",
  outline: "none",
};

const labelBase: CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-2,#64748b)",
  fontWeight: 800,
  margin: "12px 0 6px",
};

function numeroValor(valor: string): number {
  const n = Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function textoEndereco(loja: LojaForm): string {
  return [loja.endereco, loja.bairro, loja.cidade && loja.estado ? `${loja.cidade}/${loja.estado}` : loja.cidade]
    .filter(Boolean)
    .join(", ");
}

export default function PublicarServicoEmpresa({
  session,
  profile,
  negocioSelecionado,
  isDesktop,
  onVoltar,
  onPublicado,
  onErro,
}: Props) {
  const [passo, setPasso] = useState(1);
  const tipoServicoInicial = SERVICOS_EMPRESARIAIS[0].id;
  const [tipoServico, setTipoServico] = useState<string>(tipoServicoInicial);
  const [marca, setMarca] = useState("");
  const [produto, setProduto] = useState("");
  const [atividades, setAtividades] = useState<string[]>(() => atividadesIniciais(tipoServicoInicial));
  const [materialFornecido, setMaterialFornecido] = useState("");
  const [uniforme, setUniforme] = useState("");
  const [treinamentoNecessario, setTreinamentoNecessario] = useState(false);
  const [treinamentoTexto, setTreinamentoTexto] = useState("");
  const [dataServico, setDataServico] = useState("");
  const [inicio, setInicio] = useState("08:00");
  const [fim, setFim] = useState("17:00");
  const [valor, setValor] = useState("");
  const [qtdPromotores, setQtdPromotores] = useState(1);
  const [observacoes, setObservacoes] = useState("");
  const [lojas, setLojas] = useState<LojaForm[]>([lojaVazia()]);
  const [exigeFotos, setExigeFotos] = useState(true);
  const [exigeRelatorio, setExigeRelatorio] = useState(true);
  const [exigeCheckin, setExigeCheckin] = useState(true);
  const [checklist, setChecklist] = useState<ChecklistForm[]>(() => checklistInicial(tipoServicoInicial));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const servico = useMemo(
    () => SERVICOS_EMPRESARIAIS.find((s) => s.id === tipoServico) || SERVICOS_EMPRESARIAIS[0],
    [tipoServico],
  );
  const modeloServico = useMemo(() => MODELOS_SERVICO_EMPRESA[tipoServico], [tipoServico]);
  const atividadesDisponiveis = useMemo(
    () => modeloServico?.atividades?.length ? modeloServico.atividades : [...ATIVIDADES_SERVICO_EMPRESA],
    [modeloServico],
  );

  const totalEstimado = numeroValor(valor) * qtdPromotores;
  const lojaPrincipal = lojas[0];

  const atualizarLoja = (index: number, patch: Partial<LojaForm>) => {
    setLojas((prev) => prev.map((loja, i) => (i === index ? { ...loja, ...patch } : loja)));
  };

  const selecionarTipoServico = (id: string) => {
    const novoChecklist = checklistInicial(id);
    setTipoServico(id);
    setAtividades(atividadesIniciais(id));
    setChecklist(novoChecklist);
    setExigeFotos(novoChecklist.some((item) => item.tipo === "foto"));
    setExigeRelatorio(true);
    setExigeCheckin(true);
    setErro("");
  };

  const buscarCepLoja = async (index: number, cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g, "").slice(0, 8);
    atualizarLoja(index, { cep: cep.length > 5 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep });
    if (cep.length !== 8) return;

    atualizarLoja(index, { buscando: true });
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
      const data = await resp.json().catch(() => null) as {
        street?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        location?: { coordinates?: { latitude?: string | number; longitude?: string | number } };
      } | null;
      const lat = Number(data?.location?.coordinates?.latitude);
      const lng = Number(data?.location?.coordinates?.longitude);
      atualizarLoja(index, {
        endereco: data?.street || "",
        bairro: data?.neighborhood || "",
        cidade: data?.city || "",
        estado: data?.state || "",
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        geo_preciso: Number.isFinite(lat) && Number.isFinite(lng),
        buscando: false,
      });
    } catch {
      atualizarLoja(index, { buscando: false });
    }
  };

  const validar = (): string | null => {
    if (!session?.user) return "Sua sessão expirou. Entre novamente.";
    if (!marca.trim()) return "Informe a marca ou empresa responsável pelo serviço.";
    if (!dataServico) return "Informe a data do serviço.";
    if (!inicio || !fim) return "Informe início e término.";
    if (numeroValor(valor) <= 0) return "Informe o valor da diária.";
    if (qtdPromotores < 1 || qtdPromotores > 20) return "A quantidade de profissionais deve ficar entre 1 e 20.";
    if (atividades.length === 0) return "Escolha pelo menos uma atividade do serviço.";
    const lojaInvalida = lojas.find((loja) => !loja.nome_loja.trim() || !loja.endereco.trim() || !loja.cidade.trim());
    if (lojaInvalida) return "Preencha nome, endereço e cidade de todas as lojas.";
    if (checklist.some((item) => !item.pergunta.trim())) return "Remova ou preencha os itens vazios do checklist.";
    return null;
  };

  const publicar = async () => {
    const erroValidacao = validar();
    if (erroValidacao) {
      setErro(erroValidacao);
      onErro(erroValidacao);
      return;
    }
    if (!session?.user) return;

    setErro("");
    setSalvando(true);

    const endereco = textoEndereco(lojaPrincipal);
    const descricao = [
      produto.trim() ? `Produto: ${produto.trim()}` : "",
      atividades.length ? `Atividades: ${atividades.join(", ")}` : "",
      observacoes.trim(),
    ].filter(Boolean).join("\n");

    const diariaPayload = {
      empregador_id: session.user.id,
      nome_negocio: `${servico.nome}${marca.trim() ? ` - ${marca.trim()}` : ""}`,
      segmento: negocioSelecionado || profile?.segmento || "Supermercado / Varejo",
      funcao: servico.nome,
      descricao,
      data: dataServico,
      horario_inicio: inicio,
      horario_fim: fim,
      valor: numeroValor(valor),
      status: "aberta",
      vagas: qtdPromotores,
      vagas_preenchidas: 0,
      endereco,
      bairro: lojaPrincipal.bairro || null,
      lat: lojaPrincipal.lat,
      lng: lojaPrincipal.lng,
      geo_preciso: lojaPrincipal.geo_preciso,
      tipo_oferta: "servico_empresa",
    };

    const { data: diaria, error: erroDiaria } = await supabase
      .from("diarias")
      .insert(diariaPayload)
      .select()
      .single();

    if (erroDiaria || !diaria) {
      const msg = erroDiaria?.message || "Não foi possível publicar o serviço empresarial.";
      setErro(msg);
      onErro(msg);
      setSalvando(false);
      return;
    }

    const diariaId = (diaria as Diaria).id;
    const desfazerCriacao = async () => {
      await supabase.from("diarias").delete().eq("id", diariaId).eq("empregador_id", session.user.id);
    };

    const { error: erroDetalhes } = await supabase.from("servico_empresa_detalhes").insert({
      diaria_id: diariaId,
      tipo_servico: tipoServico,
      marca: marca.trim() || null,
      produto: produto.trim() || null,
      atividades,
      exige_fotos: exigeFotos,
      exige_relatorio: exigeRelatorio,
      exige_checkin: exigeCheckin,
      material_fornecido: materialFornecido.trim() || null,
      uniforme: uniforme.trim() || null,
      treinamento_necessario: treinamentoNecessario,
      treinamento_texto: treinamentoTexto.trim() || null,
      instrucoes: observacoes.trim() || null,
    });

    if (erroDetalhes) {
      await desfazerCriacao();
      setErro("A migration do módulo empresarial ainda não parece aplicada no Supabase.");
      onErro("A migration do módulo empresarial ainda não parece aplicada no Supabase.");
      setSalvando(false);
      return;
    }

    const { error: erroLojas } = await supabase.from("servico_lojas").insert(
      lojas.map((loja, index) => ({
        diaria_id: diariaId,
        ordem: index + 1,
        nome_loja: loja.nome_loja.trim(),
        cep: loja.cep || null,
        endereco: loja.endereco.trim(),
        bairro: loja.bairro.trim() || null,
        cidade: loja.cidade.trim() || null,
        estado: loja.estado.trim() || null,
        lat: loja.lat,
        lng: loja.lng,
        geo_preciso: loja.geo_preciso,
        janela_inicio: loja.janela_inicio || null,
        janela_fim: loja.janela_fim || null,
      })),
    );

    if (erroLojas) {
      await desfazerCriacao();
      setErro("Não foi possível salvar o roteiro de lojas.");
      onErro("Não foi possível salvar o roteiro de lojas.");
      setSalvando(false);
      return;
    }

    const { error: erroChecklist } = await supabase.from("servico_checklist_itens").insert(
      checklist.map((item, index) => ({
        diaria_id: diariaId,
        ordem: index + 1,
        pergunta: item.pergunta.trim(),
        tipo: item.tipo,
        obrigatorio: item.obrigatorio,
      })),
    );

    if (erroChecklist) {
      await desfazerCriacao();
      setErro("Não foi possível salvar o checklist.");
      onErro("Não foi possível salvar o checklist.");
      setSalvando(false);
      return;
    }

    setSalvando(false);
    onPublicado(diaria as Diaria);
  };

  const botaoNav = (destino: number, label: string) => (
    <button
      type="button"
      onClick={() => setPasso(destino)}
      style={{
        flex: 1,
        border: "none",
        borderRadius: 12,
        padding: "13px 12px",
        background: destino > passo ? "#f1f5f9" : "#e11d48",
        color: destino > passo ? "#64748b" : "#fff",
        fontWeight: 900,
        fontFamily: "Inter, system-ui, sans-serif",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app,#f0f2f5)", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: isDesktop ? 760 : 480, margin: "0 auto", padding: "42px 16px 80px" }}>
        <button
          type="button"
          onClick={onVoltar}
          style={{ border: "none", background: "transparent", color: "#64748b", fontSize: 15, fontWeight: 800, padding: 0, cursor: "pointer" }}
        >
          ← Voltar
        </button>

        <div style={{ marginTop: 16, borderRadius: 18, padding: 18, background: "linear-gradient(135deg,#e11d48,#ef4444)", color: "#fff" }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4, textTransform: "uppercase" }}>Serviços para Empresas</div>
          <h1 style={{ margin: "4px 0 4px", fontSize: 24, lineHeight: 1.15 }}>Publicar operação de trade</h1>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, opacity: 0.9 }}>
            Roteiro de lojas, checklist, fotos e comprovação para supermercados, atacarejos e indústrias.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, margin: "14px 0" }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Ir para passo ${n}`}
              onClick={() => setPasso(n)}
              style={{
                height: 8,
                border: "none",
                borderRadius: 999,
                background: n <= passo ? "#e11d48" : "#cbd5e1",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        <div style={{ background: "var(--bg-card,#fff)", border: "1px solid var(--border,#e2e8f0)", borderRadius: 16, padding: 16, boxShadow: "0 6px 20px rgba(15,23,42,.06)" }}>
          {passo === 1 && (
            <>
              <h2 style={tituloPasso}>1. Tipo de serviço</h2>
              <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 10 }}>
                {SERVICOS_EMPRESARIAIS.map((item) => {
                  const ativo = item.id === tipoServico;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selecionarTipoServico(item.id)}
                      style={{
                        textAlign: "left",
                        border: ativo ? "2px solid #e11d48" : "1.5px solid #e2e8f0",
                        background: ativo ? "#fff1f2" : "#fff",
                        color: "#0f172a",
                        borderRadius: 14,
                        padding: "13px 14px",
                        cursor: "pointer",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 14 }}>{item.nome}</div>
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>{item.subtitulo}</div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {passo === 2 && (
            <>
              <h2 style={tituloPasso}>2. Detalhes - {servico.nome}</h2>
              <label style={labelBase}>Marca ou empresa responsável *</label>
              <input style={inputBase} value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ex: Coca-Cola, Nestlé, distribuidora regional" />

              <label style={labelBase}>{modeloServico?.produtoLabel || "Produto ou linha"}</label>
              <input style={inputBase} value={produto} onChange={(e) => setProduto(e.target.value)} placeholder={modeloServico?.produtoPlaceholder || "Ex: Bebidas, biscoitos, higiene, linha promocional"} />

              <label style={labelBase}>Atividades de {servico.nome}</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {atividadesDisponiveis.map((atividade) => {
                  const ativo = atividades.includes(atividade);
                  return (
                    <button
                      key={atividade}
                      type="button"
                      onClick={() => setAtividades((prev) => ativo ? prev.filter((a) => a !== atividade) : [...prev, atividade])}
                      style={{
                        border: ativo ? "1.5px solid #e11d48" : "1.5px solid #e2e8f0",
                        background: ativo ? "#fff1f2" : "#fff",
                        color: ativo ? "#be123c" : "#475569",
                        borderRadius: 999,
                        padding: "8px 11px",
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {atividade}
                    </button>
                  );
                })}
              </div>

              <label style={labelBase}>Materiais fornecidos</label>
              <input style={inputBase} value={materialFornecido} onChange={(e) => setMaterialFornecido(e.target.value)} placeholder={modeloServico?.materialPlaceholder || "Ex: camisa, faixa, wobblers, cartazes"} />

              <label style={labelBase}>Uniforme obrigatório</label>
              <input style={inputBase} value={uniforme} onChange={(e) => setUniforme(e.target.value)} placeholder={modeloServico?.uniformePlaceholder || "Ex: calça preta, camisa da marca, sapato fechado"} />

              <label style={{ ...labelBase, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={treinamentoNecessario} onChange={(e) => setTreinamentoNecessario(e.target.checked)} />
                Treinamento necessário
              </label>
              {treinamentoNecessario && (
                <textarea style={{ ...inputBase, height: 72, resize: "none" }} value={treinamentoTexto} onChange={(e) => setTreinamentoTexto(e.target.value)} placeholder="Explique o treinamento ou instrução antes da execução" />
              )}
            </>
          )}

          {passo === 3 && (
            <>
              <h2 style={tituloPasso}>3. Data, horário e valor</h2>
              <label style={labelBase}>Data *</label>
              <CampoData estilo={inputBase} valorISO={dataServico} onChangeISO={setDataServico} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelBase}>Início *</label>
                  <CampoHora estilo={inputBase} valor={inicio} onChange={setInicio} />
                </div>
                <div>
                  <label style={labelBase}>Término *</label>
                  <CampoHora estilo={inputBase} valor={fim} onChange={setFim} />
                </div>
              </div>
              <label style={labelBase}>Valor por profissional *</label>
              <input style={inputBase} type="number" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex: 120" />

              <label style={labelBase}>Quantidade de profissionais</label>
              <div style={{ display: "grid", gridTemplateColumns: "48px 1fr 48px", gap: 8, alignItems: "center" }}>
                <button type="button" style={stepperBtn} onClick={() => setQtdPromotores((v) => Math.max(1, v - 1))}>−</button>
                <div style={{ ...inputBase, textAlign: "center", fontWeight: 900 }}>{qtdPromotores}</div>
                <button type="button" style={{ ...stepperBtn, background: "#e11d48", color: "#fff" }} onClick={() => setQtdPromotores((v) => Math.min(20, v + 1))}>+</button>
              </div>

              <label style={labelBase}>Instruções adicionais</label>
              <textarea style={{ ...inputBase, height: 90, resize: "none" }} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder={modeloServico?.observacaoPlaceholder || "Ex: retirar material na portaria, falar com gerente do setor, levar documento"} />
            </>
          )}

          {passo === 4 && (
            <>
              <h2 style={tituloPasso}>4. Roteiro de lojas</h2>
              {lojas.map((loja, index) => (
                <div key={index} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 13, color: "#0f172a" }}>Loja {index + 1}</strong>
                    {lojas.length > 1 && (
                      <button type="button" onClick={() => setLojas((prev) => prev.filter((_, i) => i !== index))} style={botaoTexto}>Remover</button>
                    )}
                  </div>
                  <label style={labelBase}>Nome da loja *</label>
                  <input style={inputBase} value={loja.nome_loja} onChange={(e) => atualizarLoja(index, { nome_loja: e.target.value })} placeholder="Ex: Comper Centro" />
                  <label style={labelBase}>CEP</label>
                  <input style={inputBase} value={loja.cep} maxLength={9} inputMode="numeric" onChange={(e) => buscarCepLoja(index, e.target.value)} placeholder="00000-000" />
                  {loja.buscando && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>Buscando endereço...</div>}
                  <label style={labelBase}>Endereço *</label>
                  <input style={inputBase} value={loja.endereco} onChange={(e) => atualizarLoja(index, { endereco: e.target.value })} placeholder="Rua, número e complemento" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 8 }}>
                    <div>
                      <label style={labelBase}>Bairro</label>
                      <input style={inputBase} value={loja.bairro} onChange={(e) => atualizarLoja(index, { bairro: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelBase}>Cidade *</label>
                      <input style={inputBase} value={loja.cidade} onChange={(e) => atualizarLoja(index, { cidade: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelBase}>UF</label>
                      <input style={inputBase} value={loja.estado} maxLength={2} onChange={(e) => atualizarLoja(index, { estado: e.target.value.toUpperCase().slice(0, 2) })} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" style={botaoSecundario} onClick={() => setLojas((prev) => [...prev, lojaVazia()])}>+ Adicionar loja</button>
            </>
          )}

          {passo === 5 && (
            <>
              <h2 style={tituloPasso}>5. Checklist de {servico.nome}</h2>
              {[
                ["Exigir check-in por loja", exigeCheckin, setExigeCheckin],
                ["Exigir fotos da execução", exigeFotos, setExigeFotos],
                ["Gerar relatório para a empresa", exigeRelatorio, setExigeRelatorio],
              ].map(([texto, valorAtual, setter]) => (
                <label key={String(texto)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: "1px solid #f1f5f9", color: "#0f172a", fontWeight: 800, fontSize: 13 }}>
                  {texto as string}
                  <input type="checkbox" checked={valorAtual as boolean} onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)} />
                </label>
              ))}

              <label style={labelBase}>Itens do checklist</label>
              {checklist.map((item, index) => (
                <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 104px 34px", gap: 8, marginBottom: 8 }}>
                  <input style={inputBase} value={item.pergunta} onChange={(e) => setChecklist((prev) => prev.map((x, i) => i === index ? { ...x, pergunta: e.target.value } : x))} />
                  <select style={inputBase} value={item.tipo} onChange={(e) => setChecklist((prev) => prev.map((x, i) => i === index ? { ...x, tipo: e.target.value as ChecklistForm["tipo"] } : x))}>
                    <option value="sim_nao">Sim/não</option>
                    <option value="texto">Texto</option>
                    <option value="numero">Número</option>
                    <option value="foto">Foto</option>
                  </select>
                  <button type="button" style={iconeBtn} aria-label="Remover item" onClick={() => setChecklist((prev) => prev.filter((_, i) => i !== index))}>×</button>
                </div>
              ))}
              <button type="button" style={botaoSecundario} onClick={() => setChecklist((prev) => [...prev, { pergunta: "", tipo: "sim_nao", obrigatorio: true }])}>+ Adicionar item</button>
            </>
          )}

          {passo === 6 && (
            <>
              <h2 style={tituloPasso}>6. Resumo e publicação</h2>
              <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                {[
                  ["Serviço", servico.nome],
                  ["Marca", marca || "—"],
                  ["Produto", produto || "—"],
                  ["Data", dataServico || "—"],
                  ["Horário", `${inicio} às ${fim}`],
                  ["Lojas", String(lojas.length)],
                  ["Profissionais", String(qtdPromotores)],
                  ["Atividades", atividades.length ? atividades.join(", ") : "—"],
                  ["Checklist", `${checklist.length} itens`],
                  ["Valor por profissional", valor ? `R$ ${numeroValor(valor).toLocaleString("pt-BR")}` : "—"],
                  ["Total estimado", `R$ ${totalEstimado.toLocaleString("pt-BR")}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
                    <span style={{ color: "#64748b" }}>{k}</span>
                    <strong style={{ color: "#0f172a", textAlign: "right" }}>{v}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          {erro && <div style={{ marginTop: 12, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 800 }}>{erro}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            {passo > 1 && botaoNav(passo - 1, "Voltar")}
            {passo < 6 ? botaoNav(passo + 1, "Continuar") : (
              <button type="button" disabled={salvando} onClick={publicar} style={{ ...botaoPrimario, opacity: salvando ? 0.65 : 1 }}>
                {salvando ? "Publicando..." : "Publicar serviço empresarial"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const tituloPasso: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 18,
  color: "var(--text-1,#0f172a)",
};

const botaoPrimario: CSSProperties = {
  flex: 1,
  border: "none",
  borderRadius: 12,
  padding: "13px 12px",
  background: "#e11d48",
  color: "#fff",
  fontWeight: 900,
  fontFamily: "Inter, system-ui, sans-serif",
  cursor: "pointer",
};

const botaoSecundario: CSSProperties = {
  width: "100%",
  border: "1.5px solid #e2e8f0",
  borderRadius: 12,
  padding: "12px",
  background: "#fff",
  color: "#e11d48",
  fontWeight: 900,
  fontFamily: "Inter, system-ui, sans-serif",
  cursor: "pointer",
};

const botaoTexto: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#e11d48",
  fontWeight: 900,
  fontSize: 12,
  cursor: "pointer",
};

const stepperBtn: CSSProperties = {
  height: 46,
  border: "1.5px solid #e2e8f0",
  borderRadius: 12,
  background: "#fff",
  color: "#e11d48",
  fontSize: 22,
  fontWeight: 900,
  cursor: "pointer",
};

const iconeBtn: CSSProperties = {
  border: "none",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#b91c1c",
  fontSize: 20,
  fontWeight: 900,
  cursor: "pointer",
};
