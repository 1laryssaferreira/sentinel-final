// ==========================================================
// SENTINEL 3 — núcleo do painel
//
// Este arquivo cuida de: estado dos sensores, índice de risco,
// protocolo de emergência, histórico, moradores, localização,
// conexão com o back-end (REST + Socket.IO) e avisos na tela.
//
// As câmeras ficam em cameras.js e o assistente em chat.js.
// Os três conversam pelo objeto global `Painel`.
// ==========================================================

const Painel = (() => {
  const API = window.SENTINEL.api;

  // cameras.js carrega depois deste arquivo; `const` global não vira window.X
  const camerasMod = () => (typeof Cameras !== 'undefined' ? Cameras : null);

  // -------------------- utilidades --------------------
  function cabecalhos(extra = {}) {
    const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  }

  async function api(caminho, opcoes = {}) {
    const resposta = await fetch(`${API}${caminho}`, { ...opcoes, headers: cabecalhos(opcoes.headers) });
    if (resposta.status === 401 && caminho !== '/auth/login') {
      aviso('Sua sessão expirou. Entre de novo.', 'atencao');
      setTimeout(() => logoutSentinel(), 1500);
    }
    const corpo = resposta.status === 204 ? null : await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const erro = new Error(corpo?.erro || `HTTP ${resposta.status}`);
      erro.status = resposta.status;
      erro.corpo = corpo;
      throw erro;
    }
    return corpo;
  }

  function escapar(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function horaCurta(data = new Date()) {
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function aviso(texto, tom = 'info', duracao = 4200) {
    const caixa = document.getElementById('avisos');
    const el = document.createElement('div');
    el.className = 'aviso';
    el.dataset.tom = tom;
    el.textContent = texto;
    caixa.appendChild(el);
    setTimeout(() => el.remove(), duracao);
  }

  // -------------------- estado --------------------
  const estado = {
    portaPrincipal: false,      // true = ABERTA
    janelaSala: false,          // true = ABERTA
    incendioDetectado: false,
    gasDetectado: false,
    alertaPolicial: false
  };
  let risco = 10;
  let ultimoAcesso = null;
  let localizacao = null;
  let moradores = [];
  let backendOnline = false;

  const SENSORES = {
    portaPrincipal: { nome: 'Porta principal', ligado: 'Aberta', desligado: 'Trancada', tom: 'atencao', comodo: null },
    janelaSala: { nome: 'Janela da sala', ligado: 'Aberta', desligado: 'Fechada', tom: 'atencao', comodo: 'comodoSala' },
    incendioDetectado: { nome: 'Sensor de fumaça', ligado: 'Fumaça detectada', desligado: 'Normal', tom: 'perigo', comodo: 'comodoCozinha' },
    gasDetectado: { nome: 'Sensor de gás', ligado: 'Vazamento', desligado: 'Normal', tom: 'perigo', comodo: 'comodoCozinha' }
  };

  // -------------------- risco --------------------
  const LIMIAR_CRITICO = 90;
  let protocoloDisparado = false;

  function calcularRisco() {
    let r = 10;
    if (estado.portaPrincipal) r += 25;
    if (estado.janelaSala) r += 20;
    if (estado.gasDetectado) r += 50;
    if (estado.incendioDetectado) r += 70;
    if (estado.alertaPolicial) r += 90;
    return Math.min(r, 100);
  }

  function nivelRisco(r = risco) {
    if (r < 30) return { chave: 'baixo', texto: 'Risco baixo', cor: 'var(--verde)' };
    if (r < 70) return { chave: 'medio', texto: 'Risco moderado', cor: 'var(--ambar)' };
    return { chave: 'alto', texto: 'Risco alto', cor: 'var(--vermelho)' };
  }

  function explicarRisco() {
    const partes = [];
    if (estado.alertaPolicial) partes.push('pessoa procurada detectada');
    if (estado.incendioDetectado) partes.push('fumaça na cozinha');
    if (estado.gasDetectado) partes.push('vazamento de gás');
    if (estado.portaPrincipal) partes.push('porta principal aberta');
    if (estado.janelaSala) partes.push('janela da sala aberta');
    if (!partes.length) return 'Portas e janelas fechadas, sensores sem alerta.';
    const texto = partes.join(', ');
    return texto.charAt(0).toUpperCase() + texto.slice(1) + '.';
  }

  function atualizarRisco() {
    risco = calcularRisco();
    const nivel = nivelRisco();
    const medidor = document.getElementById('medidor');
    medidor.style.setProperty('--risco', risco);
    medidor.style.setProperty('--cor-risco', nivel.cor);
    document.getElementById('riskValue').textContent = `${risco}%`;
    document.getElementById('riskLevel').textContent = nivel.texto;
    document.getElementById('riscoExplica').textContent = explicarRisco();
    const chip = document.getElementById('chipRisco');
    chip.dataset.nivel = nivel.chave;
    document.getElementById('txtRiscoChip').textContent = `${risco}%`;

    if (risco >= LIMIAR_CRITICO && !protocoloDisparado) {
      protocoloDisparado = true;
      const servico = (estado.incendioDetectado || estado.gasDetectado) ? 'BOMBEIROS' : 'POLICIA';
      log('Protocolo automático', `Risco crítico (${risco}%). Acionando ${servico === 'POLICIA' ? 'a polícia' : 'os bombeiros'}.`, 'perigo');
      pedirEmergencia(servico, `Protocolo automático: risco crítico de ${risco}%`, { automatico: true });
    } else if (risco < LIMIAR_CRITICO) {
      protocoloDisparado = false;
    }
  }

  // -------------------- sensores --------------------
  function renderizarSensor(campo) {
    const cfg = SENSORES[campo];
    if (!cfg) return;
    const ativo = estado[campo];
    const tom = ativo ? cfg.tom : '';

    const li = document.querySelector(`#listaSensores li[data-sensor="${campo}"]`);
    if (li) {
      li.classList.remove('alerta', 'atencao');
      if (ativo) li.classList.add(tom === 'perigo' ? 'alerta' : 'atencao');
      li.querySelector('.s-estado').textContent = ativo ? cfg.ligado : cfg.desligado;
    }
    document.querySelectorAll(`.disp[data-sensor="${campo}"]`).forEach(b => {
      b.classList.remove('alerta', 'atencao');
      if (ativo) b.classList.add(tom === 'perigo' ? 'alerta' : 'atencao');
      b.setAttribute('aria-pressed', String(ativo));
    });

    // Destaca o cômodo afetado na planta
    ['comodoSala', 'comodoCozinha'].forEach(id => document.getElementById(id)?.classList.remove('perigo', 'atencao'));
    if (estado.incendioDetectado || estado.gasDetectado) document.getElementById('comodoCozinha')?.classList.add('perigo');
    if (estado.janelaSala) document.getElementById('comodoSala')?.classList.add('atencao');
  }

  /**
   * Muda um sensor. `origem` aparece no histórico.
   * sincronizar=false é usado quando a mudança veio de OUTRO painel
   * (via Socket.IO), pra não mandar de volta pro servidor.
   */
  function definirSensor(campo, valor, { origem = 'Operador', sincronizar = true } = {}) {
    if (!(campo in estado) || estado[campo] === valor) return false;
    estado[campo] = valor;

    renderizarSensor(campo);
    const cfg = SENSORES[campo];

    if (sincronizar) {
      if (cfg) registrarEvento(cfg.nome, `${valor ? cfg.ligado : cfg.desligado} (${origem})`, valor ? cfg.tom : 'ok');
      api(`/sensores/${campo}`, { method: 'PUT', body: JSON.stringify({ estado: valor }) }).catch(() => {});
    }

    if (campo === 'incendioDetectado' && valor && sincronizar) {
      pedirEmergencia('BOMBEIROS', 'Sensor de fumaça disparou na cozinha');
    }
    if (campo === 'gasDetectado' && valor && sincronizar) {
      aviso('Vazamento de gás detectado. Válvula de segurança fechada.', 'perigo', 6000);
    }

    atualizarRisco();
    return true;
  }

  function alternarSensor(campo) {
    definirSensor(campo, !estado[campo]);
  }

  // -------------------- emergência --------------------
  const SERVICOS = {
    POLICIA: { numero: '190', nome: 'Polícia Militar' },
    BOMBEIROS: { numero: '193', nome: 'Corpo de Bombeiros' }
  };
  let emergenciaAtual = null;

  function pedirEmergencia(servico, motivo, { automatico = false } = {}) {
    const cfg = SERVICOS[servico];
    if (!cfg) return;
    if (emergenciaAtual) clearInterval(emergenciaAtual.timer);

    const modal = document.getElementById('emergencyModal');
    const contagem = document.getElementById('emergencyTimer');
    const botao = document.getElementById('btnCancelarEmergencia');
    modal.classList.remove('conectada');
    const relogio = (s) => `00:${String(Math.max(s, 0)).padStart(2, '0')}`;
    const numero = document.getElementById('emergencyNumber');
    if (numero) numero.textContent = cfg.numero;
    document.getElementById('emergencyTitle').textContent = `Alerta simulado · ${cfg.numero} (${cfg.nome})`;
    document.getElementById('emergencyBody').textContent = `Cenário: ${motivo}. A chamada começa em instantes — cancele se for engano.`;
    botao.textContent = 'Cancelar acionamento';
    modal.hidden = false;
    botao.focus();

    let segundos = 5;
    contagem.textContent = relogio(segundos);
    emergenciaAtual = { servico, motivo, automatico, conectada: false, timer: null };

    emergenciaAtual.timer = setInterval(() => {
      segundos--;
      contagem.textContent = relogio(segundos);
      if (segundos > 0) return;

      clearInterval(emergenciaAtual.timer);
      emergenciaAtual.conectada = true;
      modal.classList.add('conectada');
      contagem.textContent = 'Em linha';
      document.getElementById('emergencyTitle').textContent = `${cfg.nome} na linha · ${cfg.numero}`;
      document.getElementById('emergencyBody').textContent = 'Esta é uma demonstração: nenhuma ligação real foi feita. Localização, câmeras ativas e o motivo seguiriam junto com a chamada.';
      botao.textContent = 'Encerrar simulação';
      log('Emergência', `Chamada para ${cfg.numero} conectada — ${motivo}`, 'perigo');
      api('/acionamento', {
        method: 'POST',
        body: JSON.stringify({ servico, motivo, riscoNoMomento: risco, automatico })
      }).catch(() => {});
    }, 1000);
  }

  function fecharEmergencia() {
    if (!emergenciaAtual) return;
    clearInterval(emergenciaAtual.timer);
    if (!emergenciaAtual.conectada) log('Emergência', 'Chamada cancelada pelo operador antes de completar.', 'atencao');
    emergenciaAtual = null;
    document.getElementById('emergencyModal').hidden = true;
  }

  const POLICIA_BANCO = [{ id: 'PROC-8832', nome: 'Carlos "Sombra" Mendes', mandado: 'Art. 157' }];

  function simularProcurado() {
    const procurado = POLICIA_BANCO[0];
    if (camerasMod()) camerasMod().marcarAlertaEmTodas(`Procurado: ${procurado.nome}`);
    registrarAcesso(`Alerta policial (${procurado.id})`, 'Reconhecimento facial');
    api('/controle-acesso/tentativas', { method: 'POST', body: JSON.stringify({ resultado: 'PROCURADO', origem: 'Simulação' }) }).catch(() => {});
    registrarEvento('Alerta policial', `Pessoa com mandado detectada: ${procurado.nome}`, 'perigo');
    definirSensor('alertaPolicial', true, { origem: 'Reconhecimento facial' });
    // o próprio atualizarRisco() dispara o protocolo (risco = 100%)
    setTimeout(() => definirSensor('alertaPolicial', false, { origem: 'Fim da simulação' }), 30000);
  }

  // -------------------- histórico --------------------
  const eventosVistos = new Set();

  function tomDoEvento(tipo = '', status = '') {
    const t = `${tipo} ${status}`.toLowerCase();
    if (/(inc[eê]ndio|fuma[çc]a detectada|vazamento|procurad|emerg|190|193|negado|cr[ií]tico)/.test(t)) return 'perigo';
    if (/(aberta|movimento|aten[çc][aã]o|desconhecid|cancelad)/.test(t)) return 'atencao';
    if (/(trancada|fechada|normal|autorizad|reconhecid|ligada|cadastrad)/.test(t)) return 'ok';
    return '';
  }

  function log(tipo, status, tom, quando = new Date()) {
    const lista = document.getElementById('logFeed');
    const li = document.createElement('li');
    li.dataset.tom = tom ?? tomDoEvento(tipo, status);
    li.innerHTML = `<time>${horaCurta(quando)}</time><span><strong>${escapar(tipo)}</strong> — ${escapar(status)}</span>`;
    lista.prepend(li);
    while (lista.children.length > 120) lista.lastElementChild.remove();
  }

  function renderizarEventoServidor(ev) {
    if (!ev || eventosVistos.has(ev.id)) return;
    eventosVistos.add(ev.id);
    const quando = ev.timestamp ? new Date(String(ev.timestamp).replace(' ', 'T')) : new Date();
    log(ev.tipo, ev.status, undefined, isNaN(quando) ? new Date() : quando);
  }

  /** Registra no MySQL (e mostra na tela). Se o servidor estiver fora, mostra só localmente. */
  async function registrarEvento(tipo, status, tom) {
    try {
      const dados = await api('/eventos', { method: 'POST', body: JSON.stringify({ tipo, status }) });
      if (dados?.log && !eventosVistos.has(dados.log.id)) renderizarEventoServidor(dados.log);
    } catch {
      log(tipo, status, tom);
    }
  }

  async function verificarBackend() {
    try {
      const dados = await api('/eventos?limite=40');
      definirServidor(true);
      [...(dados.logs || [])].reverse().forEach(renderizarEventoServidor);
    } catch {
      definirServidor(false);
    }
  }

  function definirServidor(online) {
    const mudou = online !== backendOnline;
    backendOnline = online;
    const chip = document.getElementById('chipServidor');
    chip.dataset.estado = online ? 'online' : 'offline';
    document.getElementById('txtServidor').textContent = online ? 'online' : 'fora do ar';
    if (mudou && !online) aviso('Sem conexão com o servidor. O painel segue funcionando, mas sem salvar no banco.', 'atencao', 6000);
  }

  // -------------------- moradores e acessos --------------------
  function registrarAcesso(texto, origem) {
    ultimoAcesso = { texto, origem, quando: new Date().toISOString() };
    document.getElementById('lastAccess').textContent = `${texto} · ${horaCurta()}`;
  }

  async function carregarControleAcesso() {
    const listaR = document.getElementById('listaResidentes');
    const listaT = document.getElementById('listaTentativas');
    try {
      const [residentes, tentativas] = await Promise.all([
        api('/controle-acesso/residentes'),
        api('/controle-acesso/tentativas?limite=15')
      ]);
      moradores = residentes || [];
      listaR.innerHTML = moradores.length
        ? moradores.map(r => `
            <li>
              <span class="morador-inicial" aria-hidden="true">${escapar((r.nome || '?').trim()[0]?.toUpperCase())}</span>
              <span class="morador-info"><strong>${escapar(r.nome)}</strong><small>${escapar(r.documento_id || 'Rosto cadastrado')}</small></span>
              <button class="icone-botao morador-remover" type="button" data-remover="${r.id}" aria-label="Remover ${escapar(r.nome)}" title="Remover">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
              </button>
            </li>`).join('')
        : '<li class="vazio">Ninguém cadastrado. Abra uma câmera e use “Memorizar rosto”.</li>';

      listaT.innerHTML = (tentativas || []).length
        ? tentativas.map(t => {
            const tom = t.resultado === 'AUTORIZADO' ? 'ok' : t.resultado === 'NEGADO' ? 'atencao' : 'perigo';
            const rotulo = { AUTORIZADO: 'Liberado', NEGADO: 'Não reconhecido', PROCURADO: 'Procurado' }[t.resultado] || t.resultado;
            return `<li data-tom="${tom}"><time>${escapar((t.criado_em || '').substring(11, 16))}</time><span><strong>${rotulo}</strong> — ${escapar(t.residente_nome || 'pessoa desconhecida')} <small>(${escapar(t.origem)})</small></span></li>`;
          }).join('')
        : '<li class="vazio">Nenhum acesso registrado ainda.</li>';
    } catch {
      if (!moradores.length) listaR.innerHTML = '<li class="vazio">Servidor fora do ar — não foi possível carregar os moradores.</li>';
    }
  }

  document.addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-remover]');
    if (!botao) return;
    const nome = botao.closest('li')?.querySelector('strong')?.textContent || 'este morador';
    if (!confirm(`Remover ${nome}? O rosto deixa de ser reconhecido.`)) return;
    try {
      await api(`/controle-acesso/residentes/${botao.dataset.remover}`, { method: 'DELETE' });
      aviso(`${nome} removido.`, 'ok');
      registrarEvento('Moradores', `${nome} removido do controle de acesso`, 'atencao');
      carregarControleAcesso();
    } catch (erro) {
      aviso(`Não foi possível remover: ${erro.message}`, 'perigo');
    }
  });

  // -------------------- localização --------------------
  let ultimoEnvioGeo = 0;
  function iniciarGeolocalizacao() {
    const status = document.getElementById('geoStatus');
    if (!('geolocation' in navigator)) {
      status.textContent = 'Este navegador não informa localização.';
      return;
    }
    navigator.geolocation.watchPosition((pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      localizacao = { latitude, longitude, precisao: Math.round(accuracy) };
      document.getElementById('geoLatitude').textContent = latitude.toFixed(5);
      document.getElementById('geoLongitude').textContent = longitude.toFixed(5);
      document.getElementById('geoPrecisao').textContent = `±${Math.round(accuracy)} m`;
      status.textContent = 'Atualizando em tempo real.';
      const link = document.getElementById('geoMapLink');
      link.href = `https://www.google.com/maps?q=${latitude},${longitude}`;
      link.hidden = false;
      if (Date.now() - ultimoEnvioGeo > 15000) {
        ultimoEnvioGeo = Date.now();
        api('/localizacao', { method: 'POST', body: JSON.stringify({ latitude, longitude, precisao: accuracy, origem: 'Painel' }) }).catch(() => {});
      }
    }, (erro) => {
      status.textContent = erro.code === 1
        ? 'Permissão de localização negada. Libere no ícone de cadeado do navegador.'
        : `Não foi possível obter a localização (${erro.message}).`;
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }

  // -------------------- tempo real (Socket.IO) --------------------
  let socket = null;
  const ouvintesSocket = [];

  function carregarScript(src) {
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = falha;
      document.head.appendChild(s);
    });
  }

  async function conectarTempoReal() {
    if (typeof io === 'undefined') {
      try {
        await carregarScript(`${window.SENTINEL.origem}/socket.io/socket.io.js`);
      } catch {
        try { await carregarScript('https://cdn.socket.io/4.8.1/socket.io.min.js'); } catch { return; }
      }
    }
    socket = io(window.SENTINEL.origem, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('painel:entrar', window.SENTINEL.sala);
      definirServidor(true);
    });
    socket.on('disconnect', () => definirServidor(false));
    socket.on('evento:novo', renderizarEventoServidor);
    socket.on('acesso:novo', () => carregarControleAcesso());
    socket.on('residente:novo', () => carregarControleAcesso());
    socket.on('sensores:atualizados', ({ estado: remoto }) => {
      for (const campo of Object.keys(remoto || {})) {
        if (typeof remoto[campo] === 'boolean') definirSensor(campo, remoto[campo], { sincronizar: false });
      }
    });
    ouvintesSocket.forEach(fn => fn(socket));
  }

  function aoConectarSocket(fn) {
    if (socket) fn(socket);
    ouvintesSocket.push(fn);
  }

  // -------------------- para o assistente --------------------
  function obterEstadoParaIA() {
    const historicoNaTela = [...document.querySelectorAll('#logFeed li')].slice(0, 10).map(li => li.textContent.trim());
    return {
      sensores: {
        porta_principal: estado.portaPrincipal ? 'aberta' : 'trancada',
        janela_sala: estado.janelaSala ? 'aberta' : 'fechada',
        fumaca: estado.incendioDetectado ? 'DETECTADA' : 'normal',
        gas: estado.gasDetectado ? 'VAZAMENTO' : 'normal',
        alerta_policial: estado.alertaPolicial
      },
      risco_percentual: risco,
      nivel_risco: nivelRisco().texto,
      cameras: camerasMod() ? camerasMod().listar() : [],
      moradores_cadastrados: moradores.map(m => m.nome),
      ultimo_acesso: ultimoAcesso,
      localizacao,
      servidor_online: backendOnline,
      emergencia_em_andamento: emergenciaAtual ? { servico: emergenciaAtual.servico, conectada: emergenciaAtual.conectada } : null,
      ultimos_eventos_na_tela: historicoNaTela
    };
  }

  const SECOES = { cameras: 'cameras', planta: 'planta', acesso: 'acesso', eventos: 'eventos', localizacao: 'localizacao' };

  /** Executa uma ação pedida pela IA. Devolve um rótulo curto pra mostrar no chat (ou null). */
  function executarAcao(nome, args = {}) {
    switch (nome) {
      case 'definir_porta': {
        const abrir = String(args.estado).toLowerCase().startsWith('abert');
        definirSensor('portaPrincipal', abrir, { origem: 'Assistente' });
        return abrir ? 'Porta destrancada' : 'Porta trancada';
      }
      case 'definir_reconhecimento_facial':
        return camerasMod()?.definirIA(args.camera_id, args.ativo !== false);
      case 'definir_deteccao_movimento':
        return camerasMod()?.definirMovimento(args.camera_id, args.ativo !== false);
      case 'capturar_foto':
        return camerasMod()?.capturar(args.camera_id);
      case 'gravar_camera':
        return camerasMod()?.gravar(args.camera_id, args.gravar !== false);
      case 'abrir_secao': {
        const alvo = document.getElementById(SECOES[args.secao] || 'cameras');
        alvo?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return null;
      }
      case 'acionar_emergencia':
        pedirEmergencia(args.servico === 'BOMBEIROS' ? 'BOMBEIROS' : 'POLICIA', args.motivo || 'Pedido pelo assistente');
        return args.servico === 'BOMBEIROS' ? 'Bombeiros acionados' : 'Polícia acionada';
      default:
        return null;
    }
  }

  // -------------------- navegação e cabeçalho --------------------
  function iniciarNavegacao() {
    const links = [...document.querySelectorAll('.trilho-nav a')];
    const alvos = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach(en => {
        if (!en.isIntersecting) return;
        links.forEach(a => a.classList.toggle('ativo', a.getAttribute('href') === `#${en.target.id}`));
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    alvos.forEach(a => observador.observe(a));
  }

  function atualizarSaudacao() {
    const h = new Date().getHours();
    const parte = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const nome = (getSession()?.nome || '').split(' ')[0];
    const n = camerasMod() ? camerasMod().listar().length : 0;
    const cams = n === 0 ? 'nenhuma câmera ligada' : n === 1 ? '1 câmera ligada' : `${n} câmeras ligadas`;
    document.getElementById('saudacao').textContent = `${parte}${nome ? ', ' + nome : ''}. ${cams.charAt(0).toUpperCase() + cams.slice(1)}.`;
  }

  // -------------------- controles da interface (layout do Figma) --------------------
  function iniciarControles() {
    // Botão "Emergência" do topo abre a escolha de serviço
    const dlg = document.getElementById('dlgEmergencia');
    document.getElementById('btnEmergencia')?.addEventListener('click', () => dlg?.showModal());
    dlg?.querySelectorAll('[data-servico]').forEach(b => b.addEventListener('click', () => {
      dlg.close();
      pedirEmergencia(b.dataset.servico, 'Acionamento manual pelo operador');
    }));
    document.getElementById('btnSimularProcurado')?.addEventListener('click', () => {
      dlg?.close();
      simularProcurado();
    });

    // Zoom da planta: 50% a 200%
    const palco = document.getElementById('plantaPalco');
    const valor = document.getElementById('zoomValor');
    let zoom = 100;
    document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
      const passo = Number(b.dataset.zoom);
      zoom = passo === 0 ? 100 : Math.min(200, Math.max(50, zoom + passo * 25));
      palco?.style.setProperty('--zoom', zoom / 100);
      if (valor) valor.textContent = zoom;
    }));

    // Recolher "Atividade recente"
    const btnAtiv = document.getElementById('btnRecolherAtividade');
    btnAtiv?.addEventListener('click', () => {
      const aberto = btnAtiv.getAttribute('aria-expanded') === 'true';
      btnAtiv.setAttribute('aria-expanded', String(!aberto));
      btnAtiv.setAttribute('aria-label', aberto ? 'Mostrar atividade' : 'Recolher atividade');
      document.getElementById('logFeed').hidden = aberto;
    });

    // Alça do assistente: recolhe e expande a conversa
    const assistente = document.getElementById('assistente');
    const alca = document.getElementById('btnFecharChat');
    alca?.addEventListener('click', () => {
      const recolher = !assistente.classList.contains('recolhido');
      assistente.classList.toggle('recolhido', recolher);
      alca.setAttribute('aria-expanded', String(!recolher));
      alca.title = recolher ? 'Abrir assistente' : 'Recolher assistente';
    });
    document.getElementById('btnAbrirChat')?.addEventListener('click', () => {
      assistente.classList.remove('recolhido');
      alca?.setAttribute('aria-expanded', 'true');
      assistente.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('chatInput')?.focus({ preventScroll: true });
    });
  }

  // -------------------- início --------------------
  window.addEventListener('DOMContentLoaded', () => {
    iniciarControles();
    document.getElementById('btnCancelarEmergencia').addEventListener('click', fecharEmergencia);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && emergenciaAtual) fecharEmergencia(); });
    Object.keys(SENSORES).forEach(renderizarSensor);
    atualizarRisco();
    atualizarSaudacao();
    iniciarNavegacao();
    verificarBackend();
    carregarControleAcesso();
    iniciarGeolocalizacao();
    conectarTempoReal();
    api('/sensores').then(d => {
      for (const campo of Object.keys(d?.estado || {})) {
        if (typeof d.estado[campo] === 'boolean') definirSensor(campo, d.estado[campo], { sincronizar: false });
      }
    }).catch(() => {});
    setInterval(verificarBackend, 30000);
    setInterval(atualizarSaudacao, 60000);
  });

  return {
    api, aviso, log, escapar, horaCurta,
    registrarEvento, registrarAcesso, carregarControleAcesso, verificarBackend,
    definirSensor, alternarSensor, pedirEmergencia, simularProcurado,
    obterEstado: () => ({ ...estado }), obterRisco: () => risco, obterLocalizacao: () => localizacao, obterUltimoAcesso: () => ultimoAcesso,
    obterEstadoParaIA, executarAcao, aoConectarSocket, atualizarSaudacao
  };
})();
