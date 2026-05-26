import { createClient } from "@supabase/supabase-js";

// Prioriza variáveis de ambiente (Vercel / .env.local).
// Fallback para os valores de produção — a chave 'anon' é pública por design
// (Supabase a chama de "publishable key"); o RLS do banco protege os dados.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://rpszebrrrasoijfdvner.supabase.co";

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_3mVVT4hR6PFU0jbjr6hsvA_eXSbOvST";

// Captura informações do hash ANTES do supabase-js consumi-lo (detectSessionInUrl
// reescreve a URL após processar). Isso permite ao App.tsx detectar o fluxo de
// recuperação de senha (type=recovery) e roteá-lo para a tela de redefinição,
// em vez de cair na home como um login normal.
const rawInitialHash =
  typeof window !== "undefined" ? window.location.hash || "" : "";
const hashSemPrefixo = rawInitialHash.startsWith("#")
  ? rawInitialHash.slice(1)
  : rawInitialHash;
const hashParamsIniciais = new URLSearchParams(hashSemPrefixo);

export const RECUPERACAO_SENHA_DETECTADA =
  hashParamsIniciais.get("type") === "recovery";

export const ERRO_HASH_INICIAL = (() => {
  const err = hashParamsIniciais.get("error") || hashParamsIniciais.get("error_code");
  if (!err) return null;
  const desc = hashParamsIniciais.get("error_description")?.replace(/\+/g, " ") || err;
  return desc;
})();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // flowType 'implicit' resolve o erro "bad_oauth_state" em Android:
    // no fluxo PKCE (padrão) o code_verifier fica guardado no browser onde o
    // login começou; quando o link do e-mail abre em outro contexto (ex.: Gmail
    // app → Chrome), esse verifier não existe → erro. Com 'implicit' o token
    // vem direto no fragmento da URL e funciona em qualquer browser/aba.
    flowType: "implicit",
    detectSessionInUrl: true,
    persistSession: true,
  },
});
