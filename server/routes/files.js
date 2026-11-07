const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { encryptFileBuffer, decryptFileBuffer } = require('../crypto/serverCrypto');

const router = express.Router();

// Memory storage for incoming upload before encrypting to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100 MB max
  }
});

// Sanitize filename to prevent directory traversal and invalid characters
function sanitizeFilename(originalName) {
  if (!originalName) return 'unnamed_file';
  // Strip paths
  const base = path.basename(originalName);
  // Replace dangerous/illegal characters with underscore
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// POST /api/files/upload - Upload file with AES-256-GCM encryption at rest
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const roomCode = req.body.roomCode;
  if (!roomCode) {
    return res.status(400).json({ error: 'Room code is required.' });
  }

  const room = db.prepare('SELECT id, is_ended FROM rooms WHERE code = ?').get(roomCode.trim());
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  if (room.is_ended) {
    return res.status(400).json({ error: 'Cannot upload files to an ended room.' });
  }

  const sanitizedName = sanitizeFilename(req.file.originalname);
  const mimeType = req.file.mimetype || 'application/octet-stream';
  const sizeBytes = req.file.size;
  const now = new Date().toISOString();

  try {
    // Encrypt file buffer with AES-256-GCM
    const { encryptedData, iv, authTag } = encryptFileBuffer(req.file.buffer);

    // Save encrypted file to disk with unique stored name
    const storedName = `${Date.now()}_${crypto.randomUUID()}.enc`;
    const targetPath = path.join(config.uploadsDir, storedName);

    fs.writeFileSync(targetPath, encryptedData);

    // Store metadata in SQLite
    const insert = db.prepare(`
      INSERT INTO files (room_id, uploader_id, original_name, stored_name, mime_type, size_bytes, iv, auth_tag, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(room.id, req.user.id, sanitizedName, storedName, mimeType, sizeBytes, iv, authTag, now);

    const fileRecord = {
      id: insert.lastInsertRowid,
      roomCode,
      originalName: sanitizedName,
      sizeBytes,
      mimeType,
      uploaderId: req.user.id,
      uploaderName: req.user.displayName,
      uploadedAt: now
    };

    // Notify room participants via Socket.io if manager is available
    if (global.huddleSocketManager) {
      global.huddleSocketManager.io.to(`room:${roomCode}`).emit('file-uploaded', fileRecord);
    }

    return res.status(201).json({ success: true, file: fileRecord });
  } catch (err) {
    console.error('File upload/encryption error:', err);
    return res.status(500).json({ error: 'Failed to securely store file.' });
  }
});

// GET /api/files/room/:code - List files uploaded to room
router.get('/room/:code', requireAuth, (req, res) => {
  const roomCode = req.params.code.trim();
  const room = db.prepare('SELECT id FROM rooms WHERE code = ?').get(roomCode);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  try {
    const files = db.prepare(`
      SELECT f.id, f.original_name, f.size_bytes, f.mime_type, f.uploaded_at, u.display_name as uploader_name
      FROM files f
      JOIN users u ON f.uploader_id = u.id
      WHERE f.room_id = ?
      ORDER BY f.uploaded_at DESC
    `).all(room.id).map(f => ({
      id: f.id,
      originalName: f.original_name,
      sizeBytes: f.size_bytes,
      mimeType: f.mime_type,
      uploaderName: f.uploader_name,
      uploadedAt: f.uploaded_at
    }));

    return res.json({ files });
  } catch (err) {
    console.error('List files error:', err);
    return res.status(500).json({ error: 'Failed to retrieve room files.' });
  }
});

// GET /api/files/:id/download - Decrypt and download file
router.get('/:id/download', requireAuth, (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'Invalid file ID.' });
  }

  try {
    const file = db.prepare(`
      SELECT f.*, r.code as room_code
      FROM files f
      JOIN rooms r ON f.room_id = r.id
      WHERE f.id = ?
    `).get(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    // Verify user is authorized: must be host or participant of the room
    const isParticipant = db.prepare(`
      SELECT id FROM room_participants 
      WHERE room_id = ? AND user_id = ?
    `).get(file.room_id, req.user.id);

    const isHost = db.prepare(`
      SELECT id FROM rooms WHERE id = ? AND host_id = ?
    `).get(file.room_id, req.user.id);

    if (!isParticipant && !isHost && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You are not authorized to download this file.' });
    }

    const filePath = path.join(config.uploadsDir, file.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Stored file missing on disk.' });
    }

    // Read encrypted payload and decrypt
    const encryptedBuffer = fs.readFileSync(filePath);
    const decryptedBuffer = decryptFileBuffer(encryptedBuffer, file.iv, file.auth_tag);

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', decryptedBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
    return res.send(decryptedBuffer);
  } catch (err) {
    console.error('Download/decryption error:', err);
    return res.status(500).json({ error: 'Failed to decrypt and serve file.' });
  }
});

module.exports = router;
