import { getMissionStore } from './missionStore.js';
// Starts the Express HTTP server and attaches the Socket.IO server.
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socketHandlers.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
getMissionStore(); // Open/migrate SQLite before accepting connections.

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  registerSocketHandlers(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`CODE RED server listening on http://localhost:${PORT}`);
});
