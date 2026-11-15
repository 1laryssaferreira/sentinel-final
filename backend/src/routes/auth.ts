import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { JWT_SECRET } from '../middleware/authMiddleware';
import type { RowDataPacket } from 'mysql2';

const router = Router();

interface UsuarioRow extends RowDataPacket {
  id: number;
  nome: string;
  email: string;
  senha_hash: string;
  papel: string;
}

function gerarToken(usuario: { id: number; nome: string; email: string; papel: string }) {
  return jwt.sign(usuario, JWT_SECRET, { expiresIn: '12h' });
}

// POST /api/auth/registro
router.post('/registro', async (req: Request, res: Response) => {
  const { nome, email, senha } = req.body;

  if (!nome || nome.trim().length < 3) {
    return res.status(400).json({ erro: 'Informe o nome completo.' });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  if (!senha || senha.length < 8 || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    return res.status(400).json({ erro: 'A senha precisa ter 8+ caracteres, uma letra maiúscula e um número.' });
  }

  try {
    const [existentes] = await pool.query<UsuarioRow[]>('SELECT id FROM usuarios WHERE email = ?', [email.toLowerCase()]);
    if (existentes.length > 0) {
      return res.status(409).json({ erro: 'Já existe uma conta cadastrada com este e-mail.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const [resultado]: any = await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)',
      [nome.trim(), email.toLowerCase(), senhaHash, 'Operador']
    );

    const usuario = { id: resultado.insertId, nome: nome.trim(), email: email.toLowerCase(), papel: 'Operador' };
    const token = gerarToken(usuario);

    res.status(201).json({ usuario, token });
  } catch (erro) {
    console.error('Erro ao registrar usuário:', erro);
    res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Verifique a conexão com o MySQL.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  }

  try {
    const [linhas] = await pool.query<UsuarioRow[]>(
      'SELECT id, nome, email, senha_hash, papel FROM usuarios WHERE email = ?',
      [email.toLowerCase()]
    );

    const usuarioEncontrado = linhas[0];
    if (!usuarioEncontrado) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }

    const senhaConfere = await bcrypt.compare(senha, usuarioEncontrado.senha_hash);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }

    const usuario = {
      id: usuarioEncontrado.id,
      nome: usuarioEncontrado.nome,
      email: usuarioEncontrado.email,
      papel: usuarioEncontrado.papel
    };
    const token = gerarToken(usuario);

    res.json({ usuario, token });
  } catch (erro) {
    console.error('Erro ao autenticar usuário:', erro);
    res.status(500).json({ erro: 'Não foi possível autenticar. Verifique a conexão com o MySQL.' });
  }
});

export default router;
