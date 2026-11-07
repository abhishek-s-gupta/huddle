const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const { Server } = require('socket.io');
const app = require('./app');
const config = require('./config');
const { authenticateSocket } = require('./middleware/auth');

let server;
let protocol = 'http';

if (config.useHttps) {
  if (fs.existsSync(config.sslKeyPath) && fs.existsSync(config.sslCertPath)) {
    const key = fs.readFileSync(config.sslKeyPath);
    const cert = fs.readFileSync(config.sslCertPath);
    server = https.createServer({ key, cert }, app);
    protocol = 'https';
  } else {
    console.warn('⚠️  USE_HTTPS is true but SSL certificates not found at configured paths.');
    console.warn('    Run `npm run cert` to generate self-signed certificates. Falling back to HTTP.');
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

// Socket.io configuration
const io = new Server(server, {
  cors: {
    origin: '*',
    credentials: true
  },
  maxHttpBufferSize: 1e7 // 10MB
});

// Authenticate socket handshake using session JWT
io.use(authenticateSocket);

// Initialize socket handlers
try {
  const initSockets = require('./sockets');
  initSockets(io);
} catch (err) {
  // Socket modules will be attached in Milestone 2
}

server.listen(config.port, () => {
  console.log(`\n==================================================`);
  console.log(`  🚀 Huddle real-time conferencing server online`);
  console.log(`  Protocol: ${protocol.toUpperCase()}`);
  console.log(`  Local:    ${protocol}://localhost:${config.port}`);

  // Print LAN IP addresses for mobile testing on Wi-Fi
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  Network:  ${protocol}://${iface.address}:${config.port}`);
      }
    }
  }
  console.log(`==================================================\n`);
});

module.exports = { server, io };
