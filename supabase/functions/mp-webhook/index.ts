// Edge Function: mp-webhook
// Recebe notificações do Mercado Pago:
//   - payment.*   → atualiza pagamento_status da diária
//   - preapproval → atualiza status da assinatura + plano_ativo do usuário
//
// URL configurada em: MP Developers → Webhooks → Modo de produção
// URL: https://rpszebrrrasoijfdvner.supabase.co/functions/v1/mp-webhook
//
// Variáveis de ambiente:
//   MP_ACCESS_TOKEN       → Access Token da plataforma (produção)
//   MP_WEBHOOK_SECRET     → Assinatura secreta gerada no painel MP Developers
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MP_TOKEN         = Deno.env.get("MP_ACCESS_TOKEN")!;
const WEBHOOK_SECRET   = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";

// Comparação byte-a-byte em tempo constante — evita timing oracle
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Valida a assinatura HMAC-SHA256 enviada pelo MP no header x-signature
async function validarAssinatura(req: Request, body: string): Promise<boolean> {
  // Fail-closed: sem secret em produção a função não aceita nada.
  // Configure MP_WEBHOOK_SECRET no painel do Supabase antes de receber webhooks.
  if (!WEBHOOK_SECRET) return false;

  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id") ?? "";
  const url        = new URL(req.url);
  const dataId     = url.searchParams.get("data.id") ?? "";

  // Formato MP: "ts=<timestamp>,v1=<hash>"
  const parts: Record<string, string> = {};
  xSignature.split(",").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  });

  const ts   = parts["ts"] ?? "";
  const hash = parts["v1"] ?? "";
  if (!ts || !hash) return false;

  // Template de assinatura definido pelo MP
  const template = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(template));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqualHex(computed, hash);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const rawBody = await req.text();

    // Valida assinatura (ignora se não estiver configurada)
    const valido = await validarAssinatura(req, rawBody);
    if (!valido) {
      console.warn("Webhook com assinatura inválida rejeitado");
      return new Response("unauthorized", { status: 401 });
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // Payload inválido — retorna 200 para o MP não retentar indefinidamente
      return new Response("ok", { status: 200 });
    }
    if (!body?.data?.id) return new Response("ok", { status: 200 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const topic    = body.type ?? body.topic ?? "";

    // ─────────────────────────────────────────────────
    // 1. ASSINATURAS (preapproval / planos e assinaturas)
    // ─────────────────────────────────────────────────
    if (topic === "preapproval" || topic === "subscription_preapproval") {
      const subId = String(body.data.id);

      const mpResp = await fetch(`https://api.mercadopago.com/preapproval/${subId}`, {
        headers: { "Authorization": `Bearer ${MP_TOKEN}` },
      });
      const sub = await mpResp.json();

      // external_reference = "USER_ID::PLANO"
      const [userId, plano] = (sub.external_reference ?? "::").split("::");
      if (!userId || !plano) return new Response("ok", { status: 200 });

      const statusMap: Record<string, string> = {
        authorized: "ativo",
        paused:     "pausado",
        cancelled:  "cancelado",
        pending:    "pendente",
      };
      const novoStatus = statusMap[sub.status] ?? "pendente";

      // Atualiza a assinatura no banco
      await supabase
        .from("assinaturas")
        .update({ status: novoStatus, mp_subscription_id: subId, updated_at: new Date().toISOString() })
        .eq("user_id", userId);

      // Se ativou → atualiza plano_ativo no perfil
      if (novoStatus === "ativo") {
        await supabase
          .from("user_profiles")
          .update({ plano_ativo: plano })
          .eq("id", userId);
      }

      // Se cancelou → reverte para grátis
      if (novoStatus === "cancelado") {
        await supabase
          .from("user_profiles")
          .update({ plano_ativo: "gratis" })
          .eq("id", userId);
      }

      console.log(`Assinatura ${subId}: ${novoStatus} (user ${userId}, plano ${plano})`);
      return new Response("ok", { status: 200 });
    }

    // ─────────────────────────────────────────────────
    // 2. PAGAMENTOS (payment)
    // ─────────────────────────────────────────────────
    if (topic === "payment") {
      const paymentId = String(body.data.id);

      const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { "Authorization": `Bearer ${MP_TOKEN}` },
      });
      const payment = await mpResp.json();

      if (!payment.external_reference) return new Response("ok", { status: 200 });

      // ── Desbloqueio de contato (R$ 1) ──────────────────────────
      // O cliente é redirecionado para /?contato_desbloqueado=sucesso
      // e controla o contador via localStorage. O webhook apenas loga.
      if (String(payment.external_reference).startsWith("contact_unlock::")) {
        const userId = String(payment.external_reference).split("::")[1] ?? "";
        console.log(`Contato desbloqueado: user=${userId} payment=${paymentId} status=${payment.status}`);
        return new Response("ok", { status: 200 });
      }

      const diariaId = payment.external_reference;

      const statusMap: Record<string, string> = {
        approved:   "pago",
        pending:    "aguardando",
        in_process: "aguardando",
        rejected:   "falhou",
        cancelled:  "cancelado",
        refunded:   "reembolsado",
      };
      const novoStatus = statusMap[payment.status] ?? "aguardando";

      await supabase
        .from("diarias")
        .update({
          pagamento_status: novoStatus,
          pagamento_mp_id:  paymentId,
        })
        .eq("id", diariaId);

      // Pagamento confirmado → insere mensagem automática no chat
      if (novoStatus === "pago") {
        const { data: diaria } = await supabase
          .from("diarias")
          .select("diarista_aceite_id, empregador_id, valor")
          .eq("id", diariaId)
          .single();

        if (diaria?.empregador_id) {
          await supabase.from("mensagens").insert({
            diaria_id:    diariaId,
            remetente_id: diaria.empregador_id,
            destinatario_id: diaria.diarista_aceite_id,
            conteudo:     `✅ Pagamento de R$ ${diaria.valor} confirmado via Mercado Pago! O repasse será feito via PIX após a conclusão da diária.`,
          }).catch(() => {}); // ignora erro se coluna não existir
        }
      }

      console.log(`Pagamento ${paymentId}: ${novoStatus} (diária ${diariaId})`);
      return new Response("ok", { status: 200 });
    }

    // Evento não tratado — retorna 200 para MP não retentar
    return new Response("ok", { status: 200 });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("error", { status: 500 });
  }
});
