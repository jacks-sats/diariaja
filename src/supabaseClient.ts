import { createClient } from "@supabase/supabase-js";

// Valores carregados de variáveis de ambiente (.env.local)
// https://supabase.com/dashboard → seu projeto → Settings → API
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
