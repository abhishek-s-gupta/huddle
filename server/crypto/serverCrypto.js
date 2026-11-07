const crypto = require('crypto');
const config = require('../config');

// Ensure key is 32 bytes (256 bits)
function getMasterKey() {
  const hexKey = config.fileEncryptionKey;
  if (hexKey.length === 64) {
    return Buffer.from(hexKey, 'hex');
  }
  // Otherwise derive 32 bytes using SHA-256
  return crypto.createHash('sha256').update(hexKey).digest();
}

/**
 * Encrypt a file buffer using AES-256-GCM.
 * @param {Buffer} buffer
 * @returns {{ encryptedData: Buffer, iv: string, authTag: string }}
 */
function encryptFileBuffer(buffer) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12); // standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypt a file buffer using AES-256-GCM.
 * @param {Buffer} encryptedBuffer
 * @param {string} ivHex
 * @param {string} authTagHex
 * @returns {Buffer}
 */
function decryptFileBuffer(encryptedBuffer, ivHex, authTagHex) {
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}

module.exports = {
  encryptFileBuffer,
  decryptFileBuffer
};
