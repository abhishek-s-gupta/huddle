const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/database');
const { authLimiter } = require('../middleware/rateLimiter');
const { optionalAuth, requireAuth } = require('../middleware/auth');

const router = express.Router();

function setAuthCookie(req, res, token) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || config.useHttps;
  res.cookie('token', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function logAuthEvent(userId, eventType, req, details = null) {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const ua = req.headers['user-agent'] || 'unknown';
    db.prepare(`
      INSERT INTO audit_logs (user_id, event_type, ip_address, user_agent, details, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(userId, eventType, ip, ua, details);
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// POST /api/auth/signup
router.post('/signup', authLimiter, (req, res) => {
  const { email, password, displayName } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = (displayName || '').trim();

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Display name must be at least 2 characters.' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    // Check if first registered user -> promote to admin automatically
    const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const isAdmin = countRow.count === 0 ? 1 : 0;

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const now = new Date().toISOString();

    const insertResult = db.prepare(`
      INSERT INTO users (email, password_hash, display_name, is_admin, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanEmail, passwordHash, cleanName, isAdmin, now);

    const userId = insertResult.lastInsertRowid;
    logAuthEvent(userId, 'SIGNUP', req, isAdmin ? 'First user - promoted to admin' : null);

    const token = jwt.sign(
      { userId, email: cleanEmail, isAdmin: Boolean(isAdmin) },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    setAuthCookie(req, res, token);

    return res.status(201).json({
      success: true,
      user: {
        id: userId,
        email: cleanEmail,
        displayName: cleanName,
        isAdmin: Boolean(isAdmin)
      }
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Server error during registration. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    logAuthEvent(user.id, 'LOGIN', req);

    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: Boolean(user.is_admin) },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    setAuthCookie(req, res, token);

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        isAdmin: Boolean(user.is_admin)
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error during login. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', optionalAuth, (req, res) => {
  if (req.user) {
    logAuthEvent(req.user.id, 'LOGOUT', req);
  }
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || config.useHttps;
  res.clearCookie('token', {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'strict',
    path: '/'
  });
  return res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  return res.json({ user: req.user });
});

module.exports = router;
