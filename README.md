# Huddle — Real-Time Video Conferencing & Collaboration

> **Task 4: Real-Time Communication App (College Project)**  
> Built with Node.js, Express, Socket.io, SQLite (better-sqlite3), and pure vanilla JavaScript ES modules.

---

## Highlights

- **Direct WebRTC Mesh**: Peer-to-peer audio and video mesh supporting 2 to 6+ participants with dynamic adaptive grid reflow.
- **DTLS-SRTP Media Encryption**: All audio, video, and data channels are encrypted end-to-end between peers by default using DTLS-SRTP (RFC 5763 / RFC 5764).
- **End-to-End Encrypted (E2EE) In-Call Chat**: Chat messages are encrypted in the browser using the Web Crypto API (**AES-256-GCM**). Symmetrically derived from room passcodes (PBKDF2) or ephemeral keys stored in URL fragments (`#key=...`) that never reach the server.
- **Peer-to-Peer & Encrypted Server File Sharing**: Send files directly over `RTCDataChannel` in 64KB chunks with live progress bars, SHA-256 integrity verification, and cancel controls. Also supports server-side uploads encrypted at rest with AES-256-GCM.
- **Collaborative Whiteboard**: Full-stage shared real-time canvas with 8 drawing tools (pen, highlighter, eraser, line, rectangle, ellipse, arrow, text), color palette, stroke thicknesses, undo/redo, pan/zoom, PNG export, throttled Socket.io batching, and late-join state sync.
- **Clean, Restrained UI**: Minimalist aesthetic (inspired by Linear, Whereby, and Google Meet). Neutral dark call screen, light dashboard, 1.5px SVG icons, zero gradients, and zero AI template fluff.
- **Host Controls & Admin Panel**: Remote muting, participant removal, room locking, and global room termination. Dedicated protected `/admin` panel for the first registered user.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Backend** | Node.js, Express 5, Socket.io 4 |
| **Database** | SQLite via `better-sqlite3` (WAL mode enabled) |
| **Security** | `bcryptjs`, JWT cookies (`httpOnly`, `SameSite=Strict`), `helmet`, `express-rate-limit`, CSRF protection |
| **Media** | WebRTC PeerConnection (Mesh), Web Audio API (`AnalyserNode`) |
| **Encryption** | Web Crypto API (AES-256-GCM E2EE chat), Node crypto (AES-256-GCM files at rest) |
| **Frontend** | Vanilla JavaScript (ES modules), Semantic HTML5, CSS Variables (no frameworks) |
| **Testing** | Playwright multi-client end-to-end test suite |

---

## Quickstart

### 1. Prerequisites
- Node.js (v18+) and npm

### 2. Install & Start
```bash
# Clone or navigate to the project directory
cd huddle

# Install dependencies
npm install

# (Optional) Seed demo accounts
npm run seed

# Start development server (HTTP on localhost:3000)
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Default Demo Credentials
| Role | Email Address | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@huddle.local` | `password123` | Full access + Protected `/admin` console |
| **Member** | `user@huddle.local` | `password123` | Host / Join meetings, Whiteboard, Files |
| **New User** | Any valid email | Minimum 8 chars | Click **Create Account** on the landing page |

---

## Testing on Two Real Devices on the Same Wi-Fi (LAN)

Browsers enforce that WebRTC camera and microphone access (`navigator.mediaDevices.getUserMedia`) requires a **Secure Context** (`https://` or `localhost`). When opening the app from a phone or second laptop over a local IP (e.g., `https://192.168.1.5:3000`), HTTPS is mandatory.

### 1. Generate Local Self-Signed Certificates
Huddle includes an automated certificate generator that inspects your machine's network interfaces and binds all local LAN IPs to Subject Alternative Names (SANs):

```bash
npm run cert
```
This generates `certs/key.pem` and `certs/cert.pem`.

### 2. Start the Server over HTTPS
```bash
npm run start:https
```
The terminal will display the active addresses:
```
  🚀 Huddle real-time conferencing server online
  Protocol: HTTPS
  Local:    https://localhost:3000
  Network:  https://192.168.1.45:3000
```

### 3. Connect from Mobile / Second Device
1. Connect both devices to the same Wi-Fi network.
2. On your mobile phone browser (Chrome/Safari), open `https://<YOUR-LAN-IP>:3000`.
3. Because the certificate is self-signed for local development, accept the browser warning (**Advanced -> Proceed to site**).
4. Create an account, join the meeting room, and grant camera/mic permissions. Both devices will establish a direct peer-to-peer mesh call!

---

## Production TURN Server Setup (coturn)

