// ── /vaga/[id] — página server-side da vaga (Open Graph) ───────────────────
// O robô de prévia (WhatsApp/Facebook/Telegram/LinkedIn) baixa HTML e NÃO roda
// JavaScript — a SPA pura gerava prévia vazia. Esta função devolve o MESMO
// HTML pra robô e pra humano (sem user-agent sniffing e sem redirect
// automático — desviar humano de robô é cloaking e o Google pune): as meta
// tags og:*/twitter:* pro robô, e o conteúdo real da vaga + botão "Quero me
// candidatar" (→ SPA em /?vaga=ID, deep link que já existia) pro humano.
// Mapeada por rewrite no vercel.json: /vaga/:id → /api/vaga/:id.

import {
  buscarVagaPublica, dataBR, localVaga, tituloVaga, valorVaga,
} from "../_lib/vagaPublica";

export const config = { runtime: "edge" };

const APP = "https://www.diariaja.com";

// Escapa texto do anunciante antes de entrar no HTML (funcao/descricao são
// texto livre — sem isso seria injeção de HTML na página pública).
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const HEADERS_HTML = {
  "Content-Type": "text/html; charset=utf-8",
  // CDN absorve rajadas do crawler; 5 min de cache + 10 min stale.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop() || "";
  // Repassa o ?ref= do link compartilhado pro deep link da SPA (rastreio de
  // canal). Whitelist estrita — nada de ecoar querystring arbitrária.
  const refRaw = url.searchParams.get("ref") || "";
  const ref = /^[a-z_]{1,20}$/.test(refRaw) ? refRaw : "";

  const v = await buscarVagaPublica(id);
  if (!v) {
    return new Response(paginaIndisponivel(), { status: 404, headers: HEADERS_HTML });
  }

  const titulo = tituloVaga(v);
  const valor = valorVaga(v);
  const local = localVaga(v);
  const data = dataBR(v.data);
  const desc = [`💰 ${valor}`, `📍 ${local}`, data ? `📅 ${data}` : ""]
    .filter(Boolean).join("  ·  ");
  const ogImg = `${APP}/api/og/${encodeURIComponent(v.id)}`;
  const ogUrl = `${APP}/vaga/${encodeURIComponent(v.id)}`;
  const abrirApp = `${APP}/?vaga=${encodeURIComponent(v.id)}${ref ? `&ref=${ref}` : ""}`;
  const descricao = (v.descricao || "").trim();

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · DiáriaJá</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(titulo)} — DiáriaJá">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ogImg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${ogUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="DiáriaJá">
<meta property="og:locale" content="pt_BR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)} — DiáriaJá">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ogImg}">
<link rel="canonical" href="${ogUrl}">
</head>
<body style="margin:0;background:#0f2a4a;color:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<main style="max-width:560px;margin:0 auto;padding:36px 22px 48px">
  <div style="font-weight:800;font-size:19px;letter-spacing:-.01em">🌞 DiáriaJá</div>
  <h1 style="font-size:30px;line-height:1.12;margin:22px 0 10px;letter-spacing:-.02em">${esc(titulo)}</h1>
  <p style="display:inline-block;background:#FF6B35;font-weight:800;font-size:17px;padding:7px 16px;border-radius:10px;margin:0 0 14px">💰 ${esc(valor)}</p>
  <p style="font-size:15px;color:#c8d6e5;margin:0 0 4px">📍 ${esc(local)}</p>
  ${data ? `<p style="font-size:15px;color:#c8d6e5;margin:0 0 4px">📅 ${esc(data)}${v.horario_inicio ? ` às ${esc(String(v.horario_inicio).slice(0, 5))}` : ""}</p>` : ""}
  ${descricao ? `<p style="font-size:15px;color:#e3ebf4;line-height:1.55;margin:16px 0 0">📋 ${esc(descricao)}</p>` : ""}
  <a href="${abrirApp}" style="display:block;text-align:center;margin-top:26px;background:#FF6B35;color:#fff;font-weight:800;font-size:17px;padding:16px 24px;border-radius:14px;text-decoration:none">Quero me candidatar →</a>
  <p style="font-size:13px;color:#8fa3b8;text-align:center;margin-top:14px">Grátis pra se candidatar · O valor é combinado direto com o anunciante</p>
  <p style="font-size:13px;color:#8fa3b8;text-align:center;margin-top:26px">diariaja.com · Precisou? Achou.</p>
</main>
</body>
</html>`;

  return new Response(html, { status: 200, headers: HEADERS_HTML });
}

// 404 amigável — vaga inexistente, oculta, preenchida ou expirada.
function paginaIndisponivel(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anúncio indisponível · DiáriaJá</title>
<meta name="robots" content="noindex">
</head>
<body style="margin:0;background:#0f2a4a;color:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<main style="max-width:560px;margin:0 auto;padding:64px 22px;text-align:center">
  <div style="font-weight:800;font-size:19px">🌞 DiáriaJá</div>
  <div style="font-size:52px;margin:28px 0 8px">😕</div>
  <h1 style="font-size:24px;margin:0 0 10px">Este anúncio não está mais disponível</h1>
  <p style="font-size:15px;color:#c8d6e5;line-height:1.5;margin:0 0 26px">A vaga pode ter sido preenchida ou encerrada. Tem várias outras oportunidades te esperando no app.</p>
  <a href="${APP}" style="display:inline-block;background:#FF6B35;color:#fff;font-weight:800;font-size:16px;padding:14px 26px;border-radius:14px;text-decoration:none">Ver vagas abertas →</a>
</main>
</body>
</html>`;
}
