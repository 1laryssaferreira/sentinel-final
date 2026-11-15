// ==========================================================
// CÂMERA DO CELULAR — lado que ENVIA vídeo para o painel.
//
// Novidades da v3:
//  - escolha de qualidade e troca frontal/traseira (aqui ou pelo painel);
//  - lanterna, quando o aparelho permite;
//  - mantém a tela acesa (Wake Lock) enquanto transmite;
//  - informa bateria ao painel e reconecta sozinho se a rede cair;
//  - lembra o nome da câmera para a próxima vez.
// ==========================================================

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const TAMANHOS = { 480: [640, 480], 720: [1280, 720], 1080: [1920, 1080] };

const el = (id) => document.getElementById(id);
const video = el('videoCelular');
const inputNome = el('nomeCamera');
const selQualidade = el('qualidade');
const btnConectar = el('btnConectar');

let stream = null;
let socket = null;
let usandoTraseira = true;
let lanternaLigada = false;
let transmitindo = false;
let travaTela = null;
let bateria = null;
const conexoes = new Map(); // socketId do painel -> RTCPeerConnection

function estado(texto, tom = '') {
  el('estadoTexto').textContent = texto;
  el('estado').dataset.tom = tom;
}
function erro(texto) {
  el('erro').textContent = texto;
  el('erro').hidden = !texto;
}

setInterval(() => {
  const d = new Date();
  el('relogio').textContent = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
}, 1000);

inputNome.value = localStorage.getItem('sentinel_nome_camera') || '';

// ---------------- câmera ----------------
async function abrirCamera() {
  if (!window.isSecureContext) {
    erro('O navegador só libera a câmera em página segura. Abra este endereço com https:// (veja o QR Code no painel).');
    estado('Página não segura', 'perigo');
    return;
  }
  const [w, h] = TAMANHOS[selQualidade.value] || TAMANHOS[720];
  const novo = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: usandoTraseira ? 'environment' : 'user' }, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 24 } },
    audio: false
  });
  const trilhaNova = novo.getVideoTracks()[0];

  // Troca a trilha nas conexões abertas sem derrubar o painel
  for (const pc of conexoes.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(trilhaNova);
  }
  stream?.getTracks().forEach(t => t.stop());
  stream = novo;
  video.srcObject = stream;
  video.classList.toggle('espelhado', !usandoTraseira);
  lanternaLigada = false;

  const recursos = trilhaNova.getCapabilities?.() || {};
  el('btnLanterna').hidden = !recursos.torch;
  el('btnLanterna').setAttribute('aria-pressed', 'false');
  btnConectar.disabled = false;
  if (!transmitindo) estado('Câmera pronta');
  enviarStatus();
}

async function trocarCamera() {
  usandoTraseira = !usandoTraseira;
  try { await abrirCamera(); }
  catch (e) { usandoTraseira = !usandoTraseira; erro('Este aparelho não tem outra câmera disponível.'); }
}

async function alternarLanterna(ligar = !lanternaLigada) {
  const trilha = stream?.getVideoTracks()[0];
  if (!trilha) return;
  try {
    await trilha.applyConstraints({ advanced: [{ torch: ligar }] });
    lanternaLigada = ligar;
    el('btnLanterna').setAttribute('aria-pressed', String(ligar));
  } catch { erro('Não foi possível controlar a lanterna neste aparelho.'); }
  enviarStatus();
}

// ---------------- transmissão ----------------
function carregarSocketIO() {
  return new Promise((ok, falha) => {
    if (window.io) return ok();
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = ok; s.onerror = falha;
    document.head.appendChild(s);
  });
}

function enviarStatus() {
  if (!socket?.connected) return;
  const trilha = stream?.getVideoTracks()[0];
  socket.emit('camera:status', {
    bateria: bateria?.level,
    carregando: bateria?.charging,
    lanterna: lanternaLigada,
    lanternaDisponivel: !!trilha?.getCapabilities?.().torch,
    camera: usandoTraseira ? 'traseira' : 'frontal'
  });
}

