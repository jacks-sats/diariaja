// Edge Function: verificar-whatsapp
// Verificação de número via WhatsApp usando o Twilio Verify.
// Duas ações (campo `acao` no body):
//   • "enviar"   → dispara o código de 6 dígitos no WhatsApp do número informado
//   • "conferir" → valida o código; se OK, marca telefone_verificado=true no perfil
//
// Por que Twilio Verify (e não a Cloud API da Meta): o Verify já tem um
// remetente oficial de OTP — não precisa de número WhatsApp Business próprio
// nem aprovar template na Meta. Plug-and-play. Crédito grátis na conta nova
// cobre as primeiras ~250 verificações.
//
// O CÓDIGO é validado NO SERVIDOR (confiável) e a escrita de telefone_verificado
// usa service_role (que bypassa o trigger anti-escalada). O cliente nunca
// consegue marcar o telefone como verificado por conta própria.
//
// Deploy: supabase functions deploy verificar-whatsapp
// Secrets necessários (supabase secrets set ...):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
//   (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY são auto-injetados)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID            = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN          = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_VERIFY_SERVICE = Deno.env.get("TWILIO_VERIFY_SERVICE_SID") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

// Normaliza telefone BR pra E.164 (ex: "67 99988-7766" → "+5567999887766")
function formatarE164(tel: string): string | null {
  const d = (tel || "").replace(/\D/g, "");
  if (d.length === 11) return `+55${d}`;
  if (d.length === 13 && d.startsWith("55")) return `+${d}`;
  return null;
}

interface RateLimitOptions { key: string; max: number; windowSeconds: number; }
async function rateLimitOrReject(opts: RateLimitOptions, supabase: SupabaseClient): Promise<Response | null> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: opts.key, p_max: opts.max, p_window_seconds: opts.windowSeconds,
    });
    if (error) { console.warn("[rate-limit] RPC error, allowing:", error.message); return null; }
    if (data === false) {
      return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429);
    }
    return null;
  } catch (e) {
    console.warn("[rate-limit] thrown, allowing:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const traceId = crypto.randomUUID().slice(0, 8);

  try {
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SERVICE) {
      return json({ error: "Verificação por WhatsApp ainda não está configurada.", trace_id: traceId }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado.", trace_id: traceId }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: "Token inválido ou expirado.", trace_id: traceId }, 401);

    const { acao, telefone, codigo } = await req.json() as { acao?: string; telefone?: string; codigo?: string };
    const e164 = formatarE164(telefone ?? "");
    if (!e164) return json({ error: "Telefone inválido. Use o formato (XX) 9XXXX-XXXX.", trace_id: traceId }, 400);

    const twilioAuth = "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
    const base = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE}`;

    // ── ENVIAR código ──────────────────────────────────────────────────────
    if (acao === "enviar") {
      const blocked = await rateLimitOrReject(
        { key: `verif-wpp:enviar:${user.id}`, max: 4, windowSeconds: 600 }, supabaseUser,
      );
      if (blocked) return blocked;

      const body = new URLSearchParams({ To: e164, Channel: "whatsapp" });
      const resp = await fetch(`${base}/Verifications`, {
        method: "POST",
        headers: { "Authorization": twilioAuth, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error(`[verificar-whatsapp][${traceId}] enviar falhou:`, resp.status, JSON.stringify(data));
        const msg = data?.message?.toLowerCase?.() ?? "";
        // 60200 = número inválido; 60203 = excedeu envios
        if (resp.status === 429 || data?.code === 60203)
          return json({ error: "Muitas tentativas para este número. Aguarde e tente de novo.", trace_id: traceId }, 429);
        if (msg.includes("invalid"))
          return json({ error: "Número inválido. Confira o WhatsApp e tente novamente.", trace_id: traceId }, 400);
        return json({ error: "Não consegui enviar o código agora. Tente novamente em instantes.", trace_id: traceId }, 502);
      }
      return json({ ok: true, status: data?.status ?? "pending", trace_id: traceId });
    }

    // ── CONFERIR código ────────────────────────────────────────────────────
    if (acao === "conferir") {
      if (!codigo || !/^\d{4,8}$/.test(codigo))
        return json({ error: "Código inválido.", trace_id: traceId }, 400);

      const blocked = await rateLimitOrReject(
        { key: `verif-wpp:conferir:${user.id}`, max: 8, windowSeconds: 600 }, supabaseUser,
      );
      if (blocked) return blocked;

      const body = new URLSearchParams({ To: e164, Code: codigo });
      const resp = await fetch(`${base}/VerificationCheck`, {
        method: "POST",
        headers: { "Authorization": twilioAuth, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await resp.json();

      if (!resp.ok || data?.status !== "approved") {
        return json({ ok: false, error: "Código incorreto ou expirado. Peça um novo e tente de novo.", trace_id: traceId }, 400);
      }

      // Código OK → grava no perfil com service_role (bypassa o trigger).
      const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const telDigitos = e164.replace(/^\+55/, "");
      const { error: upErr } = await supabaseAdmin
        .from("user_profiles")
        .update({ telefone: telDigitos, telefone_verificado: true })
        .eq("id", user.id);
      if (upErr) {
        console.error(`[verificar-whatsapp][${traceId}] grant falhou:`, upErr.message);
        return json({ ok: false, error: "Código confirmado, mas falhou ao salvar no perfil. Tente de novo.", trace_id: traceId }, 500);
      }
      return json({ ok: true, verificado: true, trace_id: traceId });
    }

    return json({ error: "Ação desconhecida.", trace_id: traceId }, 400);
  } catch (err) {
    console.error(`[verificar-whatsapp][${traceId}] exception:`, err instanceof Error ? err.message : String(err));
    return json({ error: "Erro interno.", trace_id: traceId }, 500);
  }
});
