// Edge Function: create-contact-payment
// Cria preferência de R$ 1 no Mercado Pago para desbloquear
// uma seleção de candidato adicional no plano Grátis.
//
// Body: { empregador_id: string }
// Retorna: { checkout_url: string }
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

    const { empregador_id } = await req.json();

    if (!empregador_id) {
      return json({ error: "empregador_id obrigatório" }, 400);
    }

    if (user.id !== empregador_id) {
      return json({ error: "Não autorizado para este empregador." }, 403);
    }

    // Cria preferência de R$ 1,00 para desbloqueio de contato.
    // P1-6 auditoria: antes a key truncava em `slice(0, 13)` (até a hora) — dois
    // desbloqueios na mesma hora retornavam a MESMA preference do MP, então um
    // 2º desbloqueio na mesma hora era "grátis" (MP devolvia a init_point já
    // paga). Agora cada chamada tem key única com millisegundos + random.
    const idempotencyKey = `contact-unlock-${empregador_id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const preferencia = {
      items: [
        {
          id:          `contact_unlock_${empregador_id}`,
          title:       "DiáriaJá — Desbloqueio de contato",
          description: "Desbloqueie 1 seleção de candidato adicional no plano Grátis.",
          quantity:    1,
          currency_id: "BRL",
          unit_price:  1.00,
        },
      ],
      external_reference: `contact_unlock::${empregador_id}`,
      back_urls: {
        success: `${APP_URL}/?contato_desbloqueado=sucesso`,
        failure: `${APP_URL}/?contato_desbloqueado=falha`,
        pending: `${APP_URL}/?contato_desbloqueado=pendente`,
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
