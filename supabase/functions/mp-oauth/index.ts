// Edge Function: mp-oauth
// Rota de callback do OAuth do Mercado Pago para diaristas conectarem suas contas
//
// Fluxo:
// 1. Diarista clica em "Conectar Mercado Pago" no perfil
// 2. App abre: https://auth.mercadopago.com.br/authorization?client_id=...&redirect_uri=.../mp-oauth
// 3. Diarista autoriza no MP
// 4. MP redireciona para esta Edge Function com ?code=...&state=USER_ID
// 5. Esta função troca o code pelo access_token e salva no perfil
//
// Variáveis de ambiente:
//   MP_CLIENT_ID
//   MP_CLIENT_SECRET
//   APP_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MP_CLIENT_ID     = Deno.env.get("MP_CLIENT_ID")!;
const MP_CLIENT_SECRET = Deno.env.get("MP_CLIENT_SECRET")!;
const APP_URL          = Deno.env.get("APP_URL") ?? "https://trampojaapp.com.br";
const REDIRECT_URI     = `${SUPABASE_URL}/functions/v1/mp-oauth`;

Deno.serve(async (req) => {
  const url    = new URL(req.url);
  const code   = url.searchParams.get("code");
  const userId = url.searchParams.get("state"); // passamos o user_id como state
  const error  = url.searchParams.get("error");

  if (error || !code || !userId) {
    return redirect(`${APP_URL}/?mp_oauth=erro`);
  }

  try {
    // Troca o code pelo access_token
    const tokenResp = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        code,
        grant_type:    "authorization_code",
        redirect_uri:  REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResp.json();

    if (!tokenData.access_token) {
      console.error("Erro token MP:", tokenData);
      return redirect(`${APP_URL}/?mp_oauth=erro`);
    }

    // Salva no perfil do diarista
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    await supabase
      .from("user_profiles")
      .update({
        mp_access_token: tokenData.access_token,
        mp_user_id:      String(tokenData.user_id),
      })
      .eq("id", userId);

    return redirect(`${APP_URL}/?mp_oauth=sucesso`);

  } catch (err) {
    console.error("OAuth error:", err);
    return redirect(`${APP_URL}/?mp_oauth=erro`);
  }
});

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}
