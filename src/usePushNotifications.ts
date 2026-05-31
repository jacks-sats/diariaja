// ── usePushNotifications ─────────────────────────────────────────────────────
// Hook para gerenciar assinaturas de Web Push Notifications.
//
// Pré-requisitos:
//   1. Executar supabase/migrations/push_subscriptions.sql
//   2. Configurar VITE_VAPID_PUBLIC_KEY no .env.local
//   3. Configurar VAPID_PRIVATE_KEY como secret no Supabase Dashboard
//   4. Fazer deploy da Edge Function send-push:
//      supabase functions deploy send-push

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

// Chave pública VAPID gerada em generate-icons.mjs ou separadamente
// Definida em .env.local como VITE_VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
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

  useEffect(() => {
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
    if (!estado.suportado || !userId) return false;
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
