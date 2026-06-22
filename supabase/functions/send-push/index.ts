// Edge Function: send-push
// Envia notificação push para um ou mais usuários por DOIS canais:
//   - Navegador / PWA  → Web Push (VAPID, RFC 8291) via push_subscriptions
//   - App Android       → FCM (Firebase Cloud Messaging HTTP v1) via fcm_tokens
// Os dois canais são independentes: um usuário pode ter subscription web,
// token FCM, ambos ou nenhum. O envio é feito para todos os destinos achados.
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
// Secrets necessários (Web Push — já em uso):
//   supabase secrets set VAPID_PUBLIC_KEY=<chave-pública>
//   supabase secrets set VAPID_PRIVATE_KEY=<chave-privada>
//   supabase secrets set VAPID_SUBJECT=mailto:suporte@diariaja.com.br
// Secret opcional (FCM nativo — DORMENTE enquanto não setado):
//   supabase secrets set FCM_SERVICE_ACCOUNT='<json da conta de serviço>'
//   Sem esse secret, o canal FCM é simplesmente ignorado e o Web Push
//   continua funcionando exatamente como antes (zero regressão).
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
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

  // 5. Convites trocados (caller é contratante ou diarista_id no convite)
  // FIX (auditoria P1-1): a tabela convites usa `contratante_id`, NÃO `empregador_id`
  // (essa coluna não existe — ver convites.sql:6 e delete-user/index.ts:96). O nome
  // errado fazia a query falhar em silêncio e o push de convite/resposta não chegar
  // quando o convite era a única relação entre as partes (o caso normal).
  const [convitesEmp, convitesDia] = await Promise.all([
    supabaseAdmin
      .from("convites")
      .select("diarista_id")
      .eq("contratante_id", callerId)
      .in("diarista_id", alvosArr),
    supabaseAdmin
      .from("convites")
      .select("contratante_id")
      .eq("diarista_id", callerId)
      .in("contratante_id", alvosArr),
  ]);
  convitesEmp.data?.forEach((c: any) => { if (c.diarista_id) autorizados.add(c.diarista_id); });
  convitesDia.data?.forEach((c: any) => { if (c.contratante_id) autorizados.add(c.contratante_id); });

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

// ── Canal FCM (HTTP v1) — só usado se FCM_SERVICE_ACCOUNT estiver setado ─────
// base64url de string / bytes (sem padding) para montar o JWT do OAuth2.
const b64urlStr = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const b64urlBytes = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

// Converte a private_key PEM (PKCS#8) da conta de serviço em chave RSA p/ assinar.
async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// Troca a conta de serviço por um access_token OAuth2 (scope firebase.messaging).
async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await importServiceAccountKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const json = await res.json();
  return json.access_token as string;
}

// Envia uma mensagem FCM HTTP v1 para um registration token.
async function sendFcm(
  token: string,
  projectId: string,
  accessToken: string,
  p: { title: string; body: string; url: string; tipo: string },
): Promise<Response> {
  return fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: p.title, body: p.body },
        data: { url: String(p.url), tipo: String(p.tipo) },
        android: {
          priority: "high",
          notification: { channel_id: "diariaja_geral" },
        },
      },
    }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ── Auth: JWT de usuário logado OU segredo interno (cron/infra) ────────
    // O modo interno só existe se INTERNAL_PUSH_SECRET estiver setado nas
    // secrets. Usado por funções de infra (ex.: lembrar-diarias via pg_cron)
    // que não têm JWT de usuário. Sem o secret setado, o bypass nunca liga.
    const internalSecret = Deno.env.get("INTERNAL_PUSH_SECRET") ?? "";
    const isInternal = internalSecret.length > 0
      && (req.headers.get("x-internal-secret") ?? "") === internalSecret;

    let supabaseUser: ReturnType<typeof createClient> | null = null;
    let callerId = "";
    if (!isInternal) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Não autorizado." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Token inválido ou expirado." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = user.id;

      // Rate-limit: 30 pushes / 60s por usuário. Suficiente pra qualquer
      // fluxo natural (notifica candidato selecionado, etc.); bloqueia spam.
      const blocked = await rateLimitOrReject(
        { key: `send-push:user:${callerId}`, max: 30, windowSeconds: 60, corsHeaders },
        supabaseUser,
      );
      if (blocked) return blocked;
    }

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

    // ── Destinatários: modo interno envia direto; usuário passa pelo filtro ─
    const user_ids = isInternal
      ? userIdsRaw
      : await filtrarDestinatariosAutorizados(supabaseAdmin, callerId, userIdsRaw);
    if (!user_ids.length) {
      // Não revela quais foram bloqueados — resposta idêntica à de "sem subscription"
      return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca os destinos dos DOIS canais em paralelo. Se a tabela fcm_tokens
    // ainda não existir (migration não aplicada), o select retorna erro e
    // fcmTokens fica null → canal FCM é ignorado, Web Push segue normal.
    const [{ data: subs }, { data: fcmTokens }] = await Promise.all([
      supabaseAdmin
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth_key")
        .in("user_id", user_ids),
      supabaseAdmin
        .from("fcm_tokens")
        .select("token")
        .in("user_id", user_ids),
    ]);

    if (!subs?.length && !fcmTokens?.length) {
      return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({ title, body: msgBody, url, tipo, icon: "/icon-192.png", badge: "/icon-192.png" });
    let webSent = 0;
    let fcmSent = 0;

    // ── Canal 1: Web Push (VAPID) — navegador / PWA (inalterado) ───────────
    if (subs?.length) {
      await Promise.all(subs.map(async (sub) => {
        try {
          const auth = await buildVapidAuth(sub.endpoint, vapidPublic, vapidPrivate, vapidSubject);
          const { body: encBody } = await encrypt(payload, sub);

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
            webSent++;
          } else if (res.status === 410 || res.status === 404) {
            // Assinatura expirada — remove do banco
            await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
        } catch {
          // Falha individual não cancela as outras
        }
      }));
    }

    // ── Canal 2: FCM nativo (app Android) — DORMENTE até o secret entrar ───
    // Sem FCM_SERVICE_ACCOUNT setado, ou sem tokens, este bloco é no-op.
    const fcmSaRaw = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
    if (fcmSaRaw && fcmTokens?.length) {
      try {
        const sa = JSON.parse(fcmSaRaw) as ServiceAccount;
        const accessToken = await getFcmAccessToken(sa);
        await Promise.all(fcmTokens.map(async (row: any) => {
          try {
            const res = await sendFcm(row.token, sa.project_id, accessToken, { title, body: msgBody, url, tipo });
            if (res.ok) {
              fcmSent++;
            } else if (res.status === 404) {
              // Token não registrado (UNREGISTERED) — remove do banco
              await supabaseAdmin.from("fcm_tokens").delete().eq("token", row.token);
            } else {
              // Não derruba o token em 400/401/500 — pode ser config/payload
              const txt = await res.text().catch(() => "");
              if (txt.includes("UNREGISTERED")) {
                await supabaseAdmin.from("fcm_tokens").delete().eq("token", row.token);
              }
            }
          } catch {
            // Falha individual não cancela as outras
          }
        }));
      } catch (e) {
        // Config FCM inválida (JSON/chave) não pode derrubar o Web Push já enviado
        console.error("[send-push] canal FCM ignorado:", e instanceof Error ? e.message : String(e));
      }
    }

    return new Response(
      JSON.stringify({
        sent: webSent + fcmSent,
        total: (subs?.length ?? 0) + (fcmTokens?.length ?? 0),
        web: webSent,
        fcm: fcmSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
