// ==========================================================
// SENTINEL 3 — central de câmeras
//
// O que mudou em relação à v2:
//  - várias câmeras do computador ao mesmo tempo (escolhe o
//    dispositivo, o nome e a qualidade), e o painel lembra delas;
//  - reconhecimento facial de VÁRIOS rostos por quadro, com caixa
//    e nome desenhados por cima do vídeo;
//  - detecção de movimento por diferença entre quadros, com foto
//    automática na linha do tempo;
//  - foto (com data/hora gravada na imagem, como um DVR) e gravação
//    de vídeo em .webm de qualquer câmera, inclusive a do celular;
//  - layout 1 / 2×2 / 3×3, câmera em destaque e tela cheia;
//  - celular conectado por QR Code, com troca de câmera, lanterna
//    e bateria vindos do próprio celular.
// ==========================================================

const Cameras = (() => {
  const cams = new Map();
  const parede = () => document.getElementById('paredeCameras');
  const PREFS = 'sentinel_cameras_v3';
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  // Biblioteca e modelos dentro do projeto: o reconhecimento funciona sem internet.
  const MODELOS = 'vendor/modelos';

  let iaPronta = false;
  let iaCarregando = null;
  let socket = null;

  // ---------------------------------------------------------
  // utilidades
  // ---------------------------------------------------------
  const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const carimbo = () => {
    const d = new Date();
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
  };
  const nomeArquivo = (cam, ext) => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `sentinel-${normalizar(cam.nome).replace(/[^a-z0-9]+/g, '-')}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  };
  const baixar = (url, nome) => {
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const distancia = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  };

  function status(cam, texto, tom = '') {
    const el = cam.tile.querySelector('.tile-status');
    el.textContent = texto || '';
    el.dataset.tom = tom;
  }

  function lerPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS)) || []; } catch { return []; }
  }
  function salvarPrefs(lista) {
    try { localStorage.setItem(PREFS, JSON.stringify(lista)); } catch { /* armazenamento indisponível */ }
  }

  // ---------------------------------------------------------
  // modelos de IA (face-api.js)
  // ---------------------------------------------------------
  function carregarIA() {
    if (iaPronta) return Promise.resolve(true);
    if (iaCarregando) return iaCarregando;
    iaCarregando = (async () => {
      for (let i = 0; i < 40 && typeof faceapi === 'undefined'; i++) await new Promise(r => setTimeout(r, 250));
      if (typeof faceapi === 'undefined') throw new Error('face-api.js não carregou (sem internet?)');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODELOS),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELOS)
      ]);
      iaPronta = true;
      return true;
    })().catch((erro) => {
      iaCarregando = null;
      Painel.aviso('Não foi possível carregar a IA de rosto. Confira a internet e tente de novo.', 'perigo');
      console.error(erro);
      return false;
    });
    return iaCarregando;
  }

  const opcoesDetector = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

  // ---------------------------------------------------------
  // tile (o quadrinho de cada câmera)
  // ---------------------------------------------------------
  const ICONES = {
    rosto: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="11" r="3"/><path d="M8 17c1-1.5 2.4-2 4-2s3 .5 4 2"/></svg>',
    mov: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    cadastrar: '<svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4"/><path d="M3 21c0-4 3-6 7-6M17 14v6M14 17h6"/></svg>',
    foto: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    gravar: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>',
    trocar: '<svg viewBox="0 0 24 24"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>',
    lanterna: '<svg viewBox="0 0 24 24"><path d="M8 3h8l-1 6H9zM9 9l1 12h4l1-12"/></svg>',
    expandir: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    cheia: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 10V8h2M16 10V8h-2M8 14v2h2M16 14v2h-2"/></svg>',
    fechar: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  function criarTile(cam) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = `tile-${cam.id}`;
    tile.dataset.id = cam.id;
    const extrasCelular = cam.tipo === 'celular'
      ? `<button class="tb tb-icone" data-acao="trocar" title="Trocar câmera do celular" aria-label="Trocar câmera do celular">${ICONES.trocar}</button>
         <button class="tb tb-icone" data-acao="lanterna" title="Lanterna" aria-label="Lanterna" aria-pressed="false" hidden>${ICONES.lanterna}</button>`
      : '';
    const origem = cam.tipo === 'celular' ? 'Câmera do celular' : 'Webcam do computador';
    tile.innerHTML = `
      <div class="tile-cabeca">
        <div>
          <p class="tile-cabeca-sub">Monitoramento · ${origem}</p>
          <h3 class="tile-cabeca-titulo">Visualização · <span class="t-nome-modal"></span></h3>
        </div>
        <button class="tile-fechar" data-acao="fechar-ampliada" title="Fechar" aria-label="Fechar visualização">${ICONES.fechar}</button>
      </div>
      <div class="tile-tela">
        <video autoplay muted playsinline></video>
        <canvas class="sobreposicao" aria-hidden="true"></canvas>
        <div class="tile-carregando">${cam.tipo === 'celular' ? 'Conectando ao celular…' : 'Ligando câmera…'}</div>
        <div class="tile-osd">
          <span class="tile-nome osd"><span class="t-nome"></span><span class="tile-tipo">${cam.tipo === 'celular' ? 'CELULAR' : 'PC'}</span></span>
          <span class="tile-dir"><span class="rec osd">REC</span><span class="bateria osd"></span><span class="osd relogio"></span></span>
        </div>
        <div class="tile-status"></div>
        <div class="tile-barra">
          <button class="tb" data-acao="ia" aria-pressed="false" title="Reconhecimento facial">${ICONES.rosto}<span class="tb-texto">Rosto</span></button>
          <button class="tb tb-mov" data-acao="mov" aria-pressed="false" title="Detecção de movimento">${ICONES.mov}<span class="tb-texto">Movimento</span></button>
          <span class="tb-dir">
            <button class="tb tb-icone" data-acao="foto" title="Tirar foto" aria-label="Tirar foto">${ICONES.foto}</button>
            <button class="tb tb-icone tb-gravar" data-acao="gravar" aria-pressed="false" title="Gravar vídeo" aria-label="Gravar vídeo">${ICONES.gravar}</button>
            ${extrasCelular}
            <button class="tb tb-icone" data-acao="expandir" title="Destacar na grade" aria-label="Destacar câmera na grade">${ICONES.expandir}</button>
            <button class="tb tb-icone" data-acao="cheia" title="Tela cheia" aria-label="Tela cheia">${ICONES.cheia}</button>
            ${cam.tipo === 'local' ? `<button class="tb tb-icone" data-acao="remover" title="Desligar câmera" aria-label="Desligar câmera">${ICONES.fechar}</button>` : ''}
          </span>
        </div>
      </div>
      <div class="tile-rodape">
        <span class="tile-rotulo"></span>
        <span class="tile-estado">Ao vivo</span>
      </div>
      <div class="tile-modal-acoes">
        <button class="mbtn mbtn-rosto" data-acao="cadastrar">Memorizar rosto</button>
        <button class="mbtn mbtn-ia" data-acao="ia" aria-pressed="false"><span class="se-off">Ativar IA</span><span class="se-on">Desativar IA</span></button>
        <button class="mbtn mbtn-proc" data-acao="procurado">Simular procurado</button>
      </div>`;
    tile.querySelector('.t-nome').textContent = cam.nome.toUpperCase();
    tile.querySelector('.t-nome-modal').textContent = cam.nome;
    tile.querySelector('.tile-rotulo').textContent = cam.nome;
    tile.querySelector('video').addEventListener('loadeddata', () => tile.querySelector('.tile-carregando')?.remove(), { once: true });
    document.getElementById('paredeVazia').hidden = true;
    parede().appendChild(tile);
    return tile;
  }

  function registrar(cam) {
    cam.tile = criarTile(cam);
    cam.video = cam.tile.querySelector('video');
    cam.canvas = cam.tile.querySelector('canvas');
    cam.ia = false;
    cam.mov = false;
    cam.gravador = null;
    cam.rostos = [];          // última leitura (para desenhar)
    cam.rostosEm = 0;
    cam.caixaMov = null;
    cam.movEm = 0;
    cams.set(cam.id, cam);
    atualizarResumo();
    return cam;
  }

  function remover(id) {
    const cam = cams.get(id);
    if (!cam) return;
    if (cam.gravador?.state === 'recording') cam.gravador.stop();
    if (cam.tipo === 'local') cam.stream?.getTracks().forEach(t => t.stop());
    cam.pc?.close();
    if (cam.tile.classList.contains('ampliada')) fecharAmpliada();
    cam.tile.remove();
    cams.delete(id);
    if (!cams.size) document.getElementById('paredeVazia').hidden = false;
    atualizarResumo();
  }

  function atualizarResumo() {
    const n = cams.size;
    const ia = [...cams.values()].filter(c => c.ia).length;
    const mov = [...cams.values()].filter(c => c.mov).length;
    const partes = [n === 0 ? 'Nenhuma câmera ligada' : n === 1 ? '1 câmera ligada' : `${n} câmeras ligadas`];
    if (ia) partes.push(`rosto em ${ia}`);
    if (mov) partes.push(`movimento em ${mov}`);
    document.getElementById('resumoCameras').textContent = partes.join(' · ');
    const temFoco = !!parede().querySelector('.tile.em-foco');
    parede().classList.toggle('tem-foco', temFoco);
    Painel.atualizarSaudacao?.();
  }

  // ---------------------------------------------------------
  // câmeras deste computador
  // ---------------------------------------------------------
  const QUALIDADES = { 480: { width: 640, height: 480 }, 720: { width: 1280, height: 720 }, 1080: { width: 1920, height: 1080 } };

  async function abrirStream(deviceId, qualidade) {
    const tamanho = QUALIDADES[qualidade] || QUALIDADES[720];
    const video = {
      width: { ideal: tamanho.width }, height: { ideal: tamanho.height }, frameRate: { ideal: 24 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    };
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (erro) {
      if (erro.name === 'OverconstrainedError') {
        return navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
      }
      throw erro;
    }
  }

  function mensagemErroCamera(erro) {
    switch (erro?.name) {
      case 'NotAllowedError': return 'Permissão negada. Clique no cadeado ao lado do endereço e libere a câmera.';
      case 'NotFoundError': return 'Nenhuma câmera encontrada neste computador.';
      case 'NotReadableError': return 'A câmera está sendo usada por outro programa (Zoom, Teams, OBS…). Feche-o e tente de novo.';
      case 'SecurityError': return 'O navegador só libera a câmera em localhost ou HTTPS.';
      default: return `Não foi possível ligar a câmera (${erro?.message || 'erro desconhecido'}).`;
    }
  }

  async function ligarLocal({ deviceId = '', nome, qualidade = 720, lembrar = true, silencioso = false }) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não dá acesso à câmera.');
    const emUso = [...cams.values()].find(c => c.tipo === 'local' && deviceId && c.deviceId === deviceId);
    if (emUso) throw new Error(`Esse dispositivo já está ligado como “${emUso.nome}”.`);

    const stream = await abrirStream(deviceId, qualidade);
    const track = stream.getVideoTracks()[0];
    const realId = track.getSettings().deviceId || deviceId;
    const repetida = [...cams.values()].find(c => c.tipo === 'local' && c.deviceId === realId);
    if (repetida) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error(`Essa câmera já está ligada como “${repetida.nome}”. Escolha outro dispositivo na lista.`);
    }
    const id = `pc-${Math.random().toString(36).slice(2, 8)}`;
    const cam = registrar({ id, nome: nome || track.label || 'Câmera', tipo: 'local', deviceId: realId, qualidade, stream });
    cam.video.srcObject = stream;
    track.addEventListener('ended', () => status(cam, 'Câmera desconectada do computador', 'perigo'));

    if (lembrar) {
      const prefs = lerPrefs().filter(p => p.deviceId !== realId);
      prefs.push({ deviceId: realId, rotulo: track.label, nome: cam.nome, qualidade });
      salvarPrefs(prefs);
    }
    if (!silencioso) Painel.registrarEvento('Câmeras', `“${cam.nome}” ligada neste computador`, 'ok');
    return cam;
  }

  function desligarLocal(id) {
    const cam = cams.get(id);
    if (!cam) return;
    salvarPrefs(lerPrefs().filter(p => p.deviceId !== cam.deviceId));
    Painel.registrarEvento('Câmeras', `“${cam.nome}” desligada`, 'atencao');
    remover(id);
  }

  async function religarLembradas() {
    const prefs = lerPrefs();
    if (!prefs.length) return;
    let permitido = false;
    try {
      permitido = (await navigator.permissions?.query({ name: 'camera' }))?.state === 'granted';
    } catch { /* Firefox/Safari antigos não suportam essa consulta */ }
    if (!permitido) {
      Painel.aviso(`${prefs.length === 1 ? 'Uma câmera lembrada' : prefs.length + ' câmeras lembradas'}: toque em “Adicionar câmera” para religar.`, 'info', 6000);
      return;
    }
    for (const p of prefs) {
      try {
        await ligarLocal({ ...p, lembrar: false, silencioso: true });
      } catch (erro) {
        // O id do dispositivo pode mudar (outra porta USB, navegador limpou
        // os dados). Tenta achar a mesma câmera pelo nome do aparelho.
        try {
          const lista = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
          const mesma = lista.find(d => p.rotulo && d.label === p.rotulo);
          if (!mesma) throw erro;
          await ligarLocal({ ...p, deviceId: mesma.deviceId, silencioso: true });
        } catch {
          Painel.aviso(`Não consegui religar “${p.nome}”. Ela está conectada?`, 'atencao');
        }
      }
    }
  }

  async function abrirDialogoAdicionar(nomeSugerido = '') {
    const dlg = document.getElementById('dlgAdicionar');
    const sel = document.getElementById('selDispositivo');
    const erro = document.getElementById('erroAdicionar');
    erro.hidden = true;
    document.getElementById('inpNomeCamera').value = nomeSugerido;
    sel.innerHTML = '<option value="">Câmera padrão</option>';
    try {
      const dispositivos = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const emUso = new Set([...cams.values()].map(c => c.deviceId));
      dispositivos.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = (d.label || `Câmera ${i + 1}`) + (emUso.has(d.deviceId) ? ' (em uso)' : '');
        opt.disabled = emUso.has(d.deviceId);
        sel.appendChild(opt);
      });
    } catch { /* lista indisponível: fica só "Câmera padrão" */ }
    dlg.showModal();
  }

  // ---------------------------------------------------------
  // celular (WebRTC) — recebe vídeo de celular.html
  // ---------------------------------------------------------
  function conectarSinalizacao(s) {
    socket = s;
    s.on('camera:nova', ({ socketId, nome, recursos }) => {
      if (cams.has(socketId)) remover(socketId);
      const cam = registrar({ id: socketId, nome: nome || 'Celular', tipo: 'celular', recursos: recursos || {} });
      if (recursos?.lanterna) cam.tile.querySelector('[data-acao="lanterna"]').hidden = false;
      negociar(cam);
      Painel.registrarEvento('Câmeras', `Celular “${cam.nome}” conectado`, 'ok');
    });
    s.on('camera:saiu', ({ socketId }) => {
      const cam = cams.get(socketId);
      if (!cam) return;
      Painel.registrarEvento('Câmeras', `Celular “${cam.nome}” desconectou`, 'atencao');
      remover(socketId);
    });
    s.on('sinal:answer', async ({ deSocketId, answer }) => {
      const cam = cams.get(deSocketId);
      if (!cam?.pc) return;
      await cam.pc.setRemoteDescription(answer);
      for (const c of cam.iceFila.splice(0)) cam.pc.addIceCandidate(c).catch(() => {});
    });
    s.on('sinal:ice-candidate', ({ deSocketId, candidate }) => {
      const cam = cams.get(deSocketId);
      if (!cam?.pc || !candidate) return;
      if (cam.pc.remoteDescription) cam.pc.addIceCandidate(candidate).catch(() => {});
      else cam.iceFila.push(candidate);
    });
    s.on('camera:status', (info) => {
      const cam = cams.get(info.socketId);
      if (!cam) return;
      if (typeof info.bateria === 'number') {
        cam.tile.querySelector('.bateria').textContent = `${Math.round(info.bateria * 100)}%${info.carregando ? '+' : ''}`;
      }
      const lanterna = cam.tile.querySelector('[data-acao="lanterna"]');
      if (lanterna) {
        if ('lanternaDisponivel' in info) lanterna.hidden = !info.lanternaDisponivel;
        if ('lanterna' in info) lanterna.setAttribute('aria-pressed', String(!!info.lanterna));
      }
    });
  }

  async function negociar(cam, tentativa = 0) {
    cam.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    cam.pc = pc;
    cam.iceFila = [];
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (ev) => {
      cam.stream = ev.streams[0] || new MediaStream([ev.track]);
      cam.video.srcObject = cam.stream;
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit('sinal:ice-candidate', { paraSocketId: cam.id, candidate: ev.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (cam.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') status(cam, '');
      if (st === 'disconnected') status(cam, 'Sinal instável…', 'atencao');
      if (st === 'failed' && tentativa < 2) {
        status(cam, 'Reconectando…', 'atencao');
        setTimeout(() => cams.has(cam.id) && negociar(cam, tentativa + 1), 1500);
      } else if (st === 'failed') {
        status(cam, 'Sem vídeo. Confira se os dois aparelhos estão no mesmo Wi-Fi.', 'perigo');
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('sinal:offer', { paraSocketId: cam.id, offer });
  }

  function comandoCelular(cam, comando, valor) {
    socket?.emit('camera:comando', { paraSocketId: cam.id, comando, valor });
  }

  async function abrirDialogoCelular() {
    const dlg = document.getElementById('dlgCelular');
    const urlEl = document.getElementById('urlCelular');
    const qrEl = document.getElementById('qrCelular');
    const aviso = document.getElementById('avisoHttps');
    dlg.showModal();
    urlEl.textContent = 'carregando…';
    qrEl.textContent = '';
    try {
      const rede = await Painel.api('/sistema/rede');
      const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
      const ip = local ? (rede.ips[0] || location.hostname) : location.hostname;
      // Publicado na internet (sem porta no endereço): o celular usa o mesmo site.
      const publicado = !local && location.port === '';
      const url = publicado
        ? `${location.origin}/celular.html`
        : rede.portaHttps
          ? `https://${ip}:${rede.portaHttps}/celular.html`
          : `http://${ip}:${rede.portaHttp}/celular.html`;
      urlEl.textContent = url;
      aviso.hidden = publicado ? location.protocol === 'https:' : !!rede.portaHttps;
      if (typeof qrcode === 'function') {
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        qrEl.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      } else {
        qrEl.textContent = 'Digite o endereço abaixo no navegador do celular.';
      }
    } catch {
      urlEl.textContent = 'Servidor fora do ar';
      qrEl.textContent = 'Ligue o back-end (npm run dev) para gerar o QR Code.';
    }
  }

  // ---------------------------------------------------------
  // reconhecimento facial
  // ---------------------------------------------------------
  // Leituras seguidas que precisam concordar antes de liberar alguém.
  // Uma leitura só pode errar (luz, ângulo, rosto em movimento).
  const CONFIRMACOES = 3;
  // Rostos pequenos (longe da câmera) geram leituras ruins: são ignorados.
  const ROSTO_MIN_LARGURA = 90;   // pixels
  const ultimoRegistro = new Map(); // `${camId}:${chave}` -> timestamp
  let filaIA = [];
  let processando = false;
  const portaReabre = { timer: null };

  async function definirIA(idOuNome, ativo = true) {
    const alvos = resolverVarios(idOuNome);
    if (!alvos.length) return null;
    if (ativo && !(await carregarIA())) return null;
    alvos.forEach(cam => {
      cam.ia = ativo;
      cam.tile.querySelectorAll('[data-acao="ia"]').forEach(b => b.setAttribute('aria-pressed', String(ativo)));
      if (!ativo) { cam.rostos = []; cam.votos = null; cam.tile.classList.remove('reconhecido'); status(cam, ''); }
      else status(cam, 'Procurando rostos…');
    });
    atualizarResumo();
    const nomes = alvos.map(c => c.nome).join(', ');
    return `Rosto ${ativo ? 'ligado' : 'desligado'}: ${nomes}`;
  }

  // Pergunta ao servidor quem é o rosto. Antes havia um "cache" de 8 s
  // que reaproveitava o resultado de um rosto parecido; ele foi removido
  // porque podia mostrar o nome da pessoa anterior para quem chegasse depois.
  async function identificar(descritor, cam) {
    return Painel.api('/controle-acesso/autenticar', {
      method: 'POST',
      body: JSON.stringify({ descritorFacial: Array.from(descritor), origem: cam.nome, registrar: false })
    });
  }

  function deveRegistrar(cam, chave) {
    const k = `${cam.id}:${chave}`;
    const t = ultimoRegistro.get(k) || 0;
    if (Date.now() - t < 30000) return false;
    ultimoRegistro.set(k, Date.now());
    return true;
  }

  function liberarPortaSeEntrada(cam, nome) {
    if (!/entrada|porta|port[aã]o|frente/i.test(cam.nome)) return;
    const estado = Painel.obterEstado();
    if (estado.alertaPolicial || estado.portaPrincipal) return;
    Painel.definirSensor('portaPrincipal', true, { origem: `${nome} reconhecido(a)` });
    Painel.aviso(`Porta liberada para ${nome}. Tranca de novo em 15 segundos.`, 'ok');
    clearTimeout(portaReabre.timer);
    portaReabre.timer = setTimeout(() => Painel.definirSensor('portaPrincipal', false, { origem: 'Trava automática' }), 15000);
  }

  async function processarIA(cam) {
    if (!cam.video.videoWidth) return;
    if (Painel.obterEstado().alertaPolicial) return;

    const deteccoes = await faceapi
      .detectAllFaces(cam.video, opcoesDetector())
      .withFaceLandmarks()
      .withFaceDescriptors();

    const rostos = [];
    const votos = new Map(); // quantas leituras seguidas cada resultado já teve
    for (const d of deteccoes.slice(0, 4)) {
      // Rosto longe ou pouco nítido: não arrisca uma identificação.
      if (d.detection.box.width < ROSTO_MIN_LARGURA) {
        rostos.push({ caixa: d.detection.box, resultado: { status: 'LONGE' } });
        continue;
      }
      let resultado = { status: 'DESCONHECIDO' };
      try { resultado = await identificar(d.descriptor, cam); }
      catch { resultado = { status: 'OFFLINE' }; }

      // Confirmação: o mesmo resultado precisa aparecer em 3 leituras seguidas.
      const chave = resultado.status === 'AUTORIZADO' ? `r${resultado.residenteId}` : resultado.status;
      const vezes = ((cam.votos && cam.votos.get(chave)) || 0) + 1;
      votos.set(chave, vezes);
      if (vezes < CONFIRMACOES && (resultado.status === 'AUTORIZADO' || resultado.status === 'NEGADO')) {
        rostos.push({ caixa: d.detection.box, resultado: { status: 'VERIFICANDO', vezes } });
        continue;
      }
      rostos.push({ caixa: d.detection.box, resultado });

      if (resultado.status === 'AUTORIZADO') {
        if (deveRegistrar(cam, `r${resultado.residenteId}`)) {
          Painel.api('/controle-acesso/tentativas', {
            method: 'POST', body: JSON.stringify({ residenteId: resultado.residenteId, resultado: 'AUTORIZADO', origem: cam.nome })
          }).catch(() => {});
          Painel.registrarAcesso(resultado.nome, cam.nome);
          Painel.registrarEvento('Acesso', `${resultado.nome} reconhecido(a) na câmera “${cam.nome}”`, 'ok');
          liberarPortaSeEntrada(cam, resultado.nome);
        }
      } else if (resultado.status === 'NEGADO' && deveRegistrar(cam, 'desconhecido')) {
        Painel.api('/controle-acesso/tentativas', {
          method: 'POST', body: JSON.stringify({ resultado: 'NEGADO', origem: cam.nome })
        }).catch(() => {});
        Painel.registrarAcesso('Pessoa não reconhecida', cam.nome);
        Painel.registrarEvento('Acesso', `Pessoa não reconhecida na câmera “${cam.nome}”`, 'atencao');
        capturar(cam.id, { motivo: 'rosto', silencioso: true });
      }
    }

    cam.votos = votos;
    cam.rostos = rostos;
    cam.rostosEm = Date.now();
    const autorizados = rostos.filter(r => r.resultado.status === 'AUTORIZADO');
    const negados = rostos.filter(r => r.resultado.status === 'NEGADO');
    cam.tile.classList.toggle('reconhecido', autorizados.length > 0 && negados.length === 0);
    const longe = rostos.some(r => r.resultado.status === 'LONGE');
    const verificando = rostos.some(r => r.resultado.status === 'VERIFICANDO');
    if (!rostos.length) status(cam, 'Procurando rostos…');
    else if (!autorizados.length && !negados.length && verificando) status(cam, 'Verificando o rosto…');
    else if (!autorizados.length && !negados.length && longe) status(cam, 'Chegue mais perto da câmera', 'atencao');
    else if (rostos.some(r => r.resultado.status === 'OFFLINE')) status(cam, 'Rosto visto, mas o servidor está fora do ar', 'perigo');
    else if (negados.length) status(cam, negados.length === 1 ? 'Pessoa não reconhecida' : `${negados.length} pessoas não reconhecidas`, 'atencao');
    else if (autorizados.length) status(cam, `Liberado: ${autorizados.map(r => r.resultado.nome).join(', ')}`, 'ok');
    else status(cam, 'Verificando o rosto…');
  }

  async function cicloIA() {
    if (processando || !iaPronta) return;
    if (!filaIA.length) filaIA = [...cams.values()].filter(c => c.ia).map(c => c.id);
    const id = filaIA.shift();
    const cam = cams.get(id);
    if (!cam?.ia) return;
    processando = true;
    try { await processarIA(cam); }
    catch (erro) { console.warn('IA de rosto:', erro); }
    finally { processando = false; }
  }

  // ---------------------------------------------------------
  // cadastro de morador pelo vídeo
  // ---------------------------------------------------------
  let descritorPendente = null;
  let camPendente = null;

  async function cadastrarRosto(cam) {
    if (!(await carregarIA())) return;
    status(cam, 'Olhe para a câmera por 2 segundos…');
    const amostras = [];
    let melhor = null;
    for (let i = 0; i < 10 && amostras.length < 3; i++) {
      // detectAllFaces (e não detectSingleFace): assim percebemos se há
      // mais de uma pessoa na imagem. Antes, cada leitura podia pegar uma
      // pessoa diferente, e a média virava um rosto "misturado" que depois
      // era reconhecido como as duas pessoas.
      const rostos = await faceapi.detectAllFaces(cam.video, opcoesDetector()).withFaceLandmarks().withFaceDescriptors();
      if (rostos.length > 1) {
        status(cam, 'Há mais de uma pessoa na imagem. Deixe só quem vai ser cadastrado.', 'atencao');
        return;
      }
      const d = rostos[0];
      if (d && d.detection.box.width >= 120) {
        amostras.push(d.descriptor);
        if (!melhor || d.detection.score > melhor.detection.score) melhor = d;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (amostras.length < 3) {
      status(cam, 'Rosto pouco nítido. Chegue mais perto, de frente e com luz no rosto.', 'atencao');
      return;
    }
    // As três leituras precisam ser da mesma pessoa.
    for (let i = 0; i < amostras.length; i++) {
      for (let j = i + 1; j < amostras.length; j++) {
        if (distancia(amostras[i], amostras[j]) > 0.35) {
          status(cam, 'As leituras não bateram. Fique parado(a), de frente, e tente de novo.', 'atencao');
          return;
        }
      }
    }
    // Média das amostras: cadastro mais estável que um quadro só.
    // Array.from: o vetor da face-api é um Float32Array, que o JSON não envia como lista.
    descritorPendente = Array.from(amostras[0], (_, i) => amostras.reduce((s, a) => s + a[i], 0) / amostras.length);
    camPendente = cam;

    // Se esse rosto já parece com alguém cadastrado, o sistema confundiria os dois.
    try {
      const jaExiste = await Painel.api('/controle-acesso/autenticar', {
        method: 'POST', body: JSON.stringify({ descritorFacial: descritorPendente, registrar: false })
      });
      if (jaExiste.status === 'AUTORIZADO') {
        descritorPendente = null;
        status(cam, `Este rosto já está cadastrado como ${jaExiste.nome}.`, 'atencao');
        return;
      }
    } catch { /* servidor fora do ar: o salvamento vai avisar */ }

    const prev = document.getElementById('previaRosto');
    const ctx = prev.getContext('2d');
    const b = melhor.detection.box;
    const margem = b.width * 0.35;
    ctx.clearRect(0, 0, prev.width, prev.height);
    ctx.drawImage(cam.video, b.x - margem, b.y - margem, b.width + margem * 2, b.height + margem * 2, 0, 0, prev.width, prev.height);

    status(cam, '');
    document.getElementById('inpNomeMorador').value = '';
    document.getElementById('inpDocMorador').value = '';
    document.getElementById('dlgMorador').showModal();
  }

  async function salvarMorador() {
    const nome = document.getElementById('inpNomeMorador').value.trim();
    const doc = document.getElementById('inpDocMorador').value.trim();
    if (!nome || !descritorPendente) return;
    try {
      await Painel.api('/controle-acesso/residentes', {
        method: 'POST',
        body: JSON.stringify({ nome, documentoId: doc || null, descritorFacial: descritorPendente })
      });
      Painel.aviso(`${nome} cadastrado(a). Ligue “Rosto” em qualquer câmera para reconhecer.`, 'ok');
      Painel.registrarEvento('Moradores', `${nome} cadastrado(a) pela câmera “${camPendente?.nome}”`, 'ok');
      Painel.carregarControleAcesso();
    } catch (erro) {
      Painel.aviso(`Não foi possível salvar: ${erro.message}`, 'perigo');
    } finally {
      descritorPendente = null;
    }
  }

  // ---------------------------------------------------------
  // detecção de movimento
  // ---------------------------------------------------------
  const quadroPequeno = document.createElement('canvas');
  quadroPequeno.width = 96; quadroPequeno.height = 54;
  const ctxPequeno = quadroPequeno.getContext('2d', { willReadFrequently: true });

  function definirMovimento(idOuNome, ativo = true) {
    const alvos = resolverVarios(idOuNome);
    if (!alvos.length) return null;
    alvos.forEach(cam => {
      cam.mov = ativo;
      cam.quadroAnterior = null;
      cam.seguidos = 0;
      cam.tile.querySelector('[data-acao="mov"]').setAttribute('aria-pressed', String(ativo));
      if (!ativo) { cam.tile.classList.remove('movimento'); cam.caixaMov = null; }
    });
    atualizarResumo();
    return `Movimento ${ativo ? 'ligado' : 'desligado'}: ${alvos.map(c => c.nome).join(', ')}`;
  }

  function analisarMovimento(cam) {
    if (!cam.video.videoWidth) return;
    const W = quadroPequeno.width, H = quadroPequeno.height;
    ctxPequeno.drawImage(cam.video, 0, 0, W, H);
    const px = ctxPequeno.getImageData(0, 0, W, H).data;
    const cinza = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) cinza[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;

    const anterior = cam.quadroAnterior;
    cam.quadroAnterior = cinza;
    if (!anterior) return;

    let mudou = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (Math.abs(cinza[k] - anterior[k]) > 28) {
          mudou++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    const proporcao = mudou / (W * H);
    // Muda a imagem toda de uma vez = provavelmente a luz/ajuste automático, não movimento.
    const mudancaDeLuz = proporcao > 0.6;
    cam.seguidos = (proporcao > 0.012 && !mudancaDeLuz) ? (cam.seguidos || 0) + 1 : 0;

    if (cam.seguidos >= 2) {
      cam.caixaMov = { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H, em: Date.now() };
      cam.tile.classList.add('movimento');
      clearTimeout(cam.timerMov);
      cam.timerMov = setTimeout(() => cam.tile.classList.remove('movimento'), 2000);

      if (Date.now() - (cam.movEm || 0) > 20000) {
        cam.movEm = Date.now();
        Painel.registrarEvento('Movimento', `Movimento detectado na câmera “${cam.nome}”`, 'atencao');
        capturar(cam.id, { motivo: 'movimento', silencioso: true });
      }
    }
  }

  // ---------------------------------------------------------
  // desenho por cima do vídeo (caixas de rosto e movimento)
  // ---------------------------------------------------------
  function retanguloVideo(cam) {
    const cw = cam.canvas.clientWidth, ch = cam.canvas.clientHeight;
    const vw = cam.video.videoWidth || 16, vh = cam.video.videoHeight || 9;
    const escala = Math.min(cw / vw, ch / vh);
    return { escala, ox: (cw - vw * escala) / 2, oy: (ch - vh * escala) / 2, vw, vh, cw, ch };
  }

  function desenhar() {
    const dpr = window.devicePixelRatio || 1;
    for (const cam of cams.values()) {
      const c = cam.canvas;
      const r = retanguloVideo(cam);
      if (c.width !== Math.round(r.cw * dpr) || c.height !== Math.round(r.ch * dpr)) {
        c.width = Math.round(r.cw * dpr); c.height = Math.round(r.ch * dpr);
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.cw, r.ch);

      if (cam.mov && cam.caixaMov && Date.now() - cam.caixaMov.em < 1500) {
        const m = cam.caixaMov;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#F0A30A';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(240,163,10,.10)';
        const x = r.ox + m.x * r.vw * r.escala, y = r.oy + m.y * r.vh * r.escala;
        const w = m.w * r.vw * r.escala, h = m.h * r.vh * r.escala;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }

      if (cam.ia && Date.now() - cam.rostosEm < 2500) {
        for (const { caixa, resultado } of cam.rostos) {
          const cor = resultado.status === 'AUTORIZADO' ? '#34D399' : resultado.status === 'NEGADO' ? '#F0A94B'
            : resultado.status === 'VERIFICANDO' ? '#22D3EE' : '#8FA4BA';
          // A distância aparece junto do nome: ajuda a explicar a decisão.
          const dist = typeof resultado.distancia === 'number' ? ` · ${resultado.distancia.toFixed(2).replace('.', ',')}` : '';
          const rotulo = resultado.status === 'AUTORIZADO' ? `${resultado.nome}${dist}`
            : resultado.status === 'NEGADO' ? (resultado.motivo === 'AMBIGUO' ? 'Não foi possível confirmar' : `Não reconhecido${dist}`)
            : resultado.status === 'VERIFICANDO' ? `Verificando… ${resultado.vezes}/${CONFIRMACOES}`
            : resultado.status === 'LONGE' ? 'Chegue mais perto' : 'Analisando…';
          const x = r.ox + caixa.x * r.escala, y = r.oy + caixa.y * r.escala;
          const w = caixa.width * r.escala, h = caixa.height * r.escala;
          ctx.strokeStyle = cor; ctx.lineWidth = 2.5;
          ctx.strokeRect(x, y, w, h);
          ctx.font = '500 12px "42dot Sans", Arial, sans-serif';
          const tw = ctx.measureText(rotulo).width + 12;
          ctx.fillStyle = cor;
          ctx.fillRect(x, y + h + 4, tw, 20);
          ctx.fillStyle = '#0A1410';
          ctx.fillText(rotulo, x + 6, y + h + 18);
        }
      }
    }
    requestAnimationFrame(desenhar);
  }

  // ---------------------------------------------------------
  // fotos e gravação
  // ---------------------------------------------------------
  const capturas = [];

  function adicionarCaptura({ url, cam, motivo }) {
    capturas.unshift({ url, nome: cam.nome, hora: Painel.horaCurta(), motivo, arquivo: nomeArquivo(cam, 'jpg') });
    while (capturas.length > 30) URL.revokeObjectURL(capturas.pop().url);
    const lista = document.getElementById('capturasLista');
    document.getElementById('capturas').hidden = false;
    lista.innerHTML = capturas.map(c => `
      <li class="${c.motivo === 'movimento' ? 'cap-mov' : ''}">
        <a href="${c.url}" download="${c.arquivo}" title="Baixar foto">
          <img src="${c.url}" alt="Foto da câmera ${Painel.escapar(c.nome)} às ${c.hora}">
          <span>${Painel.escapar(c.nome)} · ${c.hora}${c.motivo === 'movimento' ? ' · movimento' : c.motivo === 'rosto' ? ' · desconhecido' : ''}</span>
        </a>
      </li>`).join('');
  }

  function capturar(idOuNome, { motivo = 'manual', silencioso = false } = {}) {
    const cam = resolver(idOuNome);
    if (!cam || !cam.video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = cam.video.videoWidth;
    c.height = cam.video.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(cam.video, 0, 0);
    // Carimbo de data/hora e nome, como num DVR
    const tam = Math.max(14, Math.round(c.width / 48));
    ctx.font = `500 ${tam}px "IBM Plex Mono", monospace`;
    const texto = `${cam.nome.toUpperCase()}  ${carimbo()}`;
    const largura = ctx.measureText(texto).width;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(tam * 0.6, tam * 0.6, largura + tam, tam * 1.7);
    ctx.fillStyle = '#E8F0EA';
    ctx.fillText(texto, tam * 1.1, tam * 1.85);

    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      adicionarCaptura({ url, cam, motivo });
      if (!silencioso) {
        baixar(url, nomeArquivo(cam, 'jpg'));
        Painel.aviso(`Foto de “${cam.nome}” salva.`, 'ok');
      }
    }, 'image/jpeg', 0.9);
    return `Foto de ${cam.nome}`;
  }

  function tipoGravacao() {
    const opcoes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    return opcoes.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  }

  function gravar(idOuNome, ligar = true) {
    const cam = resolver(idOuNome);
    if (!cam) return null;
    if (!cam.stream) { status(cam, 'Ainda sem vídeo para gravar', 'atencao'); return null; }
    if (!window.MediaRecorder) { Painel.aviso('Este navegador não grava vídeo.', 'perigo'); return null; }

    const gravando = cam.gravador?.state === 'recording';
    if (ligar && gravando) return `Já gravando ${cam.nome}`;
    if (!ligar && !gravando) return null;

    if (!ligar) { cam.gravador.stop(); return `Gravação de ${cam.nome} salva`; }

    const tipo = tipoGravacao();
    const partes = [];
    const rec = new MediaRecorder(cam.stream, tipo ? { mimeType: tipo, videoBitsPerSecond: 2_500_000 } : undefined);
    rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
    rec.onstop = () => {
      clearTimeout(cam.limiteGravacao);
      cam.tile.classList.remove('gravando');
      cam.tile.querySelector('[data-acao="gravar"]').setAttribute('aria-pressed', 'false');
      const blob = new Blob(partes, { type: tipo || 'video/webm' });
      const url = URL.createObjectURL(blob);
      baixar(url, nomeArquivo(cam, tipo.includes('mp4') ? 'mp4' : 'webm'));
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      Painel.registrarEvento('Gravação', `Vídeo de “${cam.nome}” salvo (${Math.round(blob.size / 1024 / 1024 * 10) / 10} MB)`, 'ok');
    };
    rec.start(1000);
    cam.gravador = rec;
    cam.tile.classList.add('gravando');
    cam.tile.querySelector('[data-acao="gravar"]').setAttribute('aria-pressed', 'true');
    // Proteção: no máximo 10 minutos por arquivo
    cam.limiteGravacao = setTimeout(() => rec.state === 'recording' && rec.stop(), 10 * 60 * 1000);
    Painel.registrarEvento('Gravação', `Gravando “${cam.nome}”`, 'atencao');
    return `Gravando ${cam.nome}`;
  }

  // ---------------------------------------------------------
  // layout e foco
  // ---------------------------------------------------------
  function definirLayout(n) {
    const p = parede();
    p.dataset.layout = String(n);
    document.querySelectorAll('[data-layout]').forEach(b => {
      if (b.tagName === 'BUTTON') b.classList.toggle('ativo', b.dataset.layout === String(n));
    });
    if (n === 1 && !p.querySelector('.tile.em-foco')) p.querySelector('.tile')?.classList.add('em-foco');
    atualizarResumo();
  }

  function focar(cam, alternar = true) {
    const ja = cam.tile.classList.contains('em-foco');
    parede().querySelectorAll('.tile.em-foco').forEach(t => t.classList.remove('em-foco'));
    if (!ja || !alternar) cam.tile.classList.add('em-foco');
    atualizarResumo();
  }

  function focarPorNome(nome) {
    const cam = resolver(nome);
    document.getElementById('cameras').scrollIntoView({ behavior: 'smooth' });
    if (cam) ampliar(cam);
    else abrirDialogoAdicionar(nome);
  }

  // Visualização ampliada: a própria câmera sai da grade e vira um modal
  // (sem mover o <video> no DOM, para o vídeo não parar).
  function ampliar(cam) {
    fecharAmpliada();
    cam.tile.classList.add('ampliada');
    document.getElementById('fundoCamera').hidden = false;
    document.body.classList.add('com-camera-ampliada');
    cam.tile.querySelector('[data-acao="fechar-ampliada"]')?.focus();
  }

  function fecharAmpliada() {
    const aberta = parede().querySelector('.tile.ampliada');
    parede().querySelectorAll('.tile.ampliada').forEach(t => t.classList.remove('ampliada'));
    document.getElementById('fundoCamera').hidden = true;
    document.body.classList.remove('com-camera-ampliada');
    return aberta;
  }

  function marcarAlertaEmTodas(texto) {
    for (const cam of cams.values()) {
      status(cam, texto, 'perigo');
      cam.tile.classList.add('alerta');
      setTimeout(() => { cam.tile.classList.remove('alerta'); status(cam, ''); }, 12000);
    }
  }

  // ---------------------------------------------------------
  // busca por id ou nome (usado pelo assistente)
  // ---------------------------------------------------------
  function resolver(idOuNome) {
    if (!idOuNome) return cams.size === 1 ? [...cams.values()][0] : null;
    if (cams.has(idOuNome)) return cams.get(idOuNome);
    const alvo = normalizar(idOuNome);
    return [...cams.values()].find(c => normalizar(c.nome) === alvo)
      || [...cams.values()].find(c => normalizar(c.nome).includes(alvo) || alvo.includes(normalizar(c.nome)))
      || null;
  }
  function resolverVarios(idOuNome) {
    if (['todas', 'todos', '*', 'all'].includes(normalizar(idOuNome))) return [...cams.values()];
    const cam = resolver(idOuNome);
    return cam ? [cam] : [];
  }

  function listar() {
    return [...cams.values()].map(c => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo === 'celular' ? 'celular' : 'computador',
      reconhecimento_facial: c.ia,
      deteccao_movimento: c.mov,
      gravando: c.gravador?.state === 'recording',
      pessoas_vistas_agora: c.ia && Date.now() - c.rostosEm < 4000
        ? c.rostos.map(r => r.resultado.status === 'AUTORIZADO' ? r.resultado.nome : 'desconhecido')
        : undefined
    }));
  }

  // ---------------------------------------------------------
  // eventos da interface
  // ---------------------------------------------------------
  function ligarInterface() {
    parede().addEventListener('click', (e) => {
      const botao = e.target.closest('[data-acao]');
      if (!botao) {
        // clicar no vídeo abre a visualização ampliada
        const tela = e.target.closest('.tile-tela');
        const tile = tela?.closest('.tile');
        if (tile && !tile.classList.contains('ampliada')) ampliar(cams.get(tile.dataset.id));
        return;
      }
      const cam = cams.get(botao.closest('.tile').dataset.id);
      if (!cam) return;
      const ativo = botao.getAttribute('aria-pressed') === 'true';
      switch (botao.dataset.acao) {
        case 'ia': definirIA(cam.id, !ativo); break;
        case 'mov': definirMovimento(cam.id, !ativo); break;
        case 'cadastrar': cadastrarRosto(cam); break;
        case 'foto': capturar(cam.id); break;
        case 'gravar': gravar(cam.id, !ativo); break;
        case 'trocar': comandoCelular(cam, 'trocar'); break;
        case 'lanterna': comandoCelular(cam, 'lanterna', !ativo); break;
        case 'expandir': fecharAmpliada(); focar(cam); break;
        case 'fechar-ampliada': fecharAmpliada()?.querySelector('.tile-tela')?.focus?.(); break;
        case 'procurado': fecharAmpliada(); Painel.simularProcurado(); break;
        case 'cheia':
          if (document.fullscreenElement) document.exitFullscreen();
          else cam.tile.requestFullscreen?.();
          break;
        case 'remover': desligarLocal(cam.id); break;
      }
    });
    document.getElementById('fundoCamera').addEventListener('click', fecharAmpliada);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && parede().querySelector('.tile.ampliada')) fecharAmpliada();
    });

    document.querySelectorAll('.seg [data-layout]').forEach(b => b.addEventListener('click', () => definirLayout(Number(b.dataset.layout))));
    document.getElementById('btnAdicionarCamera').addEventListener('click', () => abrirDialogoAdicionar());
    document.getElementById('btnConectarCelular').addEventListener('click', abrirDialogoCelular);
    document.querySelectorAll('[data-abrir="adicionar"]').forEach(b =>
      b.addEventListener('click', () => abrirDialogoAdicionar(b.dataset.nome || (cams.size ? '' : 'Entrada principal'))));
    document.querySelectorAll('[data-abrir="celular"]').forEach(b => b.addEventListener('click', abrirDialogoCelular));
    document.getElementById('btnCopiarUrl').addEventListener('click', async (e) => {
      const texto = document.getElementById('urlCelular').textContent;
      try { await navigator.clipboard.writeText(texto); e.target.textContent = 'Copiado'; }
      catch { e.target.textContent = 'Selecione e copie'; }
      setTimeout(() => { e.target.textContent = 'Copiar'; }, 2000);
    });
    document.getElementById('btnLimparCapturas').addEventListener('click', () => {
      capturas.splice(0).forEach(c => URL.revokeObjectURL(c.url));
      document.getElementById('capturasLista').innerHTML = '';
      document.getElementById('capturas').hidden = true;
    });

    const dlgAdd = document.getElementById('dlgAdicionar');
    dlgAdd.addEventListener('close', async () => {
      if (dlgAdd.returnValue !== 'ok') return;
      const opcoes = {
        deviceId: document.getElementById('selDispositivo').value,
        nome: document.getElementById('inpNomeCamera').value.trim() || `Câmera ${cams.size + 1}`,
        qualidade: Number(document.getElementById('selQualidade').value),
        lembrar: document.getElementById('chkLembrar').checked
      };
      try {
        await ligarLocal(opcoes);
      } catch (erro) {
        document.getElementById('erroAdicionar').textContent = erro instanceof DOMException ? mensagemErroCamera(erro) : erro.message;
        document.getElementById('erroAdicionar').hidden = false;
        dlgAdd.returnValue = '';
        dlgAdd.showModal();
      }
    });

    const dlgMorador = document.getElementById('dlgMorador');
    dlgMorador.addEventListener('close', () => {
      if (dlgMorador.returnValue === 'ok') salvarMorador();
      else descritorPendente = null;
    });

    setInterval(() => {
      const texto = carimbo();
      document.querySelectorAll('.tile .relogio').forEach(el => { el.textContent = texto; });
    }, 1000);
  }

  window.addEventListener('DOMContentLoaded', () => {
    ligarInterface();
    requestAnimationFrame(desenhar);
    setInterval(cicloIA, 350);
    setInterval(() => { for (const cam of cams.values()) if (cam.mov) analisarMovimento(cam); }, 250);
    Painel.aoConectarSocket(conectarSinalizacao);
    religarLembradas();
  });

  return {
    listar, resolver, definirIA, definirMovimento, capturar, gravar,
    focarPorNome, ampliar: (n) => { const c = resolver(n); if (c) ampliar(c); }, fecharAmpliada,
    marcarAlertaEmTodas, abrirDialogoAdicionar, abrirDialogoCelular
  };
})();
