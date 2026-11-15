import { Router, Request, Response } from 'express';
import { pool } from '../db';
import type { RowDataPacket } from 'mysql2';
import { emitirParaPaineis } from '../tempoReal';

const router = Router();

interface ResidenteRow extends RowDataPacket {
  id: number;
  nome: string;
  documento_id: string | null;
  ativo: number;
  criado_em: string;
}

interface TentativaRow extends RowDataPacket {
  id: number;
  residente_id: number | null;
  residente_nome: string | null;
  resultado: 'AUTORIZADO' | 'NEGADO' | 'PROCURADO';
  origem: string;
  criado_em: string;
}

// GET /api/controle-acesso/residentes — lista de moradores cadastrados no Control ID
router.get('/residentes', async (_req: Request, res: Response) => {
  try {
    const [linhas] = await pool.query<ResidenteRow[]>(
      'SELECT id, nome, documento_id, ativo, criado_em FROM residentes_autorizados ORDER BY id DESC'
    );
    res.json(linhas);
  } catch (erro) {
    console.error('Erro ao listar residentes:', erro);
    res.status(500).json({ erro: 'Não foi possível consultar os residentes cadastrados.' });
  }
});

// POST /api/controle-acesso/residentes — cadastra um morador com sua biometria facial
router.post('/residentes', async (req: Request, res: Response) => {
  const { nome, documentoId } = req.body;

  if (!nome || nome.trim().length < 2) {
    return res.status(400).json({ erro: 'Informe o nome do residente.' });
  }
  const descritorFacial = req.body.descritorFacial == null ? null : normalizarVetor(req.body.descritorFacial);
  if (req.body.descritorFacial != null && !descritorFacial) {
    return res.status(400).json({ erro: 'descritorFacial precisa ser uma lista com 128 números.' });
  }

  try {
    const [resultado]: any = await pool.query(
      'INSERT INTO residentes_autorizados (nome, documento_id, descritor_facial) VALUES (?, ?, ?)',
      [nome.trim(), documentoId || null, descritorFacial ? JSON.stringify(descritorFacial) : null]
    );
    emitirParaPaineis('residente:novo', { id: resultado.insertId, nome: nome.trim() });
    res.status(201).json({ id: resultado.insertId, nome: nome.trim(), documentoId: documentoId || null });
  } catch (erro) {
    console.error('Erro ao cadastrar residente:', erro);
    res.status(500).json({ erro: 'Não foi possível cadastrar o residente no MySQL.' });
  }
});

// DELETE /api/controle-acesso/residentes/:id — remove um morador (e sua biometria)
router.delete('/residentes/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID inválido.' });
  try {
    await pool.query('DELETE FROM residentes_autorizados WHERE id = ?', [id]);
    res.status(204).end();
  } catch (erro) {
    console.error('Erro ao remover residente:', erro);
    res.status(500).json({ erro: 'Não foi possível remover o residente.' });
  }
});

// GET /api/controle-acesso/tentativas?limite=20 — histórico de reconhecimento facial
router.get('/tentativas', async (req: Request, res: Response) => {
  const limite = Math.min(Number(req.query.limite) || 20, 100);

  try {
    const [linhas] = await pool.query<TentativaRow[]>(
      `SELECT t.id, t.residente_id, r.nome AS residente_nome, t.resultado, t.origem, t.criado_em
       FROM tentativas_acesso t
       LEFT JOIN residentes_autorizados r ON r.id = t.residente_id
       ORDER BY t.id DESC LIMIT ?`,
      [limite]
    );
    res.json(linhas);
  } catch (erro) {
    console.error('Erro ao listar tentativas de acesso:', erro);
    res.status(500).json({ erro: 'Não foi possível consultar o histórico de acessos.' });
  }
});

// Distância euclidiana entre dois vetores faciais (128 pontos gerados pelo
// face-api.js). Quanto menor a distância, mais parecidos são os rostos.
// Converte o vetor do rosto para uma lista de 128 números.
// Correção do erro da apresentação: o navegador enviava o vetor como
// Float32Array, que vira um OBJETO no JSON ({"0": -0.08, "1": ...}).
// Ele era salvo assim no MySQL e, na comparação, o objeto não tinha
// .length: a distância dava 0 e QUALQUER rosto era reconhecido como a
// primeira pessoa cadastrada. Aqui aceitamos os dois formatos (inclusive
// cadastros antigos já salvos como objeto) e devolvemos sempre uma lista.
function normalizarVetor(valor: unknown): number[] | null {
  let dado: any = valor;
  if (typeof dado === 'string') {
    try { dado = JSON.parse(dado); } catch { return null; }
  }
  if (dado && !Array.isArray(dado) && typeof dado === 'object') {
    dado = Object.keys(dado).sort((a, b) => Number(a) - Number(b)).map(k => dado[k]);
  }
  if (!Array.isArray(dado) || dado.length !== 128) return null;
  const numeros = dado.map(Number);
  return numeros.every(Number.isFinite) ? numeros : null;
}

function calcularDistanciaEuclidiana(vetorA: number[], vetorB: number[]): number {
  // Vetores de tamanhos diferentes nunca são considerados o mesmo rosto.
  if (vetorA.length !== 128 || vetorB.length !== 128) return Infinity;
  let soma = 0;
  for (let i = 0; i < 128; i++) {
    const diferenca = vetorA[i] - vetorB[i];
    soma += diferenca * diferenca;
  }
  return Math.sqrt(soma);
}

