// Edge Function: mp-health-check
// Diagnóstico end-to-end do stack de pagamentos Mercado Pago.
// Testa secrets, conectividade com MP, validade dos tokens, e capacidade
// de criar preferences e preapprovals. Não cria pagamentos REAIS — apenas
// faz validações leves contra a API do MP.
//
// Auth: exige admin OU header secret `x-health-check-secret`.
// Body: nenhum.
// Resposta: JSON com checks individuais.
//
// Deploy: npx supabase functions deploy mp-health-check
// Uso: chamado da UI admin de diagnóstico OU via curl pra debug.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HEALTH_SECRET     = Deno.env.get("HEALTH_CHECK_SECRET") ?? "";
const APP_URL           = Deno.env.get("APP_URL") ?? "https://diariaja.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-health-check-secret",
};

type Check = {
  nome:    string;
  ok:      boolean;
  detalhe: string;
  duracao_ms?: number;
};

async function checkSecret(nome: string, value: string | undefined): Promise<Check> {
  const ok = !!value && value.length > 10;
  return {
    nome:    `secret_${nome}`,
    ok,
    detalhe: ok
      ? `presente (${value!.length} chars, prefixo ${value!.slice(0, 8)}...)`
      : "ausente ou vazio",
  };
}

async function checkMpToken(rotulo: string, token: string | undefined): Promise<Check> {
  if (!token) return { nome: `mp_${rotulo}_validade`, ok: false, detalhe: "secret ausente" };

  const t0 = Date.now();
  try {
    // GET /v1/account/settings é o endpoint mais leve pra validar token
    const r = await fetch("https://api.mercadopago.com/users/me", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });
    const dt = Date.now() - t0;
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (r.ok) {
      const userId    = (data as { id?: string | number }).id;
      const siteId    = (data as { site_id?: string }).site_id;
      const isTest    = String(token).startsWith("TEST-");
      return {
        nome:      `mp_${rotulo}_validade`,
        ok:        true,
        detalhe:   `válido | user_id=${userId} site=${siteId} env=${isTest ? "TEST" : "PROD"}`,
        duracao_ms: dt,
      };
    }
    return {
      nome:      `mp_${rotulo}_validade`,
      ok:        false,
      detalhe:   `${r.status} ${r.statusText} — ${(data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? "sem mensagem"}`,
      duracao_ms: dt,
    };
  } catch (err) {
    return {
      nome:      `mp_${rotulo}_validade`,
      ok:        false,
      detalhe:   `network error: ${err instanceof Error ? err.message : String(err)}`,
      duracao_ms: Date.now() - t0,
    };
  }
}

