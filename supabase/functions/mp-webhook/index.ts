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
const INTERNAL_SECRET  = (Deno.env.get("INTERNAL_PUSH_SECRET") ?? "").trim();

// Notifica um usuário via send-push em modo interno (reusa toda a cripto Web Push
// num lugar só). Best-effort: nunca quebra o webhook se o push falhar.
async function notificarUsuario(
  _supabase: unknown, userId: string, title: string, body: string, tipo = "default",
): Promise<void> {
  if (!INTERNAL_SECRET || !userId) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify({ user_ids: [userId], title, body, url: "/", tipo }),
    });
  } catch (e) {
    console.error("[mp-webhook] notificarUsuario falhou:", e instanceof Error ? e.message : String(e));
  }
}

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
  // FIX 2026-05-28: MP envia 2 formatos de URL ao mesmo tempo:
  //   - novo: ?data.id=X&type=payment
  //   - antigo: ?id=X&topic=payment (merchant_order_wh principalmente)
  // Ambos têm assinatura HMAC válida, mas usam o `id` do query string.
  // Sem esse fallback, o formato antigo dava template com `id:;` (vazio)
  // e o HMAC não batia → 401.
  const dataId     = url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "";

  // M1 auditoria: removidos os logs de DEBUG que expunham material sensível
  // (trechos do MP_WEBHOOK_SECRET, x-signature completa e o HMAC computado).
  // Logs do Supabase ficam ~7 dias e são visíveis a qualquer dev do projeto —
  // não devem conter pista de segredo nem do hash de assinatura.

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

  // Template de assinatura definido pelo MP.
  // C-5 auditoria: data.id alfanumérico (preapproval) precisa lowercase
  // segundo docs do MP. ID numérico (payment) é imune; lowercase é no-op.
  const dataIdLower = dataId.toLowerCase();
  const template = `id:${dataIdLower};request-id:${xRequestId.trim()};ts:${ts};`;

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

  // M1: em falha de assinatura logamos só um marcador, sem o hash recebido/computado.
  if (!match) {
    console.warn("[mp-webhook][SIG] assinatura não confere (ts dentro da janela).");
  }

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
    // FIX: idempotência por ID DA NOTIFICAÇÃO (body.id), não pelo id do recurso
    // (body.data.id). O MP manda várias notificações do MESMO pagamento conforme
    // o status muda (pending → approved), todas com o mesmo data.id. Usar data.id
    // fazia a notificação de "approved" ser tratada como duplicata e ignorada —
    // então o plano/pagamento nunca era concedido (quebrava todo Pix). O body.id
    // é único por notificação; retries da MESMA notificação reusam o id (dedupe OK).
    const eventoId = String(body.id ?? body.data.id) + "::" + (body.type ?? body.topic ?? "x");
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

      // Se cancelou → reverte para grátis, MAS só se o usuário não tiver outra
      // fonte de plano ativa (A3 auditoria). No modelo dual-track um usuário
      // 'ambos' pode ter 2 assinaturas (1 por papel); cancelar uma NÃO pode
      // derrubar o plano do outro papel. E o plano avulso de 30 dias (Pix) vive
      // no próprio plano_ativo + plano_expira_em — zerar cegamente apagaria um
      // avulso ainda vigente.
      if (novoStatus === "cancelado") {
        // Outra assinatura recorrente ainda ativa?
        const { data: outras } = await supabase
          .from("assinaturas")
          .select("plano")
          .eq("user_id", userId)
          .eq("status", "ativo");
        const temOutraAtiva = Array.isArray(outras) && outras.length > 0;

        // Plano avulso (30 dias) ainda vigente?
        const { data: prof } = await supabase
          .from("user_profiles")
          .select("plano_expira_em")
          .eq("id", userId)
          .single();
        const avulsoVigente = !!prof?.plano_expira_em
          && new Date(prof.plano_expira_em).getTime() > Date.now();

        if (!temOutraAtiva && !avulsoVigente) {
          await supabase
            .from("user_profiles")
            .update({ plano_ativo: "gratis" })
            .eq("id", userId);
        }
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

      // FIX CheckoutPro: o external_reference que setamos na preferência às vezes
      // NÃO vem no objeto do pagamento — vem na merchant_order (payment.order.id).
      // Sem este fallback, pagamentos aprovados (inclusive Pix) saíam aqui sem
      // conceder o plano/contato.
      let ref = String(payment.external_reference ?? "");
      if (!ref && payment.order?.id) {
        try {
          const moResp = await fetch(`https://api.mercadopago.com/merchant_orders/${payment.order.id}`, {
            headers: { "Authorization": `Bearer ${MP_TOKEN}` },
          });
          const mo = await moResp.json();
          ref = String(mo.external_reference ?? "");
        } catch (e) { console.error("[mp-webhook] merchant_order fetch falhou:", e); }
      }
      console.log(`[mp-webhook] payment ${await pseudo(paymentId)} status=${payment.status} ref=${ref || "(vazio)"}`);
      if (!ref) return new Response("ok", { status: 200 });
      payment.external_reference = ref; // resto do fluxo usa o ref já resolvido

      // ── Desbloqueio de contato (R$ 1) ──────────────────────────
      // Registra na tabela `contatos_desbloqueios` para que o cliente saiba
      // quantos extras foram comprados no mês. UNIQUE em mp_payment_id
      // garante idempotência mesmo com retries do webhook do MP.
      if (String(payment.external_reference).startsWith("contact_unlock::")) {
        const refParts = String(payment.external_reference).split("::");
        const userId = refParts[1] ?? "";
        const conviteId = refParts[2] ?? "";  // presente só no fluxo de convite
        const ehRefund = payment.status === "refunded" || payment.status === "charged_back";
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
          // Fluxo de convite: marca o convite como pago e avisa o prestador pra
          // confirmar a presença. O chat só libera DEPOIS dessa confirmação.
          if (conviteId) {
            const { error: cvErr } = await supabase
              .from("convites")
              .update({ pago_em: new Date().toISOString() })
              .eq("id", conviteId)
              .is("pago_em", null);  // idempotente: não re-notifica em retry
            if (cvErr) {
              console.error(`[mp-webhook] marcar convite pago falhou:`, cvErr);
            } else {
              // Busca o diarista do convite pra notificar (best-effort).
              const { data: conv } = await supabase
                .from("convites").select("diarista_id, funcao").eq("id", conviteId).single();
              if (conv?.diarista_id) {
                await notificarUsuario(supabase, conv.diarista_id,
                  "Você foi contratado! 🎉",
                  `Confirme sua presença para liberar o chat e combinar "${conv.funcao ?? "a diária"}".`,
                  "confirmacao");
              }
            }
          }
        } else if (ehRefund) {
          // Estorno/chargeback do R$1 → REVOGA o desbloqueio (devolve a cota).
          // Localiza pelo mp_payment_id (idempotente: se já foi removido, no-op).
          const { error: delErr } = await supabase
            .from("contatos_desbloqueios")
            .delete()
            .eq("mp_payment_id", String(paymentId));
          if (delErr) console.error(`[mp-webhook] revogar contato (refund) falhou:`, delErr);
          else console.log(`[mp-webhook] contact_unlock REVOGADO por ${payment.status}: user=${await pseudo(userId)} payment=${await pseudo(String(paymentId))}`);
        } else {
          console.log(`[mp-webhook] contact_unlock ignored: user=${await pseudo(userId)} payment=${await pseudo(String(paymentId))} status=${payment.status}`);
        }
        return new Response("ok", { status: 200 });
      }

      // ── Plano 30 dias (pagamento único via Pix/cartão) ─────────
      // external_reference = "plano::USER_ID::PLANO_ID". Diferente do
      // preapproval: aqui é avulso (aceita Pix) e não renova sozinho —
      // grava plano_ativo + plano_expira_em (30 dias). O app avisa ao vencer.
      if (String(payment.external_reference).startsWith("plano::")) {
        const parts = String(payment.external_reference).split("::");
        const userId = parts[1] ?? "";
        const planoId = parts[2] ?? "";
        const ehRefund = payment.status === "refunded" || payment.status === "charged_back";
        if (payment.status === "approved" && userId && planoId) {
          const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const { error: upErr } = await supabase
            .from("user_profiles")
            .update({ plano_ativo: planoId, plano_expira_em: expira })
            .eq("id", userId);
          if (upErr) console.error(`[mp-webhook] plano grant falhou:`, upErr);
        } else if (ehRefund && userId) {
          // Estorno/chargeback do plano avulso → reverte pra grátis.
          // Só rebaixa se o plano atual for o que foi estornado (não derruba um
          // upgrade posterior que o user tenha pago por outro caminho).
          const { error: revErr } = await supabase
            .from("user_profiles")
            .update({ plano_ativo: "gratis", plano_expira_em: null })
            .eq("id", userId)
            .eq("plano_ativo", planoId);
          if (revErr) console.error(`[mp-webhook] reverter plano (refund) falhou:`, revErr);
          else console.log(`[mp-webhook] plano REVOGADO por ${payment.status}: user=${await pseudo(userId)} plano=${planoId}`);
        } else {
          console.log(`[mp-webhook] plano ignored: user=${await pseudo(userId)} payment=${await pseudo(String(paymentId))} status=${payment.status}`);
        }
        return new Response("ok", { status: 200 });
      }

      // ── Vaga de emprego (empresa paga pra publicar no mural) ───
      // external_reference = "vaga_emprego::VAGA_ID". approved → publica
      // (status='aberta' + pago_em). refund/chargeback → fecha a vaga.
      if (String(payment.external_reference).startsWith("vaga_emprego::")) {
        const vagaId = String(payment.external_reference).split("::")[1] ?? "";
        const ehRefund = payment.status === "refunded" || payment.status === "charged_back";
        if (payment.status === "approved" && vagaId) {
          const { error: upErr } = await supabase
            .from("vagas_emprego")
            .update({ status: "aberta", pago_em: new Date().toISOString(), mp_payment_id: String(paymentId) })
            .eq("id", vagaId);
          if (upErr) console.error(`[mp-webhook] publicar vaga_emprego falhou:`, upErr);
        } else if (ehRefund && vagaId) {
          const { error: revErr } = await supabase
            .from("vagas_emprego")
            .update({ status: "fechada" })
            .eq("id", vagaId);
          if (revErr) console.error(`[mp-webhook] fechar vaga_emprego (refund) falhou:`, revErr);
          else console.log(`[mp-webhook] vaga_emprego FECHADA por ${payment.status}: vaga=${await pseudo(vagaId)}`);
        } else {
          console.log(`[mp-webhook] vaga_emprego ignored: vaga=${await pseudo(vagaId)} payment=${await pseudo(String(paymentId))} status=${payment.status}`);
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
