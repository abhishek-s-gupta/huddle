const crypto = require('crypto');
const helmet = require('helmet');

// Content Security Policy configured for WebRTC, Socket.io, and Canvas
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "wss:", "ws:"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:", "mediastream:"],
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

/**
 * Generates and sets a CSRF token cookie if not present
 */
function csrfCookieMiddleware(req, res, next) {
  if (!req.cookies || !req.cookies.csrf_token) {
    const token = crypto.randomBytes(24).toString('hex');
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.USE_HTTPS === 'true';
    res.cookie('csrf_token', token, {
      httpOnly: false, // Accessible by frontend JS to attach as header
      secure: isHttps,
      sameSite: 'strict',
      path: '/'
    });
  }
  next();
}

/**
 * Validates CSRF token on state-changing methods (POST, PUT, PATCH, DELETE)
 */
function csrfProtection(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies ? req.cookies.csrf_token : null;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  next();
}

module.exports = {
  helmetMiddleware,
  csrfCookieMiddleware,
  csrfProtection
};
