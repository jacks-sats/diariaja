-- ═══════════════════════════════════════════════════════════════════════════
-- UNIVERSIDADE DiáriaJá — FASE 6: Cursos por profissão
-- ═══════════════════════════════════════════════════════════════════════════
-- 6 cursos técnicos pra audiência 'diarista', um por profissão-chave:
--   faxina, jardinagem, pintura, alvenaria (pedreiro), elétrica, hidráulica.
-- Cada curso: 2 módulos × (1 aula + quiz de 2 perguntas).
-- Engine: 70% pra passar + anti-fraude por tempo (tempo_min_seg). Idempotente.
-- ordem 30..35 (vem depois da trilha do prestador, que vai até 22).
-- ═══════════════════════════════════════════════════════════════════════════

DO $seed$
DECLARE v_curso UUID; v_m1 UUID; v_m2 UUID; v_p UUID;
BEGIN
  -- ╔══ CURSO 1 — Faxina profissional ═══════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('profissao-faxina', 'Faxina profissional de verdade',
          'Sequência certa, produtos e acabamento que faz o cliente chamar de novo.',
          '🧹', '#06b6d4', 'diarista', 'basico', 30, 20, 'Faxina Nota 10', '🧹')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'A ordem certa de limpar', 'De cima pra baixo, do fundo pra porta.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Sequência que economiza tempo',
   E'Limpar na ordem certa evita retrabalho e rende mais:\n\n⬆️ **De cima pra baixo:** primeiro tetos, prateleiras e móveis altos; o pó cai e você limpa o chão por último.\n⬅️ **Do fundo pra porta:** comece pelo canto mais distante e vá saindo, pra não pisar no que já limpou.\n🧴 **Deixe o produto agir:** aplique no box, vaso e pia e vá fazer outra coisa enquanto solta a sujeira — depois é só passar o pano.\n🧽 **Panos separados por ambiente:** um pra banheiro, outro pra cozinha (evita espalhar germe).\n\nTrabalhar com método é o que separa o amador do profissional — e rende elogio.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Qual a ordem certa para limpar um cômodo?', 'De cima pra baixo: o pó cai e você limpa o chão por último.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'De cima pra baixo (chão por último)',TRUE),(v_p,2,'O chão primeiro, depois os móveis altos',FALSE),
  (v_p,3,'Tanto faz a ordem',FALSE),(v_p,4,'Só o que está sujo de leve',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Por que usar panos separados para banheiro e cozinha?', 'Pra não espalhar germes de um ambiente no outro.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pra não espalhar germes de um ambiente no outro',TRUE),(v_p,2,'Não faz diferença',FALSE),
  (v_p,3,'Pra gastar mais pano',FALSE),(v_p,4,'Só por enfeite',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Produtos e superfícies', 'Produto certo pra cada material.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Cada superfície pede um cuidado',
   E'Usar o produto errado pode estragar a superfície do cliente — e isso é prejuízo seu.\n\n🪵 **Madeira/laminado:** pano levemente úmido, nunca encharcado. Água demais empena e descola.\n🪞 **Vidro e espelho:** limpa-vidros ou água com pouco detergente + rodo/pano seco pra não manchar.\n🚿 **Box e azulejo:** desengordurante ou produto pra banheiro; deixe agir antes de esfregar.\n🍳 **Inox:** pano macio no sentido do risco do aço; evite esponja dura que arranha.\n⚠️ **Nunca misture produtos** (água sanitária + outros = gás tóxico).\n\nNa dúvida sobre um material delicado (mármore, pedra), pergunte ao cliente antes.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Como limpar móvel de madeira/laminado?', 'Pano levemente úmido — água demais empena e descola.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pano levemente úmido, nunca encharcado',TRUE),(v_p,2,'Jogando bastante água',FALSE),
  (v_p,3,'Com esponja de aço',FALSE),(v_p,4,'Com água sanitária pura',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Diante de um material delicado que você não conhece (mármore/pedra), o melhor é…', 'Perguntar ao cliente antes — evita estragar e gerar prejuízo.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Perguntar ao cliente antes de usar qualquer produto',TRUE),(v_p,2,'Usar o produto mais forte que tiver',FALSE),
  (v_p,3,'Testar no meio da superfície',FALSE),(v_p,4,'Ignorar e seguir',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 2 — Jardinagem ════════════════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('profissao-jardinagem', 'Jardinagem que valoriza o quintal',
          'Poda, rega e manutenção: deixe o jardim bonito e o cliente fiel.',
          '🌿', '#22c55e', 'diarista', 'basico', 31, 20, 'Mãos Verdes', '🌿')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Poda e corte de grama', 'A hora certa e o jeito certo.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Podar sem maltratar a planta',
   E'Poda bem feita deixa a planta saudável e o jardim bonito:\n\n✂️ **Ferramenta limpa e afiada:** corte limpo cicatriza rápido; tesoura cega machuca a planta.\n📅 **Poda de limpeza** (galhos secos/doentes) pode a qualquer época. Poda de formato, prefira épocas mais frias.\n🌱 **Grama:** não corte rente demais ("escalpelar") — enfraquece e amarela. Deixe uns 3–4 cm.\n🧤 **Sempre com luva** — espinhos, seiva irritante e insetos.\n🌳 **Galho grosso:** corte rente ao tronco, sem deixar "toco", pra cicatrizar bem.\n\nLimpe as ferramentas entre plantas doentes pra não passar praga de uma pra outra.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Por que cortar a grama rente demais é ruim?', 'Enfraquece e amarela a grama; deixe uns 3–4 cm.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Enfraquece e amarela a grama',TRUE),(v_p,2,'Deixa mais verde',FALSE),
  (v_p,3,'Não muda nada',FALSE),(v_p,4,'Faz crescer mais rápido',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Por que limpar a ferramenta entre plantas doentes?', 'Pra não passar praga/doença de uma planta para outra.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pra não passar praga/doença de uma planta pra outra',TRUE),(v_p,2,'Só pra ferramenta brilhar',FALSE),
  (v_p,3,'Não precisa limpar',FALSE),(v_p,4,'Pra gastar tempo',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Rega e adubação', 'Água e nutriente na medida.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Regar na hora certa',
   E'Água demais mata tanto quanto água de menos:\n\n🌅 **Regue de manhã cedo ou no fim da tarde** — no sol forte a água evapora e pode queimar a folha (efeito lupa).\n💧 **Cheque a terra com o dedo:** se estiver úmida 2–3 cm abaixo, ainda não precisa de água.\n🪴 **Vaso precisa de furo** pra drenar — raiz encharcada apodrece.\n🍂 **Folha amarela e mole** costuma ser excesso de água; **folha seca e murcha**, falta.\n🌱 **Aduba na época de crescimento** (primavera/verão), seguindo a dosagem — adubo demais "queima" a raiz.\n\nConhecer a necessidade de cada planta é o que faz o jardim prosperar.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Qual o melhor horário pra regar?', 'De manhã cedo ou no fim da tarde — evita evaporação e queimar a folha.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'De manhã cedo ou no fim da tarde',TRUE),(v_p,2,'No sol mais forte do meio-dia',FALSE),
  (v_p,3,'Nunca de manhã',FALSE),(v_p,4,'Tanto faz, até no sol a pino',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Folha amarela e mole geralmente indica…', 'Excesso de água — a raiz encharcada sofre.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Excesso de água',TRUE),(v_p,2,'Falta total de água',FALSE),
  (v_p,3,'Excesso de sol sempre',FALSE),(v_p,4,'Nada, é normal',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 3 — Pintura ═══════════════════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('profissao-pintura', 'Pintura com acabamento profissional',
          'Preparo da parede, técnica de rolo e acabamento sem manchas nem respingos.',
          '🎨', '#a855f7', 'diarista', 'basico', 32, 20, 'Acabamento Perfeito', '🎨')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Preparar é metade do serviço', 'Parede e proteção do ambiente.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'A parede tem que estar pronta',
   E'Tinta boa em parede mal preparada descasca rápido. O preparo é o segredo do acabamento:\n\n🧹 **Limpe a parede:** poeira, gordura e mofo impedem a tinta de aderir. Mofo: trate antes (água sanitária diluída) e deixe secar.\n🩹 **Corrija buracos e trincas** com massa; depois lixe pra ficar liso.\n🟦 **Fita crepe** em rodapés, batentes, tomadas e teto pra linha reta e sem borrar.\n🛋️ **Cubra móveis e chão** com lona/jornal — respingo seco é difícil de tirar.\n🎨 **Selador/fundo** em parede nova ou muito clara economiza tinta e uniformiza.\n\nGastar 30 min protegendo o ambiente evita 2 horas limpando respingo depois.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Por que limpar a parede antes de pintar?', 'Poeira, gordura e mofo impedem a tinta de aderir e ela descasca.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Sujeira e mofo impedem a tinta de aderir',TRUE),(v_p,2,'Não precisa limpar',FALSE),
  (v_p,3,'Só pra parede ficar molhada',FALSE),(v_p,4,'Atrapalha a tinta',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Para que serve a fita crepe na hora de pintar?', 'Pra fazer linha reta e não borrar rodapé, batente, tomada e teto.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Fazer linha reta e proteger cantos de borrar',TRUE),(v_p,2,'Decorar a parede',FALSE),
  (v_p,3,'Segurar a tinta no rolo',FALSE),(v_p,4,'Nada de útil',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Técnica de rolo e demãos', 'Cobertura uniforme, sem marca.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Duas demãos finas, não uma grossa',
   E'O acabamento profissional vem da técnica, não da pressa:\n\n🎨 **Dilua a tinta** conforme a embalagem — tinta grossa demais escorre e marca.\n🖌️ **Comece pelos cantos** com pincel (recorte), depois preencha com o rolo.\n🔁 **Rolo em "W" ou "M":** espalhe e depois alise no mesmo sentido, sem apertar demais.\n2️⃣ **Duas demãos finas** cobrem melhor que uma grossa — e secam sem escorrer. Respeite o tempo de secagem entre elas.\n💡 **Mantenha a "borda úmida":** não deixe secar no meio da parede, senão marca a emenda.\n\nPaciência entre demãos é o que dá aquele acabamento liso e uniforme que rende indicação.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'O que dá melhor acabamento?', 'Duas demãos finas, respeitando a secagem — cobrem melhor que uma grossa.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Duas demãos finas, respeitando a secagem',TRUE),(v_p,2,'Uma única demão bem grossa',FALSE),
  (v_p,3,'Tinta pura sem diluir, bem carregada',FALSE),(v_p,4,'Pintar tudo correndo de uma vez',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Por que manter a "borda úmida"?', 'Pra não marcar a emenda quando a tinta seca no meio da parede.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pra não marcar a emenda entre as passadas',TRUE),(v_p,2,'Pra gastar mais tinta',FALSE),
  (v_p,3,'Não importa, sempre marca',FALSE),(v_p,4,'Pra molhar o rolo',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 4 — Pedreiro / Alvenaria ══════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('profissao-alvenaria', 'Alvenaria e pequenos reparos',
          'Massa no traço certo, nível e prumo, e reparos que não voltam a quebrar.',
          '🧱', '#dc2626', 'diarista', 'intermediario', 33, 25, 'Mão de Obra Firme', '🧱')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Massa e traço', 'Cimento, areia e água na proporção.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'O traço faz a resistência',
   E'A "receita" da massa (o traço) define se a obra fica firme ou racha:\n\n🧮 **Traço é proporção:** ex. assentamento comum costuma usar algo em torno de 1 de cimento pra 4–6 de areia + água até dar liga. Reboco e chapisco têm traços próprios.\n💧 **Água na medida:** massa mole demais perde resistência e racha; seca demais não gruda. O ponto é "cremoso", que fica no desempenadeira.\n⏱️ **Use a massa no tempo certo:** cimento começa a "pegar" — não dá pra fazer muito de uma vez e deixar endurecer no carrinho.\n🪣 **Misture bem** até cor e textura uniformes, sem bolotas secas.\n\nMassa no traço certo é o que faz o reparo durar anos, não meses.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'O que acontece com massa com água demais?', 'Perde resistência e racha — o ponto certo é cremoso.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Perde resistência e racha',TRUE),(v_p,2,'Fica mais forte',FALSE),
  (v_p,3,'Seca mais rápido e melhor',FALSE),(v_p,4,'Não muda nada',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'O "traço" da massa é…', 'A proporção entre cimento, areia e água — define a resistência.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'A proporção entre cimento, areia e água',TRUE),(v_p,2,'A cor da massa',FALSE),
  (v_p,3,'O tamanho da colher de pedreiro',FALSE),(v_p,4,'A marca do cimento só',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Nível, prumo e reparos', 'Reto, alinhado e bem feito.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Sem nível e prumo, fica torto',
   E'O que separa o serviço profissional do "quebra-galho" é a checagem:\n\n📏 **Nível** garante a horizontal (piso, prateleira, fiada de tijolo). Use o de bolha ou mangueira de nível.\n📐 **Prumo** garante a vertical (parede, batente reto). Parede fora de prumo entorta tudo.\n🧱 **Assentamento:** junta uniforme, um tijolo travando o outro; cheque nível a cada fiada.\n🩹 **Reparo de trinca:** abra um pouco a trinca, limpe, molhe e preencha — tampar por cima só esconde, e volta a abrir.\n🧽 **Cure o cimento:** mantenha úmido nos primeiros dias pra ganhar resistência e não fissurar.\n\nConferir nível e prumo a cada etapa evita refazer tudo no final.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'O "prumo" serve para garantir o quê?', 'A vertical — que a parede/batente fique reto em pé.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'A vertical (parede reta em pé)',TRUE),(v_p,2,'A cor do tijolo',FALSE),
  (v_p,3,'A temperatura da massa',FALSE),(v_p,4,'O peso do material',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Qual a forma certa de reparar uma trinca?', 'Abrir um pouco, limpar, molhar e preencher — não só tampar por cima.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Abrir, limpar, molhar e preencher direito',TRUE),(v_p,2,'Só passar tinta por cima',FALSE),
  (v_p,3,'Tampar por cima sem limpar',FALSE),(v_p,4,'Ignorar, trinca não volta',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 5 — Eletricista ═══════════════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('profissao-eletrica', 'Elétrica residencial com segurança',
          'Desligar o disjuntor, identificar fios e fazer reparos básicos sem risco.',
          '⚡', '#eab308', 'diarista', 'intermediario', 34, 25, 'Energia Segura', '⚡')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Segurança vem primeiro', 'Sem energia, sem acidente.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Desligue e confirme antes de tocar',
   E'Eletricidade não dá segunda chance. A regra de ouro é trabalhar SEM energia:\n\n🔌 **Desligue o disjuntor** do circuito (ou o geral) antes de mexer em qualquer fio, tomada ou interruptor.\n🧪 **Confirme que está desligado** com uma chave-teste / multímetro — não confie só no botão.\n🧤 **Mãos secas, calçado com sola, chão seco.** Nunca mexa em elétrica com água por perto.\n💍 **Tire anel/relógio** (metal conduz).\n⚠️ **Na dúvida ou serviço grande** (quadro, padrão, fiação nova), chame um eletricista habilitado — algumas coisas exigem profissional registrado.\n\nNenhum reparo é urgente o suficiente pra arriscar um choque. Desligou, testou, aí sim trabalha.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Antes de mexer em qualquer fio ou tomada, você deve…', 'Desligar o disjuntor e confirmar que está sem energia com chave-teste.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Desligar o disjuntor e confirmar que está sem energia',TRUE),(v_p,2,'Mexer com a energia ligada, mais rápido',FALSE),
  (v_p,3,'Só avisar que vai mexer',FALSE),(v_p,4,'Molhar a mão pra "descarregar"',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Diante de um serviço grande (quadro/fiação nova), o certo é…', 'Chamar um eletricista habilitado — algumas coisas exigem profissional registrado.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Chamar/encaminhar a um eletricista habilitado',TRUE),(v_p,2,'Improvisar sozinho de qualquer jeito',FALSE),
  (v_p,3,'Fazer com a energia ligada',FALSE),(v_p,4,'Ignorar as normas',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Reparos básicos', 'Tomada, interruptor e lâmpada.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Trocar tomada e interruptor com método',
   E'Com a energia desligada e confirmada, reparos simples são tranquilos:\n\n📸 **Fotografe a ligação antiga** antes de soltar os fios — é seu mapa pra remontar igual.\n🎨 **Identifique os fios:** fase (geralmente vermelho/preto), neutro (azul) e terra (verde-amarelo). Não troque as posições.\n🔩 **Aperte bem os bornes** — fio frouxo esquenta, derrete e causa curto/incêndio.\n💡 **Lâm, fim de tarde:** queima de lâmpada repetida pode ser mau contato no soquete — verifique.\n🔌 **Teste antes de fechar:** religue o disjuntor, teste, e só então parafuse o espelho/placa.\n🚫 **Sentiu cheiro de queimado, fio derretido ou disjuntor que cai sempre?** É problema maior — encaminhe pra um profissional.\n\nFoto + capricho nos bornes resolvem a maioria dos chamados domésticos com segurança.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Por que fotografar a ligação antes de soltar os fios?', 'Pra ter o mapa e remontar igual, sem trocar as posições.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Pra remontar igual, sem trocar as posições dos fios',TRUE),(v_p,2,'Pra postar nas redes',FALSE),
  (v_p,3,'Não serve pra nada',FALSE),(v_p,4,'Pra mostrar pro disjuntor',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Por que apertar bem os fios nos bornes?', 'Fio frouxo esquenta, pode derreter e causar curto/incêndio.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Fio frouxo esquenta e pode causar curto/incêndio',TRUE),(v_p,2,'Não importa o aperto',FALSE),
  (v_p,3,'Quanto mais frouxo melhor',FALSE),(v_p,4,'Só pra economizar fita',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  -- ╔══ CURSO 6 — Encanador / Hidráulica ════════════════════════════════════╗
  INSERT INTO academy_cursos (slug, titulo, descricao, icone, cor, audiencia, nivel, ordem, pontos_score, selo_titulo, selo_icone)
  VALUES ('profissao-hidraulica', 'Hidráulica: vazamentos e reparos',
          'Fechar o registro, achar o vazamento e trocar peças sem inundar a casa.',
          '🔧', '#3b82f6', 'diarista', 'intermediario', 35, 25, 'Sem Vazamento', '🔧')
  ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, icone=EXCLUDED.icone,
    cor=EXCLUDED.cor, audiencia=EXCLUDED.audiencia, nivel=EXCLUDED.nivel, ordem=EXCLUDED.ordem,
    pontos_score=EXCLUDED.pontos_score, selo_titulo=EXCLUDED.selo_titulo, selo_icone=EXCLUDED.selo_icone
  RETURNING id INTO v_curso;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 1, 'Feche a água primeiro', 'Registro fechado, casa seca.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m1;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m1, 1, 'texto', 'Primeiro passo: fechar o registro',
   E'Antes de abrir qualquer conexão, corte a água — senão é casa inundada:\n\n🚰 **Feche o registro** do ponto (embaixo da pia/vaso) ou o registro geral (cavalete/caixa).\n💧 **Abra a torneira** pra aliviar a pressão e esvaziar o que restou no cano.\n🪣 **Balde e pano embaixo** — sempre sai uma água residual.\n🔎 **Identifique a origem:** pingo na conexão? na rosca? no flexível? Vazamento na parede (mancha de umidade/mofo) é caso mais sério.\n🧻 **Veda rosca com fita veda-rosca** (várias voltas no sentido certo) — sem isso, mesmo apertado vaza.\n\nFechar a água e aliviar a pressão é o que transforma um reparo numa tarefa limpa, sem bagunça.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 1, 'Qual o primeiro passo antes de abrir uma conexão hidráulica?', 'Fechar o registro (do ponto ou o geral) pra cortar a água.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Fechar o registro pra cortar a água',TRUE),(v_p,2,'Abrir tudo com a água ligada',FALSE),
  (v_p,3,'Não precisa fechar nada',FALSE),(v_p,4,'Ligar mais a pressão',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m1, 2, 'Para que serve a fita veda-rosca?', 'Pra vedar a rosca da conexão — sem ela, mesmo apertado vaza.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Vedar a rosca pra não vazar',TRUE),(v_p,2,'Decorar o cano',FALSE),
  (v_p,3,'Aumentar a pressão da água',FALSE),(v_p,4,'Substituir o registro',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;

  INSERT INTO academy_modulos (curso_id, ordem, titulo, descricao)
  VALUES (v_curso, 2, 'Reparos comuns', 'Torneira pingando, sifão e descarga.')
  ON CONFLICT (curso_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao RETURNING id INTO v_m2;
  INSERT INTO academy_aulas (modulo_id, ordem, tipo, titulo, conteudo, tempo_min_seg) VALUES
  (v_m2, 1, 'texto', 'Os campeões de chamado',
   E'A maioria dos reparos hidráulicos domésticos é simples — e muito pedido:\n\n💧 **Torneira pingando:** quase sempre é o "courinho"/vedação gasto. Feche a água, abra a torneira, troque o reparo interno.\n🚽 **Vaso/descarga vazando** (água correndo direto): costuma ser o reparo da caixa acoplada (boia/vedação). Troca-se o kit interno.\n🌀 **Sifão entupido/cheirando:** desrosqueia o copo do sifão (balde embaixo!), limpa a sujeira acumulada e rosqueia de volta.\n🧪 **Ralo/pia lenta:** limpe o cabelo/gordura; evite soda cáustica em excesso (perigosa e corrói).\n🔁 **Testou e ainda vaza?** Reaperte ou troque a vedação — não adianta forçar mais a peça torta.\n\nReparo bem feito não volta na semana seguinte — e é isso que fideliza o cliente.', 30)
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET titulo=EXCLUDED.titulo, conteudo=EXCLUDED.conteudo, tempo_min_seg=EXCLUDED.tempo_min_seg;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 1, 'Torneira pingando geralmente é problema de…', 'O "courinho"/vedação interna gasto — troca-se o reparo.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Vedação/"courinho" interno gasto',TRUE),(v_p,2,'Falta de pressão na rua',FALSE),
  (v_p,3,'Excesso de fita veda-rosca',FALSE),(v_p,4,'Nada, é normal pingar',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
  INSERT INTO academy_perguntas (modulo_id, ordem, pergunta, explicacao) VALUES
  (v_m2, 2, 'Antes de abrir o copo do sifão pra desentupir, o que fazer?', 'Colocar um balde embaixo — vai sair água e sujeira acumulada.')
  ON CONFLICT (modulo_id, ordem) DO UPDATE SET pergunta=EXCLUDED.pergunta, explicacao=EXCLUDED.explicacao RETURNING id INTO v_p;
  INSERT INTO academy_opcoes (pergunta_id, ordem, texto, correta) VALUES
  (v_p,1,'Colocar um balde embaixo pra aparar a água/sujeira',TRUE),(v_p,2,'Abrir direto sem nada embaixo',FALSE),
  (v_p,3,'Ligar a água no máximo',FALSE),(v_p,4,'Quebrar o sifão',FALSE)
  ON CONFLICT (pergunta_id, ordem) DO UPDATE SET texto=EXCLUDED.texto, correta=EXCLUDED.correta;
END $seed$;

-- Verificação:
--   SELECT slug, titulo, ordem FROM academy_cursos WHERE audiencia='diarista' ORDER BY ordem;
--   -- agora inclui os 6 cursos por profissão (ordem 30..35):
--   --   profissao-faxina, profissao-jardinagem, profissao-pintura,
--   --   profissao-alvenaria, profissao-eletrica, profissao-hidraulica.