Public STUN (`stun:stun.l.google.com:19302`) is enabled by default and connects peers over most residential and office networks. In strict symmetric NAT or cellular firewall environments, a TURN relay server is required.

### Setting up `coturn` on Ubuntu/Debian:
```bash
# Install coturn
sudo apt update && sudo apt install -y coturn

# Edit configuration (/etc/turnserver.conf)
sudo nano /etc/turnserver.conf
```

Add the following configuration:
```ini
listening-port=3478
tls-listening-port=5349
realm=huddle.yourdomain.com
fingerprint
lt-cred-mech
user=huddleuser:StrongSecretPassword123
cert=/etc/letsencrypt/live/huddle.yourdomain.com/cert.pem
pkey=/etc/letsencrypt/live/huddle.yourdomain.com/privkey.pem
```

Start the service:
```bash
sudo systemctl enable turnserver
sudo systemctl restart turnserver
```

Configure in Huddle's `.env`:
```env
TURN_URLS=turn:yourdomain.com:3478
TURN_USERNAME=huddleuser
TURN_CREDENTIAL=StrongSecretPassword123
```

---

## System Architecture

```
huddle/
├── server/
│   ├── app.js                 # Express application & route configuration
│   ├── server.js              # HTTP/HTTPS listener & Socket.io initialization
│   ├── config.js              # Environment settings & defaults
│   ├── db/
│   │   ├── database.js        # SQLite database connection (better-sqlite3)
│   │   └── schema.sql         # Database schema (users, rooms, files, logs)
│   ├── middleware/
│   │   ├── auth.js            # JWT verification & socket handshake auth
│   │   ├── security.js        # Helmet CSP & CSRF protection
│   │   └── rateLimiter.js     # Rate limiters for auth and room actions
│   ├── routes/
│   │   ├── auth.js            # Sign up, sign in, sign out, me
│   │   ├── rooms.js           # Meeting creation, history, passcode check
│   │   ├── files.js           # Server file upload & AES-256 decryption
│   │   └── admin.js           # Admin overview & room termination
│   ├── sockets/
│   │   ├── index.js           # Socket event mounting
│   │   └── signaling.js       # Mesh peer signaling & room coordinator
│   └── crypto/
│       └── serverCrypto.js    # AES-256-GCM file encryption at rest
├── public/
│   ├── index.html             # Split-screen landing & auth
│   ├── dashboard.html         # Meeting hub & history
│   ├── lobby.html             # Camera/mic preview & device selector
│   ├── room.html              # Real-time call screen
│   ├── admin.html             # Protected administrative console
│   ├── css/
│   │   ├── variables.css      # Design tokens & color system
│   │   ├── main.css           # Global typography & layout
│   │   ├── room.css           # Dark theme video grid & docks
│   │   └── whiteboard.css     # Canvas tools & palette
│   └── js/
│       ├── api.js             # Fetch wrapper with CSRF injection
│       ├── crypto.js          # Web Crypto AES-256-GCM E2EE chat
│       ├── signaling.js       # Socket.io client wrapper
│       ├── rtc.js             # WebRTC mesh & audio level analyser
│       ├── files.js           # Chunked P2P DataChannel file transfers
│       └── whiteboard.js      # Collaborative canvas with stroke batching
├── tests/
│   ├── test-milestone1.js     # Auth & security integration tests
│   └── e2e/
│       └── huddle.spec.js     # 3-client automated Playwright test suite
├── scripts/
│   ├── generate-cert.js       # Automated self-signed TLS cert generator
│   └── start-https.js         # Cross-platform HTTPS entrypoint
├── UI_CHECKLIST.md            # Interactive UI element verification matrix
├── SECURITY.md                # Comprehensive threat model & crypto specs
└── package.json
```

---

## Keyboard Shortcuts in Call

| Key | Action |
| :--- | :--- |
| `M` | Toggle Microphone (Mute / Unmute) |
| `V` | Toggle Camera (Video On / Off) |
| `S` | Start / Stop Screen Sharing |
| `W` | Open / Close Collaborative Whiteboard |

---

## Running Automated E2E Tests

The automated test suite runs via Playwright, launching Chromium with fake media streams (`--use-fake-device-for-media-stream`), opening 3 concurrent browser sessions, and verifying:
1. User registration, login, and first-user admin promotion.
2. Meeting creation, lobby preview, and multi-user mesh video tile connection.
3. Media mute propagation across all clients.
4. Screen sharing broadcast.
5. End-to-end encrypted chat message round trip.
6. P2P & server encrypted file transfers with SHA-256 hash validation.
7. Real-time whiteboard synchronization and late-joiner state playback.
8. Host controls (room locking, remote muting, ending meeting).

To run:
```bash
npm test
```
