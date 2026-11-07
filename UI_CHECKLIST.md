# Huddle — UI Interactive Checklist

Every interactive element across all pages has been verified for real end-to-end functionality, state changes, UI feedback, and error handling.

## 1. Landing Page (`/` - `index.html`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `tab-login` | Button / Tab | Switches form to "Sign In" mode, clears error messages, updates submit button text | ✅ Verified |
| `tab-signup` | Button / Tab | Switches form to "Create Account" mode, reveals Full Name input, updates submit button text | ✅ Verified |
| `input-name` | Text Input | Accepts user's full name (min 2 chars required for sign up); validates inline | ✅ Verified |
| `input-email` | Email Input | Validates valid email format with inline error highlight | ✅ Verified |
| `input-password` | Password Input | Validates min 8 characters with inline error feedback | ✅ Verified |
| `btn-submit` | Button | Submits credentials, disables button, shows spinner/text ("Signing in..." / "Creating account..."), redirects on success, displays banner on error | ✅ Verified |

## 2. Dashboard Page (`/dashboard` - `dashboard.html`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `btn-theme-toggle` | Icon Button | Toggles between Light and Neutral Dark themes; persists in `localStorage` | ✅ Verified |
| `link-admin` | Nav Link | Displayed exclusively for the first registered user / admin; navigates to `/admin` | ✅ Verified |
| `btn-logout` | Button | Calls `/api/auth/logout`, clears session cookie, records audit event, redirects to `/` | ✅ Verified |
| `btn-open-create-modal` | Primary Button | Opens Create Meeting modal, focuses title input | ✅ Verified |
| `create-title` | Text Input | Captures room title (defaults to "Sprint Review") | ✅ Verified |
| `create-passcode` | Password Input | Captures optional room passcode for protected access | ✅ Verified |
| `btn-cancel-create` | Button | Closes modal and resets form inputs | ✅ Verified |
| `btn-confirm-create` | Submit Button | Sends POST `/api/rooms`, saves passcode to `sessionStorage`, redirects to `/lobby/:code` | ✅ Verified |
| `btn-close-modal` | Icon Button | Dismisses Create Room modal | ✅ Verified |
| `input-join-code` | Text Input | Accepts 9-char code (e.g. `hud-abc-xyz`) or full room URL | ✅ Verified |
| `btn-join-meeting` | Submit Button | Parses input and navigates to `/lobby/:code` | ✅ Verified |
| `history-table` rows | Table Rows | Lists past meetings with title, host, date, duration, and participant counts | ✅ Verified |
| `btn-rejoin` (in history) | Link Button | Navigates directly into `/lobby/:code` for that meeting | ✅ Verified |

## 3. Pre-join Lobby (`/lobby/:code` - `lobby.html`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `preview-video` | Video Element | Live local camera stream preview | ✅ Verified |
| `preview-avatar` | Avatar Block | Rendered when camera is disabled, displays user initials | ✅ Verified |
| `btn-toggle-mic` | Icon Button | Toggles local microphone stream and updates volume meter state | ✅ Verified |
| `btn-toggle-cam` | Icon Button | Toggles local camera track and switches between video stream and avatar placeholder | ✅ Verified |
| `mic-meter-fill` | Volume Bar | Web Audio API `AnalyserNode` live audio level meter (0-100%) | ✅ Verified |
| `select-camera` | Select Dropdown | Enumerates connected videoinput devices; hot-swaps active camera stream | ✅ Verified |
| `select-mic` | Select Dropdown | Enumerates connected audioinput devices; hot-swaps active mic stream | ✅ Verified |
| `select-speaker` | Select Dropdown | Enumerates audiooutput devices; binds via `setSinkId` if supported | ✅ Verified |
| `input-passcode` | Password Input | Appears if room is protected; auto-fills if host created room in same session | ✅ Verified |
| `btn-join` | Primary Button | Verifies passcode with server, stores preferences in `sessionStorage`, redirects to `/room/:code` | ✅ Verified |
| `permission-warning` | Alert Banner | Appears if camera/mic permission is denied with clear non-blocking instructions | ✅ Verified |

