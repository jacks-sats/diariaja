// ── Leitura pública de UMA vaga (Edge, anon) ────────────────────────────────
// Compartilhado pelas rotas /vaga/[id] (HTML + Open Graph) e /api/og/[id]
// (imagem da prévia). Usa a RPC SECURITY DEFINER `vaga_publica`, que devolve
// SÓ campos públicos (nunca endereço/contato/anunciante) e SÓ vaga aberta —
// a policy de `diarias` exige login, então a anon key não lê a tabela direto.
// A URL/anon key têm fallback de produção (públicas por design; RLS protege).

export interface VagaPublica {
  id: string;
  tipo_oferta: string | null;
  funcao: string | null;
  segmento: string | null;
  descricao: string | null;
  valor: number | null;
  salario_texto: string | null;
  tempo_estimado_min: number | null;
  tipo_contrato: string | null;
  regime: string | null;
  bairro: string | null;
  data: string | null;
  horario_inicio: string | null;
  horario_fim: string | null;
  status: string | null;
}

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://rpszebrrrasoijfdvner.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwc3plYnJycmFzb2lqZmR2bmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4NzYxMTAsImV4cCI6MjA2NDQ1MjExMH0.4qcSHDBIrPHDHRPnHUdxZLYnMLQI-ApYNVUOtNvhBiE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function buscarVagaPublica(id: string): Promise<VagaPublica | null> {
  if (!UUID_RE.test(id)) return null; // corta lixo antes de bater no banco
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vaga_publica`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_id: id }),
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as VagaPublica[];
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

// dd/mm/aaaa a partir do ISO (a coluna é texto "2026-07-14"); inválido → "".
export function dataBR(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso || "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

// Linha de valor conforme o tipo da oferta (mesma regra do montarTextoVaga).
export function valorVaga(v: VagaPublica): string {
  if (v.tipo_oferta === "emprego") return (v.salario_texto || "").trim() || "A combinar";
  if (typeof v.valor === "number" && v.valor > 0) {
    return `R$ ${v.valor}${v.tipo_oferta === "servico" ? "" : "/dia"}`;
  }
  return "Envie sua proposta";
}

export function tituloVaga(v: VagaPublica): string {
  return (v.funcao || "").trim() || (v.segmento || "").trim() || "Vaga disponível";
}

// Bairro + cidade fixa (MVP: só Campo Grande/MS — não há coluna cidade/UF).
export function localVaga(v: VagaPublica): string {
  const bairro = (v.bairro || "").trim();
  return bairro ? `${bairro} · Campo Grande/MS` : "Campo Grande/MS";
}
