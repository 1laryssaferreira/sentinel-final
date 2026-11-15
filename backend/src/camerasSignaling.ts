import type { Server as SocketIOServer, Socket } from 'socket.io';

// ==========================================================
// SINALIZAÇÃO DE CÂMERAS (WebRTC)
//
// O vídeo NUNCA passa pelo servidor: vai direto do celular para o
// navegador do painel (ponto a ponto). Aqui só trocamos os
// "convites" (offer / answer / ICE) e alguns comandos remotos.
//
// Novidades da v3:
//  - o painel pode mandar comandos pro celular (trocar câmera
//    frontal/traseira, lanterna, qualidade);
//  - o celular informa o que suporta (tem lanterna? quantas câmeras?)
//    e o nível de bateria, que aparece no tile do painel;
//  - todos os painéis entram também na sala "paineis", usada pra
//    receber eventos em tempo real (ver tempoReal.ts).
// ==========================================================

const SALA_PADRAO = 'sentinel-casa';

interface CameraConectada {
  socketId: string;
  nome: string;
  recursos?: Record<string, unknown>;
}

export function configurarSinalizacaoCameras(io: SocketIOServer) {
  const camerasPorSala = new Map<string, Map<string, CameraConectada>>();

  io.on('connection', (socket: Socket) => {
    socket.on('painel:entrar', (sala: string = SALA_PADRAO) => {
      socket.join(sala);
      socket.join('paineis');
      socket.data.sala = sala;
      socket.data.papel = 'painel';

      for (const camera of camerasPorSala.get(sala)?.values() || []) {
        socket.emit('camera:nova', camera);
      }
    });

    socket.on('camera:entrar', ({ sala = SALA_PADRAO, nome, recursos }: { sala?: string; nome: string; recursos?: Record<string, unknown> }) => {
      const nomeLimpo = String(nome || 'Celular').slice(0, 40);
      socket.join(sala);
      socket.data.sala = sala;
      socket.data.papel = 'camera';

      if (!camerasPorSala.has(sala)) camerasPorSala.set(sala, new Map());
      const camera = { socketId: socket.id, nome: nomeLimpo, recursos };
      camerasPorSala.get(sala)!.set(socket.id, camera);

      socket.to(sala).emit('camera:nova', camera);
    });

    // Celular avisando bateria, câmera em uso, lanterna etc.
    socket.on('camera:status', (status: Record<string, unknown>) => {
      const sala = socket.data.sala as string | undefined;
      if (sala) socket.to(sala).emit('camera:status', { socketId: socket.id, ...status });
    });

    // Painel mandando um comando para um celular específico.
    socket.on('camera:comando', ({ paraSocketId, comando, valor }: { paraSocketId: string; comando: string; valor?: unknown }) => {
      io.to(paraSocketId).emit('camera:comando', { deSocketId: socket.id, comando, valor });
    });

    socket.on('sinal:offer', ({ paraSocketId, offer }: { paraSocketId: string; offer: unknown }) => {
      io.to(paraSocketId).emit('sinal:offer', { deSocketId: socket.id, offer });
    });

    socket.on('sinal:answer', ({ paraSocketId, answer }: { paraSocketId: string; answer: unknown }) => {
      io.to(paraSocketId).emit('sinal:answer', { deSocketId: socket.id, answer });
    });

    socket.on('sinal:ice-candidate', ({ paraSocketId, candidate }: { paraSocketId: string; candidate: unknown }) => {
      io.to(paraSocketId).emit('sinal:ice-candidate', { deSocketId: socket.id, candidate });
    });

    socket.on('disconnect', () => {
      const sala = socket.data.sala as string | undefined;
      if (!sala) return;
      if (socket.data.papel === 'camera') {
        camerasPorSala.get(sala)?.delete(socket.id);
        socket.to(sala).emit('camera:saiu', { socketId: socket.id });
      } else if (socket.data.papel === 'painel') {
        // Avisa os celulares pra liberar a conexão WebRTC daquele painel.
        socket.to(sala).emit('painel:saiu', { socketId: socket.id });
      }
    });
  });
}
