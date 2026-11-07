# Security Architecture & Threat Model — Huddle

This document details the security and cryptographic controls implemented throughout Huddle for Task 4: Real-Time Communication App.

---

## 1. WebRTC Encryption (DTLS-SRTP)
- **Media Encryption**: All audio and video RTP streams transmitted between peers in the WebRTC mesh are encrypted using **SRTP** (Secure Real-time Transport Protocol), authenticated via **DTLS** (Datagram Transport Layer Security) handshakes (RFC 5763 / RFC 5764).
- **Data Channels**: All peer-to-peer file transfer data transmitted via `RTCDataChannel` runs over SCTP encapsulated in DTLS. Eavesdropping or tampering by intermediate network devices is mathematically prevented.
- **Zero Media Relay**: Because Huddle operates as a peer-to-peer mesh architecture, audio, video, and P2P data channels never pass through or touch the application server.

---

## 2. End-to-End Encrypted (E2EE) Chat
- **Cryptographic Standard**: Browser-native **Web Crypto API** using **AES-256-GCM** with 96-bit random initialization vectors (IVs).
- **Key Generation & Derivation**:
  1. **Passcode Protection**: When a room is created with a passcode, the symmetric AES-256 key is derived client-side via **PBKDF2** (100,000 iterations of SHA-256, salted with the room code).
  2. **URL Fragment Secret**: When entering an instant room without a passcode, an ephemeral 256-bit key is generated via `window.crypto.getRandomValues` and stored in the URL fragment (`#key=<hex>`).
- **Zero-Knowledge Server Relay**: Per the URI specification (RFC 3986), URL fragments are **never transmitted to the server in HTTP request headers**. The Node.js server receives, logs, and relays only base64 ciphertext and IVs. The server has no knowledge or ability to decrypt in-call chat messages.
- **Visual Verification**: The in-call header and chat pane feature an active green lock indicator confirming E2EE status.

---

## 3. Server-Side Encryption at Rest (Files)
- Files uploaded using the server fallback option are encrypted at rest using **AES-256-GCM** before touching persistent storage (`data/uploads/`).
- Master key is injected via `FILE_ENCRYPTION_KEY` in environment variables.
- Each file has its own unique 96-bit IV and 128-bit authentication tag stored in SQLite.
- File downloads require authentication and membership verification (only members of that meeting can retrieve and decrypt the file).
- Filenames are sanitized with `path.basename` and regex whitelist replacement (`[^a-zA-Z0-9._-]`) to prevent path traversal (`../`) and shell injection attacks.

---

## 4. Authentication, Sessions & Sockets
- **Password Hashing**: Passwords hashed with `bcryptjs` using a minimum work factor of 10 rounds. Plaintext passwords are never stored or logged.
- **JWT Storage**: JWT session tokens are stored in `httpOnly`, `SameSite=Strict` cookies to mitigate Cross-Site Scripting (XSS) token theft and Cross-Site Request Forgery (CSRF).
- **LAN IP HTTPS Compatibility**: When `USE_HTTPS=true` (or when TLS is active), the cookie `Secure` flag is enforced. The server automatically allows local development and LAN IP origins (e.g., `https://192.168.x.x:3000`).
- **Socket.io Handshake Authorization**: Socket connections are authenticated during the initial handshake by verifying the session JWT parsed from cookie headers. Unauthenticated sockets are rejected immediately.
- **Per-Room Socket Authorization**: All signaling, media toggles, and chat relays verify that the requesting socket has successfully joined that specific room in memory and SQLite. Sockets cannot broadcast to or listen to rooms they are not members of.

---

## 5. Defense in Depth
- **Content Security Policy (CSP)**: Strict headers enforced via `helmet`:
  ```http
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob: mediastream:; connect-src 'self' wss: ws:; frame-ancestors 'none';
  ```
- **CSRF Protection**: Double-submit cookie / custom header verification (`X-CSRF-Token`) on all state-changing HTTP endpoints (`POST`, `PUT`, `DELETE`).
- **Rate Limiting**: Configured via `express-rate-limit` on authentication endpoints (50 requests/15 min) and room joining operations (60 requests/min).
- **SQL Injection Prevention**: All SQLite queries are executed using parameterized statements via `better-sqlite3`. No dynamic string concatenation is used in SQL queries.
- **XSS Prevention**: User inputs (display names, chat text, filenames, room titles) are sanitized and escaped before rendering in the DOM.

---

## 6. TLS & Certificate Automation
- A self-contained script (`scripts/generate-cert.js`) generates self-signed certificates with SANs for `localhost`, `127.0.0.1`, and all discovered LAN IPv4 interfaces.
- Allows immediate local HTTPS testing for mobile devices on the same Wi-Fi network without third-party dependencies.
