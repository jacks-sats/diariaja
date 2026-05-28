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
// IMPORTANTE: trim() pra remover whitespace/newline acidental que vem do paste
// no dashboard. Foi causa real de 401s persistentes em 2026-05-28.
const WEBHOOK_SECRET   = (Deno.env.get("MP_WEBHOOK_SECRET") ?? "").trim();

// Comparação byte-a-byte em tempo constante — evita timing oracle
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Pseudonimiza ID antes de logar — primeiros 8 chars do SHA-256 hex.
// Suficiente pra correlacionar eventos do mesmo user/payment sem vazar
// o identificador real em dump de logs do Supabase (retidos ~7 dias e
// acessíveis a qualquer dev com acesso ao painel).
async function pseudo(id: string | undefined | null): Promise<string> {
  if (!id) return "—";
  try {
    const buf = new TextEncoder().encode(String(id));
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const arr = Array.from(new Uint8Array(hash));
    return arr.slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "—";
  }
}

// Valida a assinatura HMAC-SHA256 enviada pelo MP no header x-signature
async function validarAssinatura(req: Request, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.error("[mp-webhook][SIG] MP_WEBHOOK_SECRET não configurado");
    return false;
  }

  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id") ?? "";
  const url        = new URL(req.url);
  const dataId     = url.searchParams.get("data.id") ?? "";

  // DEBUG: loga TUDO que recebeu pra diagnosticar 401s. Remover após OK.
  // Inclui char codes do primeiro/último char do secret pra detectar
  // whitespace/newline invisível que vem de paste.
  const firstCharCode = WEBHOOK_SECRET.length > 0 ? WEBHOOK_SECRET.charCodeAt(0) : -1;
  const lastCharCode  = WEBHOOK_SECRET.length > 0 ? WEBHOOK_SECRET.charCodeAt(WEBHOOK_SECRET.length - 1) : -1;
  console.log("[mp-webhook][SIG] received headers:", {
    has_x_signature: !!xSignature,
    x_signature_full: xSignature,                          // sig completa pra debug — secret não vaza aqui
    has_x_request_id: !!xRequestId,
    x_request_id: xRequestId,
    data_id: dataId || "(empty)",
    url: req.url,
    secret_length: WEBHOOK_SECRET.length,
    secret_first4: WEBHOOK_SECRET.slice(0, 4),
    secret_last4: WEBHOOK_SECRET.slice(-4),
    secret_first_char_code: firstCharCode,                 // detecta whitespace inicial (32=space, 10=\n)
    secret_last_char_code: lastCharCode,                   // detecta whitespace final
  });

  // Formato MP: "ts=<timestamp>,v1=<hash>"
  const parts: Record<string, string> = {};
  xSignature.split(",").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  });

  const ts   = parts["ts"] ?? "";
  const hash = parts["v1"] ?? "";
  if (!ts || !hash) {
    console.warn("[mp-webhook][SIG] ts ou v1 faltando", { ts_present: !!ts, hash_present: !!hash, parts });
    return false;
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    console.warn("[mp-webhook][SIG] ts inválido", { ts });
    return false;
  }
  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - tsNum) > 300) {
    console.warn("[mp-webhook][SIG] ts fora da janela ±5min", { diff_seconds: agora - tsNum });
    return false;
  }

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

  const match = timingSafeEqualHex(computed, hash);

  // DEBUG: loga HMAC computed vs received pra debug. Remover após OK.
  console.log("[mp-webhook][SIG] HMAC check", { template, received_hash: hash, computed_hash: computed, match });

  return match;
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

    // P0-3 auditoria: idempotência via tabela webhook_eventos_processados.
    // Replay do mesmo payload (ou ataques) batem aqui e são silenciosamente
    // ignorados. Tabela criada em supabase/migrations/webhook_idempotencia.sql.
    // INSERT com ON CONFLICT DO NOTHING — se já existe, rowcount=0.
    const eventoId = String(body.data.id) + "::" + (body.type ?? body.topic ?? "x");
    const { error: idemErr, count: idemCount } = await supabase
      .from("webhook_eventos_processados")
      .insert({ mp_evento_id: eventoId }, { count: "exact" });
    if (idemErr) {
      // Conflito (já processado) ou erro real. Se for conflito (23505), retorna 200.
      if (String(idemErr.code) === "23505" || /duplicate key/i.test(idemErr.message)) {
        return new Response("ok", { status: 200 });
      }
      // Se a tabela não existir ainda (migration não rodou), seguimos sem
      // bloquear — fail-open na idempotência é menos pior que fail-closed.
      if (!/relation .* does not exist/i.test(idemErr.message)) {
        console.error("webhook_eventos_processados error:", idemErr);
      }
    } else if (idemCount === 0) {
      // Inserção sem conflito mas count=0 (pouco provável) — segue.
    }

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

      // Atualiza a assinatura no banco.
      // IMPORTANTE (dual track): user pode ter 2 assinaturas (1 diarista +
      // 1 empregador). Escopa por mp_subscription_id (gravado em
      // create-subscription) pra mexer só na linha correta.
      await supabase
        .from("assinaturas")
        .update({ status: novoStatus, updated_at: new Date().toISOString() })
        .eq("mp_subscription_id", subId);

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

      console.log(`Assinatura ${await pseudo(subId)}: ${novoStatus} (user ${await pseudo(userId)}, plano ${plano})`);
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
      // Registra na tabela `contatos_desbloqueios` para que o cliente saiba
      // quantos extras foram comprados no mês. UNIQUE em mp_payment_id
      // garante idempotência mesmo com retries do webhook do MP.
      if (String(payment.external_reference).startsWith("contact_unlock::")) {
        const userId = String(payment.external_reference).split("::")[1] ?? "";
        if (payment.status === "approved" && userId) {
          const { error: insErr } = await supabase
            .from("contatos_desbloqueios")
            .insert({
              empregador_id:         userId,
              mp_payment_id:         String(paymentId),
              mp_external_reference: String(payment.external_reference),
            });
          // Erro de duplicidade (UNIQUE) é esperado em retries — ignora.
          // Outros erros vamos logar pra debugging mas não bloqueamos o webhook
          // (200 OK pra MP não ficar retentando indefinidamente).
          if (insErr && !String(insErr.message ?? "").toLowerCase().includes("duplicate")) {
            console.error(`[mp-webhook] insert contato_desbloqueio falhou:`, insErr);
          }
        } else {
          console.log(`[mp-webhook] contact_unlock ignored: user=${await pseudo(userId)} payment=${await pseudo(String(paymentId))} status=${payment.status}`);
        }
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

      console.log(`Pagamento ${await pseudo(String(paymentId))}: ${novoStatus} (diária ${await pseudo(String(diariaId))})`);
      return new Response("ok", { status: 200 });
    }

    // Evento não tratado — retorna 200 para MP não retentar
    return new Response("ok", { status: 200 });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("error", { status: 500 });
  }
});
