// Edge Function: ai-gerar
// IA "Jájá Redatora" — gera TEXTOS pra preencher campos do app (recurso pago):
//   - tipo "anuncio": descrição de "O que precisa ser feito" pro anunciante
//                     (recurso "IA Jájá pra criar anúncios" — Essencial+).
//   - tipo "bio":     apresentação/bio do prestador
//                     (recurso "IA pra montar bio" — Essencial+).
//
// Diferente da ai-support (chat), aqui o objetivo é REDIGIR um único texto curto.
//
// GATE DE PLANO NO SERVIDOR: a UI esconde o botão pra quem é grátis, mas a
// fonte da verdade é aqui — checamos plano_ativo do user antes de gastar Groq.
//
// Variáveis de ambiente (Supabase → Edge Functions → Secrets):
//   GROQ_API_KEY, SUPABASE_URL (auto), SUPABASE_ANON_KEY (auto)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitOrReject } from "../_shared/rate-limit.ts";

const GROQ_API_KEY      = Deno.env.get("GROQ_API_KEY")!;
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Sanitização de PII (mesmo critério da ai-support) ─────────────────────────
const RE_CPF    = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RE_CNPJ   = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RE_TEL    = /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g;
const RE_EMAIL  = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function redigirPII(texto: string): string {
  return texto
    .replace(RE_CPF, "[REDIGIDO]")
    .replace(RE_CNPJ, "[REDIGIDO]")
    .replace(RE_EMAIL, "[REDIGIDO]")
    .replace(RE_TEL, "[REDIGIDO]");
}

// Regras comuns a qualquer texto gerado — vocabulário de marketplace (não-CLT),
// sem dados de contato (anti-burla da taxa de conexão), pt-BR, conciso.
const REGRAS = `Regras invioláveis:
- Escreva SEMPRE em português do Brasil, tom profissional e acolhedor.
- Vocabulário de marketplace de serviços autônomos: use "diária", "serviço",
  "prestador", "anunciante". NUNCA use "emprego", "CLT", "salário", "vaga",
  "funcionário", "carteira assinada".
- NÃO inclua telefone, WhatsApp, e-mail, links, redes sociais nem endereço —
  isso é proibido na plataforma (o contato é liberado pelo próprio app).
- NÃO invente qualificações, certificados, anos de experiência ou preços que
  não foram informados. Sem dados, escreva de forma genérica e honesta.
- NÃO use emojis em excesso (no máximo 1, opcional). Sem hashtags.
- Responda APENAS com o texto final, sem aspas, sem títulos, sem "Aqui está:".`;

function promptAnuncio(funcao: string, local: string, dica: string): string {
  return `Você é redatora de anúncios de diárias do DiáriaJá. Escreva o campo
"O que precisa ser feito" de um anúncio de serviço, em 2 a 4 frases curtas,
claro e objetivo, descrevendo as tarefas esperadas.

Dados:
- Habilidade/função: ${funcao || "(não informada)"}
- Local/contexto: ${local || "(não informado)"}
- Observações do anunciante: ${dica || "(nenhuma)"}

${REGRAS}`;
}

function promptBio(funcao: string, categorias: string, dica: string): string {
  return `Você é redatora de perfis do DiáriaJá. Escreva uma apresentação (bio)
de um prestador autônomo, em 2 a 3 frases, na 1ª pessoa, que transmita
profissionalismo e confiança para anunciantes que vão escolher quem contratar.

Dados:
- Ocupação principal: ${funcao || "(não informada)"}
- Outras habilidades: ${categorias || "(nenhuma)"}
- Observações do prestador: ${dica || "(nenhuma)"}

${REGRAS}`;
}

// Mapeia plano_ativo (inclui nomes legados) → tier. Espelha a regra do front.
function tierDoPlano(p?: string): "gratis" | "essencial" | "plus" {
  if (p === "plus" || p === "destaque" || p === "pro") return "plus";
  if (p === "essencial") return "essencial";
  return "gratis";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Exige JWT de usuário autenticado.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado." }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Token inválido ou expirado." }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Rate-limit: geração de texto é mais cara/pesada que chat — 8/60s por user.
    const blocked = await rateLimitOrReject(
      { key: `ai-gerar:user:${user.id}`, max: 8, windowSeconds: 60, corsHeaders: CORS },
      supabaseUser,
    );
    if (blocked) return blocked;

    // GATE DE PLANO (fonte da verdade). Lê o próprio perfil (RLS permite o dono).
    // Tanto "IA pra criar anúncios" quanto "IA pra montar bio" são Essencial+.
    const { data: prof } = await supabaseUser
      .from("user_profiles")
      .select("plano_ativo, plano_expira_em")
      .eq("id", user.id)
      .single();
    const avulsoVigente = !!prof?.plano_expira_em
      && new Date(prof.plano_expira_em).getTime() > Date.now();
    const tier = tierDoPlano(prof?.plano_ativo);
    // Plano avulso (Pix 30 dias) vive em plano_ativo+expira; se expirou, cai pra grátis.
    const planoValido = tier !== "gratis" && (prof?.plano_expira_em ? avulsoVigente : true);
    if (!planoValido) {
      return new Response(
        JSON.stringify({ error: "Recurso exclusivo dos planos Essencial e Plus.", code: "PLANO_REQUERIDO" }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    const body = await req.json() as {
      tipo?: string; funcao?: string; local?: string; categorias?: string; dica?: string;
    };
    const tipo = body.tipo === "bio" ? "bio" : body.tipo === "anuncio" ? "anuncio" : null;
    if (!tipo) {
      return new Response(JSON.stringify({ error: "tipo inválido (use 'anuncio' ou 'bio')." }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Limita e redige PII dos campos livres antes de mandar pro Groq.
    const funcao     = redigirPII(String(body.funcao ?? "").slice(0, 80));
    const local      = redigirPII(String(body.local ?? "").slice(0, 120));
    const categorias = redigirPII(String(body.categorias ?? "").slice(0, 160));
    const dica       = redigirPII(String(body.dica ?? "").slice(0, 400));

    const systemPrompt = tipo === "anuncio"
      ? promptAnuncio(funcao, local, dica)
      : promptBio(funcao, categorias, dica);

    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 320,
        temperature: 0.6,  // criatividade moderada pra copy (vs 0.3 do suporte)
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Gere o texto agora seguindo todas as regras." },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq API error (ai-gerar):", response.status, err);
      return new Response(
        JSON.stringify({ error: "Falha temporária na IA. Tente novamente em instantes." }),
        { status: 503, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    const data = await response.json();
    let texto = data?.choices?.[0]?.message?.content;
    if (!texto || typeof texto !== "string") {
      return new Response(
        JSON.stringify({ error: "IA não gerou texto válido. Tente novamente." }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // Limpeza defensiva: tira aspas de cerca e redige qualquer PII que o modelo
    // tenha inventado (defesa em profundidade contra burla da taxa de conexão).
    texto = redigirPII(texto.trim().replace(/^["'`]+|["'`]+$/g, "").trim());

    return new Response(JSON.stringify({ texto }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    console.error("ai-gerar error:", e);
    return new Response(
      JSON.stringify({ error: "Erro inesperado. Tente novamente ou contate suporte@diariaja.com.br" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
});
