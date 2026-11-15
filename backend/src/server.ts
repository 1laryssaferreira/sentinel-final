import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { testarConexaoBanco } from './db';

import authRoutes from './routes/auth';
import eventosRoutes from './routes/eventos';
import localizacaoRoutes from './routes/localizacao';
import acessoRoutes from './routes/acesso';
import acionamentoRoutes from './routes/acionamento';
import sensoresRoutes from './routes/sensores';
import assistenteRoutes from './routes/assistente';
import sistemaRoutes from './routes/sistema';
import leadsRoutes from './routes/leads';
import { configurarSinalizacaoCameras } from './camerasSignaling';
import { registrarSocket } from './tempoReal';
import { configuracaoIA } from './ia';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const PASTA_FRONTEND = path.join(__dirname, '..', '..', 'frontend');

app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(express.static(PASTA_FRONTEND, { extensions: ['html'] }));

app.use('/api/auth', authRoutes);
app.use('/api/eventos', eventosRoutes);
app.use('/api/localizacao', localizacaoRoutes);
app.use('/api/controle-acesso', acessoRoutes);
app.use('/api/acionamento', acionamentoRoutes);
app.use('/api/sensores', sensoresRoutes);
app.use('/api/assistente', assistenteRoutes);
app.use('/api/sistema', sistemaRoutes);
app.use('/api/leads', leadsRoutes);

app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// ----------------------------------------------------------
// HTTP (sempre) + HTTPS (opcional, pra câmera do celular)
//
// Por que HTTPS? O navegador do celular só libera a câmera
// (getUserMedia) em "contexto seguro": localhost ou HTTPS. Abrindo
// http://192.168.0.x:3001 no celular, o Chrome/Safari BLOQUEIA a
// câmera. Com HTTPS=true no .env, o servidor gera um certificado
// autoassinado e sobe também em https://<ip>:3443 — no celular,
// aceite o aviso de "conexão não particular" uma vez e pronto.
// ----------------------------------------------------------
const servidores: (http.Server | https.Server)[] = [http.createServer(app)];

async function criarServidorHttps(): Promise<https.Server | null> {
  if (process.env.HTTPS !== 'true') return null;
  const pastaCert = path.join(__dirname, '..', 'certs');
  const chave = path.join(pastaCert, 'chave.pem');
  const cert = path.join(pastaCert, 'cert.pem');

  try {
    if (!fs.existsSync(chave) || !fs.existsSync(cert)) {
      const selfsigned = require('selfsigned');
      const gerado = await Promise.resolve(
        selfsigned.generate([{ name: 'commonName', value: 'sentinel.local' }], { days: 825, keySize: 2048 })
      );
      fs.mkdirSync(pastaCert, { recursive: true });
      fs.writeFileSync(chave, gerado.private);
      fs.writeFileSync(cert, gerado.cert);
      console.log('🔐 Certificado autoassinado gerado em backend/certs/');
    }
    return https.createServer({ key: fs.readFileSync(chave), cert: fs.readFileSync(cert) }, app);
  } catch (erro) {
    console.error('⚠️  Não foi possível ativar HTTPS (rode "npm install"):', erro);
    return null;
  }
}

async function iniciar() {
  const servidorHttps = await criarServidorHttps();
  if (servidorHttps) servidores.push(servidorHttps);

  // Um único Socket.IO atendendo os dois servidores: um painel em
  // HTTP e um celular em HTTPS ficam na mesma sala.
  const io = new SocketIOServer({ cors: { origin: '*' }, maxHttpBufferSize: 1e6 });
  servidores.forEach(s => io.attach(s));
  configurarSinalizacaoCameras(io);
  registrarSocket(io);

  servidores[0].listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sentinel no ar:        http://localhost:${PORT}`);
  });
  servidorHttps?.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`🔐 HTTPS (câmera celular): https://<ip-do-pc>:${HTTPS_PORT}/celular.html`);
  });

  const ia = configuracaoIA();
  console.log(ia.provedor === 'off'
    ? '🤖 Assistente: modo local (configure ANTHROPIC_API_KEY ou OPENAI_BASE_URL no .env para IA de verdade)'
    : `🤖 Assistente: ${ia.provedor} / ${ia.modelo}`);
  await testarConexaoBanco();
}

iniciar();
