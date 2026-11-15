import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'sentinel-dev-secret-troque-em-producao';

export interface RequisicaoAutenticada extends Request {
  usuario?: { id: number; nome: string; email: string; papel: string };
}

/**
 * Middleware opcional: se vier um token válido, anexa o usuário em req.usuario.
 * Não bloqueia a requisição sem token — várias rotas do painel (sensores,
 * eventos) fazem sentido também em modo "operador não identificado" para
 * não travar a demonstração acadêmica caso o login não seja usado.
 */
export function autenticacaoOpcional(req: RequisicaoAutenticada, _res: Response, next: NextFunction) {
  const cabecalho = req.headers.authorization;
  if (cabecalho?.startsWith('Bearer ')) {
    try {
      const token = cabecalho.substring(7);
      req.usuario = jwt.verify(token, JWT_SECRET) as RequisicaoAutenticada['usuario'];
    } catch {
      // Token inválido/expirado: segue sem usuário autenticado.
    }
  }
  next();
}

/** Middleware estrito: exige token válido (usado em rotas administrativas). */
export function exigirAutenticacao(req: RequisicaoAutenticada, res: Response, next: NextFunction) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho?.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de autenticação ausente.' });
  }
  try {
    const token = cabecalho.substring(7);
    req.usuario = jwt.verify(token, JWT_SECRET) as RequisicaoAutenticada['usuario'];
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

export { JWT_SECRET };
