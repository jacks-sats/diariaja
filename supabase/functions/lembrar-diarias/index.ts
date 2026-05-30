// Edge Function: lembrar-diarias  (Fase C — lembrete push antes da diária)
//
// Disparada por pg_cron a cada ~10min. Seleciona diárias 'aceita' (com
// prestador confirmado) que começam nos PRÓXIMOS 30min e ainda não receberam
// lembrete; notifica empregador + diarista; marca `lembrete_enviado_em` (dedup).
//
// Reusa a `send-push` em MODO INTERNO (header x-internal-secret) — toda a
// criptografia Web Push (RFC 8291) fica num lugar só.
//
// Deploy:  supabase functions deploy lembrar-diarias --no-verify-jwt
// Secrets (compartilhado com send-push):
//   supabase secrets set INTERNAL_PUSH_SECRET=<um-segredo-forte-aleatório>
// Trigger: pg_cron → net.http_post (ver migration cron_lembrar_diarias.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_PUSH_SECRET") ?? "";

// Janela: começa de agora até +30min.
const JANELA_MIN = 30;

serve(async (req) => {
  // Só infra autorizada dispara (o mesmo segredo da send-push).
  if (INTERNAL_SECRET.length === 0
      || (req.headers.get("x-internal-secret") ?? "") !== INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: "Não autorizado." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_KEY);
    const agora = new Date();
    const limite = new Date(agora.getTime() + JANELA_MIN * 60 * 1000);

    // Candidatas: 'aceita', com prestador, ainda sem lembrete. O filtro fino de
    // horário é feito abaixo (precisa montar o timestamp data+hora).
    const { data: diarias, error } = await admin
      .from("diarias")
      .select("id, funcao, segmento, data, horario_inicio, empregador_id, diarista_aceite_id")
      .eq("status", "aceita")
      .is("lembrete_enviado_em", null)
      .not("diarista_aceite_id", "is", null);
    if (error) throw error;

    let enviados = 0;
    for (const d of diarias ?? []) {
      const hhmm = (d.horario_inicio || "00:00").slice(0, 5);
      // Brasil é UTC-3 o ano todo (sem horário de verão desde 2019). Fixamos o
      // offset pra o lembrete cair no horário-relógio certo (o cron roda em UTC).
      const inicio = new Date(`${d.data}T${hhmm}:00-03:00`);
      if (isNaN(inicio.getTime())) continue;
      if (inicio < agora || inicio > limite) continue; // só os próximos 30min

      const quem = d.funcao || d.segmento || "a diária";
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_SECRET,
            "Authorization": `Bearer ${SUPABASE_KEY}`, // passa pelo gateway de functions
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify({
            user_ids: [d.empregador_id, d.diarista_aceite_id],
            title: "⏰ Sua diária começa em breve",
            body: `${quem} às ${hhmm}. Na chegada, confirmem a presença pelo app.`,
            url: "/",
            tipo: "vaga_proxima",
          }),
        });
      } catch (e) {
        console.error("[lembrar-diarias] falha ao notificar", d.id, e instanceof Error ? e.message : String(e));
        continue; // não marca como enviado se o push falhou — tenta de novo na próxima rodada
      }

      await admin.from("diarias")
        .update({ lembrete_enviado_em: new Date().toISOString() })
        .eq("id", d.id);
      enviados++;
    }

    return new Response(JSON.stringify({ ok: true, enviados }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[lembrar-diarias] uncaught:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
