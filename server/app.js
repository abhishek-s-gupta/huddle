const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { helmetMiddleware, csrfCookieMiddleware, csrfProtection } = require('./middleware/security');
const { optionalAuth, requireAuth, requireAdmin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');

const app = express();

// Trust reverse proxy if any (for IP rate limiting and secure headers)
app.set('trust proxy', 1);

// Security headers with CSP
app.use(helmetMiddleware);

// Body parsers & Cookie parser
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// CSRF cookie setup for all requests
app.use(csrfCookieMiddleware);

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'allow' }));

// API Routes
// Note: csrfProtection protects mutating requests (/api/auth/signup, /api/auth/login, etc.)
app.use('/api/auth', csrfProtection, authRoutes);

// Placeholder mount points for subsequent milestones (lazy loaded if file exists)
app.use('/api/rooms', (req, res, next) => {
  try {
    const roomsRoutes = require('./routes/rooms');
    return csrfProtection(req, res, () => roomsRoutes(req, res, next));
  } catch (err) {
    next();
  }
});

app.use('/api/files', (req, res, next) => {
  try {
    const filesRoutes = require('./routes/files');
    return filesRoutes(req, res, next);
  } catch (err) {
    next();
  }
});

app.use('/api/admin', (req, res, next) => {
  try {
    const adminRoutes = require('./routes/admin');
    return csrfProtection(req, res, () => adminRoutes(req, res, next));
  } catch (err) {
    next();
  }
});

const sendFileOpts = { dotfiles: 'allow' };

// Page Routes
app.get('/', optionalAuth, (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'), sendFileOpts);
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'), sendFileOpts);
});

app.get('/lobby/:code', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'lobby.html'), sendFileOpts);
});

app.get('/room/:code', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'room.html'), sendFileOpts);
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'), sendFileOpts);
});

// Custom 404 handler
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'), sendFileOpts);
  }
  return res.status(404).json({ error: 'Resource not found' });
});

// Custom 500 handler
app.use((err, req, res, next) => {
  console.error('Unhandled application error:', err);
  if (req.accepts('html')) {
    return res.status(500).sendFile(path.join(__dirname, '..', 'public', '500.html'), sendFileOpts);
  }
  return res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
