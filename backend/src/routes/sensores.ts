import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { emitirParaPaineis } from '../tempoReal';
import { estadoAtual, calcularRisco, definirServicoAutomatico, LIMIAR_RISCO_CRITICO } from '../riskEngine';

const router = Router();

const CAMPO_PARA_SENSOR: Record<string, string> = {
  portaPrincipal: 'porta_principal',
  janelaSala: 'janela_sala',
  incendioDetectado: 'sensor_fumaca',
  gasDetectado: 'sensor_gas'
};

// Evita disparar o mesmo serviço de emergência repetidamente a cada
// atualização de sensor enquanto o risco continuar crítico.
const ultimoAcionamentoAutomatico: Record<string, number> = {};
const COOLDOWN_MS = 60_000;

async function registrarAcionamentoAutomatico(servico: 'POLICIA' | 'BOMBEIROS', motivo: string, risco: number) {
  const agora = Date.now();
  if (agora - (ultimoAcionamentoAutomatico[servico] || 0) < COOLDOWN_MS) return;
  ultimoAcionamentoAutomatico[servico] = agora;

  await pool.query(
    'INSERT INTO acionamentos (servico, motivo, risco_no_momento, automatico, status) VALUES (?, ?, ?, 1, ?)',
    [servico, motivo, risco, 'ACIONADO']
  );
}

// PUT /api/sensores/:campo  { estado: boolean }
// campo ∈ portaPrincipal | janelaSala | incendioDetectado | gasDetectado | alertaPolicial
router.put('/:campo', async (req: Request, res: Response) => {
  const campo = String(req.params.campo);
  const { estado } = req.body;

  if (!(campo in estadoAtual)) {
    return res.status(400).json({ erro: `Sensor desconhecido: ${campo}` });
  }
  if (typeof estado !== 'boolean') {
    return res.status(400).json({ erro: 'Envie { "estado": true|false }.' });
  }

  (estadoAtual as any)[campo] = estado;
  const risco = calcularRisco(estadoAtual);

  const nomeSensor = CAMPO_PARA_SENSOR[campo];
  if (nomeSensor) {
    try {
      await pool.query('UPDATE sensores_estado SET estado = ? WHERE nome = ?', [
        estado ? 'ATIVO' : 'NORMAL',
        nomeSensor
      ]);
    } catch (erro) {
      console.error('Erro ao persistir estado do sensor:', erro);
    }
  }

  // Protocolo automático de acionamento: quando o risco atinge o limiar
  // crítico, o próprio back-end aciona o serviço de emergência adequado,
  // sem depender de o operador clicar em nenhum botão.
  if (risco >= LIMIAR_RISCO_CRITICO) {
    const servico = definirServicoAutomatico(estadoAtual);
    if (servico) {
      try {
        await registrarAcionamentoAutomatico(
          servico,
          `Protocolo automático: risco crítico (${risco}%) — sensor "${campo}" alterado`,
          risco
        );
      } catch (erro) {
        console.error('Erro ao registrar acionamento automático:', erro);
      }
    }
  }

  emitirParaPaineis('sensores:atualizados', { estado: estadoAtual, risco });
  res.json({ estado: estadoAtual, risco });
});

// GET /api/sensores — estado atual consolidado + risco calculado no servidor
router.get('/', (_req: Request, res: Response) => {
  res.json({ estado: estadoAtual, risco: calcularRisco(estadoAtual) });
});

export default router;
