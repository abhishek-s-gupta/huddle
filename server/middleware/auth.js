const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/database');

/**
 * Parses user from JWT token (from cookie or Bearer header)
 */
function getUserFromToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT id, email, display_name, is_admin FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isAdmin: Boolean(user.is_admin)
    };
  } catch (err) {
    return null;
  }
}

/**
 * Express middleware to populate req.user if token is present
 */
function optionalAuth(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  req.user = getUserFromToken(token);
  next();
}

/**
 * Express middleware enforcing authenticated session
 */
function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      if (req.accepts('html') && req.method === 'GET') {
        return res.redirect('/?redirect=' + encodeURIComponent(req.originalUrl));
      }
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  });
}

/**
 * Express middleware enforcing admin access (first user registered or is_admin = 1)
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      if (req.accepts('html') && req.method === 'GET') {
        return res.status(403).sendFile(require('path').join(__dirname, '..', '..', 'public', '403.html'), { dotfiles: 'allow' });
      }
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
  });
}

/**
 * Socket.io handshake authentication middleware
 */
function authenticateSocket(socket, next) {
  try {
    // Parse cookie from socket handshake headers
    const cookieHeader = socket.handshake.headers.cookie;
    let token = null;

    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, c) => {
        const [k, v] = c.trim().split('=');
        if (k && v) acc[k] = decodeURIComponent(v);
        return acc;
      }, {});
      token = cookies.token;
    }

    // Also check handshake auth object if provided
    if (!token && socket.handshake.auth?.token) {
      token = socket.handshake.auth.token;
    }

    const user = getUserFromToken(token);
    if (!user) {
      return next(new Error('Authentication failed: invalid or missing session'));
    }

    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication error: ' + err.message));
  }
}

module.exports = {
  getUserFromToken,
  optionalAuth,
  requireAuth,
  requireAdmin,
  authenticateSocket
};
