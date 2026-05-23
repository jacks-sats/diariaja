-- Migração: RLS — diarista selecionado pode confirmar presença
-- Problema: nenhuma policy permitia o diarista fazer UPDATE em diarias
-- Resultado: confirmação de presença falhava silenciosamente, tela não atualizava
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

-- Permite que o diarista selecionado (diarista_aceite_id) mude o status
-- de "pendente" para "aceita" (confirmar presença)
CREATE POLICY "diarista_aceite_pode_confirmar" ON diarias
  FOR UPDATE
  USING (auth.uid() = diarista_aceite_id AND status = 'pendente')
  WITH CHECK (auth.uid() = diarista_aceite_id);

-- Políticas ativas na tabela diarias após esta migração:
-- 1. diarias_empregador   (ALL)    → empregador gerencia suas próprias vagas
-- 2. diarias_leitura      (SELECT) → qualquer autenticado pode ler
-- 3. diarias_aceitar      (UPDATE) → qualquer autenticado atualiza vagas abertas (candidatura)
-- 4. diarista_aceite_pode_confirmar (UPDATE) → diarista selecionado confirma presença

SELECT 'Policy diarista_aceite_pode_confirmar criada com sucesso!' AS resultado;
