import type { Server as SocketIOServer } from 'socket.io';

// Ponte simples pra qualquer rota avisar os painéis abertos, em tempo
// real, que algo aconteceu (evento novo, acesso, acionamento). Assim
// dois operadores com o painel aberto veem a mesma coisa sem recarregar.
let io: SocketIOServer | null = null;

export function registrarSocket(servidor: SocketIOServer) {
  io = servidor;
}

export function emitirParaPaineis(evento: string, dados: unknown) {
  io?.to('paineis').emit(evento, dados);
}
