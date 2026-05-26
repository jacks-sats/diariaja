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

    // diarista_id_a_selecionar (opcional) = fluxo novo: contratante paga ANTES
    // de gravar a seleção no banco. O webhook executa a transação ao confirmar.
    // Sem ele = fluxo legado (compatibilidade com diárias antigas).
    const { diaria_id, empregador_id, diarista_id_a_selecionar } = await req.json();

    if (!diaria_id || !empregador_id) {
      return json({ error: "diaria_id e empregador_id são obrigatórios" }, 400);
    }

    if (user.id !== empregador_id) {
      return json({ error: "Não autorizado para este empregador." }, 403);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Busca a diária
    const { data: diaria, error: dErr } = await supabase
      .from("diarias")
      .select("*, user_profiles!diarias_diarista_aceite_id_fkey(nome, telefone)")
      .eq("id", diaria_id)
      .single();

    if (dErr || !diaria) return json({ error: "Diária não encontrada" }, 404);
    if (diaria.empregador_id !== empregador_id) return json({ error: "Não autorizado" }, 403);

    // Validações específicas por fluxo
    let diaristaNome = "Profissional";
    if (diarista_id_a_selecionar) {
      // Fluxo novo: ninguém ainda foi gravado como aceite, mas o candidato precisa
      // ser real e estar pendente.
      if (diaria.diarista_aceite_id && diaria.diarista_aceite_id !== diarista_id_a_selecionar) {
        return json({ error: "Esta diária já tem outro diarista selecionado." }, 409);
      }
      const { data: cand } = await supabase
        .from("candidaturas")
        .select("status, user_profiles!candidaturas_diarista_id_fkey(nome)")
        .eq("diaria_id", diaria_id)
        .eq("diarista_id", diarista_id_a_selecionar)
        .maybeSingle();
      if (!cand) return json({ error: "Candidatura não encontrada." }, 404);
      if (cand.status !== "pendente" && cand.status !== "selecionado") {
        return json({ error: "Candidatura não está mais disponível." }, 409);
      }
      diaristaNome = ((cand as any).user_profiles?.nome) || "Profissional";
    } else {
      // Fluxo legado: precisa ter diarista_aceite_id já gravado.
      if (!diaria.diarista_aceite_id) return json({ error: "Nenhum diarista selecionado ainda" }, 400);
      diaristaNome = (diaria.user_profiles as any)?.nome || "Profissional";
    }

    const valorTotal = Number(diaria.valor);

    // 2. Cria preferência no MP com o token da PLATAFORMA (CheckoutPro)
    // external_reference: "select::<diariaId>::<diaristaId>" (fluxo novo: webhook
    // executa a seleção ao confirmar) OU "<diariaId>" (fluxo legado).
    const externalRef = diarista_id_a_selecionar
      ? `select::${diaria.id}::${diarista_id_a_selecionar}`
      : diaria.id;
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
      external_reference: externalRef,
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

    // 3. Salva o MP preference ID na diária (fluxo novo NÃO grava diarista_aceite_id
    // ainda — webhook faz isso quando o pagamento confirma)
    await supabase
      .from("diarias")
      .update({
        pagamento_mp_id:  mpData.id,
        pagamento_status: "aguardando",
        valor_diarista:   valorTotal,
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
