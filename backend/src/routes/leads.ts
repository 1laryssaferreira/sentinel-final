import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// POST /api/leads — formulário "Falar com um especialista" do site de vendas
router.post('/', async (req: Request, res: Response) => {
  const { nome, email, telefone, plano, mensagem } = req.body || {};

  if (!nome || String(nome).trim().length < 2) {
    return res.status(400).json({ erro: 'Informe seu nome.' });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }

  try {
    const [resultado]: any = await pool.query(
      'INSERT INTO leads (nome, email, telefone, plano, mensagem) VALUES (?, ?, ?, ?, ?)',
      [
        String(nome).trim().slice(0, 120),
        String(email).trim().toLowerCase().slice(0, 160),
        telefone ? String(telefone).slice(0, 30) : null,
        plano ? String(plano).slice(0, 40) : null,
        mensagem ? String(mensagem).slice(0, 1000) : null
      ]
    );
    res.status(201).json({ id: resultado.insertId });
  } catch (erro) {
    console.error('Erro ao registrar lead:', erro);
    res.status(500).json({ erro: 'Não foi possível enviar agora. Tente pelo WhatsApp.' });
  }
});

export default router;
