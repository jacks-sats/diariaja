#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/verificar.sh — Checagem completa antes de commit/push
#
# Uso manual:
#   bash scripts/verificar.sh          # roda tudo
#   bash scripts/verificar.sh --quick  # só tsc + testes (sem build)
#
# Executado automaticamente por:
#   .git/hooks/pre-commit  (tsc + testes)
#   .git/hooks/pre-push    (build completo)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

QUICK=false
[[ "${1:-}" == "--quick" ]] && QUICK=true

ERROS=0

run_step() {
  local label="$1"
  local cmd="$2"
  echo -e "\n${CYAN}▶ ${label}...${NC}"
  if eval "$cmd"; then
    echo -e "${GREEN}  ✅ ${label} — OK${NC}"
  else
    echo -e "${RED}  ❌ ${label} — FALHOU${NC}"
    ERROS=$((ERROS + 1))
  fi
}

echo -e "\n${YELLOW}══════════════════════════════════════════${NC}"
echo -e "${YELLOW}   🔍 Verificação DiáriaJá$([ $QUICK = true ] && echo " (modo rápido)")${NC}"
echo -e "${YELLOW}══════════════════════════════════════════${NC}"

# 1. TypeScript — detecta variáveis não declaradas, tipos errados, etc.
run_step "TypeScript (tsc --noEmit)" "npx tsc --noEmit 2>&1"

# 2. Testes — 60 testes unitários
run_step "Testes (vitest)" "npm test -- --run 2>&1"

# 3. Build completo — só no modo completo
if [ "$QUICK" = false ]; then
  run_step "Build de produção (vite build)" "npm run build 2>&1"
fi

echo -e "\n${YELLOW}══════════════════════════════════════════${NC}"

if [ "$ERROS" -eq 0 ]; then
  echo -e "${GREEN}  ✅ Tudo certo! Nenhum problema encontrado.${NC}"
  if [ "$QUICK" = true ]; then
    echo -e "${YELLOW}  ℹ️  Build não foi verificado (--quick). Rode sem a flag para checar.${NC}"
  fi
  echo -e "${YELLOW}══════════════════════════════════════════${NC}\n"
  exit 0
else
  echo -e "${RED}  ❌ ${ERROS} verificação(ões) falharam. Corrija antes de continuar.${NC}"
  echo -e "${YELLOW}══════════════════════════════════════════${NC}\n"
  exit 1
fi
