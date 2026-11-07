/**
 * File Transfer Manager for Huddle
 * Supports Peer-to-Peer transfer over RTCDataChannel (chunked with progress & cancel)
 * and Server-Encrypted uploads.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

export class FileTransferManager {
  constructor(rtcMesh, roomCode, callbacks = {}) {
    this.rtcMesh = rtcMesh;
    this.roomCode = roomCode;
    this.callbacks = {
      onTransferProgress: callbacks.onTransferProgress || (() => {}),
      onFileReceived: callbacks.onFileReceived || (() => {}),
      onTransferError: callbacks.onTransferError || (() => {}),
      onFileCancelled: callbacks.onFileCancelled || (() => {})
    };

    this.activeOutgoing = new Map(); // transferId -> { cancelled: boolean }
    this.activeIncoming = new Map(); // transferId -> { name, size, type, chunks, receivedBytes, totalChunks }
  }

  // Generate SHA-256 hash of an ArrayBuffer
  async computeHash(arrayBuffer) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Send file peer-to-peer over RTCDataChannel to all peers (or specific peer)
   */
  async sendFileP2P(file, targetSocketId = null) {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('File exceeds maximum size limit of 100 MB');
    }

    const transferId = `p2p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const buffer = await file.arrayBuffer();
    const hash = await this.computeHash(buffer);
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

    const transferRecord = {
      transferId,
      name: file.name,
      size: file.size,
      totalChunks,
      hash,
      cancelled: false
    };

    this.activeOutgoing.set(transferId, transferRecord);

    const headerMsg = JSON.stringify({
      type: 'file-start',
      transferId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
      hash
    });

    // Determine target channels
    const targetPeers = [];
    if (targetSocketId) {
      const p = this.rtcMesh.peers.get(targetSocketId);
      if (p?.dataChannel?.readyState === 'open') targetPeers.push(p.dataChannel);
    } else {
      for (const peer of this.rtcMesh.peers.values()) {
        if (peer.dataChannel?.readyState === 'open') {
          targetPeers.push(peer.dataChannel);
        }
      }
    }

    if (targetPeers.length === 0) {
      throw new Error('No peer data channels are currently open for direct transfer.');
    }

    // Broadcast header
    targetPeers.forEach(dc => dc.send(headerMsg));

    // Send chunks with backpressure handling
    let offset = 0;
    let chunkIndex = 0;

    const sendNextChunk = () => {
      if (transferRecord.cancelled) {
        targetPeers.forEach(dc => {
          try {
            dc.send(JSON.stringify({ type: 'file-cancel', transferId }));
          } catch (e) {}
        });
        this.activeOutgoing.delete(transferId);
        return;
      }

      while (offset < buffer.byteLength) {
        // Check backpressure across all channels
        let canSend = true;
        for (const dc of targetPeers) {
          if (dc.bufferedAmount > 8 * 1024 * 1024) { // 8MB buffer high watermark
            canSend = false;
            dc.bufferedAmountLowThreshold = 1 * 1024 * 1024;
            dc.onbufferedamountlow = () => {
              dc.onbufferedamountlow = null;
              sendNextChunk();
            };
            break;
          }
        }

        if (!canSend) return;

        const chunkData = buffer.slice(offset, offset + CHUNK_SIZE);
        // Prefix chunk with transferId length (1 byte) + transferId + chunk index (4 bytes)
        const enc = new TextEncoder();
        const idBytes = enc.encode(transferId);
        
        const packet = new Uint8Array(1 + idBytes.length + 4 + chunkData.byteLength);
        packet[0] = idBytes.length;
        packet.set(idBytes, 1);
        
        const view = new DataView(packet.buffer);
        view.setUint32(1 + idBytes.length, chunkIndex, false);
        packet.set(new Uint8Array(chunkData), 1 + idBytes.length + 4);

        targetPeers.forEach(dc => {
          try {
            dc.send(packet.buffer);
          } catch (e) {
            console.warn('Chunk send error:', e);
          }
        });

        offset += chunkData.byteLength;
        chunkIndex++;

        const percent = Math.min(100, Math.round((offset / buffer.byteLength) * 100));
        this.callbacks.onTransferProgress({
          transferId,
          name: file.name,
          percent,
          direction: 'outgoing'
        });
      }

      // Finish notification
      targetPeers.forEach(dc => {
        try {
          dc.send(JSON.stringify({ type: 'file-finish', transferId, hash }));
        } catch (e) {}
      });

      this.activeOutgoing.delete(transferId);
    };

    sendNextChunk();
    return transferId;
  }

  cancelTransfer(transferId) {
    const outgoing = this.activeOutgoing.get(transferId);
    if (outgoing) {
      outgoing.cancelled = true;
      this.callbacks.onFileCancelled(transferId);
      return;
    }

    const incoming = this.activeIncoming.get(transferId);
    if (incoming) {
      this.activeIncoming.delete(transferId);
      this.callbacks.onFileCancelled(transferId);
    }
  }

  /**
   * Handle incoming raw message from RTCDataChannel
   */
  async handleDataChannelMessage(fromSocketId, data) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'file-start') {
          this.activeIncoming.set(msg.transferId, {
            fromSocketId,
            name: msg.name,
            size: msg.size,
            mimeType: msg.mimeType,
            totalChunks: msg.totalChunks,
            hash: msg.hash,
            receivedBytes: 0,
            chunks: new Array(msg.totalChunks)
          });

          this.callbacks.onTransferProgress({
            transferId: msg.transferId,
            name: msg.name,
            percent: 0,
            direction: 'incoming'
          });
        } else if (msg.type === 'file-cancel') {
          this.activeIncoming.delete(msg.transferId);
          this.callbacks.onFileCancelled(msg.transferId);
        } else if (msg.type === 'file-finish') {
          const item = this.activeIncoming.get(msg.transferId);
          if (!item) return;

          // Assemble complete ArrayBuffer
          const completeBuffer = new Uint8Array(item.size);
          let writeOffset = 0;
          for (let i = 0; i < item.chunks.length; i++) {
            const chunk = item.chunks[i];
            if (chunk) {
              completeBuffer.set(new Uint8Array(chunk), writeOffset);
              writeOffset += chunk.byteLength;
            }
          }

          // Hash verification
          const computedHash = await this.computeHash(completeBuffer.buffer);
          const isVerified = computedHash === item.hash;

          const blob = new Blob([completeBuffer.buffer], { type: item.mimeType });
          const downloadUrl = URL.createObjectURL(blob);

          this.activeIncoming.delete(msg.transferId);

          this.callbacks.onFileReceived({
            transferId: msg.transferId,
            name: item.name,
            size: item.size,
            mimeType: item.mimeType,
            downloadUrl,
            hashVerified: isVerified,
            isP2P: true,
            fromSocketId
          });
        }
      } catch (err) {
        console.warn('Error handling JSON data channel message:', err);
      }
      return;
    }

    // Binary packet chunk
    if (data instanceof ArrayBuffer) {
      try {
        const packet = new Uint8Array(data);
        const idLen = packet[0];
        const dec = new TextDecoder();
        const transferId = dec.decode(packet.slice(1, 1 + idLen));
        const view = new DataView(packet.buffer, 1 + idLen, 4);
        const chunkIndex = view.getUint32(0, false);
        const chunkData = packet.slice(1 + idLen + 4).buffer;

        const incoming = this.activeIncoming.get(transferId);
        if (!incoming) return;

        incoming.chunks[chunkIndex] = chunkData;
        incoming.receivedBytes += chunkData.byteLength;

        const percent = Math.min(100, Math.round((incoming.receivedBytes / incoming.size) * 100));
        this.callbacks.onTransferProgress({
          transferId,
          name: incoming.name,
          percent,
          direction: 'incoming'
        });
      } catch (e) {
        console.warn('Binary chunk processing error:', e);
      }
    }
  }

  /**
   * Upload file securely to server (encrypted at rest with AES-256-GCM)
   */
  async uploadToServer(file, csrfToken) {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('File exceeds maximum size limit of 100 MB');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomCode', this.roomCode);

    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const res = await fetch('/api/files/upload', {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Server upload failed');
    }

    return data.file;
  }
}
