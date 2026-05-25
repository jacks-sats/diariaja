// Edge Function: lookup-by-cpf
// Mapeia CPF/CNPJ → e-mail do usuário, pra permitir login por documento.
// Roda com service-role pra ler o e-mail do auth.users.
//
// REGRA DE SEGURANÇA: nunca revela se o CPF existe ou não. Sempre que
// algo falhar (CPF inválido, não encontrado, sem e-mail) retorna o
// MESMO erro genérico — pra não virar um endpoint de descoberta de
// quem está cadastrado.
//
// Variáveis de ambiente:
//   SUPABASE_URL                  (auto-injetada)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-injetada)
//
// Body da requisição: { cpf: "123.456.789-00" } ou { cnpj: "..." }
// Resposta: { email: "..." } (200) ou { error: "..." } (401)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const docRaw = (body.cpf ?? body.cnpj ?? "").toString();
    const digits = docRaw.replace(/\D/g, "");

    // Aceita CPF (11) ou CNPJ (14). Valida CPF com dígito verificador.
    let docFormatado: string;
    if (digits.length === 11) {
      if (!validarCPF(digits)) {
        return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
      }
      docFormatado = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
    } else if (digits.length === 14) {
      docFormatado = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
    } else {
      return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Cadastros antigos podem ter sido salvos com ou sem máscara —
    // tenta ambos.
    const campo = digits.length === 11 ? "cpf" : "cnpj";
    const { data: rows } = await supabase
      .from("user_profiles")
      .select("id")
      .or(`${campo}.eq.${digits},${campo}.eq.${docFormatado}`)
      .limit(1);

    const profile = rows?.[0];
    if (!profile?.id) {
      return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
    }

    // Busca o e-mail no auth.users
    const { data: { user }, error } = await supabase.auth.admin.getUserById(profile.id);
    if (error || !user?.email) {
      return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
    }

    return new Response(JSON.stringify({ email: user.email }), { headers: headersJson });
  } catch (err) {
    console.error("lookup-by-cpf error:", err);
    return new Response(ERRO_GENERICO, { status: 401, headers: headersJson });
  }
});
