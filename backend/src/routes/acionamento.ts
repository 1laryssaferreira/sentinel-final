import { Router, Request, Response } from 'express';
import { pool } from '../db';
import type { RowDataPacket } from 'mysql2';
import { emitirParaPaineis } from '../tempoReal';

const router = Router();

interface AcionamentoRow extends RowDataPacket {
  id: number;
  servico: 'POLICIA' | 'BOMBEIROS';
  motivo: string;
  risco_no_momento: number;
  automatico: number;
  status: string;
  criado_em: string;
}

// GET /api/acionamento?limite=20 — histórico de chamadas de emergência (manuais e automáticas)
router.get('/', async (req: Request, res: Response) => {
  const limite = Math.min(Number(req.query.limite) || 20, 100);

  try {
    const [linhas] = await pool.query<AcionamentoRow[]>(
      'SELECT id, servico, motivo, risco_no_momento, automatico, status, criado_em FROM acionamentos ORDER BY id DESC LIMIT ?',
      [limite]
    );
    res.json(linhas);
  } catch (erro) {
    console.error('Erro ao listar acionamentos:', erro);
    res.status(500).json({ erro: 'Não foi possível consultar o histórico de acionamentos.' });
  }
});

// POST /api/acionamento — registra o disparo de um protocolo de emergência
// (chamado tanto pelos botões manuais quanto pelo protocolo automático do
// motor de risco quando o índice ultrapassa o limiar crítico).
router.post('/', async (req: Request, res: Response) => {
  const { servico, motivo, riscoNoMomento, automatico } = req.body;
  const servicosValidos = ['POLICIA', 'BOMBEIROS'];

  if (!servicosValidos.includes(servico)) {
    return res.status(400).json({ erro: `Serviço inválido. Use um de: ${servicosValidos.join(', ')}` });
  }
  if (!motivo || String(motivo).trim().length === 0) {
    return res.status(400).json({ erro: 'Informe o motivo do acionamento.' });
  }

  try {
    const [resultado]: any = await pool.query(
      'INSERT INTO acionamentos (servico, motivo, risco_no_momento, automatico, status) VALUES (?, ?, ?, ?, ?)',
      [servico, motivo, riscoNoMomento ?? 0, automatico ? 1 : 0, 'ACIONADO']
    );

    emitirParaPaineis('acionamento:novo', { servico, motivo, automatico: Boolean(automatico) });
    res.status(201).json({
      id: resultado.insertId,
      servico,
      motivo,
      riscoNoMomento: riscoNoMomento ?? 0,
      automatico: Boolean(automatico)
    });
  } catch (erro) {
    console.error('Erro ao registrar acionamento:', erro);
    res.status(500).json({ erro: 'Não foi possível registrar o acionamento no MySQL.' });
  }
});

export default router;
