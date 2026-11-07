const SocketManager = require('./signaling');

module.exports = function initSockets(io) {
  const manager = new SocketManager(io);

  io.on('connection', (socket) => {
    manager.handleConnection(socket);
  });

  return manager;
};
