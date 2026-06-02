// Edge Function: delete-user
// Apaga completamente o usuário do auth.users usando service_role key.
// Chamada pelo frontend após o usuário confirmar exclusão da conta.
//
// Deploy: supabase functions deploy delete-user
// Variáveis necessárias: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject } from "../_shared/rate-limit.ts";

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

    // Anti-abuso: no máximo 3 exclusões por hora por usuário (operação cara).
    const limited = await rateLimitOrReject(
      { key: `delete-user:user:${userId}`, max: 3, windowSeconds: 3600, corsHeaders },
      supabaseAdmin,
    );
    if (limited) return limited;

    // 1. Apaga dados do usuário em TODAS as tabelas do app (ordem importa para FK)
    // — anteriormente esquecia: convites, denuncias, nao_interesse, push_subscriptions,
    //   topicos, comentarios_comunidade, analytics_eventos, assinaturas,
    //   suporte_tickets, suporte_respostas, score_events, feedback_*. (LGPD Art. 18 VI)

    // Mensagens (qualquer ponta)
    await supabaseAdmin.from("mensagens").delete().or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`);

    // Candidaturas (diarista) — diárias do empregador são apagadas em cascata
    await supabaseAdmin.from("candidaturas").delete().eq("diarista_id", userId);

    // FIX 2026-05-28 (auditoria C-4): colunas avaliado_id/avaliador_id NÃO EXISTEM.
    // Reais: avaliacoes_empregador.diarista_id (autor), avaliacoes_diarista.empregador_id (autor).
    // Apaga apenas as escritas PELO user. Avaliações RECEBIDAS permanecem
    // (pertencem ao avaliador — decisão LGPD).
    await supabaseAdmin.from("avaliacoes_empregador").delete().eq("diarista_id", userId);
    await supabaseAdmin.from("avaliacoes_diarista").delete().eq("empregador_id", userId);

    // FIX 2026-05-28: trocado `.then(undefined as any, () => {})` por error
    // tracking real. Antes engolia erros silenciosamente: em falha parcial
    // (FK violation, timeout), código prosseguia e auth.admin.deleteUser
    // apagava só a conta, deixando linhas residuais com FK quebrada.
    // LGPD descumprida silenciosamente. Agora coleta erros e loga; se TODOS
    // não-críticos falham, ainda assim deleta auth (best effort) mas reporta.
    const erroFkRegex = /(relation .* does not exist|column .* does not exist)/i;
    const safeDelete = async (label: string, q: PromiseLike<unknown>) => {
      try { await q; } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (erroFkRegex.test(msg)) return; // tabela não existe ainda — OK
        console.error(`[delete-user][${label}] erro:`, msg);
      }
    };

    // FIX 2026-05-28 (auditoria C-3): convites.empregador_id NÃO EXISTE — só contratante_id + diarista_id.
    await safeDelete("convites",          supabaseAdmin.from("convites").delete().or(`contratante_id.eq.${userId},diarista_id.eq.${userId}`));
    // FIX 2026-05-28 (auditoria A-5): denuncias.denunciado_id NÃO EXISTE — coluna real é alvo_id.
    await safeDelete("denuncias",         supabaseAdmin.from("denuncias").delete().or(`denunciante_id.eq.${userId},alvo_id.eq.${userId}`));
    await safeDelete("nao_interesse",     supabaseAdmin.from("nao_interesse").delete().eq("diarista_id", userId));
    await safeDelete("push_subscriptions", supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId));
    // Comunidade (topicos/comentarios): NÃO apaga o conteúdo — ANONIMIZA o autor.
    // O conteúdo é público e coletivo (some pra todo mundo se apagado, inclusive
    // os tópicos oficiais criados por um admin). Espelha o ON DELETE SET NULL do
    // schema: zera autor_id e troca o nome por "Usuário removido". Atende LGPD
    // (remove o vínculo com a pessoa) sem destruir a comunidade.
    await safeDelete("comentarios_comunidade (anon)", supabaseAdmin.from("comentarios_comunidade").update({ autor_id: null, autor_nome: "Usuário removido" }).eq("autor_id", userId));
    await safeDelete("topicos (anon)",                supabaseAdmin.from("topicos").update({ autor_id: null, autor_nome: "Usuário removido" }).eq("autor_id", userId));
    await safeDelete("analytics_eventos", supabaseAdmin.from("analytics_eventos").delete().eq("user_id", userId));
    await safeDelete("assinaturas",       supabaseAdmin.from("assinaturas").delete().eq("user_id", userId));
    await safeDelete("suporte_respostas", supabaseAdmin.from("suporte_respostas").delete().eq("sender_id", userId));
    await safeDelete("suporte_tickets",   supabaseAdmin.from("suporte_tickets").delete().eq("user_id", userId));
    await safeDelete("score_events",      supabaseAdmin.from("score_events").delete().eq("user_id", userId));
    await safeDelete("feedback_vaga_expirada",  supabaseAdmin.from("feedback_vaga_expirada").delete().eq("empregador_id", userId));
    await safeDelete("feedback_pos_conclusao",  supabaseAdmin.from("feedback_pos_conclusao").delete().eq("empregador_id", userId));
    // B8 auditoria: resíduos LGPD que faltavam. Tabelas podem não existir em todos
    // os ambientes — safeDelete tolera "relation does not exist".
    // NÃO apagamos kyc_acessos_log (trilha de auditoria de acesso a KYC — base legal
    // de retenção, LGPD Art. 37) nem webhook_eventos_processados (não tem dado pessoal,
    // é só dedupe por id de notificação do MP).
    await safeDelete("contatos_desbloqueios", supabaseAdmin.from("contatos_desbloqueios").delete().eq("empregador_id", userId));
    await safeDelete("oauth_states",          supabaseAdmin.from("oauth_states").delete().eq("user_id", userId));
    await safeDelete("usuarios_bloqueados",   supabaseAdmin.from("usuarios_bloqueados").delete().or(`bloqueador_id.eq.${userId},alvo_id.eq.${userId}`));
    await safeDelete("kyc_documentos",        supabaseAdmin.from("kyc_documentos").delete().eq("user_id", userId));

    // Desliga o diarista de diárias passadas onde ele foi selecionado — caso
    // contrário a FK pode bloquear o delete (RESTRICT) ou orfanar histórico.
    await supabaseAdmin.from("diarias").update({ diarista_aceite_id: null }).eq("diarista_aceite_id", userId);
    await supabaseAdmin.from("diarias").delete().eq("empregador_id", userId);

    // 2. Apaga arquivos do storage (avatares + KYC RG/CNH + antecedentes criminais)
    // Lista e remove TUDO dentro de avatars/{userId}/, documentos/{userId}/ e
    // antecedentes/{userId}/.
    for (const bucket of ["avatars", "documentos", "antecedentes"]) {
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
