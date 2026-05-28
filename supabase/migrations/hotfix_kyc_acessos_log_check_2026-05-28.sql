-- HOTFIX 2026-05-28: kyc_acessos_log_acao_check rejeita revisões legítimas
--
-- A tabela kyc_acessos_log tem check `acao IN ('visualizou','aprovou','rejeitou')`
-- mas as RPCs revisar_documento e revisar_antecedentes inserem `acao = p_decisao`
-- onde p_decisao é 'aprovado' ou 'rejeitado' (forma do user_profiles.documento_status).
--
-- Inconsistência veio de 2 migrations não-coordenadas:
--   - seguranca_hardening.sql / _APLICAR_TUDO_PENDENTE.sql linhas 1069-1098
--   - kyc_documentos.sql (versão original sem INSERT)
--
-- Sintoma: admin clica Aprovar/Rejeitar KYC → toast "new row violates check
-- constraint kyc_acessos_log_acao_check" → revisão NÃO acontece (transação
-- inteira rolled back).
--
-- Fix: extende o check pra aceitar ambas as formas. Não-destrutivo.

ALTER TABLE kyc_acessos_log DROP CONSTRAINT IF EXISTS kyc_acessos_log_acao_check;
ALTER TABLE kyc_acessos_log ADD CONSTRAINT kyc_acessos_log_acao_check
  CHECK (acao IN ('visualizou', 'aprovou', 'aprovado', 'rejeitou', 'rejeitado'));

-- Verificação
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conname = 'kyc_acessos_log_acao_check';
