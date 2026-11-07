const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'huddle_default_jwt_secret_must_be_changed_in_prod_123',
  fileEncryptionKey: process.env.FILE_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  useHttps: process.env.USE_HTTPS === 'true',
  sslKeyPath: process.env.SSL_KEY_PATH || path.join(__dirname, '..', 'certs', 'key.pem'),
  sslCertPath: process.env.SSL_CERT_PATH || path.join(__dirname, '..', 'certs', 'cert.pem'),
  dbPath: path.join(__dirname, '..', 'data', 'huddle.sqlite'),
  uploadsDir: path.join(__dirname, '..', 'data', 'uploads'),
  turn: {
    urls: process.env.TURN_URLS ? process.env.TURN_URLS.split(',') : [],
    username: process.env.TURN_USERNAME || '',
    credential: process.env.TURN_CREDENTIAL || ''
  }
};
