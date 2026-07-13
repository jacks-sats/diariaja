// Edge Function: create-plano-payment
// Cria preferência de pagamento ÚNICO (30 dias) no Mercado Pago para um plano.
// Diferente de create-subscription (Preapproval recorrente, que NÃO aceita Pix),
// este usa CheckoutPro avulso — então o Pix aparece como forma de pagamento.
// Não renova sozinho: ao vencer (plano_expira_em), o app avisa pra renovar.
//
// Body: { plano: "essencial"|"plus", user_type: "diarista"|"empregador" }
// Retorna: { checkout_url: string }
//
// Variáveis de ambiente: MP_ACCESS_TOKEN, APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface RateLimitOptions {
  key: string;
  max: number;
  windowSeconds: number;
  corsHeaders?: Record<string, string>;
}

async function rateLimitOrReject(opts: RateLimitOptions, supabase: SupabaseClient): Promise<Response | null> {
  const bloqueio = () => new Response(
    JSON.stringify({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(opts.windowSeconds), ...(opts.corsHeaders ?? {}) } },
  );
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key:            opts.key,
      p_max:            opts.max,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) { console.warn("[rate-limit] RPC error, blocking:", error.message); return bloqueio(); }
    if (data === false) {
      return bloqueio();
    }
    return null;
  } catch (e) {
    console.warn("[rate-limit] thrown, blocking:", e instanceof Error ? e.message : String(e));
    return bloqueio();
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

// Preços decididos NO SERVIDOR (nunca confiar no valor vindo do cliente).
// Espelha src/constants.ts (PLANOS_DIARISTA / PLANOS_EMPREGADOR).
const PRECOS: Record<string, { valor: number; nome: string }> = {
  "diarista:essencial":   { valor: 9.90,  nome: "Essencial" },
  "diarista:plus":        { valor: 19.90, nome: "Plus" },
  "empregador:essencial": { valor: 24.90, nome: "Essencial" },
  "empregador:plus":      { valor: 49.90, nome: "Plus" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const traceId = crypto.randomUUID().slice(0, 8);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado.", trace_id: traceId }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: "Token inválido ou expirado.", trace_id: traceId }, 401);

    const { plano, user_type } = await req.json() as { plano?: string; user_type?: string };
    const tipo = user_type === "diarista" ? "diarista" : "empregador";
    const chave = `${tipo}:${plano}`;
    const info = PRECOS[chave];
    if (!info) return json({ error: "Plano inválido.", trace_id: traceId }, 400);

    const blocked = await rateLimitOrReject(
      { key: `plano-payment:user:${user.id}`, max: 5, windowSeconds: 60, corsHeaders: CORS },
      supabaseUser,
    );
    if (blocked) return blocked;

    const idempotencyKey = `plano-${user.id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const preferencia = {
      items: [
        {
          id:          `plano_${plano}`,
          title:       `DiáriaJá ${info.nome} — ${tipo === "diarista" ? "Diarista" : "Anunciante"} (30 dias)`,
          description: "Acesso ao plano por 30 dias. Pagamento único — não renova automaticamente.",
          quantity:    1,
          currency_id: "BRL",
          unit_price:  info.valor,
        },
      ],
      // Webhook lê isto pra conceder o plano: "plano::USER_ID::USER_TYPE::PLANO_ID".
      // P0-1: o user_type entra no ref pois o preço difere por papel (diarista vs
      // empregador) e o webhook precisa dele pra validar o valor pago.
      external_reference: `plano::${user.id}::${tipo}::${plano}`,
      back_urls: {
        success: `${APP_URL}/?plano=ativado`,
        failure: `${APP_URL}/?plano=falha`,
        pending: `${APP_URL}/?plano=pendente`,
      },
      auto_return:      "approved",
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "DIARIAJA",
      // Mantém Pix (bank_transfer) + cartão de crédito; exclui o resto.
      payment_methods: {
        excluded_payment_types: [
          { id: "ticket" }, { id: "debit_card" }, { id: "atm" }, { id: "prepaid_card" },
        ],
        installments: 1,
      },
      payer: { name: "Assinante DiáriaJá" },
    };

    // P0-1: grava a intenção (valor esperado ↔ ref ↔ user) pro webhook validar.
    // Best-effort: não bloqueia a criação da preferência se o insert falhar
    // (o webhook ainda valida pelo valor canônico hardcoded).
    await supabaseUser.from("pagamentos_intencao").insert({
      external_reference: preferencia.external_reference,
      user_id:            user.id,
      tipo:               "plano",
      valor_esperado:     info.valor,
      user_type:          tipo,
      plano_id:           plano,
    }).then(({ error }) => { if (error) console.warn(`[create-plano-payment][${traceId}] pag_intencao_falhou`, error.message); });

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method:  "POST",
      headers: {
        "Authorization":     `Bearer ${MP_TOKEN}`,
        "Content-Type":      "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(preferencia),
    });
    const mpData = await mpResp.json();

    if (!mpResp.ok || !mpData.init_point) {
      console.error(`[create-plano-payment][${traceId}] MP_ERRO:`, JSON.stringify(mpData));
      return json({
        error:      `Mercado Pago recusou (HTTP ${mpResp.status})`,
        trace_id:   traceId,
        mp_status:  mpResp.status,
        mp_message: mpData?.message ?? mpData?.error ?? null,
      }, 502);
    }

    return json({ checkout_url: mpData.init_point, sandbox_url: mpData.sandbox_init_point, trace_id: traceId });
  } catch (err) {
    console.error(`[create-plano-payment][${traceId}] exception:`, err instanceof Error ? err.message : String(err));
    return json({ error: "Erro interno ao criar pagamento.", trace_id: traceId }, 500);
  }
});
