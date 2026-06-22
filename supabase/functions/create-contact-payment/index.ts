// Edge Function: create-contact-payment
// Cria preferência de R$ 2,50 no Mercado Pago para desbloquear
// uma seleção de candidato adicional no plano Grátis.
//
// Body: { empregador_id: string }
// Retorna: { checkout_url: string }
//
// Variáveis de ambiente:
//   MP_ACCESS_TOKEN  → Access Token de produção
//   APP_URL          → URL pública do app

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Rate-limit inline (copiado de ../_shared/rate-limit.ts em 2026-05-28) ──
// Inlinado pra permitir deploy via dashboard Supabase (que não bundle multi-file).
// Se mudar, atualizar também em ../_shared/rate-limit.ts e nas outras functions.
interface RateLimitOptions {
  key: string;
  max: number;
  windowSeconds: number;
  corsHeaders?: Record<string, string>;
}

async function rateLimitOrReject(opts: RateLimitOptions, supabase: SupabaseClient): Promise<Response | null> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key:            opts.key,
      p_max:            opts.max,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) {
      console.warn("[rate-limit] RPC error, allowing:", error.message);
      return null;
    }
    if (data === false) {
      return new Response(
        JSON.stringify({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(opts.windowSeconds), ...(opts.corsHeaders ?? {}) } },
      );
    }
    return null;
  } catch (e) {
    console.warn("[rate-limit] thrown, allowing:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MP_TOKEN          = Deno.env.get("MP_ACCESS_TOKEN")!;
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function log(traceId: string, etapa: string, detalhes?: Record<string, unknown>): void {
  console.log(`[create-contact-payment][${traceId}] ${etapa}`, detalhes ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const traceId = crypto.randomUUID().slice(0, 8);

  try {
    log(traceId, "01_request_recebida", {
      method:    req.method,
      hasAuth:   !!req.headers.get("Authorization"),
      hasApiKey: !!req.headers.get("apikey"),
      tokenPrefix: MP_TOKEN ? MP_TOKEN.slice(0, 8) : "AUSENTE",
    });

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

    // convite_id é opcional: quando enviado, o webhook consegue mapear o
    // pagamento ao convite específico que foi confirmado, permitindo que a
    // UI saiba EXATAMENTE quais convites estão com contato liberado depois
    // de um reload/login (em vez de só contar quantos R$1 foram pagos).
    const { empregador_id, convite_id } = await req.json() as { empregador_id?: string; convite_id?: string };

    if (!empregador_id) {
      log(traceId, "03_body_invalido");
      return json({ error: "empregador_id obrigatório", trace_id: traceId }, 400);
    }

    if (user.id !== empregador_id) {
      log(traceId, "04_user_mismatch");
      return json({ error: "Não autorizado para este empregador.", trace_id: traceId }, 403);
    }

    const blocked = await rateLimitOrReject(
      { key: `contact-unlock:user:${user.id}`, max: 3, windowSeconds: 60, corsHeaders: CORS },
      supabaseUser,
    );
    if (blocked) {
      log(traceId, "05_rate_limit_atingido");
      return blocked;
    }

    const idempotencyKey = `contact-unlock-${empregador_id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const preferencia = {
      items: [
        {
          id:          `contact_unlock_${empregador_id}`,
          title:       "DiáriaJá — Desbloqueio de chat",
          description: "Liberação do chat interno com 1 candidato/diarista.",
          quantity:    1,
          currency_id: "BRL",
          unit_price:  2.50,
        },
      ],
      external_reference: convite_id
        ? `contact_unlock::${empregador_id}::${convite_id}`
        : `contact_unlock::${empregador_id}`,
      // (intenção P0-1 gravada logo abaixo, após montar a preferência)
      back_urls: {
        success: `${APP_URL}/?contato_desbloqueado=sucesso`,
        failure: `${APP_URL}/?contato_desbloqueado=falha`,
        pending: `${APP_URL}/?contato_desbloqueado=pendente`,
      },
      auto_return:       "approved",
      notification_url:  `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      statement_descriptor: "DIARIAJA",
      // Restringe aos métodos PIX (bank_transfer) + cartão de crédito.
      // Exclui boleto, débito, saldo MP, pré-pago e ATM.
      payment_methods: {
        excluded_payment_types: [
          { id: "ticket" },        // boleto bancário
          { id: "debit_card" },    // cartão de débito
          { id: "atm" },           // caixa eletrônico
          { id: "prepaid_card" },  // pré-pago
        ],
        installments: 1,
      },
      payer: { name: "Anunciante DiáriaJá" },
    };

    // P0-1: grava a intenção (valor esperado ↔ ref ↔ user) pro webhook validar.
    // Best-effort: não bloqueia o pagamento se falhar (webhook valida pelo canônico).
    await supabaseUser.from("pagamentos_intencao").insert({
      external_reference: preferencia.external_reference,
      user_id:            empregador_id,
      tipo:               "contato",
      valor_esperado:     2.50,
    }).then(({ error }) => { if (error) log(traceId, "pag_intencao_falhou", { msg: error.message }); });

    log(traceId, "06_mp_request_iniciada", {
      url:               "https://api.mercadopago.com/checkout/preferences",
      back_url_success:  preferencia.back_urls.success,
      notification_url:  preferencia.notification_url,
    });

    const mpT0 = Date.now();
    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method:  "POST",
      headers: {
        "Authorization":    `Bearer ${MP_TOKEN}`,
        "Content-Type":     "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(preferencia),
    });
    const mpDuracao = Date.now() - mpT0;

    const mpData = await mpResp.json();

    log(traceId, "07_mp_response", {
      status:         mpResp.status,
      ok:             mpResp.ok,
      duracao_ms:     mpDuracao,
      tem_init_point: !!mpData.init_point,
      mp_id:          mpData.id ?? null,
    });

    if (!mpResp.ok || !mpData.init_point) {
      console.error(`[create-contact-payment][${traceId}] MP_ERRO_DETALHE:`, JSON.stringify(mpData));
      return json({
        error:      `Mercado Pago recusou (HTTP ${mpResp.status})`,
        trace_id:   traceId,
        mp_status:  mpResp.status,
        mp_message: mpData?.message ?? mpData?.error ?? null,
        mp_detail:  mpData?.cause ?? mpData?.causes ?? null,
      }, 502);
    }

    log(traceId, "08_sucesso", { checkout_url_prefix: mpData.init_point.slice(0, 50) });

    return json({
      checkout_url:  mpData.init_point,
      sandbox_url:   mpData.sandbox_init_point,
      preference_id: mpData.id,
      trace_id:      traceId,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[create-contact-payment][${traceId}] uncaught:`, msg, err);
    return json({ error: `Erro: ${msg.slice(0, 200)}`, trace_id: traceId }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