// Abaixo desse valor, consideramos que é a mesma pessoa.
// Começamos com 0.5, mas na apresentação duas pessoas diferentes foram
// reconhecidas como a mesma: com webcam comum e o detector rápido
// (TinyFaceDetector), rostos diferentes podem ficar entre 0.45 e 0.55.
// Por isso o limite agora é 0.45 (mais rigoroso) e pode ser ajustado no .env.
const LIMITE_TOLERANCIA_FACIAL = Number(process.env.LIMITE_FACIAL) || 0.45;

// Se o rosto estiver quase igual distante de dois moradores, não dá para
// saber quem é: negamos em vez de "chutar" um dos dois.
const MARGEM_AMBIGUIDADE = 0.06;

interface ResidenteComDescritorRow extends RowDataPacket {
  id: number;
  nome: string;
  descritor_facial: string | null;
}

// POST /api/controle-acesso/autenticar — compara um rosto lido pela câmera
// (em qualquer dispositivo: webcam do PC ou câmera do celular) contra TODOS
// os residentes cadastrados no MySQL, e já registra a tentativa de acesso.
// Isso é o que faz o reconhecimento facial funcionar de verdade entre
// sessões/dispositivos — antes, a comparação só existia na memória do
// navegador que tinha feito o cadastro.
router.post('/autenticar', async (req: Request, res: Response) => {
  // registrar=false: só compara, sem gravar no histórico. O painel usa
  // isso a cada leitura (2-3 s) e só registra quando a pessoa muda ou a
  // cada 30 s — senão o banco ganharia uma linha por segundo.
  const { origem, registrar = true } = req.body;
  const descritorFacial = normalizarVetor(req.body.descritorFacial);

  if (!descritorFacial) {
    return res.status(400).json({ erro: 'descritorFacial precisa ser um vetor com 128 posições.' });
  }

  try {
    const [residentes] = await pool.query<ResidenteComDescritorRow[]>(
      'SELECT id, nome, descritor_facial FROM residentes_autorizados WHERE ativo = 1 AND descritor_facial IS NOT NULL'
    );

    let melhor: { id: number; nome: string; distancia: number } | null = null;
    let segundaMenor = Infinity; // distância do segundo morador mais parecido

    for (const residente of residentes) {
      const vetorSalvo = normalizarVetor(residente.descritor_facial);
      if (!vetorSalvo) continue; // cadastro com vetor inválido é ignorado

      const distancia = calcularDistanciaEuclidiana(descritorFacial, vetorSalvo);
      if (!melhor || distancia < melhor.distancia) {
        if (melhor) segundaMenor = melhor.distancia;
        melhor = { id: residente.id, nome: residente.nome, distancia };
      } else if (distancia < segundaMenor) {
        segundaMenor = distancia;
      }
    }

    const parecido = melhor !== null && melhor.distancia < LIMITE_TOLERANCIA_FACIAL;
    const ambiguo = parecido && segundaMenor - melhor!.distancia < MARGEM_AMBIGUIDADE;
    const autorizado = parecido && !ambiguo;

    // Já registra a tentativa aqui mesmo, pra qualquer câmera (PC ou
    // celular) ficar salva no mesmo histórico, sem depender do front-end
    // fazer uma segunda chamada.
    if (registrar !== false) {
      await pool.query(
        'INSERT INTO tentativas_acesso (residente_id, resultado, origem) VALUES (?, ?, ?)',
        [autorizado ? melhor!.id : null, autorizado ? 'AUTORIZADO' : 'NEGADO', origem || 'Reconhecimento Facial']
      );
      emitirParaPaineis('acesso:novo', {
        resultado: autorizado ? 'AUTORIZADO' : 'NEGADO',
        nome: autorizado ? melhor!.nome : null,
        origem: origem || 'Reconhecimento Facial'
      });
    }

    if (autorizado) {
      return res.json({
        status: 'AUTORIZADO',
        residenteId: melhor!.id,
        nome: melhor!.nome,
        distancia: Number(melhor!.distancia.toFixed(3)),
        limite: LIMITE_TOLERANCIA_FACIAL
      });
    }

    return res.status(200).json({
      status: 'NEGADO',
      nome: null,
      motivo: ambiguo ? 'AMBIGUO' : 'DESCONHECIDO',
      distancia: melhor ? Number(melhor.distancia.toFixed(3)) : null,
      limite: LIMITE_TOLERANCIA_FACIAL
    });
  } catch (erro) {
    console.error('Erro ao autenticar rosto:', erro);
    res.status(500).json({ erro: 'Não foi possível comparar o rosto com o banco de dados.' });
  }
});

// POST /api/controle-acesso/tentativas — registra o resultado de uma checagem da IA facial
router.post('/tentativas', async (req: Request, res: Response) => {
  const { residenteId, resultado, origem } = req.body;
  const resultadosValidos = ['AUTORIZADO', 'NEGADO', 'PROCURADO'];

  if (!resultadosValidos.includes(resultado)) {
    return res.status(400).json({ erro: `Resultado inválido. Use um de: ${resultadosValidos.join(', ')}` });
  }

  try {
    const [inserido]: any = await pool.query(
      'INSERT INTO tentativas_acesso (residente_id, resultado, origem) VALUES (?, ?, ?)',
      [residenteId || null, resultado, origem || 'Reconhecimento Facial']
    );
    emitirParaPaineis('acesso:novo', { resultado, residenteId: residenteId || null, origem: origem || 'Reconhecimento Facial' });
    res.status(201).json({ id: inserido.insertId, resultado });
  } catch (erro) {
    console.error('Erro ao registrar tentativa de acesso:', erro);
    res.status(500).json({ erro: 'Não foi possível registrar a tentativa de acesso no MySQL.' });
  }
});

export default router;
