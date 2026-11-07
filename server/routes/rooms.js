const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { roomLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Generate a readable 9-character code like "hud-482-917"
function generateRoomCode() {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz'; // readable charset without ambiguous chars (0/o, 1/l)
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 3; i++) {
    part1 += chars[crypto.randomInt(0, chars.length)];
    part2 += chars[crypto.randomInt(0, chars.length)];
  }
  return `hud-${part1}-${part2}`;
}

// POST /api/rooms - Create a new room
router.post('/', requireAuth, roomLimiter, (req, res) => {
  const { title, passcode } = req.body;
  const roomTitle = (title || 'Instant Meeting').trim();
  const hostId = req.user.id;
  const now = new Date().toISOString();

  let passcodeHash = null;
  if (passcode && passcode.trim().length > 0) {
    if (passcode.trim().length < 4) {
      return res.status(400).json({ error: 'Room passcode must be at least 4 characters.' });
    }
    passcodeHash = bcrypt.hashSync(passcode.trim(), 10);
  }

  // Ensure unique code
  let code = generateRoomCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = db.prepare('SELECT id FROM rooms WHERE code = ?').get(code);
    if (!existing) break;
    code = generateRoomCode();
    attempts++;
  }

  try {
    const insert = db.prepare(`
      INSERT INTO rooms (code, title, host_id, passcode_hash, is_locked, is_ended, created_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `).run(code, roomTitle, hostId, passcodeHash, now);

    // Record host in audit log
    db.prepare(`
      INSERT INTO audit_logs (user_id, event_type, ip_address, user_agent, details, created_at)
      VALUES (?, 'CREATE_ROOM', ?, ?, ?, ?)
    `).run(hostId, req.ip || '', req.headers['user-agent'] || '', `Room ${code}`, now);

    return res.status(201).json({
      success: true,
      room: {
        id: insert.lastInsertRowid,
        code,
        title: roomTitle,
        hasPasscode: Boolean(passcodeHash),
        isHost: true,
        createdAt: now
      }
    });
  } catch (err) {
    console.error('Create room error:', err);
    return res.status(500).json({ error: 'Failed to create room.' });
  }
});

// GET /api/rooms/history - Meeting history for current user
router.get('/history', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    // Find all rooms where user was host or participant
    const rows = db.prepare(`
      SELECT 
        r.id,
        r.code,
        r.title,
        r.host_id,
        u.display_name as host_name,
        r.is_ended,
        r.created_at,
        r.ended_at,
        rp.role,
        rp.joined_at,
        rp.left_at,
        (SELECT COUNT(DISTINCT user_id) FROM room_participants WHERE room_id = r.id) as participant_count
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      LEFT JOIN room_participants rp ON rp.room_id = r.id AND rp.user_id = ?
      WHERE r.host_id = ? OR rp.user_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all(userId, userId, userId);

    const history = rows.map(r => {
      let durationMinutes = null;
      if (r.joined_at && r.left_at) {
        const diffMs = new Date(r.left_at) - new Date(r.joined_at);
        durationMinutes = Math.max(1, Math.round(diffMs / 60000));
      } else if (r.created_at && r.ended_at) {
        const diffMs = new Date(r.ended_at) - new Date(r.created_at);
        durationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }

      return {
        id: r.id,
        code: r.code,
        title: r.title,
        hostName: r.host_name,
        isHost: r.host_id === userId,
        isEnded: Boolean(r.is_ended),
        createdAt: r.created_at,
        durationMinutes,
        participantCount: Math.max(1, r.participant_count || 1)
      };
    });

    return res.json({ history });
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: 'Failed to retrieve meeting history.' });
  }
});

// GET /api/rooms/:code - Room metadata & join eligibility
router.get('/:code', requireAuth, (req, res) => {
  try {
    const code = req.params.code.trim();
    const room = db.prepare(`
      SELECT r.*, u.display_name as host_name 
      FROM rooms r 
      JOIN users u ON r.host_id = u.id 
      WHERE r.code = ?
    `).get(code);

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    if (room.is_ended) {
      return res.status(410).json({ error: 'This meeting has ended.' });
    }

    const isHost = room.host_id === req.user.id;

    if (room.is_locked && !isHost && !req.user.isAdmin) {
      return res.status(423).json({ error: 'This room is currently locked by the host.' });
    }

    return res.json({
      code: room.code,
      title: room.title,
      hostName: room.host_name,
      isHost,
      isLocked: Boolean(room.is_locked),
      requiresPasscode: Boolean(room.passcode_hash) && !isHost
    });
  } catch (err) {
    console.error('Get room error:', err);
    return res.status(500).json({ error: 'Server error retrieving room details.' });
  }
});

// POST /api/rooms/:code/verify-passcode - Verify passcode
router.post('/:code/verify-passcode', requireAuth, roomLimiter, (req, res) => {
  const { passcode } = req.body;
  const code = req.params.code.trim();

  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  if (!room.passcode_hash) {
    return res.json({ verified: true });
  }

  if (!passcode) {
    return res.status(400).json({ error: 'Passcode is required.' });
  }

  const isMatch = bcrypt.compareSync(passcode, room.passcode_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Incorrect passcode.' });
  }

  return res.json({ verified: true });
});

module.exports = router;
