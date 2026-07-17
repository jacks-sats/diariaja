// Edge Function: admin-regeocode
// Reposiciona prestadores pela coordenada do CEP — corrige a galera empilhada
// no centroide da cidade (cadastros antigos). SÓ ADMIN.
//
// Mesma lógica do app (geocodificarCEP): BrasilAPI v2 → Nominatim (CEP) →
// centroide de cidade. geo_preciso segue a MESMA convenção do front:
//   - CEP resolve pro bairro/logradouro (BrasilAPI/Nominatim) → geo_preciso=true
//     (o feed usa grade de ~1,1 km — bairro cabe; libera a distância exata).
//   - só resolveu o centroide da cidade → geo_preciso=false (honesto).
//   - não resolveu nada → não mexe no perfil.
//
// Body: { dry_run?: boolean (default true), limit?: number (default 20, máx 50) }
// Retorno dry-run: { dry_run:true, candidatos, itens:[{id,nome,cep,de,para,preciso}] }
// Retorno apply:   { dry_run:false, atualizados, precisos, imprecisos, itens:[...] }
//
// Nominatim exige ~1 req/s + User-Agent — respeitado com um delay entre perfis.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "DiariaJaApp/1.0 (suporte@diariaja.com.br)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeoResultado { lat: number; lng: number; preciso: boolean }

// Espelha src/App.tsx geocodificarCEP: BrasilAPI → Nominatim → centroide cidade.
async function geocodificarCep(cep: string, cidade: string, uf: string): Promise<GeoResultado | null> {
  const cepNorm = (cep || "").replace(/\D/g, "");
  if (cepNorm.length !== 8) return null;

  // 1. BrasilAPI v2 — coordenada do CEP (nível de logradouro/bairro em cidade).
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepNorm}`);
    if (r.ok) {
      const j = await r.json();
      const lat = parseFloat(j?.location?.coordinates?.latitude);
      const lng = parseFloat(j?.location?.coordinates?.longitude);
      if (!Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0)) {
        return { lat, lng, preciso: true };
      }
    }
  } catch { /* tenta o próximo */ }

  // 2. Nominatim por CEP (+cidade/UF) — centróide do bairro.
  try {
    const q = encodeURIComponent(`${cepNorm}${cidade ? ", " + cidade : ""}${uf ? ", " + uf : ""}, Brasil`);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`,
      { headers: { "Accept-Language": "pt-BR", "User-Agent": UA } });
    const d = await r.json();
    if (Array.isArray(d) && d[0]) {
      return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), preciso: true };
    }
  } catch { /* tenta o próximo */ }

  // 3. Último recurso: centroide da CIDADE — posição IMPRECISA (geo_preciso=false).
  if (cidade && uf) {
    try {
      const q = encodeURIComponent(`${cidade}, ${uf}, Brasil`);
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
        { headers: { "Accept-Language": "pt-BR", "User-Agent": UA } });
      const d = await r.json();
      if (Array.isArray(d) && d[0]) {
        return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), preciso: false };
      }
    } catch { /* sem resultado */ }
  }
  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado." }, 401);

    // 1) Quem chamou é admin? (JWT do usuário)
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await asUser.auth.getUser();
    if (authErr || !user) return json({ error: "Token inválido ou expirado." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: perfilAdmin } = await admin.from("user_profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!perfilAdmin?.is_admin) return json({ error: "Acesso negado: somente administradores." }, 403);

    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; limit?: number };
    const dryRun = body.dry_run !== false; // default: dry-run (seguro)
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50);

    // 2) Alvos: prestadores COM CEP e SEM geo preciso (inclui os empilhados no
    //    centroide após o UPDATE de correção da flag). Menos recentes primeiro
    //    pra ir limpando a base antiga.
    const { data: alvos, error: selErr } = await admin
      .from("user_profiles")
      .select("id, nome, cep, catalogo_cidade, lat, lng")
      .in("user_type", ["diarista", "ambos"])
      .not("cep", "is", null)
      .neq("cep", "")
      .not("geo_preciso", "is", true)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (selErr) return json({ error: `Falha ao ler perfis: ${selErr.message}` }, 500);

    const itens: { id: string; nome: string; cep: string; de: string; para: string; preciso: boolean }[] = [];
    let atualizados = 0, precisos = 0, imprecisos = 0, primeiro = true;

    for (const p of (alvos ?? [])) {
      if (!primeiro) await sleep(1100); // respeita ~1 req/s do Nominatim
      primeiro = false;

      const geo = await geocodificarCep(p.cep as string, (p.catalogo_cidade as string) || "Campo Grande", "MS");
      if (!geo) continue; // não conseguiu geocodificar → não mexe

      itens.push({
        id: p.id as string,
        nome: (p.nome as string) || "(sem nome)",
        cep: p.cep as string,
        de: p.lat != null && p.lng != null ? `${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}` : "—",
        para: `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`,
        preciso: geo.preciso,
      });
      if (geo.preciso) precisos++; else imprecisos++;

      if (!dryRun) {
        const { error: upErr } = await admin.from("user_profiles")
          .update({ lat: geo.lat, lng: geo.lng, geo_preciso: geo.preciso })
          .eq("id", p.id);
        if (!upErr) atualizados++;
      }
    }

    return dryRun
      ? json({ dry_run: true, candidatos: (alvos ?? []).length, itens, precisos, imprecisos, restam_mais: (alvos ?? []).length === limit })
      : json({ dry_run: false, atualizados, precisos, imprecisos, itens, restam_mais: (alvos ?? []).length === limit });
  } catch (err) {
    return json({ error: `Erro: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});
