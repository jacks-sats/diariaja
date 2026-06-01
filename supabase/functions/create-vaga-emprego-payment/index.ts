// Edge Function: create-vaga-emprego-payment
// Cria pagamento ÚNICO (CheckoutPro, aceita Pix) para PUBLICAR uma vaga de
// emprego no mural. A EMPRESA paga; o candidato nunca paga.
//
// Fluxo:
//   1. App cria a vaga (status 'rascunho') via insert na tabela vagas_emprego.
//   2. App chama esta função com { vaga_id }.
//   3. Usuário paga no Mercado Pago.
//   4. Webhook (mp-webhook) recebe external_reference "vaga_emprego::VAGA_ID"
//      e marca a vaga como status='aberta' + pago_em (publica no mural).
//
// Espelha create-plano-payment. Preço decidido NO SERVIDOR.
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
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key:            opts.key,
      p_max:            opts.max,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) { console.warn("[rate-limit] RPC error, allowing:", error.message); return null; }
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
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Preço decidido NO SERVIDOR (nunca confiar no cliente). Espelha
// PRECO_VAGA_EMPREGO em src/constants.ts. ⚠️ valor a confirmar com o dono.
const PRECO_VAGA_EMPREGO = 19.90;

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

    const { vaga_id } = await req.json() as { vaga_id?: string };
    if (!vaga_id) return json({ error: "vaga_id obrigatório.", trace_id: traceId }, 400);

    const blocked = await rateLimitOrReject(
      { key: `vaga-emprego-payment:user:${user.id}`, max: 5, windowSeconds: 60, corsHeaders: CORS },
      supabaseUser,
    );
    if (blocked) return blocked;

    // RLS garante que o user só enxerga as próprias vagas. Confirma que a vaga
    // existe, é dele e ainda não foi publicada/paga.
    const { data: vaga, error: vagaErr } = await supabaseUser
      .from("vagas_emprego")
      .select("id, empresa_id, funcao, status, pago_em")
      .eq("id", vaga_id)
      .single();
    if (vagaErr || !vaga) return json({ error: "Vaga não encontrada.", trace_id: traceId }, 404);
    if (vaga.empresa_id !== user.id) return json({ error: "Vaga não pertence a você.", trace_id: traceId }, 403);
    if (vaga.pago_em) return json({ error: "Essa vaga já está publicada.", trace_id: traceId }, 409);

    const idempotencyKey = `vaga-${vaga_id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const preferencia = {
      items: [
        {
          id:          `vaga_emprego_${vaga_id}`,
          title:       `DiáriaJá — Publicação de vaga: ${String(vaga.funcao || "Emprego").slice(0, 60)} (30 dias)`,
          description: "Publicação de vaga de emprego no mural por 30 dias. Pagamento único.",
          quantity:    1,
          currency_id: "BRL",
          unit_price:  PRECO_VAGA_EMPREGO,
        },
      ],
      // Webhook lê isto pra publicar a vaga: "vaga_emprego::VAGA_ID"
      external_reference: `vaga_emprego::${vaga_id}`,
      back_urls: {
        success: `${APP_URL}/?vaga_emprego=publicada`,
        failure: `${APP_URL}/?vaga_emprego=falha`,
        pending: `${APP_URL}/?vaga_emprego=pendente`,
      },
      auto_return:      "approved",
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "DIARIAJA",
      payment_methods: {
        excluded_payment_types: [
          { id: "ticket" }, { id: "debit_card" }, { id: "atm" }, { id: "prepaid_card" },
        ],
        installments: 1,
      },
      payer: { name: "Anunciante DiáriaJá" },
    };

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
      console.error(`[create-vaga-emprego-payment][${traceId}] MP_ERRO:`, JSON.stringify(mpData));
      return json({
        error:      `Mercado Pago recusou (HTTP ${mpResp.status})`,
        trace_id:   traceId,
        mp_status:  mpResp.status,
        mp_message: mpData?.message ?? mpData?.error ?? null,
      }, 502);
    }

    return json({ checkout_url: mpData.init_point, sandbox_url: mpData.sandbox_init_point, trace_id: traceId });
  } catch (err) {
    console.error(`[create-vaga-emprego-payment][${traceId}] exception:`, err instanceof Error ? err.message : String(err));
    return json({ error: "Erro interno ao criar pagamento.", trace_id: traceId }, 500);
  }
});
