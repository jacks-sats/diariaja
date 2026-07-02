#!/usr/bin/env node
// ============================================================================
// Migração ONE-TIME: fotos gravadas como data-URI em user_profiles.foto_url
// → arquivo no bucket `avatars` + URL pública na coluna.
// ============================================================================
// Contexto (auditoria 02/07/2026): o antigo fallback de upload gravava a foto
// inteira em base64 na coluna foto_url quando o Storage falhava. 6 perfis
// assim faziam a RPC prestadores_publicos pesar 16,25 MB por carga.
//
// O que o script faz, por perfil com foto_url LIKE 'data:%':
//   1. decodifica o data-URI;
//   2. sobe pro bucket avatars como <user_id>.jpg (mesmo path que o app usa);
//   3. atualiza foto_url pra URL pública do Storage;
//   4. se o upload falhar, ANULA foto_url (decisão do dono: "anular as que
//      não der" — o usuário re-envia pelo app, que não tem mais o fallback).
//
// Uso (PowerShell):
//   $env:SUPABASE_URL = "https://rpszebrrrasoijfdvner.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role — NUNCA commitar>"
//   node scripts/migrar-fotos-base64.mjs --dry-run   # só lista o que faria
//   node scripts/migrar-fotos-base64.mjs             # executa de verdade
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!url || !serviceKey) {
  console.error("❌ Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: perfis, error: errSel } = await supabase
  .from("user_profiles")
  .select("id, nome, foto_url")
  .like("foto_url", "data:%");

if (errSel) {
  console.error("❌ Falha ao listar perfis:", errSel.message);
  process.exit(1);
}
if (!perfis || perfis.length === 0) {
  console.log("✅ Nenhum perfil com foto base64 — nada a fazer.");
  process.exit(0);
}

console.log(`Encontrados ${perfis.length} perfis com foto base64:`);
let migradas = 0, anuladas = 0, falhas = 0;

for (const p of perfis) {
  const kb = Math.round((p.foto_url?.length ?? 0) / 1024);
  const rotulo = `${p.nome ?? "(sem nome)"} <${p.id}> (${kb} KB)`;

  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(p.foto_url ?? "");
  if (!m) {
    // data-URI de tipo inesperado (SVG etc.) — não é foto válida do app: anula.
    console.log(`  • ${rotulo} — data-URI não reconhecido → ${dryRun ? "ANULARIA" : "anulando"}`);
    if (!dryRun) {
      const { error } = await supabase.from("user_profiles").update({ foto_url: null }).eq("id", p.id);
      if (error) { console.error(`    ❌ falha ao anular: ${error.message}`); falhas++; continue; }
      anuladas++;
    }
    continue;
  }

  const [, mime, b64] = m;
  if (dryRun) {
    console.log(`  • ${rotulo} — ${mime} → MIGRARIA pro Storage como ${p.id}.jpg`);
    continue;
  }

  const bytes = Buffer.from(b64, "base64");
  const path = `${p.id}.jpg`; // mesmo path/convenção do upload do app
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { upsert: true, contentType: mime });

  if (upErr) {
    console.error(`  • ${rotulo} — upload falhou (${upErr.message}) → anulando foto_url`);
    const { error } = await supabase.from("user_profiles").update({ foto_url: null }).eq("id", p.id);
    if (error) { console.error(`    ❌ falha ao anular: ${error.message}`); falhas++; continue; }
    anuladas++;
    continue;
  }

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error: updErr } = await supabase
    .from("user_profiles")
    .update({ foto_url: pub.publicUrl })
    .eq("id", p.id);

  if (updErr) {
    console.error(`  • ${rotulo} — arquivo subiu mas UPDATE falhou: ${updErr.message}`);
    falhas++;
    continue;
  }
  console.log(`  • ${rotulo} — ✅ migrada → ${pub.publicUrl}`);
  migradas++;
}

console.log(dryRun
  ? `\n(dry-run) ${perfis.length} perfis seriam processados.`
  : `\nResumo: ${migradas} migradas, ${anuladas} anuladas, ${falhas} falhas.`);
process.exit(falhas > 0 ? 1 : 0);
