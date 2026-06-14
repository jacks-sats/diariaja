// ── usePushNotifications ─────────────────────────────────────────────────────
// Hook DUAL-CANAL para gerenciar push notifications:
//   - App nativo (Capacitor / Android) → FCM via @capacitor/push-notifications
//   - Navegador / PWA                  → Web Push (VAPID, RFC 8291)
// A API exposta (estado / solicitarPermissao / cancelarInscricao) é idêntica
// nos dois modos, então os callers no App.tsx não mudam.
//
// Pré-requisitos (Web Push):
//   1. Executar supabase/migrations/push_subscriptions.sql
//   2. Configurar VITE_VAPID_PUBLIC_KEY no .env.local
//   3. Configurar VAPID_PRIVATE_KEY como secret no Supabase Dashboard
//   4. supabase functions deploy send-push
// Pré-requisitos (FCM nativo):
//   1. Executar supabase/migrations/fcm_tokens.sql
//   2. android/app/google-services.json (projeto Firebase, package com.diariaja.app)
//   3. npx cap sync android  (registra o plugin no projeto Android)
//   4. Setar FCM_SERVICE_ACCOUNT como secret no Supabase (ativa o envio)

import { useState, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabaseClient";

// Chave pública VAPID gerada em generate-icons.mjs ou separadamente
// Definida em .env.local como VITE_VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

// true quando rodando dentro do app Capacitor (Android) — usa FCM em vez de VAPID.
const NATIVO = Capacitor.isNativePlatform();

// ⚠️ TOGGLE de segurança do push NATIVO (FCM).
// Histórico (2026-06-14): o crash no LOGIN que parecia ser do FCM era, na verdade,
// a ofuscação R8 (minifyEnabled) derrubando classes carregadas via reflection
// pelos plugins Capacitor — confirmado: com minify OFF (v12) o app abre e loga
// normal. Logo, o FCM nativo NÃO era a causa e está reativado aqui (`true`).
// Mantido como toggle por precaução: se algum dia o registro nativo der problema,
// basta `false` para voltar ao Web Push (navegador) sem tocar no resto do código.
const FCM_NATIVO_ATIVO = true;

// Canal de notificação Android (obrigatório no Android 8+). O id tem que bater
// com o channel_id enviado pelo send-push (android.notification.channel_id).
const CANAL_GERAL = {
  id: "diariaja_geral",
  name: "Geral",
  description: "Convites, mensagens, avaliações e avisos do DiáriaJá",
  importance: 5 as const, // IMPORTANCE_HIGH — notificação com heads-up
  visibility: 1 as const, // VISIBILITY_PUBLIC
  vibration: true,
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Mapeia o PermissionState do plugin nativo pro NotificationPermission do web.
function mapPermNativa(p: string): NotificationPermission {
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default"; // "prompt" | "prompt-with-rationale"
}

export interface PushState {
  suportado: boolean;
  permissao: NotificationPermission | "default";
  inscrito: boolean;
  solicitando: boolean;
  erro?: "vapid_ausente";  // setado quando a chave VAPID não está configurada
}

export function usePushNotifications(userId: string | undefined) {
  const [estado, setEstado] = useState<PushState>({
    suportado: false,
    permissao: "default",
    inscrito: false,
    solicitando: false,
  });

  // ── Salva/atualiza o token FCM no Supabase, ligado ao user_id ───────────────
  const salvarTokenFcm = useCallback(async (uid: string, token: string) => {
    const { error } = await supabase.from("fcm_tokens").upsert({
      user_id: uid,
      token,
      platform: Capacitor.getPlatform(),
      user_agent: navigator.userAgent.slice(0, 200),
      updated_at: new Date().toISOString(),
    }, { onConflict: "token" });
    if (error) {
      console.error("[Push nativo] erro ao salvar token FCM:", error.message);
      return;
    }
    setEstado(e => ({ ...e, inscrito: true }));
  }, []);

  // ── Modo NATIVO (Capacitor / FCM) ───────────────────────────────────────────
  // Cria o canal Android, lê a permissão, registra os listeners e — se já houver
  // permissão — registra em silêncio pra refrescar o token a cada abertura.
  useEffect(() => {
    if (!NATIVO || !userId || !FCM_NATIVO_ATIVO) return;
    let cancelado = false;
    const handles: { remove: () => void }[] = [];

    (async () => {
      try {
        if (Capacitor.getPlatform() === "android") {
          await PushNotifications.createChannel(CANAL_GERAL).catch(() => { /* canal já existe */ });
        }

        const perm = await PushNotifications.checkPermissions();
        if (cancelado) return;
        setEstado(e => ({ ...e, suportado: true, permissao: mapPermNativa(perm.receive) }));

        // Token capturado (no register e nos refreshes) → salva no banco.
        handles.push(await PushNotifications.addListener("registration", (t) => {
          salvarTokenFcm(userId, t.value);
        }));
        handles.push(await PushNotifications.addListener("registrationError", (err) => {
          console.error("[Push nativo] registrationError:", JSON.stringify(err));
        }));

        // Já autorizado: registra agora pra garantir token atualizado no Supabase.
        if (perm.receive === "granted") await PushNotifications.register();
      } catch (err) {
        console.error("[Push nativo] init falhou:", err);
      }
    })();

    return () => {
      cancelado = true;
      handles.forEach(h => { try { h.remove(); } catch { /* ignore */ } });
    };
  }, [userId, salvarTokenFcm]);

  // ── Modo WEB (Web Push / VAPID) ─────────────────────────────────────────────
  useEffect(() => {
    if (NATIVO) return; // no app nativo, o efeito acima cuida do push
    const suportado =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setEstado(e => ({
      ...e,
      suportado,
      permissao: suportado ? Notification.permission : "default",
    }));

    if (suportado && userId) {
      verificarInscricaoExistente(userId);
    }
  }, [userId]);

  const verificarInscricaoExistente = async (uid: string) => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // FIX 2026-05-28: .single() retorna 406/PGRST116 sempre que não acha.
        // .maybeSingle() devolve data=null sem erro — é o que queremos aqui.
        const { data } = await supabase
          .from("push_subscriptions")
          .select("id")
          .eq("user_id", uid)
          .eq("endpoint", sub.endpoint)
          .maybeSingle();
        setEstado(e => ({ ...e, inscrito: !!data }));
      }
    } catch {
      // Service worker pode não estar ativo ainda
    }
  };

  const solicitarPermissao = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;

    // ── NATIVO: permissão pela API do plugin + register (token → fcm_tokens) ──
    if (NATIVO) {
      // Kill switch: FCM nativo desligado (estava crashando) — no-op seguro.
      if (!FCM_NATIVO_ATIVO) return false;
      setEstado(e => ({ ...e, solicitando: true }));
      try {
        const r = await PushNotifications.requestPermissions();
        setEstado(e => ({ ...e, permissao: mapPermNativa(r.receive) }));
        if (r.receive !== "granted") {
          setEstado(e => ({ ...e, solicitando: false }));
          return false;
        }
        // Dispara o listener "registration" acima, que salva o token no banco.
        await PushNotifications.register();
        setEstado(e => ({ ...e, solicitando: false }));
        return true;
      } catch (err) {
        console.error("[Push nativo] solicitarPermissao:", err);
        setEstado(e => ({ ...e, solicitando: false }));
        return false;
      }
    }

    // ── WEB: Web Push / VAPID (inalterado) ──
    if (!estado.suportado) return false;
    if (!VAPID_PUBLIC_KEY) {
      console.warn("[Push] VITE_VAPID_PUBLIC_KEY não configurada");
      // Expõe o erro no estado pra UI avisar (sem depender do console).
      setEstado(e => ({ ...e, erro: "vapid_ausente" }));
      return false;
    }

    setEstado(e => ({ ...e, solicitando: true }));

    try {
      const permissao = await Notification.requestPermission();
      setEstado(e => ({ ...e, permissao }));

      if (permissao !== "granted") {
        setEstado(e => ({ ...e, solicitando: false }));
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
      });

      const subJson = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert({
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: (subJson.keys as { p256dh: string; auth: string })?.p256dh ?? "",
        auth_key: (subJson.keys as { p256dh: string; auth: string })?.auth ?? "",
        user_agent: navigator.userAgent.slice(0, 200),
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });

      if (error) {
        console.error("[Push] Erro ao salvar assinatura:", error.message);
        setEstado(e => ({ ...e, solicitando: false }));
        return false;
      }

      setEstado(e => ({ ...e, inscrito: true, solicitando: false }));
      return true;
    } catch (err) {
      console.error("[Push] Erro ao se inscrever:", err);
      setEstado(e => ({ ...e, solicitando: false }));
      return false;
    }
  }, [estado.suportado, userId]);

  const cancelarInscricao = useCallback(async () => {
    if (!userId) return;

    // ── NATIVO: desregistra do FCM + apaga os tokens deste usuário ──
    if (NATIVO) {
      try {
        await PushNotifications.unregister().catch(() => { /* ignore */ });
        await supabase.from("fcm_tokens").delete().eq("user_id", userId);
        setEstado(e => ({ ...e, inscrito: false }));
      } catch (err) {
        console.error("[Push nativo] Erro ao cancelar:", err);
      }
      return;
    }

    // ── WEB (inalterado) ──
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", sub.endpoint);
      }
      setEstado(e => ({ ...e, inscrito: false }));
    } catch (err) {
      console.error("[Push] Erro ao cancelar assinatura:", err);
    }
  }, [userId]);

  return { estado, solicitarPermissao, cancelarInscricao };
}
