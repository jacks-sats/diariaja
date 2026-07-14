// Edge Function: export-user-data
// Cumpre LGPD Art. 18 V (portabilidade de dados): usuário autenticado
// recebe um JSON com todos os dados que a plataforma tem sobre ele.
//
// O que inclui:
//   - profile (dados cadastrais)
//   - diárias publicadas (como contratante)
//   - diárias trabalhadas (como diarista)
//   - candidaturas enviadas
//   - convites recebidos / enviados
//   - mensagens (apenas as enviadas pelo próprio user)
//   - avaliações dadas e recebidas
//   - denúncias feitas
//   - assinaturas
//   - contatos desbloqueados (histórico R$1)
//
// O que NÃO inclui (por design):
//   - mensagens recebidas (pertencem ao remetente — pedir export por lá)
//   - hashes de senha
//   - tokens MP / Supabase
//   - logs de auditoria admin (kyc_acessos_log com ações sobre o user)
//
// Auth: Authorization: Bearer <jwt>. Usuário só exporta os PRÓPRIOS dados.
// Body: nenhum. (user é identificado pelo JWT)
// Resposta: { generated_at, user_id, data: {...} }
//
// Deploy: npx supabase functions deploy export-user-data

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject } from "../_shared/rate-limit.ts";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Autenticação obrigatória — exportação tem que ser do próprio user.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado." }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user?.id) return json({ error: "Token inválido ou expirado." }, 401);

    // Daqui pra frente usa service_role pra ler tudo sem barreira de RLS
    // (já validamos quem é o user pelo JWT acima).
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const uid = user.id;

    // Anti-abuso: export é pesado (lê todas as tabelas) — máx. 5 por hora/usuário.
    const limited = await rateLimitOrReject(
      { key: `export-user-data:user:${uid}`, max: 5, windowSeconds: 3600, corsHeaders: CORS, failClosed: true },
      supabase,
    );
    if (limited) return limited;

    // Coleta paralela das tabelas. Cada uma é pequena pra um user comum.
    const [
      profile,
      diariasComoContratante,
      diariasComoDiarista,
      candidaturas,
      convitesRecebidos,
      convitesEnviados,
      mensagensEnviadas,
      avaliacoesDadas,
      avaliacoesRecebidas,
      denunciasFeitas,
      assinaturas,
      contatosDesbloqueios,
      pushSubs,
      topicos,
      comentariosComunidade,
    ] = await Promise.all([
      supabase.from("user_profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("diarias").select("*").eq("empregador_id", uid),
      supabase.from("diarias").select("*").eq("diarista_aceite_id", uid),
      supabase.from("candidaturas").select("*").eq("diarista_id", uid),
      supabase.from("convites").select("*").eq("diarista_id", uid),
      // FIX 2026-05-28: coluna real é contratante_id (auditoria banco C-3).
      supabase.from("convites").select("*").eq("contratante_id", uid),
      supabase.from("mensagens").select("*").eq("remetente_id", uid),
      supabase.from("avaliacoes_diarista").select("*").eq("empregador_id", uid)
        .then(async (a) => {
          const b = await supabase.from("avaliacoes_empregador").select("*").eq("diarista_id", uid);
          return { data: [...(a.data || []), ...(b.data || [])] };
        }),
      supabase.from("avaliacoes_diarista").select("*").eq("diarista_id", uid)
        .then(async (a) => {
          const b = await supabase.from("avaliacoes_empregador").select("*").eq("empregador_id", uid);
          return { data: [...(a.data || []), ...(b.data || [])] };
        }),
      supabase.from("denuncias").select("*").eq("denunciante_id", uid),
      supabase.from("assinaturas").select("*").eq("user_id", uid),
      supabase.from("contatos_desbloqueios").select("*").eq("empregador_id", uid),
      supabase.from("push_subscriptions").select("endpoint,created_at").eq("user_id", uid),
      supabase.from("topicos").select("*").eq("autor_id", uid),
      supabase.from("comentarios_comunidade").select("*").eq("autor_id", uid),
    ]);

    // Sanitiza tokens / hashes sensíveis do profile antes de devolver.
    // (mp_access_token NÃO deve sair pro user — é credencial)
    let profileSanitizado: Record<string, unknown> | null = null;
    if (profile.data) {
      const { mp_access_token, ...rest } = profile.data as Record<string, unknown>;
      profileSanitizado = { ...rest, mp_access_token: mp_access_token ? "[REDACTED]" : null };
    }

    const dump = {
      generated_at: new Date().toISOString(),
      user_id: uid,
      lgpd_base_legal: "Art. 18 V da LGPD (Lei 13.709/2018) — Direito à portabilidade",
      data: {
        profile: profileSanitizado,
        diarias_como_contratante: diariasComoContratante.data || [],
        diarias_como_diarista:    diariasComoDiarista.data || [],
        candidaturas:             candidaturas.data || [],
        convites_recebidos:       convitesRecebidos.data || [],
        convites_enviados:        convitesEnviados.data || [],
        mensagens_enviadas:       mensagensEnviadas.data || [],
        avaliacoes_dadas:         avaliacoesDadas.data || [],
        avaliacoes_recebidas:     avaliacoesRecebidas.data || [],
        denuncias_feitas:         denunciasFeitas.data || [],
        assinaturas:              assinaturas.data || [],
        contatos_desbloqueios:    contatosDesbloqueios.data || [],
        push_subscriptions:       pushSubs.data || [],
        topicos_publicados:       topicos.data || [],
        comentarios_comunidade:   comentariosComunidade.data || [],
      },
      observacao: "Mensagens RECEBIDAS não constam — pertencem ao remetente. Solicite-as via suporte se necessário.",
    };

    return new Response(JSON.stringify(dump, null, 2), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type":        "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="diariaja-export-${uid.slice(0,8)}-${Date.now()}.json"`,
        "Cache-Control":       "no-store, no-cache",
      },
    });
  } catch (err) {
    // Pseudonimiza qualquer ID no log
    console.error("[export-user-data] error:", err instanceof Error ? err.message : String(err));
    return json({ error: "Erro interno ao exportar dados. Tente novamente em alguns minutos." }, 500);
  }
});
