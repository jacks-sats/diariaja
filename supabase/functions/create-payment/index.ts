// Edge Function: create-payment
// Cria uma preferência de pagamento no Mercado Pago com split automático
// O diarista recebe (valor - 1,5%) direto na conta MP dele
// A plataforma retém os 1,5% como marketplace_fee
//
// Variáveis de ambiente necessárias no Supabase Dashboard → Settings → Edge Functions:
//   MP_CLIENT_ID       → seu CLIENT_ID do app no MP Developers
//   MP_CLIENT_SECRET   → seu CLIENT_SECRET
//   APP_URL            → URL pública do seu app (ex: https://trampojaapp.com.br)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TAXA_PLATAFORMA = 0.015; // 1,5%
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL         = Deno.env.get("APP_URL") ?? "https://trampojaapp.com.br";

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { diaria_id, empregador_id } = await req.json();

    if (!diaria_id || !empregador_id) {
      return json({ error: "diaria_id e empregador_id são obrigatórios" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Busca a diária
    const { data: diaria, error: dErr } = await supabase
      .from("diarias")
      .select("*, user_profiles!diarias_diarista_aceite_id_fkey(*)")
      .eq("id", diaria_id)
      .single();

    if (dErr || !diaria) return json({ error: "Diária não encontrada" }, 404);
    if (diaria.empregador_id !== empregador_id) return json({ error: "Não autorizado" }, 403);
    if (!diaria.diarista_aceite_id) return json({ error: "Nenhum diarista selecionado ainda" }, 400);

    // 2. Busca o access_token do diarista (conectado via OAuth)
    const { data: diaristaPerfil } = await supabase
      .from("user_profiles")
      .select("mp_access_token, mp_user_id, nome")
      .eq("id", diaria.diarista_aceite_id)
      .single();

    if (!diaristaPerfil?.mp_access_token) {
      return json({
        error: "O diarista ainda não conectou a conta Mercado Pago. Peça para ele acessar o perfil e conectar.",
        code: "MP_NOT_CONNECTED",
      }, 422);
    }

    // 3. Calcula valores
    const valorTotal   = Number(diaria.valor);
    const taxaApp      = Math.round(valorTotal * TAXA_PLATAFORMA * 100) / 100;

    // 4. Cria preferência no MP com o token do DIARISTA (split automático)
    const preferencia = {
      items: [
        {
          id:          diaria.id,
          title:       `Diária – ${diaria.funcao || diaria.segmento}`,
          description: diaria.descricao?.slice(0, 255) || "",
          quantity:    1,
          currency_id: "BRL",
          unit_price:  valorTotal,
        },
      ],
      marketplace_fee: taxaApp,           // valor que vai para a plataforma
      external_reference: diaria.id,      // nosso ID interno
      back_urls: {
        success: `${APP_URL}/?pagamento=sucesso&diaria=${diaria.id}`,
        failure: `${APP_URL}/?pagamento=falha&diaria=${diaria.id}`,
        pending: `${APP_URL}/?pagamento=pendente&diaria=${diaria.id}`,
      },
      auto_return:       "approved",
      notification_url:  `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "TRAMPOJAAPP",
      payer: {
        name: diaria.nome_negocio || "Contratante",
      },
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${diaristaPerfil.mp_access_token}`,
        "Content-Type":  "application/json",
        "X-Idempotency-Key": `trampojadiaria-${diaria.id}`,
      },
      body: JSON.stringify(preferencia),
    });

    const mpData = await mpResp.json();

    if (!mpResp.ok) {
      console.error("Erro MP:", mpData);
      return json({ error: "Erro ao criar pagamento no Mercado Pago", detalhe: mpData }, 502);
    }

    // 5. Salva o MP preference ID na diária
    await supabase
      .from("diarias")
      .update({
        pagamento_mp_id:    mpData.id,
        pagamento_status:   "aguardando",
        taxa_plataforma:    taxaApp,
        valor_diarista:     valorTotal - taxaApp,
      })
      .eq("id", diaria.id);

    return json({
      checkout_url:       mpData.init_point,          // URL para redirecionar o empregador
      sandbox_url:        mpData.sandbox_init_point,  // URL de teste
      preference_id:      mpData.id,
      valor_total:        valorTotal,
      taxa_plataforma:    taxaApp,
      valor_diarista:     valorTotal - taxaApp,
    });

  } catch (err) {
    console.error(err);
    return json({ error: "Erro interno" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
