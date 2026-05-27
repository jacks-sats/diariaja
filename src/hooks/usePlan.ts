// ── usePlan ─────────────────────────────────────────────────────────────────
// Derive o plano ATIVO do usuário pra cada papel a partir da lista de
// assinaturas. Modelo dual track: usuário 'ambos' pode ter 2 assinaturas
// (1 diarista + 1 empregador) com planos diferentes.
//
// Migração: planos legados 'pro' e 'destaque' são normalizados pra 'plus'
// no client (defesa em profundidade — a migration do banco já faz UPDATE).

import { useMemo } from "react";
import type { Assinatura } from "../types";
import type { PlanoId, RoleAssinatura } from "../constants";

function normalizar(plano: string | undefined): PlanoId {
  if (!plano) return "gratis";
  if (plano === "pro" || plano === "destaque") return "plus"; // alias legado
  if (plano === "gratis" || plano === "essencial" || plano === "plus") return plano;
  return "gratis"; // fallback seguro
}

export interface PlanosAtivos {
  diarista:   PlanoId;
  empregador: PlanoId;
}

/**
 * Retorna o plano ativo do usuário pra cada papel.
 * - Considera apenas assinaturas com status = 'ativo'.
 * - Sem assinatura ativa = 'gratis'.
 * - Normaliza 'pro'/'destaque' (legados) → 'plus'.
 */
export function usePlan(assinaturas: Assinatura[] | null | undefined): PlanosAtivos {
  return useMemo(() => {
    const lista = Array.isArray(assinaturas) ? assinaturas : [];
    const ativaPor = (role: RoleAssinatura): PlanoId => {
      const a = lista.find(x => x.user_type === role && x.status === "ativo");
      return normalizar(a?.plano);
    };
    return {
      diarista:   ativaPor("diarista"),
      empregador: ativaPor("empregador"),
    };
  }, [assinaturas]);
}
