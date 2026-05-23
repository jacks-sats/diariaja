// Edge Function: delete-user
// Apaga completamente o usuário do auth.users usando service_role key.
// Chamada pelo frontend após o usuário confirmar exclusão da conta.
//
// Deploy: supabase functions deploy delete-user
// Variáveis necessárias: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Não autorizado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cliente com token do usuário para verificar identidade
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verifica quem está chamando
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Token inválido ou expirado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // Cliente admin com service_role para poder deletar auth.users
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Apaga dados do usuário nas tabelas do app (ordem importa para FK constraints)
    await supabaseAdmin.from("mensagens").delete().or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`);
    await supabaseAdmin.from("candidaturas").delete().eq("diarista_id", userId);
    await supabaseAdmin.from("avaliacoes_diarista").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
    await supabaseAdmin.from("avaliacoes_empregador").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
    await supabaseAdmin.from("diarias").delete().eq("empregador_id", userId);
    await supabaseAdmin.from("user_profiles").delete().eq("id", userId);

    // 2. Apaga o registro no auth.users (exclusão definitiva conforme LGPD)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Conta excluída com sucesso." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
