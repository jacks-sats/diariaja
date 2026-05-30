-- ═══════════════════════════════════════════════════════════════════════════
-- UNIVERSIDADE DiáriaJá — FASE 5: Trilha do Prestador
-- ═══════════════════════════════════════════════════════════════════════════
-- 3 cursos novos pra audiência 'diarista' (o "Atendimento 5 estrelas" já existe).
-- Cada módulo: aula(s) + quiz (engine: 70% + anti-fraude por tempo). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $seed$
DECLARE v_curso UUID; v_m1 UUID; v_m2 UUID; v_p UUID;
BEGIN
  -- ╔══ CURSO 1 — Perfil que conquista oportunidades ════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('prestador-mais-oportunidades', 'Perfil que conquista oportunidades',
          'Foto, bio e estratégia de resposta: como se destacar e ser escolhido por mais anunciantes.',
          '✨', '#FF6B35', 'diarista', 'basico', 20, 15, 'Perfil Destaque', '✨')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Foto e bio que passam confiança', 'Sua vitrine na plataforma.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'A primeira impressão é o perfil',
   E'O anunciante decide em segundos olhando seu perfil. Capriche:\n\n📸 **Foto:** rosto visível, boa luz, expressão amigável. Nada de foto escura, de longe ou com outras pessoas.\n📝 **Bio:** diga sua especialidade e o que te diferencia. Ex: "Faxineira com 5 anos de experiência, caprichosa e pontual. Levo meus produtos."\n✅ **Complete os níveis de confiança:** telefone e documento verificados = mais confiança = mais escolhas.\n\nPerfil completo aparece mais e é escolhido mais. É o investimento de 5 minutos que mais dá retorno.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Como deve ser a foto de perfil?', 'Rosto visível, boa luz, expressão amigável — passa confiança.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Rosto visível, boa luz, expressão amigável',TRUE),(v_p,2,'Escura e de longe',FALSE),
  (v_p,3,'Com várias pessoas juntas',FALSE),(v_p,4,'Sem foto nenhuma',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Por que completar os níveis de confiança (telefone, documento)?', 'Mais confiança = aparece mais e é escolhido mais.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Passa mais confiança e aumenta as chances de ser escolhido',TRUE),(v_p,2,'Não muda nada',FALSE),
  (v_p,3,'Só serve pra enfeite',FALSE),(v_p,4,'Atrapalha',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Responder rápido e bem', 'Velocidade e clareza fecham mais diárias.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Quem responde primeiro, leva',
   E'O anunciante costuma escolher entre os primeiros que respondem bem.\n\n⚡ **Responda rápido** — ative as notificações pra não perder oportunidade.\n💬 **Seja claro e educado:** "Olá! Tenho disponibilidade pra sábado 8h. Confirmo?"\n📋 **Confirme os detalhes:** endereço, horário, escopo e valor — por escrito no chat.\n🙂 **Mostre interesse genuíno** sem ser insistente.\n\nResponder em minutos (não horas) pode ser a diferença entre fechar a diária ou ver outro profissional levar.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Por que responder rápido aumenta suas chances?', 'O anunciante costuma escolher entre os primeiros que respondem bem.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'O anunciante costuma escolher entre os primeiros que respondem bem',TRUE),(v_p,2,'Não faz diferença',FALSE),
  (v_p,3,'Quem responde devagar é melhor',FALSE),(v_p,4,'O app penaliza quem responde rápido',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'O que confirmar por escrito no chat antes de fechar?', 'Endereço, horário, escopo e valor — pra ter tudo registrado.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Endereço, horário, escopo e valor',TRUE),(v_p,2,'Nada, deixa pra hora',FALSE),
  (v_p,3,'Só o nome do anunciante',FALSE),(v_p,4,'Só a cor da casa',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 2 — Dinheiro no controle (financeiro do autônomo) ═════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('prestador-financeiro', 'Dinheiro no controle: financeiro do autônomo',
          'Precificação, reserva e organização: como ganhar bem e não ver o dinheiro sumir.',
          '💰', '#16a34a', 'diarista', 'intermediario', 21, 20, 'Mente Financeira', '💰')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Precificar sem se prejudicar', 'Cobrar o justo é respeito pelo seu trabalho.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Quanto cobrar?',
   E'Cobrar muito barato parece atrair mais cliente, mas te esgota e desvaloriza seu trabalho.\n\nPra definir seu preço, considere:\n💵 **Tempo do serviço** (quantas horas de verdade)\n🚌 **Deslocamento** (transporte, distância)\n🧴 **Material** (você fornece? inclua no preço)\n🔧 **Esforço/risco** (serviço pesado vale mais)\n📊 **Mercado** (quanto cobram na sua região)\n\nRegra de ouro: seu preço precisa pagar suas contas E te sobrar. Trabalhar muito e não juntar nada é sinal de preço errado.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'O que considerar ao definir seu preço?', 'Tempo, deslocamento, material, esforço e o mercado da região.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Tempo, deslocamento, material, esforço e o mercado',TRUE),(v_p,2,'Só cobrar o mais barato possível',FALSE),
  (v_p,3,'O que o vizinho mandar',FALSE),(v_p,4,'Sempre o dobro do mercado',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Trabalhar muito e não juntar nada costuma ser sinal de…', 'Preço errado (baixo demais) — que esgota sem retorno.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Preço baixo demais',TRUE),(v_p,2,'Preço alto demais',FALSE),
  (v_p,3,'Excesso de clientes ricos',FALSE),(v_p,4,'Nada, é normal',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Reserva e organização', 'Separar para os dias parados.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'A reserva de emergência do autônomo',
   E'Como autônomo, sua renda varia. Tem mês cheio e mês fraco. A reserva é o que te protege nos dias parados (doença, feriado, baixa procura).\n\n🐷 **Separe um pouquinho de cada diária** — nem que seja 10%. O segredo é a constância.\n📅 **Anote o que entra e o que sai.** Sem anotar, o dinheiro "some".\n🎯 **Meta inicial:** juntar o equivalente a 1 mês de gastos. Depois, 3 meses.\n💳 **Separe o dinheiro do trabalho do dinheiro pessoal** — evita gastar o que era pra material/transporte.\n\nReserva = tranquilidade pra recusar uma diária ruim sem desespero.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Por que o autônomo precisa de reserva de emergência?', 'A renda varia; a reserva protege nos dias parados (doença, baixa procura).')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'A renda varia; a reserva protege nos dias parados',TRUE),(v_p,2,'Não precisa de reserva',FALSE),
  (v_p,3,'Só quem é rico precisa',FALSE),(v_p,4,'Reserva atrapalha',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Qual é uma boa prática financeira?', 'Separar um pouco de cada diária e anotar entradas e saídas.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Separar um pouco de cada diária e anotar o que entra/sai',TRUE),(v_p,2,'Gastar tudo assim que recebe',FALSE),
  (v_p,3,'Misturar dinheiro do trabalho com o pessoal',FALSE),(v_p,4,'Nunca anotar nada',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 3 — Segurança no trabalho ═════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('prestador-seguranca-trabalho', 'Segurança no trabalho',
          'EPIs, conduta e prevenção de acidentes: como se proteger enquanto trabalha.',
          '🦺', '#f59e0b', 'diarista', 'basico', 22, 15, 'Trabalho Seguro', '🦺')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Proteção e prevenção', 'EPIs e cuidados que evitam acidentes.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Use o equipamento certo',
   E'Sua saúde é seu maior patrimônio. Proteja-se:\n\n🧤 **Luvas** ao usar produtos de limpeza fortes (evita alergia e queimadura química)\n😷 **Máscara** em ambientes com poeira, mofo ou produtos com cheiro forte\n👟 **Calçado fechado e antiderrapante** (piso molhado escorrega)\n🪜 **Cuidado com altura:** escada firme, nunca em cima de cadeira/móvel\n🧪 **Nunca misture produtos** (água sanitária + amoníaco = gás tóxico!)\n\nSe o serviço exige um equipamento que você não tem, combine com o anunciante ou recuse. Nenhuma diária vale sua saúde.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Misturar água sanitária com amoníaco (ou outros produtos) é…', 'Perigoso — pode liberar gás tóxico. Nunca misture produtos de limpeza.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Perigoso — pode formar gás tóxico; nunca misture',TRUE),(v_p,2,'Limpa melhor, pode misturar',FALSE),
  (v_p,3,'Indiferente',FALSE),(v_p,4,'Recomendado',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'O serviço exige um equipamento de segurança que você não tem. O que fazer?', 'Combinar com o anunciante ou recusar — nenhuma diária vale sua saúde.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Combinar com o anunciante ou recusar — segurança em 1º lugar',TRUE),(v_p,2,'Fazer mesmo assim, arriscado',FALSE),
  (v_p,3,'Improvisar de qualquer jeito',FALSE),(v_p,4,'Ignorar o risco',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Segurança pessoal', 'Cuidados além do físico do serviço.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Indo a um local novo',
   E'Antes de ir a um endereço que você não conhece:\n\n📍 **Confira o endereço** no mapa e veja se a região é tranquila\n📲 **Avise alguém de confiança** pra onde você vai e que horas volta\n💬 **Mantenha tudo no chat do app** — fica registro de com quem você combinou\n🚪 **Chegou e algo está estranho?** Você tem o direito de não entrar. Confie no seu instinto.\n🆘 Em emergência, ligue 190.\n\nA grande maioria das diárias é tranquila — mas esses cuidados simples te deixam mais segura(o) e confiante.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Antes de ir a um endereço novo, o que é recomendado?', 'Conferir o endereço e avisar alguém de confiança pra onde você vai.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Conferir o endereço e avisar alguém de confiança',TRUE),(v_p,2,'Não falar pra ninguém',FALSE),
  (v_p,3,'Ir sem checar nada',FALSE),(v_p,4,'Combinar tudo fora do app',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Chegou no local e algo está muito estranho/inseguro. Você…', 'Tem o direito de não entrar e ir embora. Confie no seu instinto.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Tem o direito de não entrar e ir embora',TRUE),(v_p,2,'É obrigada(o) a entrar de qualquer jeito',FALSE),
  (v_p,3,'Deve ignorar o instinto',FALSE),(v_p,4,'Não pode desistir nunca',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
END $seed$;

-- Verificação:
--   SELECT slug, titulo, ordem FROM academy_cursos WHERE audiencia='diarista' ORDER BY ordem;
--   -- inclui os 3 novos (ordem 20,21,22) + 'Atendimento 5 estrelas' que já existia.
