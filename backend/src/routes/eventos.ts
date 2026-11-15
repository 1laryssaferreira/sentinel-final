import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { autenticacaoOpcional, RequisicaoAutenticada } from '../middleware/authMiddleware';
import type { RowDataPacket } from 'mysql2';
import { emitirParaPaineis } from '../tempoReal';

const router = Router();

interface EventoRow extends RowDataPacket {
  id: number;
  tipo: string;
  status: string;
  criado_em: string;
}

// GET /api/eventos?limite=50 — histórico mais recente primeiro
router.get('/', async (req: Request, res: Response) => {
  const limite = Math.min(Number(req.query.limite) || 50, 200);

  try {
    const [linhas] = await pool.query<EventoRow[]>(
      'SELECT id, tipo, status, criado_em AS timestamp FROM eventos ORDER BY id DESC LIMIT ?',
      [limite]
    );
    const [[{ total }]]: any = await pool.query('SELECT COUNT(*) AS total FROM eventos');

    res.json({ status: 'Operacional', conexao: 'Estável', totalLogs: total, logs: linhas });
  } catch (erro) {
    console.error('Erro ao listar eventos:', erro);
    res.status(500).json({ erro: 'Não foi possível consultar o histórico de eventos.' });
  }
});

// POST /api/eventos — registra um novo evento (sensor, IA, chatbot, operador...)
router.post('/', autenticacaoOpcional, async (req: RequisicaoAutenticada, res: Response) => {
  const { tipo, status } = req.body;
  const tipoFinal = tipo || 'Geral';
  const statusFinal = status || 'Atualizado';

  try {
    const [resultado]: any = await pool.query(
      'INSERT INTO eventos (tipo, status, usuario_id) VALUES (?, ?, ?)',
      [tipoFinal, statusFinal, req.usuario?.id ?? null]
    );

    const [linhas] = await pool.query<EventoRow[]>(
      'SELECT id, tipo, status, criado_em AS timestamp FROM eventos WHERE id = ?',
      [resultado.insertId]
    );

    emitirParaPaineis('evento:novo', linhas[0]);
    res.status(201).json({ mensagem: 'Evento registrado com sucesso.', log: linhas[0] });
  } catch (erro) {
    console.error('Erro ao registrar evento:', erro);
    res.status(500).json({ erro: 'Não foi possível registrar o evento no MySQL.' });
  }
});

export default router;
