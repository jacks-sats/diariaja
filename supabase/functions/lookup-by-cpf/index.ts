// Edge Function: lookup-by-cpf
// Mapeia CPF/CNPJ → e-mail do usuário, pra permitir login por documento.
// Roda com service-role pra ler o e-mail do auth.users.
//
// REGRA DE SEGURANÇA: nunca revela se o CPF existe ou não. Sempre que
// algo falhar (CPF inválido, não encontrado, sem e-mail) retorna o
// MESMO erro genérico — pra não virar um endpoint de descoberta de
// quem está cadastrado.
//
// Body da requisição: { cpf: "12345678900" } ou { cnpj: "..." }
// Resposta: { email: "..." } (200) ou { error: "..." } (401)
//
// Deploy: npx supabase functions deploy lookup-by-cpf

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject, getClientIp } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ERRO_GENERICO = JSON.stringify({ error: "CPF/CNPJ ou senha incorretos." });
const headersJson = { ...CORS, "Content-Type": "application/json" };

// Valida dígitos verificadores do CPF (mesma regra do helpers.ts)
function validarCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false;
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

// Valida dígitos verificadores do CNPJ
function validarCNPJ(cnpj: string): boolean {
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

// Tempo MÍNIMO de resposta pra mitigar timing oracle. Qualquer caminho
// (CPF inválido, válido-mas-não-cadastrado, encontrado) tem que demorar
// pelo menos isso. Senão atacante mede latência e enumera CPFs cadastrados.
// 450ms é folga sobre o pior caso real (auth.admin.getUserById costuma
// resolver em 100-300ms).
const TEMPO_MIN_RESPOSTA_MS = 450;

async function comTempoMinimo<T>(promise: Promise<T>, minMs: number): Promise<T> {
  const inicio = Date.now();
  const resultado = await promise;
  const decorrido = Date.now() - inicio;
  const restante = minMs - decorrido;
  if (restante > 0) {
    await new Promise<void>((r) => setTimeout(r, restante));
  }
  return resultado;
}

async function processar(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({} as any));
  const docRaw = (body.cpf ?? body.cnpj ?? "").toString();
  const digits = docRaw.replace(/\D/g, "");

  // Aceita CPF (11) ou CNPJ (14). Valida algoritmo de DV nos 2 casos.
  let docFormatado: string;
  if (digits.length === 11) {
    if (!validarCPF(digits)) {
      return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
    }
    docFormatado = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
  } else if (digits.length === 14) {
    if (!validarCNPJ(digits)) {
      return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
    }
    docFormatado = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
  } else {
    return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  let profileId: string | null = null;

  // 1) À prova de formato: RPC normaliza os dois lados pra dígitos no SQL
  // (regexp_replace), então casa o documento salvo com máscara, só dígitos ou
  // com sujeira. Ver migration lookup_documento_normalizado.sql.
  const { data: rpcId } = await supabase.rpc("id_por_documento", { p_digits: digits });
  if (typeof rpcId === "string" && rpcId) profileId = rpcId;

  // 2) Fallback (caso a RPC ainda não tenha sido aplicada): .eq() SEPARADOS —
  // nunca num .or(), porque dentro de .or() o PostgREST quebra o parsing nos
  // caracteres da máscara ('.' e '/') e o CNPJ mascarado nunca casa.
  if (!profileId) {
    const campo = digits.length === 11 ? "cpf" : "cnpj";
    for (const valor of [digits, docFormatado]) {
      const { data: rows } = await supabase
        .from("user_profiles")
        .select("id")
        .eq(campo, valor)
        .limit(1);
      if (rows?.[0]?.id) { profileId = rows[0].id; break; }
    }
  }

  if (!profileId) {
    return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
  }

  const { data: { user }, error } = await supabase.auth.admin.getUserById(profileId);
  if (error || !user?.email) {
    return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
  }

  return new Response(JSON.stringify({ email: user.email }), { headers: headersJson });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  // Rate-limit por IP: 5 tentativas / minuto. Endpoint público sem auth,
  // alvo natural pra enumeração — ainda que o timing oracle esteja
  // fechado, brute-force seguiria possível em escala.
  const ip = getClientIp(req);
  const supabaseRL = createClient(SUPABASE_URL, SUPABASE_KEY);
  const blocked = await rateLimitOrReject(
    // failClosed: endpoint público de busca por CPF/CNPJ — se o rate-limit
    // falhar, BLOQUEIA (em vez de abrir a porta pra enumeração/brute-force).
    { key: `lookup-by-cpf:ip:${ip}`, max: 5, windowSeconds: 60, corsHeaders: CORS, failClosed: true },
    supabaseRL,
  );
  if (blocked) return blocked;

  // Garante tempo mínimo de resposta em TODOS os caminhos (sucesso ou erro)
  // pra fechar o timing oracle de enumeração.
  try {
    return await comTempoMinimo(processar(req), TEMPO_MIN_RESPOSTA_MS);
  } catch {
    // Em erro inesperado, também respeita o tempo mínimo.
    await new Promise<void>((r) => setTimeout(r, TEMPO_MIN_RESPOSTA_MS));
    return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
  }
});
