// Edge Function: create-contact-payment
// Cria preferência de R$ 1 no Mercado Pago. Dois usos:
//   1. Body: { empregador_id }                  → desbloqueio de seleção extra
//      no plano Grátis. external_reference = "contact_unlock::<empregadorId>".
//   2. Body: { empregador_id, convite_id }      → liberação de contato em
//      convite direto. external_reference = "invite_unlock::<conviteId>".
//
// Retorna: { checkout_url }
//
// Variáveis de ambiente:
//   MP_ACCESS_TOKEN  → Access Token de produção
//   APP_URL          → URL pública do app

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MP_TOKEN          = Deno.env.get("MP_ACCESS_TOKEN")!;
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // ── Auth: confirma que o chamador é mesmo o empregador_id alegado ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado." }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: "Token inválido ou expirado." }, 401);

    const { empregador_id, convite_id } = await req.json();

    if (!empregador_id) {
      return json({ error: "empregador_id obrigatório" }, 400);
    }

    if (user.id !== empregador_id) {
      return json({ error: "Não autorizado para este empregador." }, 403);
    }

    // Se vier convite_id, valida: convite tem que existir, pertencer ao caller,
    // estar aceito e ainda não estar pago. (Service-role bypass de RLS aqui.)
    if (convite_id) {
      const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      const { data: conv } = await supabaseAdmin
        .from("convites")
        .select("id, contratante_id, status, contato_pago_em")
        .eq("id", convite_id)
        .maybeSingle();
      if (!conv) return json({ error: "Convite não encontrado." }, 404);
      if (conv.contratante_id !== empregador_id) return json({ error: "Convite não pertence a você." }, 403);
      if (conv.status !== "aceito") return json({ error: "Convite não foi aceito ainda." }, 409);
      if (conv.contato_pago_em) return json({ error: "Contato já liberado." }, 409);
    }

    // R$ 1,00 — vale pros dois casos (desbloqueio extra ou liberação de convite)
    const idempotencyKey = convite_id
      ? `invite-unlock-${convite_id}`
      : `contact-unlock-${empregador_id}-${new Date().toISOString().slice(0, 13)}`;

    const externalRef = convite_id
      ? `invite_unlock::${convite_id}`
      : `contact_unlock::${empregador_id}`;

    const title = convite_id
      ? "DiáriaJá — Liberar contato do profissional"
      : "DiáriaJá — Desbloqueio de contato";

    const description = convite_id
      ? "Liberação do WhatsApp do profissional convidado."
      : "Desbloqueie 1 seleção de candidato adicional no plano Grátis.";

    const successPath = convite_id
      ? `${APP_URL}/?contato_liberado=sucesso&convite=${convite_id}`
      : `${APP_URL}/?contato_desbloqueado=sucesso`;
    const failurePath = convite_id
      ? `${APP_URL}/?contato_liberado=falha&convite=${convite_id}`
      : `${APP_URL}/?contato_desbloqueado=falha`;
    const pendingPath = convite_id
      ? `${APP_URL}/?contato_liberado=pendente&convite=${convite_id}`
      : `${APP_URL}/?contato_desbloqueado=pendente`;

    const preferencia = {
      items: [
        {
          id:          convite_id ? `invite_unlock_${convite_id}` : `contact_unlock_${empregador_id}`,
          title,
          description,
          quantity:    1,
          currency_id: "BRL",
          unit_price:  1.00,
        },
      ],
      external_reference: externalRef,
      back_urls: {
        success: successPath,
        failure: failurePath,
        pending: pendingPath,
      },
      auto_return:       "approved",
      notification_url:  `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      statement_descriptor: "DIARIAJA",
      payer: { name: "Contratante DiáriaJá" },
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method:  "POST",
      headers: {
        "Authorization":    `Bearer ${MP_TOKEN}`,
        "Content-Type":     "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(preferencia),
    });

    const mpData = await mpResp.json();

    if (!mpResp.ok) {
      console.error("Erro MP create-contact-payment:", JSON.stringify(mpData));
      return json({ error: "Erro ao criar pagamento no Mercado Pago", detalhe: mpData }, 502);
    }

    return json({
      checkout_url:  mpData.init_point,
      sandbox_url:   mpData.sandbox_init_point,
      preference_id: mpData.id,
    });

  } catch (err) {
    console.error("create-contact-payment error:", err);
    return json({ error: "Erro interno" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