async function checkMpCheckoutPro(token: string | undefined): Promise<Check> {
  if (!token) return { nome: "mp_checkout_pro_pode_criar", ok: false, detalhe: "MP_ACCESS_TOKEN ausente" };

  const t0 = Date.now();
  try {
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method:  "POST",
      headers: {
        "Authorization":  `Bearer ${token}`,
        "Content-Type":   "application/json",
        "X-Idempotency-Key": `healthcheck-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      },
      body: JSON.stringify({
        items: [{
          id: "healthcheck",
          title: "DiáriaJá Health Check (não cobrar)",
          quantity: 1,
          currency_id: "BRL",
          unit_price: 1.0,
        }],
        external_reference: `healthcheck::${Date.now()}`,
        back_urls: { success: APP_URL, failure: APP_URL, pending: APP_URL },
      }),
    });
    const dt = Date.now() - t0;
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (r.ok && (data as { init_point?: string }).init_point) {
      return {
        nome:      "mp_checkout_pro_pode_criar",
        ok:        true,
        detalhe:   `OK | preference criado | id=${(data as { id?: string }).id}`,
        duracao_ms: dt,
      };
    }
    return {
      nome:      "mp_checkout_pro_pode_criar",
      ok:        false,
      detalhe:   `${r.status} — ${(data as { message?: string }).message ?? JSON.stringify(data).slice(0, 200)}`,
      duracao_ms: dt,
    };
  } catch (err) {
    return {
      nome:      "mp_checkout_pro_pode_criar",
      ok:        false,
      detalhe:   `network error: ${err instanceof Error ? err.message : String(err)}`,
      duracao_ms: Date.now() - t0,
    };
  }
}

async function checkMpPreapprovalDryRun(token: string | undefined): Promise<Check> {
  if (!token) return { nome: "mp_preapproval_pode_criar", ok: false, detalhe: "MP_SUBSCRIPTION_TOKEN ausente" };

  // Não criamos uma preapproval real (cobraria de um payer_email).
  // Em vez disso, fazemos um GET /preapproval que lista — testa permissão.
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.mercadopago.com/preapproval/search?limit=1", {
      method:  "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });
    const dt = Date.now() - t0;
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (r.ok) {
      const total = (data as { paging?: { total?: number } }).paging?.total ?? 0;
      return {
        nome:      "mp_preapproval_pode_criar",
        ok:        true,
        detalhe:   `OK | conta acessa Preapproval | total existentes=${total}`,
        duracao_ms: dt,
      };
    }
    return {
      nome:      "mp_preapproval_pode_criar",
      ok:        false,
      detalhe:   `${r.status} — ${(data as { message?: string }).message ?? JSON.stringify(data).slice(0, 200)}`,
      duracao_ms: dt,
    };
  } catch (err) {
    return {
      nome:      "mp_preapproval_pode_criar",
      ok:        false,
      detalhe:   `network error: ${err instanceof Error ? err.message : String(err)}`,
      duracao_ms: Date.now() - t0,
    };
  }
}

async function checkSupabaseTable(supabase: ReturnType<typeof createClient>, nome: string): Promise<Check> {
  const t0 = Date.now();
  const { error, count } = await supabase.from(nome).select("*", { count: "exact", head: true });
  const dt = Date.now() - t0;
  return {
    nome:    `tabela_${nome}`,
    ok:      !error,
    detalhe: error ? `erro: ${error.message}` : `OK | rows=${count ?? 0}`,
    duracao_ms: dt,
  };
}

async function checkRpc(supabase: ReturnType<typeof createClient>, nome: string, args: Record<string, unknown> = {}): Promise<Check> {
  const t0 = Date.now();
  const { error } = await supabase.rpc(nome, args);
  const dt = Date.now() - t0;
  // Algumas RPCs retornam erro de validação (auth.uid() null) — isso é OK,
  // significa que a RPC existe. Erro de "function does not exist" é o ruim.
  const naoExiste = error && /does not exist|function .* does not exist/i.test(error.message);
  return {
    nome:    `rpc_${nome}`,
    ok:      !naoExiste,
    detalhe: error ? `erro: ${error.message.slice(0, 120)}` : "OK",
    duracao_ms: dt,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth: admin via JWT OU secret header (pra cron / curl debug)
  let autorizado = false;
  const headerSecret = req.headers.get("x-health-check-secret");
  if (HEALTH_SECRET && headerSecret === HEALTH_SECRET) autorizado = true;

  if (!autorizado) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) {
        const { data: profile } = await supabaseUser
          .from("user_profiles").select("is_admin").eq("id", user.id).maybeSingle();
        if ((profile as { is_admin?: boolean } | null)?.is_admin) autorizado = true;
      }
    }
  }

  if (!autorizado) {
    return json({ error: "Não autorizado. Use admin JWT ou x-health-check-secret." }, 401);
  }

  const MP_ACCESS         = Deno.env.get("MP_ACCESS_TOKEN");
  const MP_SUBSCRIPTION   = Deno.env.get("MP_SUBSCRIPTION_TOKEN");
  const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET");

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Roda checks em paralelo onde possível
  const [
    sec_mp_access,
    sec_mp_subscription,
    sec_mp_webhook,
    sec_app_url,
    sec_supabase_url,
    sec_service_role,
    mp_checkout_token,
    mp_subscription_token,
    mp_checkout_create,
    mp_preapproval_list,
    tab_assinaturas,
    tab_contatos_desbloqueios,
    tab_webhook_eventos,
    rpc_check_rate_limit,
    rpc_pode_selecionar,
  ] = await Promise.all([
    checkSecret("MP_ACCESS_TOKEN", MP_ACCESS),
    checkSecret("MP_SUBSCRIPTION_TOKEN", MP_SUBSCRIPTION),
    checkSecret("MP_WEBHOOK_SECRET", MP_WEBHOOK_SECRET),
    checkSecret("APP_URL", Deno.env.get("APP_URL")),
    checkSecret("SUPABASE_URL", SUPABASE_URL),
    checkSecret("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY),
    checkMpToken("checkout_pro", MP_ACCESS),
    checkMpToken("subscription", MP_SUBSCRIPTION),
    checkMpCheckoutPro(MP_ACCESS),
    checkMpPreapprovalDryRun(MP_SUBSCRIPTION),
    checkSupabaseTable(supabase, "assinaturas"),
    checkSupabaseTable(supabase, "contatos_desbloqueios"),
    checkSupabaseTable(supabase, "webhook_eventos_processados"),
    checkRpc(supabase, "check_rate_limit", { p_key: "healthcheck", p_max: 999, p_window_seconds: 60 }),
    checkRpc(supabase, "pode_selecionar_candidato", { p_diaria_id: "00000000-0000-0000-0000-000000000000" }),
  ]);

  const checks: Check[] = [
    sec_supabase_url, sec_service_role, sec_app_url,
    sec_mp_access, sec_mp_subscription, sec_mp_webhook,
    mp_checkout_token, mp_subscription_token,
    mp_checkout_create, mp_preapproval_list,
    tab_assinaturas, tab_contatos_desbloqueios, tab_webhook_eventos,
    rpc_check_rate_limit, rpc_pode_selecionar,
  ];

  const totais = {
    total:  checks.length,
    ok:     checks.filter(c => c.ok).length,
    falha:  checks.filter(c => !c.ok).length,
  };

  const diagnostico = {
    status:     totais.falha === 0 ? "saudavel" : "com_problemas",
    timestamp:  new Date().toISOString(),
    totais,
    checks,
    // Diagnóstico textual rápido
    veredito: (() => {
      if (!sec_mp_access.ok) return "MP_ACCESS_TOKEN ausente — R$1 unlock vai falhar";
      if (!mp_checkout_token.ok) return `Token de CheckoutPro inválido/recusado pelo MP: ${mp_checkout_token.detalhe}`;
      if (!mp_checkout_create.ok) return `MP rejeita criar preference: ${mp_checkout_create.detalhe}`;
      if (!sec_mp_subscription.ok) return "MP_SUBSCRIPTION_TOKEN ausente — Assinaturas vão falhar";
      if (!mp_subscription_token.ok) return `Token de Subscription inválido/recusado pelo MP: ${mp_subscription_token.detalhe}`;
      if (!mp_preapproval_list.ok) return `MP rejeita Preapproval (conta sem permissão): ${mp_preapproval_list.detalhe}`;
      if (!tab_assinaturas.ok) return "Tabela assinaturas inacessível";
      if (totais.falha === 0) return "Todos os checks passaram — stack MP saudável";
      return `${totais.falha} checks falharam — ver detalhes acima`;
    })(),
  };

  return json(diagnostico, totais.falha === 0 ? 200 : 503);
});
