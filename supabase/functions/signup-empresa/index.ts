// Edge Function: signup-empresa
// Cria a conta de uma EMPRESA (PJ) já confirmada e grava o perfil com CNPJ
// numa só operação (service-role). Assim a empresa entra por CNPJ na MESMA
// hora, sem depender da confirmação de e-mail — sem mexer no fluxo dos
// diaristas (que seguem confirmando o e-mail normalmente).
//
// Por que existe: o cadastro client-side faz signUp e só grava o perfil DEPOIS
// de ter sessão. Com "Confirm email" ligado, a sessão não vem na hora e o
// CNPJ/telefone/endereço se perdiam — quebrando o login por CNPJ. Aqui usamos
// admin.createUser({ email_confirm: true }) + insert do perfil com service-role.
//
// Body: { cnpj, nomeFantasia, razaoSocial?, email, telefone, senha,
//         cep, rua, numero, complemento?, bairro, cidade, estado,
//         responsavelNome?, responsavelCpf? }
// Resposta: { ok: true } (200) | { error: "cnpj_existe" | "email_existe" |
//            "dados_invalidos" } (4xx)
//
// Deploy: npx supabase functions deploy signup-empresa

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject, getClientIp } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const headersJson = { ...CORS, "Content-Type": "application/json" };

function erro(code: string, status = 400): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: headersJson });
}

// ── Validadores (mesma regra do helpers.ts do front) ────────────────────────
function digits(s: string): string { return (s || "").replace(/\D/g, ""); }

function validarCNPJ(cnpj: string): boolean {
  const c = digits(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((acc, n, i) => acc + parseInt(n) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== parseInt(c[12])) return false;
  const dv2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === parseInt(c[13]);
}

function validarCPF(cpf: string): boolean {
  const c = digits(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i]) * (10 - i);
  let r = (soma * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(c[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i]) * (11 - i);
  r = (soma * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === parseInt(c[10]);
}

function validarEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || "").trim());
}

function validarTelefone(tel: string): boolean {
  const d = digits(tel);
  // 10 (fixo) ou 11 (celular) dígitos, DDD 11-99
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = parseInt(d.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

function maskCNPJ(c: string): string {
  const d = digits(c).slice(0, 14);
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

interface Body {
  cnpj?: string; nomeFantasia?: string; razaoSocial?: string;
  email?: string; telefone?: string; senha?: string;
  cep?: string; rua?: string; numero?: string; complemento?: string;
  bairro?: string; cidade?: string; estado?: string;
  responsavelNome?: string; responsavelCpf?: string;
}

async function processar(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Body;

  const cnpjDig = digits(body.cnpj || "");
  const email   = (body.email || "").trim().toLowerCase();
  const senha   = body.senha || "";

  // Validação server-side (o front valida também, mas nunca confie só nele)
  if (!validarCNPJ(cnpjDig))            return erro("dados_invalidos");
  if (!validarEmail(email))             return erro("dados_invalidos");
  if (!(body.nomeFantasia || "").trim()) return erro("dados_invalidos");
  if (!validarTelefone(body.telefone || "")) return erro("dados_invalidos");
  if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) return erro("dados_invalidos");
  if (!(body.rua || "").trim() || !(body.cidade || "").trim() || (body.estado || "").trim().length !== 2) {
    return erro("dados_invalidos");
  }
  if (body.responsavelCpf && !validarCPF(body.responsavelCpf)) return erro("dados_invalidos");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) CNPJ já cadastrado? Compara com e sem máscara — em queries .eq()
  // SEPARADAS, não num .or(): dentro de .or() o PostgREST quebra nos caracteres
  // da máscara ('.'/'/'), o que deixava o CNPJ mascarado passar como "novo"
  // (mesma raiz do bug de login por CNPJ).
  const cnpjMasked = maskCNPJ(cnpjDig);
  for (const valor of [cnpjDig, cnpjMasked]) {
    const { data: dup } = await admin
      .from("user_profiles")
      .select("id")
      .eq("cnpj", valor)
      .limit(1);
    if (dup && dup.length > 0) return erro("cnpj_existe", 409);
  }

  // 2) Cria o usuário JÁ confirmado (não exige clique no e-mail)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { user_type: "empregador", pessoa_tipo: "juridica" },
  });
  if (createErr || !created?.user) {
    const m = (createErr?.message || "").toLowerCase();
    if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
      return erro("email_existe", 409);
    }
    return erro("dados_invalidos");
  }
  const uid = created.user.id;

  // 3) Grava o perfil (service-role → não depende de RLS/sessão do cliente)
  const endereco = `${body.rua}, ${body.numero}${(body.complemento || "").trim() ? ` — ${body.complemento}` : ""}, ${body.bairro}, ${body.cidade}/${body.estado} — CEP ${body.cep}`;
  // Colunas garantidas (as mesmas que o saveProfile do app escreve).
  const perfilBase: Record<string, unknown> = {
    id: uid,
    user_type: "empregador",
    pessoa_tipo: "juridica",
    cnpj: cnpjMasked,
    nome_negocio: body.nomeFantasia,
    nome: (body.responsavelNome || "").trim() || body.nomeFantasia,
    telefone: digits(body.telefone || ""),
    endereco_empregador: endereco,
  };
  const { error: insErr } = await admin.from("user_profiles").insert(perfilBase);
  if (insErr) {
    // Não deixa órfão: se o perfil não gravou, remove o auth user recém-criado.
    const m = (insErr.message || "").toLowerCase();
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    if (m.includes("duplicate") || m.includes("unique")) return erro("cnpj_existe", 409);
    return erro("dados_invalidos", 500);
  }

  // 4) Best-effort: colunas extras de migration ainda pendente (não derruba o
  //    cadastro se a coluna não existir — vai num UPDATE separado).
  await admin.from("user_profiles").update({
    nome_fantasia: body.nomeFantasia,
    razao_social: (body.razaoSocial || "").trim(),
    responsavel_nome: (body.responsavelNome || "").trim(),
    responsavel_cpf: digits(body.responsavelCpf || ""),
  }).eq("id", uid).then(() => {}, () => {});

  return new Response(JSON.stringify({ ok: true }), { headers: headersJson });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Rate-limit por IP: cadastro é caro (cria user). 5/min por IP.
  const ip = getClientIp(req);
  const rl = createClient(SUPABASE_URL, SERVICE_KEY);
  const blocked = await rateLimitOrReject(
    { key: `signup-empresa:ip:${ip}`, max: 5, windowSeconds: 60, corsHeaders: CORS },
    rl,
  );
  if (blocked) return blocked;

  try {
    return await processar(req);
  } catch (e) {
    console.error("[signup-empresa] erro inesperado:", e instanceof Error ? e.message : String(e));
    return erro("dados_invalidos", 500);
  }
});
