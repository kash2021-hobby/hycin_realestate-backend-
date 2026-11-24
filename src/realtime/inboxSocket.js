import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { authorizeInboxSocket } from '../integrations/inboxRules.js';

export function attachInboxSocket(server, env) {
  const io = new Server(server, {
    cors: { origin: true, credentials: true },
  });
  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token || '', env.jwt.accessSecret);
      const auth = authorizeInboxSocket(payload);
      if (!auth) return next(new Error('unauthorized'));
      socket.data.tenantId = auth.tenantId;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`tenant:${socket.data.tenantId}`);
  });
  return io;
}
