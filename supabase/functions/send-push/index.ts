// Edge Function: send-push
// Envia Web Push Notification para um ou mais usuários.
//
// SEGURANÇA (corrigido — antes era pública, vetor de phishing autenticado)
// - Exige Authorization: Bearer <jwt> de usuário logado.
// - O caller só pode enviar push pra users com quem tem relação registrada
//   no banco: diárias compartilhadas (empregador/diarista_aceite),
//   candidaturas em vagas do caller, ou convites trocados. Caller pode
//   enviar pra si mesmo (teste de subscription).
// - Destinatários sem relação são silenciosamente filtrados — endpoint
//   não revela se push foi enviado ou não pra cada user_id.
//
// Deploy: supabase functions deploy send-push
// Secrets necessários:
//   supabase secrets set VAPID_PUBLIC_KEY=<chave-pública>
//   supabase secrets set VAPID_PRIVATE_KEY=<chave-privada>
//   supabase secrets set VAPID_SUBJECT=mailto:suporte@diariaja.com.br
//
// Body da requisição:
//   { user_ids: string[], title: string, body: string, url?: string, tipo?: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject } from "../_shared/rate-limit.ts";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resolve a partir do banco quais destinatários o caller tem permissão pra
// notificar. Retorna o subset autorizado dos user_ids passados.
async function filtrarDestinatariosAutorizados(
  supabaseAdmin: ReturnType<typeof createClient>,
  callerId: string,
  userIds: string[],
): Promise<string[]> {
  // Admin libera qualquer destinatário — usado pra responder tickets de
  // suporte, avisos da plataforma, etc.
  const { data: callerProfile } = await supabaseAdmin
    .from("user_profiles")
    .select("is_admin")
    .eq("id", callerId)
    .single();
  if (callerProfile?.is_admin === true) return userIds;

  const alvos = new Set(userIds.filter(id => id && id !== callerId));
  if (alvos.size === 0) {
    // Caller só quer notificar a si mesmo — sempre permitido
    return userIds.includes(callerId) ? [callerId] : [];
  }

  const autorizados = new Set<string>();
  // Self-push sempre liberado
  if (userIds.includes(callerId)) autorizados.add(callerId);

  const alvosArr = Array.from(alvos);

  // 1. Diárias onde caller é empregador → libera diarista_aceite_id
  // 2. Diárias onde caller é diarista_aceite → libera empregador_id
  const [diariasComoEmp, diariasComoDia] = await Promise.all([
    supabaseAdmin
      .from("diarias")
      .select("diarista_aceite_id")
      .eq("empregador_id", callerId)
      .in("diarista_aceite_id", alvosArr),
    supabaseAdmin
      .from("diarias")
      .select("empregador_id")
      .eq("diarista_aceite_id", callerId)
      .in("empregador_id", alvosArr),
  ]);
  diariasComoEmp.data?.forEach((d: any) => { if (d.diarista_aceite_id) autorizados.add(d.diarista_aceite_id); });
  diariasComoDia.data?.forEach((d: any) => { if (d.empregador_id) autorizados.add(d.empregador_id); });

  // 3. Candidaturas em vagas do caller (empregador) — libera diarista
  // 4. Candidaturas feitas pelo caller (diarista) — libera empregador da vaga
  const [candAlvos, vagasCallerAlvos] = await Promise.all([
    // diaristas que se candidataram em vagas que o caller publicou
    supabaseAdmin
      .from("candidaturas")
      .select("diarista_id, diarias!inner(empregador_id)")
      .eq("diarias.empregador_id", callerId)
      .in("diarista_id", alvosArr),
    // empregadores cujas vagas o caller se candidatou
    supabaseAdmin
      .from("candidaturas")
      .select("diarias!inner(empregador_id)")
      .eq("diarista_id", callerId)
      .in("diarias.empregador_id", alvosArr),
  ]);
  candAlvos.data?.forEach((c: any) => { if (c.diarista_id) autorizados.add(c.diarista_id); });
  vagasCallerAlvos.data?.forEach((c: any) => { if (c.diarias?.empregador_id) autorizados.add(c.diarias.empregador_id); });

  // 5. Convites trocados (caller é empregador ou diarista_id no convite)
  const [convitesEmp, convitesDia] = await Promise.all([
    supabaseAdmin
      .from("convites")
      .select("diarista_id")
      .eq("empregador_id", callerId)
      .in("diarista_id", alvosArr),
    supabaseAdmin
      .from("convites")
      .select("empregador_id")
      .eq("diarista_id", callerId)
      .in("empregador_id", alvosArr),
  ]);
  convitesEmp.data?.forEach((c: any) => { if (c.diarista_id) autorizados.add(c.diarista_id); });
  convitesDia.data?.forEach((c: any) => { if (c.empregador_id) autorizados.add(c.empregador_id); });

  // Mantém só os que estavam na lista original
  return userIds.filter(id => autorizados.has(id));
}

