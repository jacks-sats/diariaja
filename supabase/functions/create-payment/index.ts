// Edge Function: create-payment
// Cria uma preferência de pagamento no Mercado Pago (CheckoutPro)
// O empregador paga o valor total para a plataforma via MP
// O repasse ao diarista é feito via PIX pela plataforma após confirmação
//
// Variáveis de ambiente (Supabase → Edge Functions → Secrets):
//   MP_ACCESS_TOKEN  → Access Token de produção do app DiáriaJá no MP
//   APP_URL          → URL pública do app (ex: https://diariaja.vercel.app)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MP_TOKEN          = Deno.env.get("MP_ACCESS_TOKEN")!;
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // ── Auth: confirma que o chamador é mesmo o empregador_id alegado ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado." }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: "Token inválido ou expirado." }, 401);

    const { diaria_id, empregador_id } = await req.json();

    if (!diaria_id || !empregador_id) {
      return json({ error: "diaria_id e empregador_id são obrigatórios" }, 400);
    }

    if (user.id !== empregador_id) {
      return json({ error: "Não autorizado para este empregador." }, 403);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Busca a diária e o perfil do diarista
    const { data: diaria, error: dErr } = await supabase
      .from("diarias")
      .select("*, user_profiles!diarias_diarista_aceite_id_fkey(nome, telefone)")
      .eq("id", diaria_id)
      .single();

    if (dErr || !diaria) return json({ error: "Diária não encontrada" }, 404);
    if (diaria.empregador_id !== empregador_id) return json({ error: "Não autorizado" }, 403);
    if (!diaria.diarista_aceite_id) return json({ error: "Nenhum diarista selecionado ainda" }, 400);

    // P1-1 auditoria: guard contra cobrança dupla. Se já existe pagamento em
    // estado final ou aguardando, não criamos nova preference. Empregador
    // tocou 2 vezes ou abriu de outra aba — devolvemos a preference atual.
    if (diaria.pagamento_status === "pago" || diaria.pagamento_status === "reembolsado") {
      return json({ error: "Esta diária já foi paga.", status: diaria.pagamento_status }, 409);
    }
    if (diaria.pagamento_status === "aguardando" && diaria.pagamento_mp_id) {
      // Devolve a preference existente em vez de criar outra (idempotência de UX).
      return json({
        checkout_url:  `https://www.mercadopago.com.br/checkout/v1/redirect?preference-id=${diaria.pagamento_mp_id}`,
        preference_id: diaria.pagamento_mp_id,
        valor_total:   Number(diaria.valor),
        reused:        true,
      });
    }

    const valorTotal = Number(diaria.valor);
    const diaristaNome = (diaria.user_profiles as any)?.nome || "Profissional";

    // 2. Cria preferência no MP com o token da PLATAFORMA (CheckoutPro)
    const preferencia = {
      items: [
        {
          id:          diaria.id,
          title:       `DiáriaJá – ${diaria.funcao || diaria.segmento}`,
          description: `Serviço com ${diaristaNome} em ${new Date(diaria.data + "T12:00:00").toLocaleDateString("pt-BR")}`,
          quantity:    1,
          currency_id: "BRL",
          unit_price:  valorTotal,
        },
      ],
      external_reference: diaria.id,
      back_urls: {
        success: `${APP_URL}/?pagamento=sucesso&diaria=${diaria.id}`,
        failure: `${APP_URL}/?pagamento=falha&diaria=${diaria.id}`,
        pending: `${APP_URL}/?pagamento=pendente&diaria=${diaria.id}`,
      },
      auto_return:       "approved",
      notification_url:  `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "DIARIAJA",
      payer: {
        name: diaria.nome_negocio || "Contratante",
      },
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method:  "POST",
      headers: {
        "Authorization":    `Bearer ${MP_TOKEN}`,
        "Content-Type":     "application/json",
        "X-Idempotency-Key": `diariaja-${diaria.id}`,
      },
      body: JSON.stringify(preferencia),
    });

    const mpData = await mpResp.json();

    if (!mpResp.ok) {
      console.error("Erro MP:", JSON.stringify(mpData));
      return json({ error: "Erro ao criar pagamento no Mercado Pago", detalhe: mpData }, 502);
    }

    // 3. Salva o MP preference ID na diária
    await supabase
      .from("diarias")
      .update({
        pagamento_mp_id:  mpData.id,
        pagamento_status: "aguardando",
        valor_diarista:   valorTotal,  // repasse total ao diarista (sem split automático)
      })
      .eq("id", diaria.id);

    return json({
      checkout_url:  mpData.init_point,
      sandbox_url:   mpData.sandbox_init_point,
      preference_id: mpData.id,
      valor_total:   valorTotal,
    });

  } catch (err) {
    console.error(err);
    return json({ error: "Erro interno" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
