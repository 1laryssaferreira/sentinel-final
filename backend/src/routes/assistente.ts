import { Router, Response } from 'express';
import { conversar, configuracaoIA, MensagemChat } from '../ia';
import { exigirAutenticacao, RequisicaoAutenticada } from '../middleware/authMiddleware';

const router = Router();

// Limite simples por operador: evita gastar crédito de API à toa
// (ex.: alguém segurando o Enter). 20 mensagens por minuto.
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 20;
const uso = new Map<number, number[]>();

function dentroDoLimite(usuarioId: number): boolean {
  const agora = Date.now();
  const recentes = (uso.get(usuarioId) || []).filter(t => agora - t < JANELA_MS);
  if (recentes.length >= MAX_POR_JANELA) return false;
  recentes.push(agora);
  uso.set(usuarioId, recentes);
  return true;
}

// GET /api/assistente/status — o painel usa pra mostrar "IA conectada" ou "modo local"
// ---------------------------------------------------------------
// Desempenho da IA local (pedido da banca: dimensionar RAM e latência).
// Guardamos o tempo das últimas respostas para calcular a média.
// ---------------------------------------------------------------
const latencias: number[] = [];

function registrarLatencia(ms: number) {
  latencias.push(ms);
  if (latencias.length > 50) latencias.shift();
}

// Pergunta ao Ollama quanta memória o modelo carregado está usando (rota /api/ps).
async function memoriaDoModeloMB(): Promise<number | null> {
  const base = (process.env.OPENAI_BASE_URL || '').replace(/\/v1\/?$/, '');
  if (!base) return null;
  try {
    const r = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(1500) });
    const dados: any = await r.json();
    const total = (dados.models || []).reduce((soma: number, m: any) => soma + (m.size || 0), 0);
    return total ? Math.round(total / 1024 / 1024) : null;
  } catch {
    return null;
  }
}

router.get('/status', async (_req, res) => {
  const { provedor, modelo } = configuracaoIA();
  const media = latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;
  res.json({
    ativo: provedor !== 'off',
    provedor,
    modelo,
    desempenho: {
      respostasMedidas: latencias.length,
      ultimaLatenciaMs: latencias.length ? latencias[latencias.length - 1] : null,
      mediaLatenciaMs: media,
      memoriaModeloMB: provedor === 'openai' ? await memoriaDoModeloMB() : null
    }
  });
});

// POST /api/assistente/chat  { mensagens: [{papel, texto}], estado: {...} }
router.post('/chat', exigirAutenticacao, async (req: RequisicaoAutenticada, res: Response) => {
  const { mensagens, estado } = req.body || {};

  if (!Array.isArray(mensagens) || !mensagens.length) {
    return res.status(400).json({ erro: 'Envie o histórico em "mensagens".' });
  }
  const historico: MensagemChat[] = mensagens
    .filter((m: any) => (m?.papel === 'usuario' || m?.papel === 'assistente') && typeof m?.texto === 'string')
    .map((m: any) => ({ papel: m.papel, texto: String(m.texto).slice(0, 2000) }));

  if (!dentroDoLimite(req.usuario!.id)) {
    return res.status(429).json({ erro: 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.' });
  }

  try {
    const inicio = Date.now();
    const resultado = await conversar(historico, estado ?? {}, req.usuario!.nome);
    const tempoMs = Date.now() - inicio;
    registrarLatencia(tempoMs);
    console.log(`🧠 ${resultado.modelo} respondeu em ${(tempoMs / 1000).toFixed(1)} s (${resultado.acoes.length} ação(ões))`);
    res.json({ ...resultado, tempoMs });
  } catch (erro: any) {
    if (erro?.message === 'IA_DESLIGADA') {
      return res.status(503).json({ erro: 'Nenhuma IA configurada no servidor.', fallback: true });
    }
    console.error('Erro no assistente de IA:', erro);
    res.status(502).json({ erro: 'A IA não respondeu. Usando o modo local.', fallback: true });
  }
});

export default router;
