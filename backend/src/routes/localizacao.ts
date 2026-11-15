import { Router, Request, Response } from 'express';
import { pool } from '../db';
import type { RowDataPacket } from 'mysql2';

const router = Router();

interface LocalizacaoRow extends RowDataPacket {
  id: number;
  latitude: number;
  longitude: number;
  precisao_metros: number | null;
  origem: string;
  criado_em: string;
}

// POST /api/localizacao — recebe uma leitura da Geolocation API do navegador
router.post('/', async (req: Request, res: Response) => {
  const { latitude, longitude, precisao, origem } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ erro: 'Envie latitude e longitude numéricas.' });
  }

  try {
    const [resultado]: any = await pool.query(
      'INSERT INTO localizacoes (latitude, longitude, precisao_metros, origem) VALUES (?, ?, ?, ?)',
      [latitude, longitude, precisao ?? null, origem || 'Navegador']
    );

    res.status(201).json({ id: resultado.insertId, latitude, longitude, precisao: precisao ?? null });
  } catch (erro) {
    console.error('Erro ao registrar localização:', erro);
    res.status(500).json({ erro: 'Não foi possível registrar a localização no MySQL.' });
  }
});

// GET /api/localizacao/ultima — última posição conhecida da residência/operador
router.get('/ultima', async (_req: Request, res: Response) => {
  try {
    const [linhas] = await pool.query<LocalizacaoRow[]>(
      'SELECT id, latitude, longitude, precisao_metros, origem, criado_em FROM localizacoes ORDER BY id DESC LIMIT 1'
    );
    res.json(linhas[0] || null);
  } catch (erro) {
    console.error('Erro ao consultar última localização:', erro);
    res.status(500).json({ erro: 'Não foi possível consultar a localização.' });
  }
});

export default router;
