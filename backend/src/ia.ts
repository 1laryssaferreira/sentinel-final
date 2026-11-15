import { pool } from './db';

// ==========================================================
// SENTINEL IA — chatbot com modelo de linguagem de verdade
//
// O assistente agora conversa usando um LLM (Claude, da Anthropic,
// ou qualquer API compatível com OpenAI — inclusive o Ollama, que
// roda de graça no seu próprio computador).
//
// Como ele "faz coisas" no painel: usamos *tool calling*. Passamos
// pro modelo uma lista de ferramentas (trancar porta, ligar câmera,
// acionar polícia...). Quando ele decide usar uma, a gente:
//   - executa aqui mesmo, no servidor, se for uma CONSULTA ao banco
//     (histórico de eventos, tentativas de acesso);
//   - devolve pro front-end como "ação", se for algo que mexe no
//     painel (porta, câmeras, emergência). O front executa.
//
// Se nenhuma IA estiver configurada no .env, a rota responde 503 e
// o front-end cai no motor local de regras (assistente.js).
// ==========================================================

export interface MensagemChat {
  papel: 'usuario' | 'assistente';
  texto: string;
}

export interface AcaoPainel {
  nome: string;
  argumentos: Record<string, unknown>;
}

export interface RespostaIA {
  resposta: string;
  acoes: AcaoPainel[];
  provedor: string;
  modelo: string;
}

type Provedor = 'anthropic' | 'openai' | 'off';

