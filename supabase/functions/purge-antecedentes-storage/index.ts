// Edge Function: purge-antecedentes-storage
// Apaga FISICAMENTE do bucket `antecedentes` os PDFs/imagens já zerados
// pela RPC `purgar_antecedentes_expirados()` (que limpa metadados no
// user_profiles mas não acessa Storage diretamente).
//
// Estratégia conservadora — apaga apenas:
//   1. Arquivos no bucket cujo prefixo (user_id) não tem `antecedentes_url`
//      apontando pra eles (= já foram zerados pela RPC OU o usuário trocou
//      o arquivo).
//   2. Arquivos com mais de 95 dias de idade (folga sobre os 90 da validade
//      legal — caso a RPC ainda não tenha rodado pra esse user).
//
// Auth: SERVICE_ROLE — só admin ou cron pode chamar. Se acessado via
// Authorization Bearer com JWT de admin, também aceita.
//
// Body: nenhum.
// Resposta: { purgados: number, ignorados: number }
//
// Schedule: chamar via pg_cron (pg_net.http_post) ou GitHub Action diário.
// Deploy: npx supabase functions deploy purge-antecedentes-storage

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PURGE_SECRET      = Deno.env.get("PURGE_ANTECEDENTES_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-purge-secret",
};
const headersJson = { ...CORS, "Content-Type": "application/json" };

const MAX_IDADE_DIAS = 95; // folga sobre os 90 dias legais

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // ── Autorização: admin (JWT) OU header secreto (cron / GitHub Action) ──
  let autorizado = false;

  // Caminho 1: secret header (cron interno)
  const headerSecret = req.headers.get("x-purge-secret");
  if (PURGE_SECRET && headerSecret && headerSecret === PURGE_SECRET) {
    autorizado = true;
  }

  // Caminho 2: admin autenticado
  if (!autorizado) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) {
        const { data: profile } = await supabaseUser
          .from("user_profiles").select("is_admin").eq("id", user.id).maybeSingle();
        if (profile?.is_admin) autorizado = true;
      }
    }
  }

  if (!autorizado) {
    return new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401, headers: headersJson });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const cutoffMs = Date.now() - MAX_IDADE_DIAS * 24 * 60 * 60 * 1000;
    let purgados  = 0;
    let ignorados = 0;

    // 1. Pega URLs ativas (não devemos apagar essas) — escala bem com índice
    const { data: ativos } = await supabase
      .from("user_profiles")
      .select("antecedentes_url")
      .not("antecedentes_url", "is", null);
    const setAtivos = new Set<string>((ativos ?? []).map((r: { antecedentes_url: string }) => r.antecedentes_url));

    // 2. Lista pastas raiz do bucket (cada pasta = um user_id).
    // FIX 2026-07-24 (auditoria A-9): list() antes só pegava primeiros
    // 1000 users e 100 arquivos por user. A partir do 1001º user ou 101º
    // arquivo, NADA era purgado — LGPD silenciosamente descumprida.
    // Agora pagina até esgotar.
    const PAGE = 1000;
    let offsetPastas = 0;
    let ciclosPastas = 0;
    while (ciclosPastas < 100) { // hard-stop defensivo (100 * 1000 = 100k users)
      const { data: pastas, error: errPastas } = await supabase.storage
        .from("antecedentes")
        .list("", { limit: PAGE, offset: offsetPastas });
      if (errPastas) throw errPastas;
      if (!pastas?.length) break;

      for (const p of pastas) {
        const userIdPrefix = p.name;
        if (!userIdPrefix || userIdPrefix.startsWith(".")) continue;

        // Pagina arquivos por user também.
        let offsetArq = 0;
        let ciclosArq = 0;
        while (ciclosArq < 100) { // 100 * 1000 = 100k arquivos/user (impossível na prática)
          const { data: arquivos, error: errArq } = await supabase.storage
            .from("antecedentes")
            .list(userIdPrefix, { limit: PAGE, offset: offsetArq });
          if (errArq) break;
          if (!arquivos?.length) break;

          const aDeletar: string[] = [];
          for (const arq of arquivos) {
            const path = `${userIdPrefix}/${arq.name}`;
            if (setAtivos.has(path)) { ignorados++; continue; }
            const created = arq.created_at ? new Date(arq.created_at).getTime() : 0;
            if (created > 0 && created > cutoffMs) { ignorados++; continue; }
            aDeletar.push(path);
          }

          if (aDeletar.length > 0) {
            const { error: errDel } = await supabase.storage
              .from("antecedentes")
              .remove(aDeletar);
            if (!errDel) purgados += aDeletar.length;
          }

          if (arquivos.length < PAGE) break;
          offsetArq += PAGE;
          ciclosArq++;
        }
      }

      if (pastas.length < PAGE) break;
      offsetPastas += PAGE;
      ciclosPastas++;
    }

    return new Response(
      JSON.stringify({ purgados, ignorados, executed_at: new Date().toISOString() }),
      { headers: headersJson },
    );
  } catch (err) {
    console.error("[purge-antecedentes-storage] error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Erro interno." }), { status: 500, headers: headersJson });
  }
});
