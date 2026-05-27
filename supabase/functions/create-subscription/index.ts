// Edge Function: create-subscription
// Cria uma assinatura recorrente mensal no Mercado Pago
// e registra na tabela assinaturas do Supabase
//
// Variáveis de ambiente: MP_SUBSCRIPTION_TOKEN (preferencial) ou
// MP_ACCESS_TOKEN (fallback), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject } from "../_shared/rate-limit.ts";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Preapproval (Assinaturas) precisa do token de uma aplicação MP cadastrada
// como "Assinaturas". MP_ACCESS_TOKEN é da app de CheckoutPro e dá erro
// PA_UNAUTHORIZED_RESULT_FROM_POLICIES no Preapproval. Fallback pra
// MP_ACCESS_TOKEN só se MP_SUBSCRIPTION_TOKEN não estiver setada (dev).
const MP_TOKEN          = Deno.env.get("MP_SUBSCRIPTION_TOKEN") ?? Deno.env.get("MP_ACCESS_TOKEN")!;
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

// CORS headers reutilizados em respostas pra preflight (OPTIONS) e pra
// erro 429 do rate-limit. Antes existiam só inline no OPTIONS, mas o
// helper rateLimitOrReject precisa receber esses headers explicitamente
// (senão o browser bloqueia a resposta 429 por CORS — daí "ReferenceError:
// CORS is not defined" virava 500 silencioso).
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization,content-type,apikey",
};

// Logging estruturado: cada log tem um trace_id por requisição pra correlacionar
// frontend ↔ Edge Function ↔ Mercado Pago ↔ webhook. Aparece nos logs do Supabase.
function log(traceId: string, etapa: string, detalhes?: Record<string, unknown>): void {
  console.log(`[create-subscription][${traceId}] ${etapa}`, detalhes ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const traceId = crypto.randomUUID().slice(0, 8);

  // Guard rail: se NENHUM token MP está setado, retorna erro claro em vez
  // de fazer "Bearer undefined" e MP devolver 401 sem contexto.
  if (!MP_TOKEN) {
    console.error(`[create-subscription][${traceId}] MP_TOKEN_AUSENTE`);
    return json({
      error:    "Configuração ausente: MP_SUBSCRIPTION_TOKEN (ou MP_ACCESS_TOKEN como fallback) não está nos secrets.",
      trace_id: traceId,
    }, 503);
  }

  try {
    log(traceId, "01_request_recebida", {
      method: req.method,
      hasAuth: !!req.headers.get("Authorization"),
      hasApiKey: !!req.headers.get("apikey"),
      origin: req.headers.get("origin") ?? "—",
      tokenSource: Deno.env.get("MP_SUBSCRIPTION_TOKEN") ? "MP_SUBSCRIPTION_TOKEN" : "MP_ACCESS_TOKEN(fallback)",
    });

    // ── Auth: confirma que o chamador é mesmo o user_id alegado ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log(traceId, "02_auth_ausente");
      return json({ error: "Não autorizado.", trace_id: traceId }, 401);
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      log(traceId, "02_auth_falhou", { error: authErr?.message });
      return json({ error: "Token inválido ou expirado.", trace_id: traceId }, 401);
    }
    log(traceId, "02_auth_ok", { user_id_prefix: user.id.slice(0, 8) });

    const body = await req.json();
    const { plano, user_id, user_type, payer_email } = body as {
      plano?: string; user_id?: string; user_type?: string; payer_email?: string;
    };

    log(traceId, "03_body_parsed", {
      plano, user_type,
      user_id_prefix: user_id?.slice(0, 8) ?? "—",
      payer_email_domain: payer_email?.split("@")[1] ?? "—",
    });

    if (!plano || !user_id || !user_type || !payer_email) {
      log(traceId, "03_body_invalido", { plano, user_type, hasUserId: !!user_id, hasEmail: !!payer_email });
      return json({
        error: "Campos obrigatórios: plano, user_id, user_type, payer_email",
        trace_id: traceId,
      }, 400);
    }

    if (user.id !== user_id) {
      log(traceId, "04_user_mismatch");
      return json({ error: "Não autorizado para este usuário.", trace_id: traceId }, 403);
    }

    // Rate-limit: 5 tentativas / hora. Criar assinatura é raro — proteção
    // contra abuso de criação de preapprovals do MP (custo + spam).
    const blocked = await rateLimitOrReject(
      { key: `create-subscription:user:${user.id}`, max: 5, windowSeconds: 3600, corsHeaders: CORS },
      supabaseUser,
    );
    if (blocked) {
      log(traceId, "05_rate_limit_atingido");
      return blocked;
    }

    // P2-6 auditoria: valida formato e tamanho do payer_email.
    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (typeof payer_email !== "string" || payer_email.length > 254 || !EMAIL_RE.test(payer_email)) {
      log(traceId, "06_email_invalido");
      return json({ error: "payer_email inválido", trace_id: traceId }, 400);
    }

    if (user_type !== "diarista" && user_type !== "empregador") {
      log(traceId, "07_user_type_invalido", { user_type });
      return json({ error: "user_type deve ser 'diarista' ou 'empregador'.", trace_id: traceId }, 400);
    }
    const planoDef = PLANOS[user_type]?.[plano];
    if (!planoDef) {
      log(traceId, "08_plano_invalido", { plano, user_type });
      return json({ error: `Plano '${plano}' não disponível para ${user_type}.`, trace_id: traceId }, 400);
    }
    log(traceId, "08_plano_ok", { valor: planoDef.valor, nome: planoDef.nome });

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

    log(traceId, "09_mp_request_iniciada", {
      url: "https://api.mercadopago.com/preapproval",
      valor: planoDef.valor,
      back_url: mpBody.back_url,
    });

    const mpT0 = Date.now();
    const mpResp = await fetch("https://api.mercadopago.com/preapproval", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${MP_TOKEN}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(mpBody),
    });
    const mpDuracao = Date.now() - mpT0;

    const mpData = await mpResp.json();

    log(traceId, "10_mp_response", {
      status: mpResp.status,
      ok: mpResp.ok,
      duracao_ms: mpDuracao,
      tem_init_point: !!mpData.init_point,
      mp_id: mpData.id ?? null,
    });

    if (!mpResp.ok || !mpData.init_point) {
      // Loga RESPOSTA COMPLETA do MP pra diagnóstico — não pseudonimizamos
      // porque é mensagem de erro técnica, não PII.
      console.error(`[create-subscription][${traceId}] MP_ERRO_DETALHE:`, JSON.stringify(mpData));
      return json({
        error:     `Mercado Pago recusou (HTTP ${mpResp.status})`,
        trace_id:  traceId,
        mp_status: mpResp.status,
        mp_message: mpData?.message ?? mpData?.error ?? null,
        mp_detail:  mpData?.cause ?? mpData?.causes ?? null,
        mp_code:    mpData?.code ?? null,
      }, 502);
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

    if (dbErr) {
      console.error(`[create-subscription][${traceId}] DB_ERROR:`, dbErr);
      log(traceId, "11_db_falhou", { error: dbErr.message });
      // NÃO retornamos 500: o MP já criou a preference. Cliente pode pagar.
      // Webhook reconcilia depois pelo external_reference.
    } else {
      log(traceId, "11_db_ok");
    }

    log(traceId, "12_sucesso_redirecionando", { checkout_url_prefix: mpData.init_point.slice(0, 50) });

    return json({
      checkout_url:      mpData.init_point,
      trace_id:          traceId,
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
