import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Lê sql/schema.sql e executa cada instrução no servidor MySQL configurado
 * no .env. Roda sem selecionar um banco de antemão porque o próprio script
 * cria o banco `sentinel_db` (ou o nome definido em DB_NAME) se ele não existir.
 */
async function migrar() {
  const caminhoSchema = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sqlCompleto = fs.readFileSync(caminhoSchema, 'utf-8');

  const conexao = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    console.log('▶ Executando sql/schema.sql ...');
    await conexao.query(sqlCompleto);
    console.log('✅ Schema do Sentinel criado/atualizado com sucesso.');

    await conexao.query(`USE ${process.env.DB_NAME || 'sentinel_db'}`);
    const senhaHash = await bcrypt.hash('Sentinel123', 10);
    await conexao.query(
      `INSERT IGNORE INTO usuarios (nome, email, senha_hash, papel)
       VALUES ('Operador Sentinel', 'operador@sentinel.com', ?, 'Administrador')`,
      [senhaHash]
    );
    console.log('✅ Usuário de demonstração pronto: operador@sentinel.com / Sentinel123');
  } finally {
    await conexao.end();
  }
}

migrar().catch((erro) => {
  console.error('❌ Erro ao rodar a migração:', erro);
  process.exit(1);
});
