const rateLimit = require('express-rate-limit');

// Rate limiter for authentication (login / signup)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

// Rate limiter for room creation and joining
const roomLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to room operations, please slow down.' }
});

module.exports = {
  authLimiter,
  roomLimiter
};
