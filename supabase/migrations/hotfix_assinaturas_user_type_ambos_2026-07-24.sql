-- HOTFIX 2026-07-24 — assinaturas.user_type aceitar 'ambos' (auditoria banco A-8)
--
-- Bug: assinaturas.user_type CHECK só aceitava ('empregador','diarista'), mas
-- user_profiles.user_type aceita 'ambos' (empregador+diarista PJ). Quando um
-- usuário 'ambos' tentava assinar via create-subscription, o upsert falhava
-- com violation de CHECK — DEPOIS do MP já ter criado o checkout.
--
-- Sintoma: usuário paga assinatura, MP confirma, webhook chega, mas UPSERT
-- em assinaturas dá erro 23514 e status nunca vira 'ativo'. plano_ativo do
-- perfil nunca é atualizado.
--
-- Fix: extende o CHECK pra aceitar 'ambos'. Idempotente (drop + recreate).
--
-- Nota arquitetural: 'ambos' num único registro de assinatura significa que
-- o plano cobre ambos os papéis (dual-track flexível). Alternativa seria
-- forçar 2 assinaturas separadas, mas isso quebraria a UNIQUE(user_id, user_type)
-- e exigiria refactor maior. Aceita 'ambos' por enquanto.

ALTER TABLE assinaturas DROP CONSTRAINT IF EXISTS assinaturas_user_type_check;
ALTER TABLE assinaturas ADD CONSTRAINT assinaturas_user_type_check
  CHECK (user_type IN ('empregador', 'diarista', 'ambos'));

-- Verificação
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname = 'assinaturas_user_type_check';
