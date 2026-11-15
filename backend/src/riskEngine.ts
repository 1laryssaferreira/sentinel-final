export interface EstadoSensores {
  portaPrincipal: boolean;
  janelaSala: boolean;
  incendioDetectado: boolean;
  gasDetectado: boolean;
  alertaPolicial: boolean;
}

export const estadoAtual: EstadoSensores = {
  portaPrincipal: false,
  janelaSala: false,
  incendioDetectado: false,
  gasDetectado: false,
  alertaPolicial: false
};

/** Limiar a partir do qual o protocolo automático de acionamento é disparado. */
export const LIMIAR_RISCO_CRITICO = 90;

/**
 * Recalcula o índice preditivo de risco (0-100) a partir do estado atual
 * dos sensores. Mantido no back-end para que o risco "oficial" do sistema
 * não dependa apenas do front-end (ex.: múltiplos operadores conectados).
 */
export function calcularRisco(estado: EstadoSensores = estadoAtual): number {
  let score = 10;

  if (estado.portaPrincipal) score += 25;
  if (estado.janelaSala) score += 20;
  if (estado.gasDetectado) score += 50;
  if (estado.incendioDetectado) score += 70;
  if (estado.alertaPolicial) score += 90;

  return Math.min(score, 100);
}

/** Decide, a partir do risco, qual serviço de emergência deve ser acionado automaticamente. */
export function definirServicoAutomatico(estado: EstadoSensores = estadoAtual): 'POLICIA' | 'BOMBEIROS' | null {
  if (estado.incendioDetectado || estado.gasDetectado) return 'BOMBEIROS';
  if (estado.alertaPolicial) return 'POLICIA';
  return null;
}
