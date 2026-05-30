-- ═══════════════════════════════════════════════════════════════════════════
-- UNIVERSIDADE DiáriaJá — FASE 4: Trilha do Anunciante
-- ═══════════════════════════════════════════════════════════════════════════
-- 3 cursos pra audiência 'empregador'. Cada módulo tem aula(s) + quiz (a engine
-- exige quiz por módulo pra progressão/certificado). Idempotente (ON CONFLICT).
-- Reaproveita academy_submeter_quiz/concluir_aula (70% + anti-fraude por tempo).
-- ═══════════════════════════════════════════════════════════════════════════

DO $seed$
DECLARE v_curso UUID; v_m1 UUID; v_m2 UUID; v_p UUID;
BEGIN
  -- ╔══ CURSO 1 — Anúncios que atraem os melhores ═══════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('anunciante-anuncio-perfeito', 'Anúncios que atraem os melhores',
          'Título, descrição, valor e informações: como montar um anúncio claro que traz os profissionais certos e evita conflito.',
          '📝', '#FF6B35', 'empregador', 'basico', 10, 15, 'Anúncio Nota 10', '📝')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Título e descrição que vendem', 'O que escrever pra atrair o profissional certo.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Seja específico (sem ser confuso)',
   E'Um bom anúncio responde 3 perguntas em segundos: **o quê, quando e onde.**\n\n❌ "Preciso de ajuda em casa"\n✅ "Faxina completa de apartamento 2 quartos — sábado 8h às 12h — Centro"\n\nRegras:\n1. **Função clara:** diga exatamente o serviço (faxina, pintura, jardim…)\n2. **Escopo realista:** quantos cômodos, tamanho, o que inclui\n3. **Data e horário:** evite "qualquer dia"\n4. **Sem exageros:** descreva o trabalho real. Surpresa no local = avaliação ruim e profissional indo embora.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Qual anúncio atrai melhor os profissionais certos?', 'Específico (o quê, quando, onde) traz a pessoa certa e evita frustração.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'"Preciso de ajuda em casa"',FALSE),(v_p,2,'"Faxina de apto 2 quartos, sábado 8h-12h, Centro"',TRUE),
  (v_p,3,'"Serviço urgente, paga bem"',FALSE),(v_p,4,'"Qualquer coisa, qualquer dia"',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Por que NÃO exagerar/esconder informação no anúncio?', 'Surpresa no local faz o profissional ir embora e gera avaliação ruim.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Porque gera surpresa no local, conflito e avaliação ruim',TRUE),(v_p,2,'Porque o app proíbe textos longos',FALSE),
  (v_p,3,'Não tem problema exagerar',FALSE),(v_p,4,'Porque deixa o anúncio bonito',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Valor e condições combinadas', 'Transparência no valor evita conflito.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Valor justo e claro',
   E'O valor é o que mais gera atrito quando fica vago. Combine **antes** e por escrito.\n\n✅ Informe um valor compatível com o serviço e a região\n✅ Diga o que está incluído (material? você fornece?)\n✅ Combine forma de pagamento (PIX ou dinheiro) e momento\n✅ Registre tudo no **chat do app** — vira prova\n\nLembre: a DiáriaJá **não intermedia o valor da diária**. O pagamento é direto entre vocês. Combinar bem antes evita 90% dos problemas.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Quando e onde combinar o valor da diária?', 'Antes do serviço e por escrito no chat do app — fica registrado como prova.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Antes do serviço, por escrito no chat do app',TRUE),(v_p,2,'Só na hora de pagar, de boca',FALSE),
  (v_p,3,'Depois do serviço, se der',FALSE),(v_p,4,'Não precisa combinar valor',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Quem fica com o dinheiro da diária?', 'A plataforma não intermedia o valor — o pagamento é direto entre as partes.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'A DiáriaJá guarda e repassa',FALSE),(v_p,2,'É direto entre anunciante e prestador (a plataforma não intermedia)',TRUE),
  (v_p,3,'Fica com o app',FALSE),(v_p,4,'Ninguém recebe',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 2 — Como escolher o profissional certo ════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('anunciante-escolher-profissional', 'Como escolher o profissional certo',
          'Avaliações, histórico e perfil: critérios pra decidir bem (e não só pelo menor preço).',
          '🔍', '#3A86FF', 'empregador', 'basico', 11, 15, 'Bom Olho', '🔍')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Avaliações e histórico', 'O que as estrelas e o histórico te dizem.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Leia além da nota',
   E'A nota média é um resumo — mas os **comentários** contam a história.\n\n✅ Veja quantas diárias o profissional já fez (experiência)\n✅ Leia os comentários: pontualidade? capricho? comunicação?\n✅ Olhe os **níveis de confiança** (telefone, documento verificados)\n✅ Veja o perfil completo: foto, bio, especialidade\n\n⚠️ Pouca avaliação não é ruim — todo mundo começou um dia. Mas combine bem tudo no chat antes.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Além da nota média, o que mais ajuda a avaliar um profissional?', 'Comentários, número de diárias e níveis de confiança contam a história completa.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Comentários, nº de diárias feitas e níveis de confiança',TRUE),(v_p,2,'Só a foto do perfil',FALSE),
  (v_p,3,'Apenas o menor preço',FALSE),(v_p,4,'A cor do avatar',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Um profissional tem poucas avaliações. Isso significa que é ruim?', 'Não — todos começam sem histórico. Combine bem no chat e dê uma chance.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Não necessariamente — todos começam um dia; combine bem no chat',TRUE),(v_p,2,'Sim, com certeza é ruim',FALSE),
  (v_p,3,'Significa que é golpista',FALSE),(v_p,4,'Deve ser bloqueado',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Critérios de decisão', 'O menor preço nem sempre é o melhor negócio.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Preço x valor',
   E'O mais barato pode sair caro: serviço malfeito, retrabalho, dor de cabeça.\n\nPese:\n⚖️ **Reputação** (avaliações + comentários)\n⚖️ **Distância** (quem está perto chega no horário)\n⚖️ **Comunicação** (respondeu bem e rápido no chat?)\n⚖️ **Encaixe** (a pessoa entendeu o que você precisa?)\n\nDecida pelo conjunto — não só pelo número. Um profissional confiável que cobra um pouco mais costuma valer cada centavo.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Qual a melhor forma de decidir entre profissionais?', 'Pelo conjunto: reputação, distância, comunicação e encaixe — não só o preço.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pelo conjunto: reputação, distância, comunicação e encaixe',TRUE),(v_p,2,'Só pelo menor preço, sempre',FALSE),
  (v_p,3,'Pelo nome mais bonito',FALSE),(v_p,4,'Pelo primeiro que aparecer',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Por que o mais barato pode "sair caro"?', 'Serviço malfeito gera retrabalho e dor de cabeça — o barato pode custar mais no fim.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pode gerar serviço malfeito, retrabalho e prejuízo',TRUE),(v_p,2,'Nunca sai caro, barato é sempre melhor',FALSE),
  (v_p,3,'Porque o app cobra mais',FALSE),(v_p,4,'Não faz diferença',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 3 — Contratação segura e avaliações justas ════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('anunciante-contratacao-segura', 'Contratação segura e avaliações justas',
          'Boas práticas de segurança na contratação e como avaliar com justiça pra fortalecer a comunidade.',
          '🛡️', '#16a34a', 'empregador', 'basico', 12, 20, 'Contratante Confiável', '🛡️')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Segurança na contratação', 'Como contratar com tranquilidade.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Boas práticas de segurança',
   E'✅ **Combine tudo no chat do app** — fica registrado (escopo, valor, horário).\n✅ **Use o QR Code de presença** — comprova que o profissional chegou.\n✅ **Confira o perfil e os níveis de confiança** antes de fechar.\n✅ **Desconfie de quem quer sair do app** antes de combinar tudo.\n\n🚩 Pediram para pagar tudo adiantado por fora, sem registro? Cuidado.\n\nEncontrou um comportamento abusivo ou suspeito? Use o botão de **denúncia (⚑)** — a equipe analisa. Sua segurança e a do profissional vêm primeiro.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Qual prática AUMENTA a segurança da contratação?', 'Combinar tudo no chat (registro) e usar o QR Code de presença.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Combinar tudo no chat do app e usar o QR Code de presença',TRUE),(v_p,2,'Combinar tudo de boca, sem registro',FALSE),
  (v_p,3,'Pagar tudo adiantado por fora',FALSE),(v_p,4,'Sair do app o quanto antes',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Encontrou um usuário com comportamento abusivo. O que fazer?', 'Use o botão de denúncia (⚑). A equipe analisa.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Denunciar pelo botão ⚑',TRUE),(v_p,2,'Ignorar',FALSE),(v_p,3,'Revidar no chat',FALSE),(v_p,4,'Combinar por fora do app',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Avaliações justas', 'Avaliar com justiça fortalece a plataforma.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Como avaliar com justiça',
   E'Sua avaliação ajuda toda a comunidade a confiar mais.\n\n✅ Avalie pelo serviço **combinado** — não por algo que não estava no acordo\n✅ Seja **honesto e específico** no comentário (ajuda o profissional a melhorar)\n✅ Reconheça o que foi bom (pontualidade, capricho, comunicação)\n✅ Se algo deu errado, descreva o fato — sem ofensa pessoal\n\n❌ Não use a avaliação como chantagem ("nota baixa se não fizer de graça")\n❌ Não puna por algo fora do combinado\n\nAvaliação justa = comunidade mais confiável pra todos, inclusive pra você.', 25)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'O que é uma avaliação justa?', 'Avaliar pelo serviço combinado, com honestidade e sem ofensa pessoal.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Avaliar pelo serviço combinado, com honestidade e sem ofensa',TRUE),(v_p,2,'Dar nota baixa por algo fora do combinado',FALSE),
  (v_p,3,'Usar a nota como chantagem',FALSE),(v_p,4,'Avaliar pela aparência da pessoa',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Usar a avaliação como chantagem ("nota baixa se não fizer de graça") é…', 'É abusivo e injusto. A avaliação reflete o serviço combinado, não chantagem.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Abusivo e injusto — não se deve fazer',TRUE),(v_p,2,'Uma boa estratégia',FALSE),
  (v_p,3,'Recomendado pelo app',FALSE),(v_p,4,'Indiferente',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
END $seed$;

-- Verificação:
--   SELECT slug, titulo, audiencia, ordem FROM academy_cursos WHERE audiencia='empregador' ORDER BY ordem;
--   -- 3 cursos novos (ordem 10,11,12), 2 módulos cada, 2 perguntas por módulo.
