import { createClient } from "@supabase/supabase-js";

// Prioriza variáveis de ambiente (Vercel / .env.local).
// Fallback para os valores de produção — a chave 'anon' é pública por design
// (Supabase a chama de "publishable key"); o RLS do banco protege os dados.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://rpszebrrrasoijfdvner.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_3mVVT4hR6PFU0jbjr6hsvA_eXSbOvST";

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
