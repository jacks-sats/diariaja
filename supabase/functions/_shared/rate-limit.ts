// ── Helper compartilhado: rate-limit via RPC `check_rate_limit` ─────────────
// Cada Edge Function importa daqui pra aplicar limite por IP e/ou user.
//
// Uso:
//   import { rateLimitOrReject } from "../_shared/rate-limit.ts";
//   const limited = await rateLimitOrReject({
//     key: `lookup-by-cpf:ip:${ip}`,
//     max: 5,
//     windowSeconds: 60,
//   }, supabase);
//   if (limited) return limited; // Response 429 já formatada
//
// Falha aberta: se a RPC retornar erro (ex: tabela não existe ainda), o
// helper PERMITE a requisição. Decisão deliberada: não derrubar produção
// se a migration de rate_limits não tiver sido aplicada.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getClientIp(req: Request): string {
  // Vercel/Supabase passam o IP real em x-forwarded-for. Pega o primeiro
  // (cadeia: cliente, proxy1, proxy2, ...).
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0].trim();
  if (first) return first;
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitOptions {
  /** Chave única do limite (ex: "ai-support:user:<uuid>") */
  key: string;
  /** Máximo de requisições permitidas dentro da janela */
  max: number;
  /** Tamanho da janela em segundos */
  windowSeconds: number;
  /** CORS headers da função chamadora — pra incluir na resposta 429 */
  corsHeaders?: Record<string, string>;
}

/**
 * Verifica o rate limit; se passou, retorna uma Response 429 pronta.
 * Caso contrário retorna null (chamador segue normal).
 */
export async function rateLimitOrReject(
  opts: RateLimitOptions,
  supabase: SupabaseClient,
): Promise<Response | null> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key:            opts.key,
      p_max:            opts.max,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) {
      // Fail-open: deixa passar mas loga (pseudonimizado).
      console.warn("[rate-limit] RPC error, allowing:", error.message);
      return null;
    }
    if (data === false) {
      const headers: Record<string, string> = {
        "Content-Type":  "application/json",
        "Retry-After":   String(opts.windowSeconds),
        ...(opts.corsHeaders ?? {}),
      };
      return new Response(
        JSON.stringify({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }),
        { status: 429, headers },
      );
    }
    return null;
  } catch (e) {
    console.warn("[rate-limit] thrown, allowing:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
