// Edge Function: create-subscription
// Cria uma assinatura recorrente mensal no Mercado Pago
// e registra na tabela assinaturas do Supabase
//
// Variáveis de ambiente: MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject } from "../_shared/rate-limit.ts";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MP_TOKEN          = Deno.env.get("MP_ACCESS_TOKEN")!;
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.vercel.app";

// Definição dos planos por papel (espelho do frontend — PLANOS_EMPREGADOR
// e PLANOS_DIARISTA em src/constants.ts). Dual track: diarista e empregador
// têm preços diferentes pro mesmo "tier".
const PLANOS: Record<string, Record<string, { valor: number; nome: string }>> = {
  diarista: {
    essencial: { valor:  9.90, nome: "DiáriaJá Essencial — Diarista"   },
    plus:      { valor: 19.90, nome: "DiáriaJá Plus — Diarista"        },
  },
  empregador: {
    essencial: { valor: 24.90, nome: "DiáriaJá Essencial — Contratante" },
    plus:      { valor: 49.90, nome: "DiáriaJá Plus — Contratante"      },
  },
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

    // Rate-limit: 5 tentativas / hora. Criar assinatura é raro — proteção
    // contra abuso de criação de preapprovals do MP (custo + spam).
    const blocked = await rateLimitOrReject(
      { key: `create-subscription:user:${user.id}`, max: 5, windowSeconds: 3600, corsHeaders: CORS },
      supabaseUser,
    );
    if (blocked) return blocked;

    // P2-6 auditoria: valida formato e tamanho do payer_email.
    // O MP exige que esse email bata com a conta MP do pagador, mas validamos
    // localmente pra rejeitar lixo antes do roundtrip e evitar logs sujos.
    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (typeof payer_email !== "string" || payer_email.length > 254 || !EMAIL_RE.test(payer_email)) {
      return json({ error: "payer_email inválido" }, 400);
    }

    // user_type tem que ser 'diarista' ou 'empregador' (NÃO 'ambos').
    // No client, 'ambos' nunca é mandado direto — o modoAtual escolhe um.
    if (user_type !== "diarista" && user_type !== "empregador") {
      return json({ error: "user_type deve ser 'diarista' ou 'empregador'." }, 400);
    }
    const planoDef = PLANOS[user_type]?.[plano];
    if (!planoDef) {
      return json({ error: `Plano '${plano}' não disponível para ${user_type}.` }, 400);
    }

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

    // Dual track: UNIQUE composta (user_id, user_type) — onConflict tem que
    // bater com a constraint nova `uq_assinaturas_user_role` da migration
    // monetizacao_dual_track.sql. Antes era só user_id, mas isso quebrou
    // quando o mesmo user pode ter 2 assinaturas (1 por papel).
    const { error: dbErr } = await supabase.from("assinaturas").upsert({
      user_id,
      plano,
      user_type,
      status:              "pendente",
      mp_subscription_id:  mpData.id,
      valor:               planoDef.valor,
      inicio:              agora.toISOString(),
      proximo_pagamento:   proximo.toISOString(),
    }, { onConflict: "user_id,user_type" });

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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[create-subscription] uncaught:", msg, err);
    // Retorna o motivo real pro client em vez de "Erro interno" cego — facilita
    // diagnóstico em produção (MP fora do ar, body malformado, etc.).
    return json({ error: `Erro: ${msg.slice(0, 200)}` }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