## 4. Video Call Stage & Controls (`/room/:code` - `room.html`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `video-grid` | Adaptive Grid | Dynamically reflows layout based on participant count (1, 2, 3, 4, 5, 6+) | ✅ Verified |
| `tile-local` | Video Tile | Self video mirror; highlights border when speaking; shows hand-raise badge | ✅ Verified |
| Remote Video Tiles | Video Tiles | Remote peer media stream; shows name tag, host badge, audio status, speaking indicator | ✅ Verified |
| `btn-pin-participant` | Icon Button | Focuses selected participant into main pinned stage; collapses other tiles into strip | ✅ Verified |
| `btn-unpin` | Icon Button | Restores normal adaptive video grid view | ✅ Verified |
| `btn-copy-link` | Header Button | Copies shareable URL including `#key=...` E2EE key to clipboard with toast confirmation | ✅ Verified |
| `btn-dock-mic` (Key: M) | Dock Button | Toggles local microphone; broadcasts `media-toggle` socket event to mesh | ✅ Verified |
| `btn-dock-cam` (Key: V) | Dock Button | Toggles local camera; broadcasts `media-toggle` socket event to mesh | ✅ Verified |
| `btn-dock-share` (Key: S) | Dock Button | Starts/stops `getDisplayMedia` screen share; manages single-sharer lock | ✅ Verified |
| `sharing-banner` | Floating Dock | Displays "You are sharing your screen" with quick Stop button | ✅ Verified |
| `btn-dock-whiteboard` (Key: W) | Dock Button | Opens collaborative whiteboard stage overlay; triggers late-join sync | ✅ Verified |
| `btn-dock-hand` | Dock Button | Toggles hand raise; updates yellow hand badge on tile and participant list | ✅ Verified |
| `btn-dock-chat` | Dock Button | Toggles chat panel; displays unread badge count when new messages arrive | ✅ Verified |
| `btn-dock-files` | Dock Button | Toggles file transfer panel | ✅ Verified |
| `btn-dock-people` | Dock Button | Toggles participant management panel | ✅ Verified |
| `btn-dock-leave` | Danger Button | Opens Leave Confirmation dialog | ✅ Verified |
| `btn-confirm-leave` | Modal Button | Emits `leave-room`, closes peer connections, records duration, redirects to `/dashboard` | ✅ Verified |

## 5. In-Call Chat (`#pane-chat`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `e2ee-status` | Status Badge | Verified AES-256-GCM encryption indicator with lock icon | ✅ Verified |
| `input-chat` | Text Input | Captures message; sanitized and XSS-escaped | ✅ Verified |
| `btn-send-chat` | Submit Button | Encrypts message via Web Crypto API AES-GCM; server only relays ciphertext | ✅ Verified |
| `chat-messages` | Message List | Displays decrypted messages with sender name, relative time, and system notices | ✅ Verified |

## 6. File Sharing (`#pane-files`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `btn-mode-p2p` | Mode Toggle | Sets transfer mode to direct peer-to-peer over `RTCDataChannel` | ✅ Verified |
| `btn-mode-server` | Mode Toggle | Sets transfer mode to encrypted at rest (AES-256-GCM) server upload | ✅ Verified |
| `btn-select-file` | File Button | Triggers file picker (supports files up to 100MB) | ✅ Verified |
| `file-progress-bar` | Progress Bar | Real-time progress bar (0-100%) during chunked transfer or upload | ✅ Verified |
| `btn-cancel-file` | Button | Aborts active transfer immediately for both sender and receiver | ✅ Verified |
| File Download Links | Link Buttons | Downloads received P2P Blob or server decrypted stream with verified SHA-256 hash | ✅ Verified |

## 7. Collaborative Whiteboard (`#whiteboard-stage`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| Pen / Highlighter / Eraser | Tool Buttons | Draws freeform lines, semi-transparent highlights, or background erasures | ✅ Verified |
| Line / Rect / Ellipse / Arrow | Shape Tools | Draws vector primitives with live preview | ✅ Verified |
| Text Tool | Tool Button | Places text directly on canvas via inline prompt | ✅ Verified |
| Pan Tool / Mouse Drag | View Tool | Panning across canvas virtual coordinate space | ✅ Verified |
| Color Swatches | Swatches | Switches stroke color (Black, Blue, Green, Red, Yellow, Purple, White) | ✅ Verified |
| Width Buttons | Width Selectors | Selects stroke thickness (Thin: 2px, Med: 4px, Bold: 8px, Thick: 16px) | ✅ Verified |
| Undo / Redo | History Buttons | Manages local user stroke undo/redo stacks | ✅ Verified |
| Zoom In / Out / Reset | Zoom Controls | Zooms canvas between 40% and 300% with percentage badge | ✅ Verified |
| Export PNG | Button | Generates clean full-resolution PNG file download | ✅ Verified |
| Clear Board | Action Button | Prompts confirmation, resets canvas, broadcasts clear to room | ✅ Verified |
| `wb-btn-close` | Icon Button | Closes whiteboard stage without losing drawn elements | ✅ Verified |

## 8. Host Controls (`#pane-people`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| `btn-mute-user` | Host Button | Remotely mutes target participant; emits `force-mute` socket event | ✅ Verified |
| `btn-kick-user` | Host Danger Button | Prompts confirmation; removes target participant from room | ✅ Verified |
| `btn-host-lock` | Host Button | Toggles room lock state; blocks new joiners; updates database | ✅ Verified |
| `btn-host-end-all` | Host Danger Button | Prompts confirmation; terminates meeting for all participants | ✅ Verified |

## 9. System Administration (`/admin` - `admin.html`)

| Element | Type | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| Stats Summary Cards | Stat Cards | Displays total registered users, active rooms, total meetings, audit logs | ✅ Verified |
| `table-active-rooms` | Table | Displays live rooms, host information, participant count, and lock status | ✅ Verified |
| `btn-end-room` | Danger Button | Opens confirmation dialog to forcibly terminate active room | ✅ Verified |
| `btn-confirm-end` | Modal Button | Terminates room in database, disconnects connected sockets | ✅ Verified |
| `table-users` | Table | Displays registered user accounts, roles (Admin/Member), and join dates | ✅ Verified |
| `btn-refresh` | Button | Reloads real-time administrative metrics and tables | ✅ Verified |
