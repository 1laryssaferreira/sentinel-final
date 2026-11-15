// ==========================================================
// SENTINEL 3 — chat do assistente
//
// 1. Pergunta ao servidor se há IA configurada (/api/assistente/status).
// 2. Com IA: manda a conversa + o estado atual do painel para
//    /api/assistente/chat. A IA responde texto e uma lista de
//    "ações" (trancar porta, gravar câmera...), que o painel executa.
// 3. Sem IA, ou se a IA falhar: usa o motor local (assistente.js).
//
// Extras: entrada por voz (Web Speech API), leitura das respostas
// em voz alta e conversa guardada enquanto a aba estiver aberta.
// ==========================================================

(() => {
  const CHAVE = 'sentinel_chat_v3';
  const lista = document.getElementById('chatHistory');
  const form = document.getElementById('chatForm');
  const entrada = document.getElementById('chatInput');
  const painelChat = document.getElementById('assistente');

  let historico = [];
  let iaAtiva = false;
  let descricaoIA = '';
  let ocupado = false;
  let falarRespostas = false;

  try { historico = JSON.parse(sessionStorage.getItem(CHAVE)) || []; } catch { historico = []; }
  const salvar = () => { try { sessionStorage.setItem(CHAVE, JSON.stringify(historico.slice(-40))); } catch { /* cheio */ } };

  // ---------------- renderização ----------------
  function bolha(papel, texto, { acoes = [], erro = false, meta = '' } = {}) {
    const el = document.createElement('div');
    el.className = `bolha ${papel === 'usuario' ? 'bolha-eu' : 'bolha-ia'}${erro ? ' erro' : ''}`;
    el.textContent = texto;
    lista.appendChild(el);
    if (acoes.length) {
      const chips = document.createElement('div');
      chips.className = 'acoes-feitas';
      acoes.forEach(a => { const s = document.createElement('span'); s.textContent = a; chips.appendChild(s); });
      lista.appendChild(chips);
    }
    if (meta) {
      // Modelo e tempo de resposta da IA, para acompanhar a latência
      const info = document.createElement('div');
      info.className = 'bolha-meta';
      info.textContent = meta;
      lista.appendChild(info);
    }
    lista.scrollTop = lista.scrollHeight;
  }

  function boasVindas() {
    const el = document.createElement('div');
    el.className = 'bolha bolha-boas';
    const nome = (getSession()?.nome || '').split(' ')[0];
    el.textContent = `Oi${nome ? ', ' + nome : ''}. Pergunte como está a casa ou peça uma ação — por exemplo “grava a câmera da entrada” ou “quem chegou hoje?”.`;
    lista.appendChild(el);
  }

  function renderizarTudo() {
    lista.innerHTML = '';
    boasVindas();
    historico.forEach(m => bolha(m.papel, m.texto, { acoes: m.acoes || [] }));
  }

  let indicador = null;
  function digitando(sim) {
    if (sim && !indicador) {
      indicador = document.createElement('div');
      indicador.className = 'digitando';
      indicador.setAttribute('aria-label', 'O assistente está respondendo');
      indicador.innerHTML = '<i></i><i></i><i></i>';
      lista.appendChild(indicador);
      lista.scrollTop = lista.scrollHeight;
    } else if (!sim && indicador) {
      indicador.remove();
      indicador = null;
    }
  }

  // ---------------- modo (IA ou local) ----------------
  function definirModo(ativo, provedor, modelo) {
    iaAtiva = ativo;
    descricaoIA = ativo ? (provedor === 'anthropic' ? `Claude · ${modelo}` : modelo) : '';
    painelChat.classList.toggle('com-ia', ativo);
    document.getElementById('assistenteModo').textContent = ativo ? `IA conectada — ${descricaoIA}` : 'Modo local (sem IA no servidor)';
    const chip = document.getElementById('chipIA');
    chip.dataset.estado = ativo ? 'ia' : 'local';
    document.getElementById('txtIA').textContent = ativo ? 'IA conectada' : 'modo local';
  }

  async function verificarIA() {
    try {
      const s = await Painel.api('/assistente/status');
      definirModo(!!s.ativo, s.provedor, s.modelo);
    } catch {
      definirModo(false);
    }
  }

  // ---------------- execução das ações ----------------
  async function executarAcoes(acoes) {
    const rotulos = [];
    for (const a of acoes || []) {
      try {
        const r = await Painel.executarAcao(a.nome, a.argumentos || {});
        if (r) rotulos.push(r);
      } catch (erro) {
        console.warn('Ação do assistente falhou:', a, erro);
      }
    }
    return rotulos;
  }

  function responderLocal(texto) {
    const rotulos = [];
    const { resposta } = SentinelAssistente.processar(texto, {
      estado: Painel.obterEstado,
      risco: Painel.obterRisco,
      cameras: () => Cameras.listar(),
      localizacao: Painel.obterLocalizacao,
      ultimoAcesso: Painel.obterUltimoAcesso,
      executar: (nome, args) => {
        Promise.resolve(Painel.executarAcao(nome, args)).then(r => r && rotulos.push(r));
      }
    });
    return { resposta, rotulos };
  }

  // ---------------- envio ----------------
  async function enviar(texto) {
    texto = texto.trim();
    if (!texto || ocupado) return;
    ocupado = true;
    form.querySelector('.enviar').disabled = true;

    historico.push({ papel: 'usuario', texto });
    bolha('usuario', texto);
    salvar();
    digitando(true);

    let resposta = '';
    let rotulos = [];
    let erro = false;
    let meta = '';

    if (iaAtiva) {
      try {
        const dados = await Painel.api('/assistente/chat', {
          method: 'POST',
          body: JSON.stringify({
            mensagens: historico.map(m => ({ papel: m.papel, texto: m.texto })),
            estado: Painel.obterEstadoParaIA()
          })
        });
        rotulos = await executarAcoes(dados.acoes);
        resposta = dados.resposta;
        if (dados.tempoMs) meta = `${dados.modelo} · ${(dados.tempoMs / 1000).toFixed(1).replace('.', ',')} s`;
      } catch (falha) {
        if (falha.status === 429) {
          resposta = falha.message;
          erro = true;
        } else {
          // IA fora do ar: responde com o motor local e avisa uma vez.
          const local = responderLocal(texto);
          await new Promise(r => setTimeout(r, 60));
          resposta = local.resposta;
          rotulos = local.rotulos;
          if (falha.corpo?.fallback || !falha.status) {
            Painel.aviso('A IA não respondeu. Esta resposta veio do modo local.', 'atencao');
          }
        }
      }
    } else {
      await new Promise(r => setTimeout(r, 350));
      const local = responderLocal(texto);
      await new Promise(r => setTimeout(r, 60));
      resposta = local.resposta;
      rotulos = local.rotulos;
    }

    digitando(false);
    bolha('assistente', resposta, { acoes: rotulos, erro, meta });
    if (!erro) {
      historico.push({ papel: 'assistente', texto: resposta, acoes: rotulos });
      salvar();
      falar(resposta);
    }
    ocupado = false;
    form.querySelector('.enviar').disabled = false;
  }

  // ---------------- voz ----------------
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnVoz = document.getElementById('btnVoz');
  if (Reconhecimento) {
    btnVoz.hidden = false;
    const rec = new Reconhecimento();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    let ouvindo = false;
    rec.onresult = (e) => {
      const texto = [...e.results].map(r => r[0].transcript).join(' ');
      entrada.value = texto;
      ajustarAltura();
      if (e.results[e.results.length - 1].isFinal) { enviar(texto); entrada.value = ''; ajustarAltura(); }
    };
    rec.onend = () => { ouvindo = false; btnVoz.classList.remove('ouvindo'); };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') Painel.aviso('Libere o microfone no navegador para falar com o assistente.', 'atencao');
    };
    btnVoz.addEventListener('click', () => {
      if (ouvindo) { rec.stop(); return; }
      ouvindo = true;
      btnVoz.classList.add('ouvindo');
      rec.start();
    });
  }

  const btnFalar = document.getElementById('btnFalarRespostas');
  if (!('speechSynthesis' in window)) btnFalar.hidden = true;
  btnFalar.addEventListener('click', () => {
    falarRespostas = !falarRespostas;
    btnFalar.setAttribute('aria-pressed', String(falarRespostas));
    if (!falarRespostas) speechSynthesis.cancel();
  });
  function falar(texto) {
    if (!falarRespostas || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    const voz = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('pt'));
    if (voz) u.voice = voz;
    speechSynthesis.speak(u);
  }

  // ---------------- entrada ----------------
  function ajustarAltura() {
    entrada.style.height = 'auto';
    entrada.style.height = Math.min(entrada.scrollHeight, 140) + 'px';
  }
  entrada.addEventListener('input', ajustarAltura);
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = entrada.value;
    entrada.value = '';
    ajustarAltura();
    enviar(texto);
  });
  document.getElementById('sugestoes').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') enviar(e.target.textContent);
  });
  document.getElementById('btnLimparChat').addEventListener('click', () => {
    historico = [];
    salvar();
    renderizarTudo();
  });

  // ---------------- gaveta (telas menores) ----------------
  const btnAbrir = document.getElementById('btnAbrirChat');
  btnAbrir.addEventListener('click', () => {
    painelChat.classList.add('aberto');
    btnAbrir.setAttribute('aria-expanded', 'true');
    entrada.focus();
  });
  document.getElementById('btnFecharChat').addEventListener('click', () => {
    painelChat.classList.remove('aberto');
    btnAbrir.setAttribute('aria-expanded', 'false');
    btnAbrir.focus();
  });

  renderizarTudo();
  verificarIA();
  setInterval(verificarIA, 60000);
})();