export function configuracaoIA(): { provedor: Provedor; modelo: string } {
  const escolhido = (process.env.IA_PROVEDOR || '').toLowerCase();

  if (escolhido === 'off') return { provedor: 'off', modelo: '' };
  if (escolhido === 'openai' || (!escolhido && !process.env.ANTHROPIC_API_KEY && process.env.OPENAI_BASE_URL)) {
    return { provedor: 'openai', modelo: process.env.OPENAI_MODEL || 'llama3.1' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provedor: 'anthropic', modelo: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5' };
  }
  return { provedor: 'off', modelo: '' };
}

// ----------------------------------------------------------
// Ferramentas que o modelo pode usar
// ----------------------------------------------------------
interface Ferramenta {
  nome: string;
  descricao: string;
  parametros: Record<string, unknown>;
  /** 'servidor' = executa aqui (consulta ao MySQL); 'painel' = vira ação no front-end */
  onde: 'servidor' | 'painel';
}

const FERRAMENTAS: Ferramenta[] = [
  {
    nome: 'definir_porta',
    descricao: 'Tranca ou destranca a fechadura eletrônica da porta principal.',
    parametros: {
      type: 'object',
      properties: { estado: { type: 'string', enum: ['trancada', 'aberta'] } },
      required: ['estado']
    },
    onde: 'painel'
  },
  {
    nome: 'definir_reconhecimento_facial',
    descricao: 'Liga ou desliga o reconhecimento facial em uma câmera ativa. Use o id exato da câmera que aparece no estado do sistema.',
    parametros: {
      type: 'object',
      properties: {
        camera_id: { type: 'string' },
        ativo: { type: 'boolean' }
      },
      required: ['camera_id', 'ativo']
    },
    onde: 'painel'
  },
  {
    nome: 'definir_deteccao_movimento',
    descricao: 'Liga ou desliga a detecção de movimento em uma câmera ativa.',
    parametros: {
      type: 'object',
      properties: {
        camera_id: { type: 'string' },
        ativo: { type: 'boolean' }
      },
      required: ['camera_id', 'ativo']
    },
    onde: 'painel'
  },
  {
    nome: 'capturar_foto',
    descricao: 'Tira uma foto (snapshot) de uma câmera ativa e salva no computador do operador.',
    parametros: {
      type: 'object',
      properties: { camera_id: { type: 'string' } },
      required: ['camera_id']
    },
    onde: 'painel'
  },
  {
    nome: 'gravar_camera',
    descricao: 'Começa ou para a gravação de vídeo de uma câmera ativa.',
    parametros: {
      type: 'object',
      properties: {
        camera_id: { type: 'string' },
        gravar: { type: 'boolean' }
      },
      required: ['camera_id', 'gravar']
    },
    onde: 'painel'
  },
  {
    nome: 'abrir_secao',
    descricao: 'Rola o painel até uma seção para o operador ver.',
    parametros: {
      type: 'object',
      properties: { secao: { type: 'string', enum: ['cameras', 'planta', 'acesso', 'eventos', 'localizacao'] } },
      required: ['secao']
    },
    onde: 'painel'
  },
  {
    nome: 'acionar_emergencia',
    descricao:
      'Aciona a Polícia Militar (190) ou o Corpo de Bombeiros (193). Use SOMENTE quando o operador pedir explicitamente ' +
      'ou quando ele descrever uma emergência real em andamento (invasão, fogo, vazamento de gás, alguém ferido).',
    parametros: {
      type: 'object',
      properties: {
        servico: { type: 'string', enum: ['POLICIA', 'BOMBEIROS'] },
        motivo: { type: 'string' }
      },
      required: ['servico', 'motivo']
    },
    onde: 'painel'
  },
  {
    nome: 'consultar_eventos',
    descricao: 'Busca no banco de dados os eventos mais recentes do sistema (sensores, portas, câmeras, alertas).',
    parametros: {
      type: 'object',
      properties: { limite: { type: 'integer', minimum: 1, maximum: 30 } }
    },
    onde: 'servidor'
  },
  {
    nome: 'consultar_acessos',
    descricao: 'Busca no banco de dados as últimas tentativas de acesso por reconhecimento facial (quem entrou, quem foi negado).',
    parametros: {
      type: 'object',
      properties: { limite: { type: 'integer', minimum: 1, maximum: 30 } }
    },
    onde: 'servidor'
  },
  {
    nome: 'consultar_acionamentos',
    descricao: 'Busca no banco de dados o histórico de chamadas de emergência (polícia/bombeiros), manuais e automáticas.',
    parametros: {
      type: 'object',
      properties: { limite: { type: 'integer', minimum: 1, maximum: 30 } }
    },
    onde: 'servidor'
  }
];

async function executarFerramentaServidor(nome: string, args: any): Promise<string> {
  const limite = Math.min(Math.max(Number(args?.limite) || 10, 1), 30);
  try {
    if (nome === 'consultar_eventos') {
      const [linhas] = await pool.query('SELECT tipo, status, criado_em FROM eventos ORDER BY id DESC LIMIT ?', [limite]);
      return JSON.stringify(linhas);
    }
    if (nome === 'consultar_acessos') {
      const [linhas] = await pool.query(
        `SELECT r.nome AS residente, t.resultado, t.origem, t.criado_em
         FROM tentativas_acesso t LEFT JOIN residentes_autorizados r ON r.id = t.residente_id
         ORDER BY t.id DESC LIMIT ?`,
        [limite]
      );
      return JSON.stringify(linhas);
    }
    if (nome === 'consultar_acionamentos') {
      const [linhas] = await pool.query(
        'SELECT servico, motivo, risco_no_momento, automatico, criado_em FROM acionamentos ORDER BY id DESC LIMIT ?',
        [limite]
      );
      return JSON.stringify(linhas);
    }
  } catch (erro) {
    return JSON.stringify({ erro: 'Banco de dados indisponível no momento.' });
  }
  return JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` });
}

function montarPromptSistema(estado: unknown, nomeOperador: string): string {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return [
    'Você é a Sentinel, assistente de uma central de monitoramento residencial.',
    `Você está falando com ${nomeOperador}, que opera o painel. Data e hora: ${agora}.`,
    '',
    'Como responder:',
    '- Português do Brasil, frases curtas e diretas, tom calmo e profissional. Sem markdown pesado; no máximo listas curtas.',
    '- Baseie-se SOMENTE no estado do sistema abaixo e no que as ferramentas de consulta retornarem. Se não souber, diga que não sabe.',
    '- Quando o operador pedir uma ação (trancar porta, ligar IA numa câmera, gravar, tirar foto), use a ferramenta correspondente e confirme em uma frase.',
    '- Se ele citar uma câmera pelo nome ("a do quintal"), descubra o camera_id na lista de câmeras do estado.',
    '- Se o pedido for ambíguo (duas câmeras parecidas), pergunte qual antes de agir.',
    '- Só acione polícia ou bombeiros com pedido explícito ou emergência real descrita. Em dúvida, pergunte.',
    '- Em risco alto, comece pela informação mais importante e diga o que o operador deve fazer agora.',
    '- Você não vê as imagens das câmeras; sabe apenas o que o estado e o histórico informam.',
    '',
    'Estado atual do sistema (JSON enviado pelo painel):',
    JSON.stringify(estado, null, 2)
  ].join('\n');
}

const MAX_RODADAS = 4;

// ----------------------------------------------------------
// Provedor Anthropic (Claude) — Messages API com tool use
// ----------------------------------------------------------
async function conversarAnthropic(historico: MensagemChat[], sistema: string, modelo: string): Promise<RespostaIA> {
  const mensagens: any[] = historico.map(m => ({
    role: m.papel === 'usuario' ? 'user' : 'assistant',
    content: m.texto
  }));
  const ferramentas = FERRAMENTAS.map(f => ({ name: f.nome, description: f.descricao, input_schema: f.parametros }));
  const acoes: AcaoPainel[] = [];
  let textoFinal = '';

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: modelo, max_tokens: 800, system: sistema, tools: ferramentas, messages: mensagens })
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`Anthropic ${resposta.status}: ${corpo.slice(0, 300)}`);
    }

    const dados: any = await resposta.json();
    const blocos: any[] = dados.content || [];
    textoFinal = blocos.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || textoFinal;

    const usos = blocos.filter(b => b.type === 'tool_use');
    if (!usos.length || dados.stop_reason !== 'tool_use') break;

    mensagens.push({ role: 'assistant', content: blocos });
    const resultados = [];
    for (const uso of usos) {
      const ferramenta = FERRAMENTAS.find(f => f.nome === uso.name);
      let conteudo: string;
      if (ferramenta?.onde === 'servidor') {
        conteudo = await executarFerramentaServidor(uso.name, uso.input);
      } else {
        acoes.push({ nome: uso.name, argumentos: uso.input || {} });
        conteudo = 'Ação enviada ao painel e executada.';
      }
      resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: conteudo });
    }
    mensagens.push({ role: 'user', content: resultados });
  }

  return { resposta: textoFinal || 'Feito.', acoes, provedor: 'anthropic', modelo };
}

// ----------------------------------------------------------
// Provedor compatível com OpenAI (OpenAI, Groq, Ollama local...)
// ----------------------------------------------------------
async function conversarOpenAI(historico: MensagemChat[], sistema: string, modelo: string): Promise<RespostaIA> {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const mensagens: any[] = [
    { role: 'system', content: sistema },
    ...historico.map(m => ({ role: m.papel === 'usuario' ? 'user' : 'assistant', content: m.texto }))
  ];
  const ferramentas = FERRAMENTAS.map(f => ({
    type: 'function',
    function: { name: f.nome, description: f.descricao, parameters: f.parametros }
  }));
  const acoes: AcaoPainel[] = [];
  let textoFinal = '';

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resposta = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.OPENAI_API_KEY ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {})
      },
      body: JSON.stringify({ model: modelo, messages: mensagens, tools: ferramentas, temperature: 0.3 })
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`OpenAI-compatível ${resposta.status}: ${corpo.slice(0, 300)}`);
    }

    const dados: any = await resposta.json();
    const mensagem = dados.choices?.[0]?.message || {};
    if (mensagem.content) textoFinal = String(mensagem.content).trim();

    const chamadas: any[] = mensagem.tool_calls || [];
    if (!chamadas.length) break;

    mensagens.push(mensagem);
    for (const chamada of chamadas) {
      const nome = chamada.function?.name;
      let args: any = {};
      try { args = JSON.parse(chamada.function?.arguments || '{}'); } catch { /* argumentos inválidos */ }

      const ferramenta = FERRAMENTAS.find(f => f.nome === nome);
      let conteudo: string;
      if (ferramenta?.onde === 'servidor') {
        conteudo = await executarFerramentaServidor(nome, args);
      } else {
        acoes.push({ nome, argumentos: args });
        conteudo = 'Ação enviada ao painel e executada.';
      }
      mensagens.push({ role: 'tool', tool_call_id: chamada.id, content: conteudo });
    }
  }

  return { resposta: textoFinal || 'Feito.', acoes, provedor: 'openai', modelo };
}

export async function conversar(historico: MensagemChat[], estado: unknown, nomeOperador: string): Promise<RespostaIA> {
  const { provedor, modelo } = configuracaoIA();
  if (provedor === 'off') throw new Error('IA_DESLIGADA');

  // Mantém só as últimas trocas: o estado do sistema já vai inteiro no
  // prompt, então não precisa mandar a conversa inteira toda vez.
  const recorte = historico.slice(-12).filter(m => m.texto && m.texto.trim());
  while (recorte.length && recorte[0].papel !== 'usuario') recorte.shift();

  const sistema = montarPromptSistema(estado, nomeOperador);
  return provedor === 'anthropic'
    ? conversarAnthropic(recorte, sistema, modelo)
    : conversarOpenAI(recorte, sistema, modelo);
}
