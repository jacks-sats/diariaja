// ── useLimits ───────────────────────────────────────────────────────────────
// Calcula contadores e limites em tempo real a partir do state global do
// App. Não busca dados — recebe tudo como parâmetro. Quem decide quando
// chamar a RPC `pode_selecionar_candidato` (fonte oficial server-side) é o
// fluxo de seleção, NÃO este hook (que é só pra UI / badges).

import { useMemo } from "react";
import type { Diaria } from "../types";
import type { PlanosAtivos } from "./usePlan";

const LIMITE_GRATIS_MATCHES_MES        = 3;  // empregador grátis
const LIMITE_GRATIS_DIARIAS_VITALICIO  = 3;  // diarista grátis — vitalício

export interface LimitsEmpregador {
  matchesMesUsados:          number;
  matchesGratisRestantes:    number;   // -1 = ilimitado (plano pago)
  contatosDesbloqueadosMes:  number;
  limiteEfetivoMes:          number;   // 3 + extras (grátis) ou Infinity (pago)
  cobrancaR1Iminente:        boolean;  // true se próxima seleção exige R$1
}

export interface LimitsDiarista {
  diariasConcluidasTotal:    number;
  restantesAteCTA:           number;   // -1 = ilimitado (plano pago)
  passouCotaGratis:          boolean;
}

export interface Limits {
  empregador: LimitsEmpregador;
  diarista:   LimitsDiarista;
}

/**
 * Calcula os limites consolidados.
 *
 * @param plans            saída do usePlan() — pra saber se está grátis ou pago
 * @param diariasEmp       diárias do empregador (filtradas pelo empregador_id)
 * @param contatosExtras   unlocks R$1 deste mês (vem da RPC contar_contatos_desbloqueados_mes)
 * @param diariasConcluidasComoDiarista  conta vitalícia (vem da RPC contar_diarias_concluidas_diarista)
 */
export function useLimits(
  plans: PlanosAtivos,
  diariasEmp: Diaria[] | null | undefined,
  contatosExtras: number,
  diariasConcluidasComoDiarista: number,
): Limits {
  return useMemo(() => {
    // ── Empregador ──────────────────────────────────────────────────────────
    const mes = new Date().toISOString().slice(0, 7);
    const lista = Array.isArray(diariasEmp) ? diariasEmp : [];
    const matchesMesUsados = lista.filter(
      d => d.diarista_aceite_id && d.created_at && d.created_at.slice(0, 7) === mes
    ).length;

    const empPago = plans.empregador === "essencial" || plans.empregador === "plus";
    const limiteEfetivoMes = empPago
      ? Number.POSITIVE_INFINITY
      : LIMITE_GRATIS_MATCHES_MES + (contatosExtras || 0);
    const matchesGratisRestantes = empPago
      ? -1
      : Math.max(0, limiteEfetivoMes - matchesMesUsados);
    const cobrancaR1Iminente = !empPago && matchesMesUsados >= limiteEfetivoMes;

    // ── Diarista ────────────────────────────────────────────────────────────
    const diaPago = plans.diarista === "essencial" || plans.diarista === "plus";
    const restantesAteCTA = diaPago
      ? -1
      : Math.max(0, LIMITE_GRATIS_DIARIAS_VITALICIO - diariasConcluidasComoDiarista);
    const passouCotaGratis = !diaPago && diariasConcluidasComoDiarista >= LIMITE_GRATIS_DIARIAS_VITALICIO;

    return {
      empregador: {
        matchesMesUsados,
        matchesGratisRestantes,
        contatosDesbloqueadosMes: contatosExtras || 0,
        limiteEfetivoMes,
        cobrancaR1Iminente,
      },
      diarista: {
        diariasConcluidasTotal: diariasConcluidasComoDiarista,
        restantesAteCTA,
        passouCotaGratis,
      },
    };
  }, [plans.empregador, plans.diarista, diariasEmp, contatosExtras, diariasConcluidasComoDiarista]);
}
