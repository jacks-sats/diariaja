-- ═══════════════════════════════════════════════════════════════════════════
-- UNIVERSIDADE DiáriaJá (Já Decola) — FASE 1
-- Curso OBRIGATÓRIO "Como funciona o DiáriaJá" + correção do certificado
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Estende a base academy_* (ja_decola_academy.sql). Idempotente (ON CONFLICT).
--
-- 1) FIX do certificado: a lógica contava TODOS os módulos do curso, mas só
--    emite certificado quando todos têm tentativa de quiz aprovada. Cursos com
--    módulos só-conteúdo (sem quiz) NUNCA emitiam o certificado. Passa a contar
--    apenas módulos QUE TÊM quiz. (Conserta também o curso "Atendimento 5★".)
--
-- 2) SEED do curso obrigatório (audiencia 'ambos', ordem 0 → aparece 1º pra
--    todos). 5 módulos, cada um com aula(s) de conteúdo + um mini-quiz de 2
--    perguntas (10 perguntas no total). Sequencial (a UI já desbloqueia o
--    módulo seguinte só após o quiz do anterior). Selo "Usuário Capacitado".
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX — certificado conta só módulos COM quiz
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION academy_submeter_quiz(
  p_modulo_id UUID,
  p_respostas JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_acertos    INT  := 0;
  v_total      INT  := 0;
  v_passou     BOOLEAN;
  v_cooldown   TIMESTAMPTZ;
  v_tentativa_recente RECORD;
  v_curso_id   UUID;
  v_pontos     INT;
  v_modulos_total INT;
  v_modulos_aprovados INT;
  v_certificado_emitido BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT * INTO v_tentativa_recente
    FROM academy_quiz_tentativas
   WHERE user_id = v_user_id AND modulo_id = p_modulo_id AND cooldown_ate > NOW()
   ORDER BY iniciada_em DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('erro', 'cooldown', 'cooldown_ate', v_tentativa_recente.cooldown_ate);
  END IF;

  SELECT COUNT(*) INTO v_total FROM academy_perguntas WHERE modulo_id = p_modulo_id;
  IF v_total = 0 THEN RAISE EXCEPTION 'módulo sem quiz'; END IF;

  SELECT COUNT(*) INTO v_acertos
    FROM jsonb_array_elements(p_respostas) r
    JOIN academy_opcoes o ON o.id = (r->>'opcao_id')::UUID
   WHERE o.correta = TRUE
     AND o.pergunta_id = (r->>'pergunta_id')::UUID
     AND EXISTS (SELECT 1 FROM academy_perguntas pp WHERE pp.id = o.pergunta_id AND pp.modulo_id = p_modulo_id);

  v_passou := (v_acertos::FLOAT / v_total) >= 0.70;
  IF NOT v_passou THEN v_cooldown := NOW() + INTERVAL '1 hour'; END IF;

  INSERT INTO academy_quiz_tentativas (user_id, modulo_id, concluida_em, acertos, total, passou, cooldown_ate)
  VALUES (v_user_id, p_modulo_id, NOW(), v_acertos, v_total, v_passou, v_cooldown);

  IF v_passou THEN
    SELECT curso_id INTO v_curso_id FROM academy_modulos WHERE id = p_modulo_id;

    -- FIX: conta SÓ módulos que têm quiz (módulos só-conteúdo não bloqueiam o cert)
    SELECT COUNT(*) INTO v_modulos_total
      FROM academy_modulos m
     WHERE m.curso_id = v_curso_id
       AND EXISTS (SELECT 1 FROM academy_perguntas p WHERE p.modulo_id = m.id);

    SELECT COUNT(DISTINCT t.modulo_id) INTO v_modulos_aprovados
      FROM academy_quiz_tentativas t
      JOIN academy_modulos m ON m.id = t.modulo_id
     WHERE t.user_id = v_user_id AND t.passou = TRUE AND m.curso_id = v_curso_id;

    IF v_modulos_aprovados >= v_modulos_total THEN
      SELECT pontos_score INTO v_pontos FROM academy_cursos WHERE id = v_curso_id;
      INSERT INTO academy_certificados (user_id, curso_id, pontuacao)
      VALUES (v_user_id, v_curso_id, v_acertos)
      ON CONFLICT (user_id, curso_id) DO NOTHING;
      v_certificado_emitido := TRUE;
    END IF;
  END IF;

  RETURN jsonb_build_object('acertos', v_acertos, 'total', v_total, 'passou', v_passou,
                            'cooldown_ate', v_cooldown, 'curso_concluido', v_certificado_emitido);
END $$;
REVOKE ALL ON FUNCTION academy_submeter_quiz(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION academy_submeter_quiz(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SEED — Curso obrigatório "Como funciona o DiáriaJá"
-- ─────────────────────────────────────────────────────────────────────────────
DO $seed$
DECLARE
  v_curso UUID;
  v_m1 UUID; v_m2 UUID; v_m3 UUID; v_m4 UUID; v_m5 UUID;
  v_p  UUID;
BEGIN
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('como-funciona-app', 'Como funciona o DiáriaJá',
          'Comece por aqui! Em 5 minutos você entende o que a plataforma é (e o que não é), seus direitos e deveres, segurança e como funcionam as avaliações.',
          '📲', '#3A86FF', 'ambos', 'basico', 0, 25, 'Usuário Capacitado', '🎓')
  ON CONFLICT (slug) DO UPDATE SET
    titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao, icone = EXCLUDED.icone,
    cor = EXCLUDED.cor, audiencia = EXCLUDED.audiencia, nivel = EXCLUDED.nivel,
    ordem = EXCLUDED.ordem, pontos_score = EXCLUDED.pontos_score,
    selo_titulo = EXCLUDED.selo_titulo, selo_icone = EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  -- ═══ MÓDULO 1 — O que é o DiáriaJá ═══════════════════════════════════════
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'O que é o DiáriaJá', 'Uma plataforma de conexão entre quem precisa e quem faz.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_m1;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Uma plataforma de conexão (não de emprego)',
   E'O DiáriaJá conecta **anunciantes** (quem precisa de um serviço pontual) a **prestadores autônomos** (quem oferece o serviço: faxina, delivery, jardinagem, obra, beleza, cuidado…).\n\nA relação entre as duas partes é de **prestação de serviço autônoma e independente** — regida pelo Código Civil. **NÃO é emprego (CLT) nem trabalho doméstico.** Cada um é dono do próprio nariz: combinam preço, horário e condições entre si.\n\nA plataforma é uma **ferramenta de conexão** — como um mural de oportunidades. Ela aproxima as pessoas; quem executa e quem paga são vocês.',
   25),
  (v_m1, 2, 'texto', 'O que o app FAZ e o que NÃO faz',
   E'**O que o DiáriaJá FAZ:**\n✅ Publica anúncios de oportunidades\n✅ Conecta anunciante e prestador\n✅ Oferece chat interno (com registro de tudo)\n✅ Gera QR Code de presença (prova de que o serviço aconteceu)\n✅ Emite recibo digital (prova bilateral — NÃO é nota fiscal)\n\n**O que o DiáriaJá NÃO faz:**\n❌ NÃO emprega ninguém\n❌ NÃO controla a execução do serviço\n❌ NÃO garante a qualidade do serviço\n❌ NÃO recebe, guarda nem repassa o valor da diária\n\nO pagamento da diária é **combinado e feito direto entre as partes** (PIX ou dinheiro). A plataforma não entra nesse dinheiro.',
   30);

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Qual é a relação entre anunciante e prestador no DiáriaJá?',
   'É prestação de serviço autônoma (Código Civil) — não é emprego CLT. Cada parte é independente.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Emprego com carteira assinada (CLT)', FALSE),
  (v_p, 2, 'Prestação de serviço autônoma e independente', TRUE),
  (v_p, 3, 'A plataforma é a empregadora do prestador', FALSE),
  (v_p, 4, 'Trabalho doméstico registrado', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Quem fica responsável pelo pagamento do valor da diária?',
   'A plataforma NÃO recebe nem repassa o valor. O pagamento é direto entre anunciante e prestador.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'A DiáriaJá recebe e repassa o valor', FALSE),
  (v_p, 2, 'O anunciante e o prestador combinam e pagam direto entre si', TRUE),
  (v_p, 3, 'O governo paga', FALSE),
  (v_p, 4, 'Ninguém precisa pagar', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  -- ═══ MÓDULO 2 — Responsabilidades do Prestador ═══════════════════════════
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Responsabilidades do Prestador', 'Combinou, cumpriu: o que se espera de quem presta o serviço.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_m2;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Os 5 deveres do prestador',
   E'Aceitou uma oportunidade? Então:\n\n1. **Compareça no horário combinado.** Planeje chegar 10 min antes. Atrasou? Avise pelo chat ASSIM QUE souber — nunca depois.\n2. **Execute o serviço anunciado.** Faça o que foi combinado, com capricho. Pediram algo a mais? Combine valor antes de fazer.\n3. **Comunique imprevistos.** Não vai conseguir ir? Avise com antecedência e proponha remarcar.\n4. **Aja com respeito.** Educação e profissionalismo abrem portas (e geram avaliação 5★).\n5. **Zele pela sua própria segurança.** Confirme endereço, avise alguém para onde vai, e desconfie de pedidos estranhos.',
   30);

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Você aceitou uma diária mas vai se atrasar. Qual a atitude certa?',
   'Avisar pelo chat assim que souber — com antecedência — é o que diferencia um profissional.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Avisar pelo chat assim que souber, com horário real de chegada', TRUE),
  (v_p, 2, 'Não falar nada e torcer pra não notarem', FALSE),
  (v_p, 3, 'Cancelar sem avisar', FALSE),
  (v_p, 4, 'Inventar uma desculpa quando chegar', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'O anunciante pede um serviço extra que não estava combinado. O que fazer?',
   'Você tem direito de combinar um valor pelo extra ANTES de fazer. Não trabalhe de graça por receio.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Fazer de graça pra não ganhar avaliação ruim', FALSE),
  (v_p, 2, 'Combinar um valor pelo extra, por escrito no chat, antes de fazer', TRUE),
  (v_p, 3, 'Sair sem falar nada', FALSE),
  (v_p, 4, 'Fazer e cobrar o que quiser depois, sem combinar', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  -- ═══ MÓDULO 3 — Responsabilidades do Anunciante ══════════════════════════
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 3, 'Responsabilidades do Anunciante', 'Anúncio claro e contratação justa atraem os melhores profissionais.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_m3;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m3, 1, 'texto', 'Os 5 deveres do anunciante',
   E'Vai publicar uma oportunidade? Então:\n\n1. **Crie um anúncio claro.** Diga exatamente o que precisa: função, escopo, data e horário.\n2. **Informe o valor corretamente.** Combine um valor justo e seja transparente. Surpresas geram conflito e avaliação ruim.\n3. **Informe o local corretamente.** Endereço certo evita atraso e frustração.\n4. **Trate o profissional com respeito.** Do outro lado tem uma pessoa trabalhando. Educação gera bom serviço.\n5. **Cumpra o que combinou.** Pague o combinado, no momento combinado. A palavra (registrada no chat) vale.',
   30);

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m3, 1, 'Qual é a melhor prática ao criar um anúncio?',
   'Anúncio claro (função, valor, local, data) atrai os profissionais certos e evita conflito.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Descrever função, valor, local e data com clareza', TRUE),
  (v_p, 2, 'Deixar tudo vago pra negociar na hora', FALSE),
  (v_p, 3, 'Esconder o valor real até o profissional chegar', FALSE),
  (v_p, 4, 'Informar um endereço errado de propósito', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m3, 2, 'O serviço foi concluído conforme combinado. O que o anunciante deve fazer?',
   'Cumprir o combinado: pagar o valor acertado, no momento acertado. A palavra registrada vale.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Pagar o valor combinado, como acertado no chat', TRUE),
  (v_p, 2, 'Tentar pagar menos do que combinou', FALSE),
  (v_p, 3, 'Sumir sem pagar', FALSE),
  (v_p, 4, 'Pedir mais serviço sem pagar a mais', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  -- ═══ MÓDULO 4 — Segurança ════════════════════════════════════════════════
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 4, 'Segurança', 'Fique dentro do app, reconheça golpes e saiba denunciar.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_m4;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m4, 1, 'texto', 'Golpes comuns e como se proteger',
   E'🚩 **Tirar você do app.** "Vamos falar no WhatsApp" antes de combinar tudo. Risco: pagamento fora, pedido não combinado, sem registro. **Combine tudo no chat do app.**\n\n🚩 **Mudar o combinado na hora.** O anúncio dizia 1 cômodo, chega lá são 5. Você pode renegociar ou recusar.\n\n🚩 **Pedir dados ou dinheiro adiantado por fora.** Desconfie sempre.\n\n**Por que usar o chat interno:** tudo que é combinado por escrito fica **registrado** — vira prova se houver divergência. E o **QR Code de presença** comprova que o serviço aconteceu.\n\n**Encontrou um usuário mal-intencionado?** Use o botão de **denúncia (⚑)** no perfil ou no anúncio. A equipe analisa.',
   30);

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m4, 1, 'Alguém insiste em sair do app pra combinar tudo pelo WhatsApp ANTES de fechar. Isso é…',
   'Tirar do app é o sinal nº1 de risco. Combine tudo no chat interno, que fica registrado.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Um sinal de risco — melhor combinar tudo no chat do app', TRUE),
  (v_p, 2, 'Totalmente seguro, pode ir', FALSE),
  (v_p, 3, 'Obrigatório sair do app', FALSE),
  (v_p, 4, 'Indiferente', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m4, 2, 'Você encontrou um usuário com comportamento abusivo ou suspeito. O que fazer?',
   'Use o botão de denúncia (⚑) no perfil/anúncio. A equipe da plataforma analisa.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Denunciar pelo botão ⚑ no perfil ou anúncio', TRUE),
  (v_p, 2, 'Ignorar e seguir combinando por fora', FALSE),
  (v_p, 3, 'Xingar a pessoa no chat', FALSE),
  (v_p, 4, 'Não tem o que fazer', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  -- ═══ MÓDULO 5 — Avaliações e Reputação ═══════════════════════════════════
  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 5, 'Avaliações e Reputação', 'Sua reputação é seu cartão de visitas na plataforma.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao
  RETURNING id INTO v_m5;

  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m5, 1, 'texto', 'Como funciona a reputação',
   E'Depois de cada diária, **as duas partes se avaliam** — prestador avalia anunciante e vice-versa. Essas notas formam a sua **reputação**, visível pra todos.\n\n**Como GANHAR confiança:**\n✅ Cumpra o combinado (horário, escopo, pagamento)\n✅ Comunique-se bem pelo chat\n✅ Trate o outro com respeito\n✅ Complete seu perfil e os níveis de confiança (telefone, documento)\n\n**Como EVITAR avaliações negativas:**\n❌ Não falte sem avisar\n❌ Não mude o combinado na marra\n❌ Não seja grosseiro\n\nReputação boa = mais oportunidades, mais destaque, mais confiança. É o ativo mais valioso que você constrói aqui.',
   30);

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m5, 1, 'Qual atitude AJUDA a construir uma boa reputação?',
   'Cumprir o combinado, comunicar-se bem e respeitar o outro são a base de uma boa reputação.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Cumprir o combinado, comunicar bem e respeitar o outro', TRUE),
  (v_p, 2, 'Faltar sem avisar de vez em quando', FALSE),
  (v_p, 3, 'Mudar o combinado na hora', FALSE),
  (v_p, 4, 'Ser grosseiro quando estiver com pressa', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;

  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m5, 2, 'Por que a reputação é importante no DiáriaJá?',
   'Reputação boa traz mais oportunidades, destaque e confiança — é o ativo que você constrói na plataforma.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta = EXCLUDED.pergunta, explicacao = EXCLUDED.explicacao
  RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p, 1, 'Traz mais oportunidades, destaque e confiança', TRUE),
  (v_p, 2, 'Não serve pra nada', FALSE),
  (v_p, 3, 'Só atrapalha', FALSE),
  (v_p, 4, 'É só enfeite', FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto = EXCLUDED.texto, correta = EXCLUDED.correta;
END $seed$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT slug, titulo, audiencia, ordem FROM academy_cursos WHERE slug='como-funciona-app';
--   SELECT m.ordem, m.titulo, count(p.id) AS perguntas
--     FROM academy_modulos m
--     LEFT JOIN academy_perguntas p ON p.modulo_id = m.id
--     JOIN academy_cursos c ON c.id = m.curso_id AND c.slug='como-funciona-app'
--    GROUP BY m.ordem, m.titulo ORDER BY m.ordem;
--   -- 5 módulos, 2 perguntas cada.
-- ─────────────────────────────────────────────────────────────────────────────
