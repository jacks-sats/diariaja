import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

// Prioriza variáveis de ambiente (Vercel / .env.local).
// Fallback para os valores de produção — a chave 'anon' é pública por design
// (Supabase a chama de "publishable key"); o RLS do banco protege os dados.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://rpszebrrrasoijfdvner.supabase.co";

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_3mVVT4hR6PFU0jbjr6hsvA_eXSbOvST";

// ── Storage durável da sessão (Android/Capacitor) ───────────────────────────
// PROBLEMA: por padrão a sessão fica no localStorage do WebView, que o Android
// PODE DESPEJAR (memória baixa, force-stop, limpeza do WebView) → logout
// intermitente. SOLUÇÃO: guardar a sessão no @capacitor/preferences
// (SharedPreferences nativo), que é persistente.
//
// É um adapter ASSÍNCRONO (o supabase-js suporta storage async). Características:
//   • MIGRADOR one-time embutido no getItem: na 1ª leitura da chave de sessão,
//     se o Preferences ainda não tiver mas o localStorage (legado) tiver, copia
//     pro Preferences e devolve o valor. Como o supabase-js AGUARDA o getItem
//     antes de resolver a sessão (getSession/INITIAL_SESSION), a migração
//     termina ANTES de a sessão ser lida — à prova de race, sem deslogar quem
//     já estava logado.
//   • FALLBACK defensivo: se o Preferences lançar erro, cai pro localStorage.
//     O login NUNCA trava.
//   • removeItem limpa Preferences E o legado do localStorage (pra a migração
//     não "ressuscitar" a sessão depois de um logout).
const storageNativo = {
  async getItem(key: string): Promise<string | null> {
    try {
      const { value } = await Preferences.get({ key });
      if (value !== null) return value;
      // Migração one-time: sessão antiga ainda no localStorage do WebView.
      try {
        const legado = window.localStorage.getItem(key);
        if (legado !== null) {
          await Preferences.set({ key, value: legado });
          return legado;
        }
      } catch { /* localStorage indisponível */ }
      return null;
    } catch {
      // Preferences falhou → fallback gracioso pro localStorage.
      try { return window.localStorage.getItem(key); } catch { return null; }
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await Preferences.set({ key, value });
    } catch {
      try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
    }
  },
  async removeItem(key: string): Promise<void> {
    try { await Preferences.remove({ key }); } catch { /* ignore */ }
    // Limpa também o legado pra a migração não ressuscitar a sessão no logout.
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

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
    autoRefreshToken: true,
    // No app NATIVO (Android): storage durável via Preferences (+ migração).
    // Na WEB: mantém o localStorage padrão (que já é durável no browser) —
    // `undefined` preserva 100% o comportamento atual do site.
    storage: Capacitor.isNativePlatform() ? storageNativo : undefined,
  },
});