function atualizarAssistindo() {
  const n = [...conexoes.values()].filter(pc => pc.connectionState === 'connected').length;
  el('assistindo').textContent = n === 0 ? 'Nenhum painel assistindo' : n === 1 ? '1 painel assistindo' : `${n} painéis assistindo`;
  if (transmitindo) estado(n ? 'Transmitindo' : 'Aguardando o painel…', n ? 'ok' : 'atencao');
}

function conexaoPara(painelId) {
  conexoes.get(painelId)?.close();
  const pc = new RTCPeerConnection({ iceServers: STUN });
  conexoes.set(painelId, pc);
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('sinal:ice-candidate', { paraSocketId: painelId, candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) conexoes.delete(painelId);
    atualizarAssistindo();
  };
  return pc;
}

async function comecar(nome) {
  await carregarSocketIO();
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('camera:entrar', {
      sala: window.SENTINEL.sala,
      nome,
      recursos: { lanterna: !!stream?.getVideoTracks()[0]?.getCapabilities?.().torch }
    });
    atualizarAssistindo();
    enviarStatus();
  });
  socket.on('disconnect', () => estado('Sem conexão — tentando de novo…', 'perigo'));

  socket.on('sinal:offer', async ({ deSocketId, offer }) => {
    const pc = conexaoPara(deSocketId);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('sinal:answer', { paraSocketId: deSocketId, answer });
  });
  socket.on('sinal:ice-candidate', ({ deSocketId, candidate }) => {
    const pc = conexoes.get(deSocketId);
    if (pc && candidate) pc.addIceCandidate(candidate).catch(() => {});
  });
  socket.on('painel:saiu', ({ socketId }) => {
    conexoes.get(socketId)?.close();
    conexoes.delete(socketId);
    atualizarAssistindo();
  });
  socket.on('camera:comando', ({ comando, valor }) => {
    if (comando === 'trocar') trocarCamera();
    if (comando === 'lanterna') alternarLanterna(Boolean(valor));
  });

  transmitindo = true;
  manterTelaAcesa();
}

function parar() {
  transmitindo = false;
  socket?.disconnect();
  socket = null;
  conexoes.forEach(pc => pc.close());
  conexoes.clear();
  travaTela?.release?.();
  travaTela = null;
  el('formCelular').hidden = false;
  el('btnParar').hidden = true;
  inputNome.disabled = false;
  selQualidade.disabled = false;
  estado('Transmissão parada');
  atualizarAssistindo();
}

async function manterTelaAcesa() {
  try { travaTela = await navigator.wakeLock?.request('screen'); } catch { /* não suportado */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && transmitindo) manterTelaAcesa();
});

// ---------------- interface ----------------
el('formCelular').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = inputNome.value.trim();
  if (!nome || !stream) return;
  localStorage.setItem('sentinel_nome_camera', nome);
  erro('');
  inputNome.disabled = true;
  selQualidade.disabled = true;
  el('formCelular').hidden = true;
  el('btnParar').hidden = false;
  estado('Conectando…', 'atencao');
  try { await comecar(nome); }
  catch { erro('Não consegui falar com o servidor do Sentinel. O computador está ligado e no mesmo Wi-Fi?'); parar(); }
});
el('btnParar').addEventListener('click', parar);
el('btnTrocar').addEventListener('click', trocarCamera);
el('btnLanterna').addEventListener('click', () => alternarLanterna());
selQualidade.addEventListener('change', () => abrirCamera().catch(() => {}));

window.addEventListener('DOMContentLoaded', async () => {
  try {
    bateria = await navigator.getBattery?.();
    const mostrar = () => {
      if (!bateria) return;
      el('bateria').textContent = `Bateria ${Math.round(bateria.level * 100)}%${bateria.charging ? ' · carregando' : ''}`;
      enviarStatus();
    };
    bateria?.addEventListener('levelchange', mostrar);
    bateria?.addEventListener('chargingchange', mostrar);
    mostrar();
  } catch { /* API de bateria indisponível (iPhone) */ }

  try { await abrirCamera(); }
  catch (e) {
    estado('Câmera bloqueada', 'perigo');
    if (!el('erro').textContent) erro(e.name === 'NotAllowedError'
      ? 'Permissão negada. Toque no cadeado da barra de endereço e libere a câmera.'
      : `Não foi possível abrir a câmera (${e.message}).`);
  }
});
