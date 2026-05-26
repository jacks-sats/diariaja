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

    // 1. Apaga dados do usuário em TODAS as tabelas do app (ordem importa para FK)
    // — anteriormente esquecia: convites, denuncias, nao_interesse, push_subscriptions,
    //   topicos, comentarios_comunidade, analytics_eventos, assinaturas,
    //   suporte_tickets, suporte_respostas, score_events, feedback_*. (LGPD Art. 18 VI)

    // Mensagens (qualquer ponta)
    await supabaseAdmin.from("mensagens").delete().or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`);

    // Candidaturas (diarista) — diárias do empregador são apagadas em cascata
    await supabaseAdmin.from("candidaturas").delete().eq("diarista_id", userId);

    // Avaliações (em ambas as direções)
    await supabaseAdmin.from("avaliacoes_diarista").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);
    await supabaseAdmin.from("avaliacoes_empregador").delete().or(`avaliado_id.eq.${userId},avaliador_id.eq.${userId}`);

    // Convites (qualquer ponta) — colunas podem se chamar contratante_id e diarista_id
    await supabaseAdmin.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId},empregador_id.eq.${userId}`).then(undefined as any, () => {});

    // Denúncias (autor ou alvo) — colunas: denunciante_id, denunciado_id
    await supabaseAdmin.from("denuncias").delete().or(`denunciante_id.eq.${userId},denunciado_id.eq.${userId}`).then(undefined as any, () => {});

    // "Não tenho interesse" do diarista
    await supabaseAdmin.from("nao_interesse").delete().eq("diarista_id", userId).then(undefined as any, () => {});

    // Inscrições de push
    await supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId).then(undefined as any, () => {});

    // Comentários da Comunidade — autor
    await supabaseAdmin.from("comentarios_comunidade").delete().eq("autor_id", userId).then(undefined as any, () => {});

    // Tópicos da Comunidade — autor
    await supabaseAdmin.from("topicos").delete().eq("autor_id", userId).then(undefined as any, () => {});

    // Eventos de analytics
    await supabaseAdmin.from("analytics_eventos").delete().eq("user_id", userId).then(undefined as any, () => {});

    // Assinaturas (planos pagos)
    await supabaseAdmin.from("assinaturas").delete().eq("user_id", userId).then(undefined as any, () => {});

    // Tickets de suporte + respostas (PR painel-admin)
    // Apaga respostas onde o user é sender (em tickets de outros)
    await supabaseAdmin.from("suporte_respostas").delete().eq("sender_id", userId).then(undefined as any, () => {});
    // Apaga tickets do user (CASCADE limpa as respostas relacionadas)
    await supabaseAdmin.from("suporte_tickets").delete().eq("user_id", userId).then(undefined as any, () => {});

    // Eventos de gamificação (trust score) — se existirem
    await supabaseAdmin.from("score_events").delete().eq("user_id", userId).then(undefined as any, () => {});

    // Feedback (vagas expiradas / pós-conclusão)
    await supabaseAdmin.from("feedback_vaga_expirada").delete().eq("empregador_id", userId).then(undefined as any, () => {});
    await supabaseAdmin.from("feedback_pos_conclusao").delete().eq("empregador_id", userId).then(undefined as any, () => {});

    // Desliga o diarista de diárias passadas onde ele foi selecionado — caso
    // contrário a FK pode bloquear o delete (RESTRICT) ou orfanar histórico.
    await supabaseAdmin.from("diarias").update({ diarista_aceite_id: null }).eq("diarista_aceite_id", userId);
    await supabaseAdmin.from("diarias").delete().eq("empregador_id", userId);

    // 2. Apaga arquivos do storage (avatares + documentos KYC)
    // Lista e remove TUDO dentro de avatars/{userId}/ e documentos/{userId}/.
    for (const bucket of ["avatars", "documentos"]) {
      try {
        const { data: files } = await supabaseAdmin.storage.from(bucket).list(userId);
        if (files && files.length > 0) {
          const paths = files.map(f => `${userId}/${f.name}`);
          await supabaseAdmin.storage.from(bucket).remove(paths);
        }
        // Também tenta apagar arquivo legado `<userId>.jpg` (estrutura antiga)
        await supabaseAdmin.storage.from(bucket).remove([`${userId}.jpg`, `${userId}.png`, `${userId}.webp`]).catch(() => {});
      } catch { /* bucket pode não existir ainda — não bloqueia delete */ }
    }

    // 3. Apaga o profile (depois de tudo que tem FK pra ele)
    await supabaseAdmin.from("user_profiles").delete().eq("id", userId);

    // 4. Apaga o registro no auth.users (exclusão definitiva conforme LGPD Art. 18 VI)
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
