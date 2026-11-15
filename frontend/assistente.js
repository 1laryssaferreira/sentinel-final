// ==========================================================
// SENTINEL — motor local do assistente (modo sem IA)
//
// Quando o servidor não tem nenhuma IA configurada (ou está fora
// do ar), o chat usa este motor de regras. Ele reconhece intenções
// por grupos de palavras e sinônimos, pontua cada uma e escolhe a
// mais provável. Não é um modelo de linguagem — por isso o painel
// mostra "Modo local" no cabeçalho do assistente.
//
// As ações usam os MESMOS nomes das ferramentas da IA de verdade
// (definir_porta, gravar_camera...), então o painel executa as
// duas do mesmo jeito.
// ==========================================================

const SentinelAssistente = (() => {
  const normalizar = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function alvoCamera(msg, ctx) {
    const cams = ctx.cameras();
    if (/\b(todas|todos)\b/.test(msg)) return { cams };
    const cam = cams.find(c => msg.includes(normalizar(c.nome)));
    if (cam) return { cams: [cam] };
    if (cams.length === 1) return { cams };
    return { cams: [] };
  }

  function pedirCamera(ctx, verbo) {
    const cams = ctx.cameras();
    if (!cams.length) return 'Nenhuma câmera está ligada. Use “Adicionar câmera” ou conecte um celular.';
    return `Em qual câmera devo ${verbo}? Ligadas agora: ${cams.map(c => c.nome).join(', ')}. Pode dizer “todas”.`;
  }

  const desligar = (msg) => /\b(desliga|desligar|desativa|desativar|para|parar|pare)\b/.test(msg);

  const INTENCOES = [
    { nome: 'saudacao', peso: 1, padroes: [['oi'], ['ola'], ['bom dia'], ['boa tarde'], ['boa noite'], ['e ai']],
      responder: () => 'Olá! Posso dizer como está a casa, trancar a porta, ligar o reconhecimento ou a gravação de uma câmera e acionar socorro. O que você precisa?' },
    { nome: 'agradecimento', peso: 1, padroes: [['obrigad'], ['valeu'], ['brigad']],
      responder: () => 'Por nada. Sigo de olho.' },
    { nome: 'ajuda', peso: 2, padroes: [['ajuda'], ['o que voce faz'], ['comandos'], ['como funciona']],
      responder: () => 'No modo local eu entendo pedidos como: “como está a casa?”, “tranca a porta”, “liga o rosto na câmera da entrada”, ' +
        '“grava o quintal”, “tira uma foto da sala”, “quem entrou?”, “onde estou?”, “chama a polícia”. ' +
        'Com a IA ligada no servidor, você pode conversar livremente.' },
    { nome: 'status', peso: 3, padroes: [['risco'], ['seguranca'], ['tudo bem'], ['como esta'], ['situacao'], ['status']],
      responder(ctx) {
        const e = ctx.estado();
        const alertas = [];
        if (e.portaPrincipal) alertas.push('a porta principal está aberta');
        if (e.janelaSala) alertas.push('a janela da sala está aberta');
        if (e.gasDetectado) alertas.push('há vazamento de gás');
        if (e.incendioDetectado) alertas.push('há fumaça na cozinha');
        const cams = ctx.cameras().length;
        return `Risco em ${ctx.risco()}%. ${alertas.length ? 'Atenção: ' + alertas.join('; ') + '.' : 'Portas e janelas fechadas, sensores normais.'} ` +
          `${cams ? cams + (cams === 1 ? ' câmera ligada.' : ' câmeras ligadas.') : 'Nenhuma câmera ligada.'}`;
      } },
    { nome: 'trancar', peso: 4, padroes: [['tranc'], ['fecha', 'porta'], ['bloque', 'porta']],
      responder(ctx) {
        if (/destranc|abr/.test(ctx.msg)) return null;
        if (!ctx.estado().portaPrincipal) return 'A porta principal já está trancada.';
        ctx.executar('definir_porta', { estado: 'trancada' });
        return 'Porta principal trancada.';
      } },
    { nome: 'destrancar', peso: 5, padroes: [['destranc'], ['abr', 'porta'], ['libera', 'porta']],
      responder(ctx) {
        if (ctx.estado().portaPrincipal) return 'A porta principal já está aberta.';
        ctx.executar('definir_porta', { estado: 'aberta' });
        return 'Porta destrancada. O índice de risco sobe enquanto ela estiver aberta.';
      } },
    { nome: 'rosto', peso: 5, padroes: [['rosto'], ['reconhec'], ['facial'], ['liga a ia'], ['ia em'], ['ia na']],
      responder(ctx) {
        const { cams } = alvoCamera(ctx.msg, ctx);
        if (!cams.length) return pedirCamera(ctx, 'mexer no reconhecimento');
        const ativo = !desligar(ctx.msg);
        cams.forEach(c => ctx.executar('definir_reconhecimento_facial', { camera_id: c.id, ativo }));
        return `Reconhecimento facial ${ativo ? 'ligado' : 'desligado'} em: ${cams.map(c => c.nome).join(', ')}.`;
      } },
    { nome: 'movimento', peso: 5, padroes: [['movimento'], ['mexe']],
      responder(ctx) {
        const { cams } = alvoCamera(ctx.msg, ctx);
        if (!cams.length) return pedirCamera(ctx, 'mexer na detecção de movimento');
        const ativo = !desligar(ctx.msg);
        cams.forEach(c => ctx.executar('definir_deteccao_movimento', { camera_id: c.id, ativo }));
        return `Detecção de movimento ${ativo ? 'ligada' : 'desligada'} em: ${cams.map(c => c.nome).join(', ')}.`;
      } },
    { nome: 'gravar', peso: 5, padroes: [['grav'], ['filma']],
      responder(ctx) {
        const { cams } = alvoCamera(ctx.msg, ctx);
        if (!cams.length) return pedirCamera(ctx, 'gravar');
        const ligar = !desligar(ctx.msg);
        cams.forEach(c => ctx.executar('gravar_camera', { camera_id: c.id, gravar: ligar }));
        return ligar ? `Gravando: ${cams.map(c => c.nome).join(', ')}.` : `Gravação encerrada e salva: ${cams.map(c => c.nome).join(', ')}.`;
      } },
    { nome: 'foto', peso: 5, padroes: [['foto'], ['print'], ['captura'], ['snapshot']],
      responder(ctx) {
        const { cams } = alvoCamera(ctx.msg, ctx);
        if (!cams.length) return pedirCamera(ctx, 'tirar a foto');
        cams.forEach(c => ctx.executar('capturar_foto', { camera_id: c.id }));
        return `Foto tirada: ${cams.map(c => c.nome).join(', ')}.`;
      } },
    { nome: 'cameras', peso: 2, padroes: [['camera'], ['cameras']],
      responder(ctx) {
        const cams = ctx.cameras();
        if (!cams.length) return 'Nenhuma câmera ligada agora.';
        return 'Câmeras ligadas: ' + cams.map(c => `${c.nome}${c.reconhecimento_facial ? ' (rosto)' : ''}${c.deteccao_movimento ? ' (movimento)' : ''}${c.gravando ? ' (gravando)' : ''}`).join(', ') + '.';
      } },
    { nome: 'quem', peso: 4, padroes: [['quem'], ['acesso'], ['entrou'], ['chegou']],
      responder(ctx) {
        const u = ctx.ultimoAcesso();
        return u ? `O último acesso registrado foi: ${u.texto}, na câmera “${u.origem}”. O histórico completo está em “Últimos acessos”.`
          : 'Ainda não registrei nenhum acesso nesta sessão.';
      } },
    { nome: 'local', peso: 3, padroes: [['localiza'], ['onde'], ['gps']],
      responder(ctx) {
        const l = ctx.localizacao();
        return l ? `Posição atual: ${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)} (±${l.precisao} m).` : 'Ainda não recebi a localização do navegador.';
      } },
    { nome: 'policia', peso: 6, padroes: [['policia'], ['190'], ['socorro'], ['ladrao'], ['assalt'], ['invas']],
      responder(ctx) {
        ctx.executar('acionar_emergencia', { servico: 'POLICIA', motivo: 'Pedido pelo assistente' });
        return 'Acionando a Polícia Militar (190). Você tem 5 segundos para cancelar na tela.';
      } },
    { nome: 'bombeiros', peso: 6, padroes: [['bombeiro'], ['193'], ['incendio'], ['fogo']],
      responder(ctx) {
        ctx.executar('acionar_emergencia', { servico: 'BOMBEIROS', motivo: 'Pedido pelo assistente' });
        return 'Acionando o Corpo de Bombeiros (193). Você tem 5 segundos para cancelar na tela.';
      } }
  ];

  function pontuar(intencao, msg) {
    return intencao.padroes.reduce((pts, grupo) => pts + (grupo.every(p => msg.includes(p)) ? 1 : 0), 0) * intencao.peso;
  }

  /** ctx: { estado(), risco(), cameras(), localizacao(), ultimoAcesso(), executar(nome, args) } */
  function processar(texto, ctx) {
    const msg = normalizar(texto);
    const ordenadas = INTENCOES
      .map(i => ({ i, pts: pontuar(i, msg) }))
      .filter(x => x.pts > 0)
      .sort((a, b) => b.pts - a.pts);

    for (const { i } of ordenadas) {
      const resposta = i.responder({ ...ctx, msg });
      if (resposta) return { intent: i.nome, resposta };
    }
    return {
      intent: 'desconhecida',
      resposta: 'Não entendi esse pedido no modo local. Tente algo como “como está a casa?”, “tranca a porta” ou “grava o quintal” — ou digite “ajuda”.'
    };
  }

  return { processar };
})();
