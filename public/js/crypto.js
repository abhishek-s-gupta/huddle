/**
 * Client-Side End-to-End Encryption (E2EE) Module for Huddle
 * Uses standard Web Crypto API (AES-256-GCM).
 * Keys are derived from room passcode via PBKDF2, or from the URL fragment (#key=...),
 * which is never transmitted to the server.
 */

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export class E2EEManager {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.cryptoKey = null;
    this.keyDerived = false;
  }

  /**
   * Initializes the E2EE key from URL fragment or room passcode.
   * If neither exists, generates an ephemeral secret and appends to URL fragment.
   */
  async initKey(passcode = null) {
    const hash = window.location.hash;
    let rawKeyHex = null;

    if (hash && hash.includes('key=')) {
      const match = hash.match(/key=([a-f0-9]+)/i);
      if (match) rawKeyHex = match[1];
    }

    if (passcode && passcode.trim().length > 0) {
      // Derive 256-bit key from passcode using PBKDF2
      this.cryptoKey = await this.deriveKeyFromPasscode(passcode.trim(), this.roomCode);
      this.keyDerived = true;
    } else if (rawKeyHex && rawKeyHex.length === 64) {
      // Import existing key from URL fragment
      this.cryptoKey = await this.importRawHexKey(rawKeyHex);
      this.keyDerived = true;
    } else {
      // Generate new key and append to URL fragment (without reloading)
      const randomBytes = new Uint8Array(32);
      window.crypto.getRandomValues(randomBytes);
      const generatedHex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      this.cryptoKey = await this.importRawHexKey(generatedHex);
      this.keyDerived = true;

      // Update URL fragment silently
      const currentUrl = window.location.href.split('#')[0];
      window.history.replaceState(null, '', `${currentUrl}#key=${generatedHex}`);
    }

    return this.keyDerived;
  }

  async deriveKeyFromPasscode(passcode, saltString) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(passcode),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = encoder.encode(`huddle-salt-${saltString}`);

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async importRawHexKey(hex) {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    return window.crypto.subtle.importKey(
      'raw',
      bytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encryptMessage(plainText) {
    if (!this.cryptoKey) throw new Error('E2EE key not initialized');

    const encoder = new TextEncoder();
    const encoded = encoder.encode(plainText);
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      encoded
    );

    return {
      ciphertext: bufferToBase64(ciphertextBuffer),
      iv: bufferToBase64(iv)
    };
  }

  async decryptMessage(ciphertextBase64, ivBase64) {
    if (!this.cryptoKey) throw new Error('E2EE key not initialized');

    try {
      const ciphertextBuffer = base64ToBuffer(ciphertextBase64);
      const ivBuffer = base64ToBuffer(ivBase64);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(ivBuffer) },
        this.cryptoKey,
        ciphertextBuffer
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (err) {
      console.warn('Failed to decrypt message (possible key mismatch):', err);
      return '[Encrypted message could not be decrypted]';
    }
  }

  getShareableLink() {
    return window.location.href;
  }
}