// Converte base64url para Uint8Array
function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(b64.length + ((4 - b64.length % 4) % 4), "="));
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

// Importa chave ECDH P-256 a partir de raw bytes (chave pública)
async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

// Gera chave VAPID para assinar o JWT da notificação
async function buildVapidAuth(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKeyPkcs8: string,
  vapidSubject: string,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" })).replace(/=/g, "");
  const payload = btoa(JSON.stringify({ aud: audience, exp, sub: vapidSubject })).replace(/=/g, "");
  const sigInput = new TextEncoder().encode(`${header}.${payload}`);

  const privKey = await crypto.subtle.importKey(
    "pkcs8",
    b64urlToBytes(vapidPrivateKeyPkcs8),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privKey, sigInput);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `vapid t=${header}.${payload}.${sigB64},k=${vapidPublicKey}`;
}

// Cifra o payload usando RFC 8291 (AES-GCM + ECDH P-256)
async function encrypt(
  payload: string,
  sub: { p256dh: string; auth_key: string },
): Promise<{ body: Uint8Array; salt: Uint8Array }> {
  const clientPubKey = await importPublicKey(b64urlToBytes(sub.p256dh));
  const authSecret = b64urlToBytes(sub.auth_key);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"],
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPubKey }, serverKeyPair.privateKey, 256,
  );

  const prk = await crypto.subtle.importKey("raw", sharedBits, { name: "HKDF" }, false, ["deriveKey"]);
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));
  const clientPubRaw = b64urlToBytes(sub.p256dh);

  // IKM = PRK derivado de authSecret + sharedBits
  const keyInfoBuf = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...clientPubRaw, ...serverPubRaw]);
  const ikm = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfoBuf }, prk, 256);

  const contentKey = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("Content-Encoding: aes128gcm\0") },
    contentKey, { name: "AES-GCM", length: 128 }, false, ["encrypt"],
  );

  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("Content-Encoding: nonce\0") },
      contentKey, 96,
    ),
  );

  const data = new TextEncoder().encode(payload);
  const padded = new Uint8Array([...data, 2]); // padding delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  // Header: record_size (4 bytes BE) + idlen (1 byte) + server_pub_key (65 bytes)
  const header = new Uint8Array(5 + 1 + 65);
  new DataView(header.buffer).setUint32(0, ciphertext.length + 16 + 1, false);
  header[4] = 65;
  header.set(serverPubRaw, 5);

  const body = new Uint8Array([...salt, ...header, ...ciphertext]);
  return { body, salt };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ── Auth: exige JWT de usuário logado (não aceita anon) ────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Token inválido ou expirado." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate-limit: 30 pushes / 60s por usuário. Suficiente pra qualquer
    // fluxo natural (notifica candidato selecionado, etc.); bloqueia spam.
    const blocked = await rateLimitOrReject(
      { key: `send-push:user:${user.id}`, max: 30, windowSeconds: 60, corsHeaders },
      supabaseUser,
    );
    if (blocked) return blocked;

    const { user_ids: userIdsRaw, title, body: msgBody, url = "/", tipo = "default" } = await req.json() as {
      user_ids: string[];
      title: string;
      body: string;
      url?: string;
      tipo?: string;
    };

    if (!Array.isArray(userIdsRaw) || !userIdsRaw.length) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:suporte@diariaja.com.br";

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── Filtra destinatários: caller só pode notificar quem tem relação ──
    const user_ids = await filtrarDestinatariosAutorizados(supabaseAdmin, user.id, userIdsRaw);
    if (!user_ids.length) {
      // Não revela quais foram bloqueados — resposta idêntica à de "sem subscription"
      return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", user_ids);

    if (!subs?.length) return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const payload = JSON.stringify({ title, body: msgBody, url, tipo, icon: "/icon-192.png", badge: "/icon-192.png" });
    let sent = 0;

    await Promise.all(subs.map(async (sub) => {
      try {
        const auth = await buildVapidAuth(sub.endpoint, vapidPublic, vapidPrivate, vapidSubject);
        const { body: encBody, salt } = await encrypt(payload, sub);

        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            "Authorization": auth,
            "TTL": "86400",
            "Urgency": "normal",
            "Content-Length": encBody.length.toString(),
          },
          body: encBody,
        });

        if (res.ok || res.status === 201) {
          sent++;
        } else if (res.status === 410 || res.status === 404) {
          // Assinatura expirada — remove do banco
          await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      } catch {
        // Falha individual não cancela as outras
      }
    }));

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // FIX 2026-05-28: NUNCA vazar stack/mensagem pro client (vazava nomes
    // de tabela, IDs, etc.). Loga internamente, retorna genérico.
    console.error("[send-push] uncaught:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
