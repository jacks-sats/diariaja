// ── usePermissions ──────────────────────────────────────────────────────────
// Boolean gates por feature. UI consulta isso pra mostrar/esconder elementos
// (badges, botões de feature paga, ranking, etc).
//
// IMPORTANTE: permissões aqui são para UX ("o botão aparece?"). NUNCA
// confie nelas pra impedir uma ação destrutiva — o backend (RLS + RPC) é a
// fonte da verdade. Quem usa o hook deve replicar a regra no backend antes
// de executar a operação.

import { useMemo } from "react";
import type { PlanosAtivos } from "./usePlan";

export interface PermissoesEmpregador {
  vagasIlimitadas:              boolean;  // todos: sim (limite era removido)
  matchesSemCobrancaR1:         boolean;  // essencial+
  iaJajaParaCriarVagas:         boolean;  // essencial+
  filtrosAvancados:             boolean;  // essencial+
  favoritosDiaristas:           boolean;  // essencial+
  historicoContratacoes:        boolean;  // essencial+
  destaqueModerado:             boolean;  // essencial+
  prioridadeMaxima:             boolean;  // plus
  vagasImpulsionadas:           boolean;  // plus
  convitesIlimitados:           boolean;  // plus
  automacoesVagasRecorrentes:   boolean;  // plus
  multiEndereco:                boolean;  // plus
  relatorios:                   boolean;  // plus
  seloContratanteVerificado:    boolean;  // plus
}

export interface PermissoesDiarista {
  candidaturasIlimitadas:       boolean;  // todos: sim
  cursoInterno:                 boolean;  // todos: sim
  niveisDeConfianca:            boolean;  // todos: sim
  diariasIlimitadas:            boolean;  // essencial+
  prioridadeModerada:           boolean;  // essencial+
  seloProfissional:             boolean;  // essencial+
  iaAssistente:                 boolean;  // essencial+
  boostSemanal:                 boolean;  // essencial+
  notificacoesAntecipadas:      boolean;  // essencial+
  topoDaLista:                  boolean;  // plus
  boostDiario:                  boolean;  // plus
  destaquePremium:              boolean;  // plus
  iaAvancada:                   boolean;  // plus
  prioridadeMaxima:             boolean;  // plus
  seloAltaConfiabilidade:       boolean;  // plus
}

export interface Permissoes {
  empregador: PermissoesEmpregador;
  diarista:   PermissoesDiarista;
}

/**
 * Compute boolean feature gates a partir dos planos ativos.
 * Convenção: 'plus' herda tudo de 'essencial' + extras; 'essencial' herda
 * features comuns de 'gratis' + extras.
 */
export function usePermissions(plans: PlanosAtivos): Permissoes {
  return useMemo(() => {
    const empEss = plans.empregador === "essencial" || plans.empregador === "plus";
    const empPlu = plans.empregador === "plus";
    const diaEss = plans.diarista === "essencial" || plans.diarista === "plus";
    const diaPlu = plans.diarista === "plus";

    return {
      empregador: {
        vagasIlimitadas:              true,
        matchesSemCobrancaR1:         empEss,
        iaJajaParaCriarVagas:         empEss,
        filtrosAvancados:             empEss,
        favoritosDiaristas:           empEss,
        historicoContratacoes:        empEss,
        destaqueModerado:             empEss,
        prioridadeMaxima:             empPlu,
        vagasImpulsionadas:           empPlu,
        convitesIlimitados:           empPlu,
        automacoesVagasRecorrentes:   empPlu,
        multiEndereco:                empPlu,
        relatorios:                   empPlu,
        seloContratanteVerificado:    empPlu,
      },
      diarista: {
        candidaturasIlimitadas:       true,
        cursoInterno:                 true,
        niveisDeConfianca:            true,
        diariasIlimitadas:            diaEss,
        prioridadeModerada:           diaEss,
        seloProfissional:             diaEss,
        iaAssistente:                 diaEss,
        boostSemanal:                 diaEss,
        notificacoesAntecipadas:      diaEss,
        topoDaLista:                  diaPlu,
        boostDiario:                  diaPlu,
        destaquePremium:              diaPlu,
        iaAvancada:                   diaPlu,
        prioridadeMaxima:             diaPlu,
        seloAltaConfiabilidade:       diaPlu,
      },
    };
  }, [plans.empregador, plans.diarista]);
}

/**
 * Helper auxiliar: peso de prioridade do plano (pra ordenação de listas).
 * Plus > Essencial > Grátis.
 */
export function pesoPlano(plano: "gratis" | "essencial" | "plus"): number {
  if (plano === "plus")      return 100;
  if (plano === "essencial") return 50;
  return 0;
}
