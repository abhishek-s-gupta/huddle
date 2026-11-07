const bcrypt = require('bcryptjs');
const db = require('../db/database');

class SocketManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomCode -> roomState
    global.huddleSocketManager = this;
  }

  getOrCreateRoom(roomCode, dbRoom) {
    if (!this.rooms.has(roomCode)) {
      this.rooms.set(roomCode, {
        code: roomCode,
        id: dbRoom.id,
        title: dbRoom.title,
        hostId: dbRoom.host_id,
        isLocked: Boolean(dbRoom.is_locked),
        isEnded: Boolean(dbRoom.is_ended),
        participants: new Map(), // socketId -> participantInfo
        currentScreenSharer: null,
        whiteboardElements: []
      });
    }
    return this.rooms.get(roomCode);
  }

  handleConnection(socket) {
    const user = socket.user; // populated by handshake authentication

    // JOIN ROOM
    socket.on('join-room', ({ roomCode, passcode, mediaState }) => {
      try {
        if (!roomCode) {
          return socket.emit('join-error', { message: 'Room code is required.' });
        }

        const cleanCode = roomCode.trim();
        const dbRoom = db.prepare(`
          SELECT r.*, u.display_name as host_name 
          FROM rooms r 
          JOIN users u ON r.host_id = u.id 
          WHERE r.code = ?
        `).get(cleanCode);

        if (!dbRoom) {
          return socket.emit('join-error', { message: 'Room not found.' });
        }

        if (dbRoom.is_ended) {
          return socket.emit('join-error', { message: 'This meeting has ended.' });
        }

        const isHost = dbRoom.host_id === user.id;

        // Check if room is locked
        if (dbRoom.is_locked && !isHost && !user.isAdmin) {
          return socket.emit('join-error', { message: 'This room is locked by the host.' });
        }

        // Check passcode if room is passcode-protected and user is not host
        if (dbRoom.passcode_hash && !isHost) {
          if (!passcode || !bcrypt.compareSync(passcode, dbRoom.passcode_hash)) {
            return socket.emit('join-error', { message: 'Invalid room passcode.' });
          }
        }

        const room = this.getOrCreateRoom(cleanCode, dbRoom);

        // Disconnect any existing socket in this room for the same user (prevent duplicate tab joins)
        for (const [sId, p] of room.participants.entries()) {
          if (p.userId === user.id) {
            const existingSocket = this.io.sockets.sockets.get(sId);
            if (existingSocket) {
              existingSocket.emit('kicked', { message: 'You connected from another window or tab.' });
              existingSocket.leave(`room:${cleanCode}`);
            }
            room.participants.delete(sId);
          }
        }

        // Track participant in SQLite
        const now = new Date().toISOString();
        const participantRole = isHost ? 'host' : 'participant';
        const insertResult = db.prepare(`
          INSERT INTO room_participants (room_id, user_id, role, joined_at)
          VALUES (?, ?, ?, ?)
        `).run(dbRoom.id, user.id, participantRole, now);

        socket.roomCode = cleanCode;
        socket.participantDbId = insertResult.lastInsertRowid;
        socket.join(`room:${cleanCode}`);

        const participantData = {
          socketId: socket.id,
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          isHost,
          role: participantRole,
          mediaState: {
            audio: mediaState?.audio !== false,
            video: mediaState?.video !== false
          },
          isHandRaised: false,
          joinedAt: now
        };

        // Existing participants list to return to newcomer
        const existingParticipants = Array.from(room.participants.values());

        // Add newcomer to room
        room.participants.set(socket.id, participantData);

        // Send room-joined to newcomer
        socket.emit('room-joined', {
          roomCode: cleanCode,
          title: dbRoom.title,
          isHost,
          currentUser: participantData,
          existingParticipants,
          currentScreenSharer: room.currentScreenSharer,
          isLocked: room.isLocked,
          whiteboardElements: room.whiteboardElements
        });

        // Notify existing members
        socket.to(`room:${cleanCode}`).emit('user-joined', participantData);

        // System notification in chat
        this.io.to(`room:${cleanCode}`).emit('system-message', {
          text: `${user.displayName} joined the meeting.`,
          timestamp: new Date().toISOString()
        });

      } catch (err) {
        console.error('Error during join-room:', err);
        socket.emit('join-error', { message: 'Failed to join room. Please try again.' });
      }
    });

    // WEBRTC SIGNALING: OFFER, ANSWER, ICE CANDIDATE
    socket.on('signal-offer', ({ toSocketId, offer }) => {
      if (!this.validatePeerTarget(socket, toSocketId)) return;
      this.io.to(toSocketId).emit('signal-offer', {
        fromSocketId: socket.id,
        offer
      });
    });

    socket.on('signal-answer', ({ toSocketId, answer }) => {
      if (!this.validatePeerTarget(socket, toSocketId)) return;
      this.io.to(toSocketId).emit('signal-answer', {
        fromSocketId: socket.id,
        answer
      });
    });

    socket.on('ice-candidate', ({ toSocketId, candidate }) => {
      if (!this.validatePeerTarget(socket, toSocketId)) return;
      this.io.to(toSocketId).emit('ice-candidate', {
        fromSocketId: socket.id,
        candidate
      });
    });

    // MEDIA TOGGLE (Mic / Camera)
    socket.on('media-toggle', ({ type, enabled }) => {
      const room = this.rooms.get(socket.roomCode);
      if (!room) return;

      const p = room.participants.get(socket.id);
      if (p) {
        if (type === 'audio') p.mediaState.audio = Boolean(enabled);
        if (type === 'video') p.mediaState.video = Boolean(enabled);

        socket.to(`room:${socket.roomCode}`).emit('user-media-toggle', {
          socketId: socket.id,
          type,
          enabled: Boolean(enabled)
        });
      }
    });

    // SCREEN SHARING
    socket.on('start-screen-share', () => {
      const room = this.rooms.get(socket.roomCode);
      if (!room) return;

      if (room.currentScreenSharer && room.currentScreenSharer !== socket.id) {
        return socket.emit('screen-share-error', {
          message: 'Another participant is already sharing their screen.'
        });
      }

      room.currentScreenSharer = socket.id;
      this.io.to(`room:${socket.roomCode}`).emit('screen-share-started', {
        socketId: socket.id,
        displayName: user.displayName
      });
    });

    socket.on('stop-screen-share', () => {
      const room = this.rooms.get(socket.roomCode);
      if (!room) return;

      if (room.currentScreenSharer === socket.id) {
        room.currentScreenSharer = null;
        this.io.to(`room:${socket.roomCode}`).emit('screen-share-stopped', {
          socketId: socket.id
        });
      }
    });

    // RAISE / LOWER HAND
    socket.on('raise-hand-toggle', () => {
      const room = this.rooms.get(socket.roomCode);
      if (!room) return;

      const p = room.participants.get(socket.id);
      if (p) {
        p.isHandRaised = !p.isHandRaised;
        this.io.to(`room:${socket.roomCode}`).emit('hand-raise-changed', {
          socketId: socket.id,
          isHandRaised: p.isHandRaised,
          displayName: user.displayName
        });
      }
    });

    // HOST CONTROLS: MUTE, REMOVE, LOCK, END
    socket.on('lock-room', ({ locked }) => {
      const room = this.rooms.get(socket.roomCode);
      if (!room || (!this.isUserHost(socket, room) && !user.isAdmin)) return;

      room.isLocked = Boolean(locked);
      db.prepare('UPDATE rooms SET is_locked = ? WHERE code = ?').run(room.isLocked ? 1 : 0, socket.roomCode);

      this.io.to(`room:${socket.roomCode}`).emit('room-lock-changed', {
        isLocked: room.isLocked
      });
      this.io.to(`room:${socket.roomCode}`).emit('system-message', {
        text: `Room has been ${room.isLocked ? 'locked' : 'unlocked'} by the host.`,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('remote-mute-participant', ({ targetSocketId }) => {
      const room = this.rooms.get(socket.roomCode);
      if (!room || (!this.isUserHost(socket, room) && !user.isAdmin)) return;

      const target = room.participants.get(targetSocketId);
      if (target) {
        target.mediaState.audio = false;
        this.io.to(targetSocketId).emit('force-mute');
        this.io.to(`room:${socket.roomCode}`).emit('user-media-toggle', {
          socketId: targetSocketId,
          type: 'audio',
          enabled: false
        });
        this.io.to(`room:${socket.roomCode}`).emit('system-message', {
          text: `${target.displayName} was muted by the host.`,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('remove-participant', ({ targetSocketId }) => {
      const room = this.rooms.get(socket.roomCode);
      if (!room || (!this.isUserHost(socket, room) && !user.isAdmin)) return;

      const target = room.participants.get(targetSocketId);
      if (target) {
        const targetSocket = this.io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.emit('kicked', { message: 'You have been removed from the meeting by the host.' });
          targetSocket.leave(`room:${socket.roomCode}`);
        }
        this.cleanupParticipant(room, targetSocketId, 'removed');
      }
    });

    socket.on('end-meeting', () => {
      const room = this.rooms.get(socket.roomCode);
      if (!room || (!this.isUserHost(socket, room) && !user.isAdmin)) return;

      this.endRoom(socket.roomCode, 'The host has ended the meeting.');
    });

    // IN-CALL CHAT (E2EE Ciphertext Relay)
    socket.on('chat-message', ({ messageId, ciphertext, iv }) => {
      if (!socket.roomCode) return;
      const room = this.rooms.get(socket.roomCode);
      if (!room) return;

      const now = new Date().toISOString();

      // Log metadata only into SQLite (NO PLAINTEXT)
      try {
        db.prepare(`
          INSERT INTO messages_meta (room_id, sender_id, message_id, timestamp, is_system)
          VALUES (?, ?, ?, ?, 0)
        `).run(room.id, user.id, messageId || String(Date.now()), now);
      } catch (err) {
        console.error('Chat metadata log error:', err);
      }

      // Relay E2EE ciphertext payload to room
      this.io.to(`room:${socket.roomCode}`).emit('chat-message', {
        messageId,
        senderId: user.id,
        senderName: user.displayName,
        senderSocketId: socket.id,
        ciphertext,
        iv,
        timestamp: now
      });
    });

    // WHITEBOARD (Strokes and Clear)
    socket.on('whiteboard-stroke', ({ elements }) => {
      const room = this.rooms.get(socket.roomCode);
      if (!room || !Array.isArray(elements)) return;

      // Keep recent elements for late joiners (cap at 4000 to prevent unbounded memory)
      room.whiteboardElements.push(...elements);
      if (room.whiteboardElements.length > 4000) {
        room.whiteboardElements.splice(0, room.whiteboardElements.length - 4000);
      }

      socket.to(`room:${socket.roomCode}`).emit('whiteboard-stroke', { elements });
    });

    socket.on('whiteboard-clear', () => {
      const room = this.rooms.get(socket.roomCode);
      if (!room) return;

      room.whiteboardElements = [];
      this.io.to(`room:${socket.roomCode}`).emit('whiteboard-cleared');
    });

    // LEAVE / DISCONNECT
    socket.on('leave-room', () => {
      this.handleLeave(socket);
    });

    socket.on('disconnect', () => {
      this.handleLeave(socket);
    });
  }

  validatePeerTarget(socket, targetSocketId) {
    if (!socket.roomCode) return false;
    const room = this.rooms.get(socket.roomCode);
    if (!room) return false;
    return room.participants.has(targetSocketId);
  }

  isUserHost(socket, room) {
    return room.hostId === socket.user.id;
  }

  handleLeave(socket) {
    if (!socket.roomCode) return;
    const room = this.rooms.get(socket.roomCode);
    if (!room) return;

    this.cleanupParticipant(room, socket.id, 'left');
    socket.leave(`room:${socket.roomCode}`);
    socket.roomCode = null;
  }

  cleanupParticipant(room, socketId, reason = 'left') {
    const p = room.participants.get(socketId);
    if (!p) return;

    room.participants.delete(socketId);

    // Update leave time in database
    const now = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE room_participants 
        SET left_at = ? 
        WHERE room_id = ? AND user_id = ? AND left_at IS NULL
      `).run(now, room.id, p.userId);
    } catch (err) {
      console.error('Update participant left_at error:', err);
    }

    // Stop screen sharing if this participant was sharing
    if (room.currentScreenSharer === socketId) {
      room.currentScreenSharer = null;
      this.io.to(`room:${room.code}`).emit('screen-share-stopped', { socketId });
    }

    // Notify room of participant departure
    this.io.to(`room:${room.code}`).emit('user-left', {
      socketId,
      userId: p.userId,
      displayName: p.displayName
    });

    this.io.to(`room:${room.code}`).emit('system-message', {
      text: `${p.displayName} ${reason === 'removed' ? 'was removed from' : 'left'} the meeting.`,
      timestamp: now
    });

    // If room is empty, cleanup room from memory after 1 minute
    if (room.participants.size === 0) {
      setTimeout(() => {
        if (room.participants.size === 0) {
          this.rooms.delete(room.code);
        }
      }, 60000);
    }
  }

  endRoom(roomCode, reason = 'The meeting has ended.') {
    const room = this.rooms.get(roomCode);
    const now = new Date().toISOString();

    db.prepare('UPDATE rooms SET is_ended = 1, ended_at = ? WHERE code = ?').run(now, roomCode);
    db.prepare(`
      UPDATE room_participants 
      SET left_at = ? 
      WHERE room_id = (SELECT id FROM rooms WHERE code = ?) AND left_at IS NULL
    `).run(now, roomCode);

    this.io.to(`room:${roomCode}`).emit('meeting-ended', { reason });

    if (room) {
      room.participants.clear();
      this.rooms.delete(roomCode);
    }
  }
}

module.exports = SocketManager;
