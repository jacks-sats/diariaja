// ── /api/og/[id] — imagem 1200×630 da prévia (Open Graph) ──────────────────
// Gera o "card" que o WhatsApp/Facebook mostram ao compartilhar /vaga/ID.
// @vercel/og (Satori) renderiza na edge e a CDN cacheia. Satori NÃO usa fontes
// do sistema — a Inter (mesma do app, via @fontsource) vai embarcada em
// api/_fonts/. Elementos como objetos {type, props} (sem JSX) pra dispensar
// React no bundle da função.

import { ImageResponse } from "@vercel/og";
import {
  buscarVagaPublica, dataBR, localVaga, tituloVaga, valorVaga,
} from "../_lib/vagaPublica";

export const config = { runtime: "edge" };

const fonteRegular = fetch(
  new URL("../_fonts/inter-latin-400-normal.woff", import.meta.url),
).then((r) => r.arrayBuffer());
const fonteBold = fetch(
  new URL("../_fonts/inter-latin-800-normal.woff", import.meta.url),
).then((r) => r.arrayBuffer());

// Helper mínimo pra montar a árvore que o Satori consome.
const el = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
) => ({ type, props: { style, ...(children !== undefined ? { children } : {}) } });

export default async function handler(req: Request) {
  const id = new URL(req.url).pathname.split("/").pop() || "";
  const v = await buscarVagaPublica(id);

  const titulo = v ? tituloVaga(v) : "Vagas e serviços perto de você";
  const valor = v ? valorVaga(v) : "Vagas abertas";
  const local = v ? localVaga(v) : "Campo Grande/MS";
  const data = v ? dataBR(v.data) : "";
  // Título longo estoura o card — corta com reticências (Satori não elipsa).
  const tituloCurto = titulo.length > 44 ? `${titulo.slice(0, 43).trimEnd()}…` : titulo;

  const [regular, bold] = await Promise.all([fonteRegular, fonteBold]);

  return new ImageResponse(
    el(
      "div",
      {
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: "60px 72px",
        background: "linear-gradient(135deg, #0f2a4a 0%, #163a63 100%)",
        color: "#ffffff", fontFamily: "Inter",
      },
      [
        el("div", { display: "flex", fontSize: 40, fontWeight: 800 }, "🌞 DiáriaJá"),
        el("div", { display: "flex", flexDirection: "column", gap: 18 }, [
          el("div", {
            display: "flex", alignSelf: "flex-start", background: "#FF6B35",
            padding: "10px 26px", borderRadius: 16, fontSize: 42, fontWeight: 800,
          }, valor),
          el("div", {
            display: "flex", fontSize: 74, fontWeight: 800, lineHeight: 1.06,
            letterSpacing: "-0.02em",
          }, tituloCurto),
          el("div", { display: "flex", gap: 34, fontSize: 32, color: "#c8d6e5" },
            [`📍 ${local}`, data ? `📅 ${data}` : ""].filter(Boolean).map((t) =>
              el("div", { display: "flex" }, t))),
        ]),
        el("div", {
          display: "flex", justifyContent: "space-between", fontSize: 28,
          color: "#8fa3b8",
        }, [
          el("div", { display: "flex" }, "diariaja.com"),
          el("div", { display: "flex" }, "Precisou? Achou."),
        ]),
      ],
    ) as unknown as Parameters<typeof ImageResponse>[0],
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: bold, weight: 800, style: "normal" },
      ],
      headers: {
        // Imagem por vaga muda pouco — cache mais longo que o HTML.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
