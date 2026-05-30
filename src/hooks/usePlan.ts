// ── usePlan ─────────────────────────────────────────────────────────────────
// Derive o plano ATIVO do usuário pra cada papel. Duas fontes:
//   1. Tabela `assinaturas` (recorrente / Preapproval) — por papel (dual track).
//   2. user_profiles.plano_ativo (+ plano_expira_em) — plano AVULSO de 30 dias
//      pago via Pix/cartão (Edge Function create-plano-payment → webhook). Esta
//      é HOJE a única forma de compra na tela de planos, então IGNORAR essa
//      fonte significava cobrar e não liberar nada (bug C3 da auditoria).
//
// Migração: planos legados 'pro' e 'destaque' são normalizados pra 'plus'
// no client (defesa em profundidade — a migration do banco já faz UPDATE).

import { useMemo } from "react";
import type { Assinatura } from "../types";
import type { PlanoId, RoleAssinatura } from "../constants";
import { pesoPlano } from "./usePermissions";

function normalizar(plano: string | undefined | null): PlanoId {
  if (!plano) return "gratis";
  if (plano === "pro" || plano === "destaque") return "plus"; // alias legado
  if (plano === "gratis" || plano === "essencial" || plano === "plus") return plano;
  return "gratis"; // fallback seguro
}

// Escolhe o MELHOR entre dois planos (plus > essencial > gratis).
function melhorPlano(a: PlanoId, b: PlanoId): PlanoId {
  return pesoPlano(a) >= pesoPlano(b) ? a : b;
}

export interface PlanosAtivos {
  diarista:   PlanoId;
  empregador: PlanoId;
}

export interface PerfilPlano {
  plano_ativo?: string | null;
  plano_expira_em?: string | null;
}

/**
 * Retorna o plano ativo do usuário pra cada papel.
 * - Considera assinaturas com status = 'ativo' (por papel) E o plano avulso de
 *   30 dias gravado em user_profiles.plano_ativo (não vencido).
 * - Pega o melhor entre as duas fontes.
 * - Sem nada ativo = 'gratis'.
 * - Normaliza 'pro'/'destaque' (legados) → 'plus'.
 *
 * @param assinaturas lista de assinaturas recorrentes do usuário
 * @param perfil      { plano_ativo, plano_expira_em } do user_profiles
 */
export function usePlan(
  assinaturas: Assinatura[] | null | undefined,
  perfil?: PerfilPlano | null,
): PlanosAtivos {
  const planoAtivo = perfil?.plano_ativo ?? null;
  const expiraEm   = perfil?.plano_expira_em ?? null;
  return useMemo(() => {
    const lista = Array.isArray(assinaturas) ? assinaturas : [];

    // Plano avulso (30 dias) é role-agnostic no schema → aplica aos dois papéis.
    // Usuário 'ambos' que comprou só um papel é caso raro; ainda assim é melhor
    // liberar do que cobrar por algo já pago. Respeita o vencimento (defesa em
    // profundidade — checkProfile já reverte plano_ativo expirado no banco).
    const venceu = !!expiraEm && new Date(expiraEm).getTime() < Date.now();
    const planoAvulso: PlanoId = venceu ? "gratis" : normalizar(planoAtivo);

    const ativaPor = (role: RoleAssinatura): PlanoId => {
      const a = lista.find(x => x.user_type === role && x.status === "ativo");
      return melhorPlano(normalizar(a?.plano), planoAvulso);
    };
    return {
      diarista:   ativaPor("diarista"),
      empregador: ativaPor("empregador"),
    };
  }, [assinaturas, planoAtivo, expiraEm]);
}
