// Edge Function: mp-webhook
// Recebe notificações do Mercado Pago:
//   - payment.*   → atualiza status da diária
//   - preapproval → atualiza status da assinatura + plano_ativo do usuário
//
// URL configurada em: MP Developers → sua aplicação → Webhooks
// URL: https://rpszebrrrasoijfdvner.supabase.co/functions/v1/mp-webhook
//
// Variáveis de ambiente:
//   MP_ACCESS_TOKEN       → Access Token da plataforma (seu token pessoal)
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MP_TOKEN      = Deno.env.get("MP_ACCESS_TOKEN")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (!body.data?.id) return new Response("ok", { status: 200 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const topic    = body.type ?? body.topic ?? "";

    // ────────────────────────────────────────────────
    // 1. ASSINATURAS (preapproval)
    // ────────────────────────────────────────────────
    if (topic === "preapproval" || topic === "subscription_preapproval") {
      const subId = String(body.data.id);

      const mpResp = await fetch(`https://api.mercadopago.com/preapproval/${subId}`, {
        headers: { "Authorization": `Bearer ${MP_TOKEN}` },
      });
      const sub = await mpResp.json();

      // external_reference = "USER_ID::PLANO"
      const [userId, plano] = (sub.external_reference ?? "::").split("::");
      if (!userId || !plano) return new Response("ok", { status: 200 });

      const subStatusMap: Record<string, string> = {
        authorized: "ativo",
        paused:     "pausado",
        cancelled:  "cancelado",
        pending:    "pendente",
      };
      const novoStatus = subStatusMap[sub.status] ?? "pendente";

      // Atualiza a assinatura
      await supabase
        .from("assinaturas")
        .update({ status: novoStatus, mp_subscription_id: subId })
        .eq("user_id", userId);

      // Se ativou: atualiza plano_ativo no perfil (para ordenação de diaristas)
      if (novoStatus === "ativo") {
        await supabase
          .from("user_profiles")
          .update({ plano_ativo: plano })
          .eq("id", userId);
      }

      // Se cancelou/expirou: reverte para grátis
      if (novoStatus === "cancelado") {
        await supabase
          .from("user_profiles")
          .update({ plano_ativo: "gratis" })
          .eq("id", userId);
      }

      return new Response("ok", { status: 200 });
    }

    // ────────────────────────────────────────────────
    // 2. PAGAMENTOS (payment)
    // ────────────────────────────────────────────────
    const paymentId = body.data.id;

    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${MP_TOKEN}` },
    });
    const payment = await mpResp.json();

    if (!payment.external_reference) return new Response("ok", { status: 200 });

    const diariaId = payment.external_reference;

    const statusMap: Record<string, string> = {
      approved:    "pago",
      pending:     "aguardando",
      in_process:  "aguardando",
      rejected:    "falhou",
      cancelled:   "cancelado",
      refunded:    "reembolsado",
    };
    const novoStatus = statusMap[payment.status] ?? "aguardando";

    await supabase
      .from("diarias")
      .update({
        pagamento_status: novoStatus,
        pagamento_mp_id:  String(paymentId),
      })
      .eq("id", diariaId);

    if (novoStatus === "pago") {
      const { data: diaria } = await supabase
        .from("diarias")
        .select("diarista_aceite_id, empregador_id, valor, valor_diarista")
        .eq("id", diariaId)
        .single();

      if (diaria?.diarista_aceite_id) {
        await supabase.from("mensagens").insert({
          diaria_id:   diariaId,
          sender_id:   diaria.empregador_id,
          sender_type: "sistema",
          content:     `✅ Pagamento de R$ ${diaria.valor_diarista ?? diaria.valor} confirmado via Mercado Pago! O valor será liberado após a conclusão da diária.`,
        }).catch(() => {});
      }
    }

    return new Response("ok", { status: 200 });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("error", { status: 500 });
  }
});
