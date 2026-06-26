-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de EMPREGO — Mensagem automática (Fase 1): coluna na tabela `diarias`
-- ═══════════════════════════════════════════════════════════════════════════
-- Texto LIVRE que o anunciante escreve uma vez na vaga de emprego. Vira a 1ª
-- mensagem da EMPRESA no chat quando o candidato confirma (ver o trigger no
-- arquivo vaga_mensagem_automatica_trigger.sql). Opcional: vaga sem mensagem
-- segue funcionando igual.
--
-- ⚠️ NUNCA jogamos dado do candidato (CPF/telefone) na mensagem nem em link —
-- o conteúdo é exatamente o que a empresa escreveu. O candidato preenche tudo
-- na mão no destino externo (se houver link).
--
-- Idempotente. Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS mensagem_automatica text;

SELECT 'Vaga emprego: coluna mensagem_automatica criada.' AS resultado;
