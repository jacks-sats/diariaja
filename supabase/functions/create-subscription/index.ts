// Edge Function: create-subscription
// Cria uma assinatura recorrente mensal no Mercado Pago
// e registra na tabela assinaturas do Supabase
//
// Variáveis de ambiente: MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MP_TOKEN          = Deno.env.get("MP_ACCESS_TOKEN")!;
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.vercel.app";

// Definição dos planos (espelho do frontend)
const PLANOS: Record<string, { valor: number; nome: string }> = {
  essencial: { valor: 49, nome: "Trampojá Essencial" },
  pro:       { valor: 99, nome: "Trampojá Pro"       },
  destaque:  { valor: 19, nome: "Trampojá Destaque"  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,apikey" } });
  }

  try {
    // ── Auth: confirma que o chamador é mesmo o user_id alegado ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado." }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: "Token inválido ou expirado." }, 401);

    const { plano, user_id, user_type, payer_email } = await req.json();

    if (!plano || !user_id || !user_type || !payer_email) {
      return json({ error: "Campos obrigatórios: plano, user_id, user_type, payer_email" }, 400);
    }

    if (user.id !== user_id) {
      return json({ error: "Não autorizado para este usuário." }, 403);
    }

    const planoDef = PLANOS[plano];
    if (!planoDef) return json({ error: "Plano inválido" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Cria a assinatura no Mercado Pago (Preapproval)
    const agora = new Date();
    const fim   = new Date(agora);
    fim.setFullYear(fim.getFullYear() + 5); // contrato aberto por 5 anos

    const mpBody = {
      reason:             planoDef.nome,
      auto_recurring: {
        frequency:          1,
        frequency_type:     "months",
        transaction_amount: planoDef.valor,
        currency_id:        "BRL",
        start_date:         agora.toISOString(),
        end_date:           fim.toISOString(),
      },
      payer_email,
      back_url:           `${APP_URL}/?assinatura=sucesso&plano=${plano}`,
      external_reference: `${user_id}::${plano}`,
    };

    const mpResp = await fetch("https://api.mercadopago.com/preapproval", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${MP_TOKEN}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(mpBody),
    });

    const mpData = await mpResp.json();

    if (!mpResp.ok || !mpData.init_point) {
      console.error("Erro MP Subscription:", mpData);
      return json({ error: "Erro ao criar assinatura no Mercado Pago", detalhe: mpData }, 502);
    }

    // Registra no banco (pendente — webhook confirma)
    const proximo = new Date();
    proximo.setMonth(proximo.getMonth() + 1);

    const { error: dbErr } = await supabase.from("assinaturas").upsert({
      user_id,
      plano,
      user_type,
      status:              "pendente",
      mp_subscription_id:  mpData.id,
      valor:               planoDef.valor,
      inicio:              agora.toISOString(),
      proximo_pagamento:   proximo.toISOString(),
    }, { onConflict: "user_id" });

    if (dbErr) console.error("DB assinaturas error:", dbErr);

    // plano_ativo só é atualizado pelo webhook do MP quando o pagamento é
    // efetivamente autorizado — evita conceder plano por checkout abandonado.

    return json({
      checkout_url:      mpData.init_point,
      subscription_id:   mpData.id,
      plano,
      valor:             planoDef.valor,
    });

  } catch (err) {
    console.error(err);
    return json({ error: "Erro interno" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
