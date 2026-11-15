import os from 'os';
import { Router } from 'express';
import { pool } from '../db';
import { configuracaoIA } from '../ia';

const router = Router();

// Endereços IPv4 desta máquina na rede local — o painel usa isso pra
// montar o QR Code que o celular escaneia pra virar câmera.
function ipsDaRede(): string[] {
  const ips: string[] = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
    }
  }
  // Redes domésticas comuns primeiro (192.168.x.x), depois o resto.
  return ips.sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}

router.get('/rede', (_req, res) => {
  res.json({
    ips: ipsDaRede(),
    portaHttp: Number(process.env.PORT) || 3001,
    portaHttps: process.env.HTTPS === 'true' ? Number(process.env.HTTPS_PORT) || 3443 : null
  });
});

router.get('/saude', async (_req, res) => {
  let banco = false;
  try {
    await pool.query('SELECT 1');
    banco = true;
  } catch { /* modo degradado */ }
  const ia = configuracaoIA();
  res.json({ servidor: 'online', banco, ia: ia.provedor !== 'off' ? `${ia.provedor}:${ia.modelo}` : 'local', versao: '3.0.0' });
});

export default router;
