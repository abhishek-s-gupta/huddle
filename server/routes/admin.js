const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/overview
router.get('/overview', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, email, display_name, is_admin, created_at 
      FROM users 
      ORDER BY id ASC
    `).all().map(u => ({
      ...u,
      isAdmin: Boolean(u.is_admin)
    }));

    const activeRooms = db.prepare(`
      SELECT 
        r.id,
        r.code,
        r.title,
        r.is_locked,
        r.created_at,
        u.display_name as host_name,
        u.email as host_email,
        (SELECT COUNT(*) FROM room_participants WHERE room_id = r.id AND left_at IS NULL) as active_participants
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      WHERE r.is_ended = 0
      ORDER BY r.created_at DESC
    `).all().map(r => ({
      ...r,
      isLocked: Boolean(r.is_locked),
      activeParticipants: r.active_participants || 0
    }));

    const stats = {
      totalUsers: users.length,
      activeRoomsCount: activeRooms.length,
      totalRoomsCount: db.prepare('SELECT COUNT(*) as count FROM rooms').get().count,
      totalAuditLogs: db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count
    };

    return res.json({ users, activeRooms, stats });
  } catch (err) {
    console.error('Admin overview error:', err);
    return res.status(500).json({ error: 'Failed to load admin overview.' });
  }
});

// POST /api/admin/rooms/:code/end - Forcibly end an active room
router.post('/rooms/:code/end', requireAdmin, (req, res) => {
  const code = req.params.code.trim();

  try {
    const room = db.prepare('SELECT id, is_ended FROM rooms WHERE code = ?').get(code);
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    if (room.is_ended) {
      return res.json({ message: 'Room has already ended.' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE rooms SET is_ended = 1, ended_at = ? WHERE id = ?').run(now, room.id);
    db.prepare('UPDATE room_participants SET left_at = ? WHERE room_id = ? AND left_at IS NULL').run(now, room.id);

    db.prepare(`
      INSERT INTO audit_logs (user_id, event_type, details, created_at)
      VALUES (?, 'ADMIN_END_ROOM', ?, ?)
    `).run(req.user.id, `Terminated room ${code}`, now);

    // Notify active sockets via global signaling manager if available
    if (global.huddleSocketManager) {
      global.huddleSocketManager.endRoom(code, 'Meeting was terminated by an administrator.');
    }

    return res.json({ success: true, message: `Room ${code} has been ended.` });
  } catch (err) {
    console.error('Admin end room error:', err);
    return res.status(500).json({ error: 'Failed to terminate room.' });
  }
});

module.exports = router;
