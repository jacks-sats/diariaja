// Edge Function: send-push
// Envia Web Push Notification para um ou mais usuários.
//
// Deploy: supabase functions deploy send-push
// Secrets necessários:
//   supabase secrets set VAPID_PUBLIC_KEY=<chave-pública>
//   supabase secrets set VAPID_PRIVATE_KEY=<chave-privada>
//   supabase secrets set VAPID_SUBJECT=mailto:suporte@diariaja.com.br
//
// Body da requisição:
//   { user_ids: string[], title: string, body: string, url?: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { user_ids, title, body: msgBody, url = "/" } = await req.json() as {
      user_ids: string[];
      title: string;
      body: string;
      url?: string;
    };

    if (!user_ids?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:suporte@diariaja.com.br";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", user_ids);

    if (!subs?.length) return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const payload = JSON.stringify({ title, body: msgBody, url, icon: "/icon-192.png", badge: "/icon-192.png" });
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
