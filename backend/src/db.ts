import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Pool de conexões com o MySQL. Reutilizar o pool evita abrir uma conexão
// nova a cada requisição, o que é essencial num sistema que recebe eventos
// de sensores em tempo real.
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sentinel_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

/**
 * Testa a conexão com o banco assim que o servidor sobe.
 * Não derruba o processo se falhar — o painel deve continuar funcionando
 * em modo degradado (sem persistência) e reportar o status via /api/status.
 */
export async function testarConexaoBanco(): Promise<boolean> {
  try {
    const conexao = await pool.getConnection();
    await conexao.ping();
    conexao.release();
    console.log('✅ Conectado ao MySQL:', process.env.DB_NAME || 'sentinel_db');
    return true;
  } catch (erro) {
    console.error('❌ Falha ao conectar no MySQL. O Sentinel seguirá em modo degradado.', erro);
    return false;
  }
}
