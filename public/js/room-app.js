/**
 * Main Controller for Huddle Real-Time Conference Room
 */

import { api } from '/js/api.js';
import { SignalingClient } from '/js/signaling.js';
import { RTCMeshManager } from '/js/rtc.js';
import { E2EEManager } from '/js/crypto.js';
import { FileTransferManager } from '/js/files.js';
import { Whiteboard } from '/js/whiteboard.js';

const roomCode = window.location.pathname.split('/').pop().trim();

// State
let currentUser = null;
let roomInfo = null;
let isHost = false;
let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;
let isHandRaised = false;
let pinnedSocketId = null;
let currentScreenSharer = null;

let participants = new Map(); // socketId -> participantData
let unreadChatCount = 0;
let fileUploadMode = 'p2p'; // 'p2p' or 'server'
let whiteboardInstance = null;
let callStartTime = Date.now();

// Instantiate Managers
const signaling = new SignalingClient();
const e2ee = new E2EEManager(roomCode);
let rtcMesh = null;
let fileManager = null;

// DOM Elements
const videoGrid = document.getElementById('video-grid');
const stageArea = document.getElementById('stage-area');
const screenShareStage = document.getElementById('screen-share-stage');
const screenShareVideo = document.getElementById('screen-share-video');
const sharingBanner = document.getElementById('sharing-banner');
const pinnedStage = document.getElementById('pinned-stage');
const pinnedVideo = document.getElementById('pinned-video');
const pinnedNameTag = document.getElementById('pinned-name-tag');
const btnUnpin = document.getElementById('btn-unpin');

const btnDockMic = document.getElementById('btn-dock-mic');
const btnDockCam = document.getElementById('btn-dock-cam');
const btnDockShare = document.getElementById('btn-dock-share');
const btnDockWb = document.getElementById('btn-dock-whiteboard');
const btnDockHand = document.getElementById('btn-dock-hand');
const btnDockLeave = document.getElementById('btn-dock-leave');
const btnDockChat = document.getElementById('btn-dock-chat');
const btnDockFiles = document.getElementById('btn-dock-files');
const btnDockPeople = document.getElementById('btn-dock-people');

const sidePanel = document.getElementById('side-panel');
const btnClosePanel = document.getElementById('btn-close-panel');
const chatUnreadBadge = document.getElementById('chat-unread-count');
const chatMessagesContainer = document.getElementById('chat-messages');
const formChat = document.getElementById('form-chat');
const inputChat = document.getElementById('input-chat');

const whiteboardStage = document.getElementById('whiteboard-stage');
const wbBtnClose = document.getElementById('wb-btn-close');

const peopleList = document.getElementById('people-list');
const peoplePanelCount = document.getElementById('people-panel-count');
const participantCountBadge = document.getElementById('participant-count-badge');
const btnHostLock = document.getElementById('btn-host-lock');
const hostLockText = document.getElementById('host-lock-text');
const hostActionsDock = document.getElementById('host-actions-dock');
const btnHostEndAll = document.getElementById('btn-host-end-all');

const filesList = document.getElementById('files-list');
const btnSelectFile = document.getElementById('btn-select-file');
const fileInput = document.getElementById('file-input');
const btnModeP2P = document.getElementById('btn-mode-p2p');
const btnModeServer = document.getElementById('btn-mode-server');
const fileProgressContainer = document.getElementById('file-progress-container');
const fileProgressBar = document.getElementById('file-progress-bar');
const fileProgressName = document.getElementById('file-progress-name');
const fileProgressPercent = document.getElementById('file-progress-percent');
const btnCancelFile = document.getElementById('btn-cancel-file');
let currentActiveTransferId = null;

// Toast Utility
function showToast(text, type = 'info') {
  const container = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : (type === 'success' ? 'toast-success' : '')}`;
  toast.textContent = text;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// Call Timer
setInterval(() => {
  const diffSec = Math.floor((Date.now() - callStartTime) / 1000);
  const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
  const secs = String(diffSec % 60).padStart(2, '0');
  document.getElementById('call-timer').textContent = `${mins}:${secs}`;
}, 1000);

// Initialize Call Room
async function initCall() {
  try {
    // 1. Check user auth
    const authData = await api.getMe();
    if (!authData.user) {
      window.location.href = `/?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    currentUser = authData.user;
    document.getElementById('name-local').textContent = `${currentUser.displayName} (You)`;

    // 2. Fetch room info
    roomInfo = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}`);
    document.getElementById('call-room-title').textContent = roomInfo.title || 'Meeting';
    document.getElementById('call-room-code').textContent = roomInfo.code;
    isHost = roomInfo.isHost;

    if (isHost || currentUser.isAdmin) {
      btnHostLock.style.display = 'inline-flex';
      hostActionsDock.style.display = 'block';
    }

    // 3. Initialize E2EE Key
    const passcode = sessionStorage.getItem(`huddle_passcode_${roomCode}`);
    await e2ee.initKey(passcode);

    // 4. Initialize RTC Mesh Manager
    rtcMesh = new RTCMeshManager(signaling, {
      onRemoteStream: handleRemoteStream,
      onRemoteStreamRemoved: handleRemoteStreamRemoved,
      onSpeakingChange: handleSpeakingChange,
      onQualityChange: handleQualityChange,
      onDataChannelMessage: (socketId, data) => fileManager?.handleDataChannelMessage(socketId, data),
      onScreenShareEndedLocally: () => stopScreenShareLocally()
    });

    // 5. Initialize File Transfer Manager
    fileManager = new FileTransferManager(rtcMesh, roomCode, {
      onTransferProgress: handleTransferProgress,
      onFileReceived: handleFileReceived,
      onFileCancelled: handleFileCancelled
    });

    // 6. Connect Signaling
    await signaling.connect();

    // 7. Get user media from stored lobby preferences
    const prefAudio = sessionStorage.getItem('huddle_pref_audio') !== '0';
    const prefVideo = sessionStorage.getItem('huddle_pref_video') !== '0';
    const prefCam = sessionStorage.getItem('huddle_pref_cam');
    const prefMic = sessionStorage.getItem('huddle_pref_mic');

    isAudioMuted = !prefAudio;
    isVideoMuted = !prefVideo;

    const stream = await rtcMesh.initLocalStream({
      audio: prefAudio,
      video: prefVideo,
      camId: prefCam,
      micId: prefMic
    });

    const localVideo = document.getElementById('video-local');
    localVideo.srcObject = stream;
    updateLocalMediaUI();

    // 8. Join Room over socket
    signaling.emit('join-room', {
      roomCode,
      passcode,
      mediaState: { audio: prefAudio, video: prefVideo }
    });

    // Setup Socket Event Handlers
    bindSocketEvents();
    bindUIEvents();
    loadServerFiles();
    window.__roomReady = true;
  } catch (err) {
    console.error('Initialization error:', err);
    showToast(err.message || 'Failed to enter meeting.', 'error');
  }
}

// Bind Signaling Events
function bindSocketEvents() {
  signaling.on('room-joined', (data) => {
    isHost = data.isHost;
    if (data.isLocked) {
      hostLockText.textContent = 'Unlock Room';
    }

    // Init whiteboard state if present
    initWhiteboard();
    if (data.whiteboardElements && whiteboardInstance) {
      whiteboardInstance.loadInitialState(data.whiteboardElements);
    }

    // Add existing participants
    data.existingParticipants.forEach(p => {
      participants.set(p.socketId, p);
      addVideoTile(p);
      // As newcomer, initiate WebRTC mesh peer connection with existing members
      rtcMesh.createPeer(p.socketId, true, p);
    });

    updateParticipantCounts();
    renderPeopleList();

    if (data.currentScreenSharer) {
      currentScreenSharer = data.currentScreenSharer;
    }
  });

  signaling.on('user-joined', (participant) => {
    participants.set(participant.socketId, participant);
    addVideoTile(participant);
    updateParticipantCounts();
    renderPeopleList();
    // Existing member waits for offer from newcomer
    rtcMesh.createPeer(participant.socketId, false, participant);
  });

  signaling.on('user-left', ({ socketId, displayName }) => {
    participants.delete(socketId);
    removeVideoTile(socketId);
    rtcMesh.removePeer(socketId);
    updateParticipantCounts();
    renderPeopleList();

    if (pinnedSocketId === socketId) {
      unpinParticipant();
    }
    if (currentScreenSharer === socketId) {
      stopScreenShareStage();
    }
  });

  signaling.on('signal-offer', ({ fromSocketId, offer }) => {
    rtcMesh.handleOffer(fromSocketId, offer);
  });

  signaling.on('signal-answer', ({ fromSocketId, answer }) => {
    rtcMesh.handleAnswer(fromSocketId, answer);
  });

  signaling.on('ice-candidate', ({ fromSocketId, candidate }) => {
    rtcMesh.handleCandidate(fromSocketId, candidate);
  });

  signaling.on('user-media-toggle', ({ socketId, type, enabled }) => {
    const p = participants.get(socketId);
    if (p) {
      if (type === 'audio') p.mediaState.audio = enabled;
      if (type === 'video') p.mediaState.video = enabled;
      updateRemoteMediaUI(socketId, p);
      renderPeopleList();
    }
  });

  signaling.on('hand-raise-changed', ({ socketId, isHandRaised, displayName }) => {
    const p = participants.get(socketId);
    if (p) p.isHandRaised = isHandRaised;

    const tile = document.getElementById(`tile-${socketId}`);
    if (tile) {
      const badge = tile.querySelector('.badge-hand');
      if (badge) badge.style.display = isHandRaised ? 'flex' : 'none';
    }
    renderPeopleList();
  });

  signaling.on('screen-share-started', ({ socketId, displayName }) => {
    currentScreenSharer = socketId;
    if (socketId !== signaling.getSocketId()) {
      showToast(`${displayName} is sharing their screen.`);
      // Connect remote screen stream to main stage
      const peer = rtcMesh.peers.get(socketId);
      if (peer && peer.stream) {
        screenShareVideo.srcObject = peer.stream;
        screenShareStage.style.display = 'flex';
      }
    }
  });

  signaling.on('screen-share-stopped', () => {
    currentScreenSharer = null;
    stopScreenShareStage();
  });

  signaling.on('screen-share-error', ({ message }) => {
    showToast(message, 'error');
  });

  signaling.on('force-mute', () => {
    isAudioMuted = true;
    rtcMesh.setAudioEnabled(false);
    updateLocalMediaUI();
    showToast('You were muted by the host.');
  });

  signaling.on('kicked', ({ message }) => {
    alert(message || 'You have been removed from the meeting.');
    window.location.href = '/dashboard';
  });

  signaling.on('meeting-ended', ({ reason }) => {
    alert(reason || 'The meeting has ended.');
    window.location.href = '/dashboard';
  });

  signaling.on('room-lock-changed', ({ isLocked }) => {
    hostLockText.textContent = isLocked ? 'Unlock Room' : 'Lock Room';
    showToast(`The room is now ${isLocked ? 'locked' : 'unlocked'}.`);
  });

  signaling.on('system-message', ({ text, timestamp }) => {
    appendSystemMessage(text, timestamp);
  });

  signaling.on('chat-message', async (data) => {
    try {
      const decryptedText = await e2ee.decryptMessage(data.ciphertext, data.iv);
      appendChatMessage({
        senderName: data.senderName,
        isSelf: data.senderSocketId === signaling.getSocketId(),
        text: decryptedText,
        timestamp: data.timestamp
      });
    } catch (e) {
      console.warn('Failed to decrypt received chat message:', e);
    }
  });

  signaling.on('file-uploaded', (fileRecord) => {
    appendFileItem(fileRecord, false);
    showToast(`New file shared: ${fileRecord.originalName}`);
  });
}

// Handle WebRTC Peer Streams
function handleRemoteStream(socketId, stream, track) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (tile) {
    const video = tile.querySelector('video');
    if (video && video.srcObject !== stream) {
      video.srcObject = stream;
    }
  }

  // If this peer is actively screen sharing, attach to main screen stage
  if (currentScreenSharer === socketId) {
    screenShareVideo.srcObject = stream;
    screenShareStage.style.display = 'flex';
  }
}

function handleRemoteStreamRemoved(socketId) {
  removeVideoTile(socketId);
}

function handleSpeakingChange(id, isSpeaking) {
  const tile = id === 'local' ? document.getElementById('tile-local') : document.getElementById(`tile-${id}`);
  if (tile) {
    if (isSpeaking) {
      tile.classList.add('is-speaking');
    } else {
      tile.classList.remove('is-speaking');
    }
  }
}

function handleQualityChange(socketId, quality) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (tile) {
    let qTag = tile.querySelector('.quality-indicator');
    if (!qTag) {
      qTag = document.createElement('span');
      qTag.className = 'quality-indicator text-meta';
      qTag.style.fontSize = '10px';
      qTag.style.padding = '2px 6px';
      qTag.style.borderRadius = '3px';
      tile.querySelector('.tile-meta-bar').prepend(qTag);
    }
    qTag.textContent = quality.toUpperCase();
    qTag.style.backgroundColor = quality === 'good' ? '#16A34A' : (quality === 'fair' ? '#F59E0B' : '#DC2626');
  }
}

// Adaptive Video Grid Helpers
function addVideoTile(participant) {
  if (document.getElementById(`tile-${participant.socketId}`)) return;

  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `tile-${participant.socketId}`;

  const initials = participant.displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  tile.innerHTML = `
    <video autoplay playsinline></video>
    <div class="tile-avatar" style="display: none;">${initials}</div>
    <div class="tile-meta-bar">
      <span class="tile-name-tag">
        <span class="tile-user-name">${escapeHtml(participant.displayName)}</span>
        ${participant.isHost ? '<span style="font-size: 10px; color: #3B82F6;">(Host)</span>' : ''}
        <svg class="tile-mic-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      </span>
      <div class="tile-actions">
        <span class="badge-hand" style="display: ${participant.isHandRaised ? 'flex' : 'none'};" title="Hand Raised">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path>
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path>
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path>
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>
          </svg>
        </span>
        <button class="tile-icon-btn btn-pin-participant" title="Pin to stage">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  tile.querySelector('.btn-pin-participant').addEventListener('click', () => {
    pinParticipant(participant.socketId, participant.displayName);
  });

  videoGrid.appendChild(tile);
  updateRemoteMediaUI(participant.socketId, participant);
  reflowGrid();
}

function removeVideoTile(socketId) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (tile) tile.remove();
  reflowGrid();
}

function reflowGrid() {
  const totalTiles = videoGrid.querySelectorAll('.video-tile').length;
  videoGrid.setAttribute('data-count', String(Math.min(totalTiles, 9)));
}

function updateParticipantCounts() {
  const count = participants.size + 1; // peers + self
  const text = `${count} participant${count === 1 ? '' : 's'}`;
  participantCountBadge.textContent = text;
  peoplePanelCount.textContent = text;
}

// Media UI Toggles
function updateLocalMediaUI() {
  const videoLocal = document.getElementById('video-local');
  const avatarLocal = document.getElementById('avatar-local');
  const initials = currentUser?.displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '--';
  avatarLocal.textContent = initials;

  if (isVideoMuted) {
    videoLocal.style.display = 'none';
    avatarLocal.style.display = 'flex';
    btnDockCam.classList.add('btn-muted');
  } else {
    videoLocal.style.display = 'block';
    avatarLocal.style.display = 'none';
    btnDockCam.classList.remove('btn-muted');
  }

  if (isAudioMuted) {
    btnDockMic.classList.add('btn-muted');
    document.getElementById('mic-icon-local').style.display = 'none';
  } else {
    btnDockMic.classList.remove('btn-muted');
    document.getElementById('mic-icon-local').style.display = 'block';
  }
}

function updateRemoteMediaUI(socketId, p) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (!tile) return;

  const video = tile.querySelector('video');
  const avatar = tile.querySelector('.tile-avatar');
  const micIcon = tile.querySelector('.tile-mic-icon');

  if (p.mediaState.video) {
    video.style.display = 'block';
    avatar.style.display = 'none';
  } else {
    video.style.display = 'none';
    avatar.style.display = 'flex';
  }

  micIcon.style.display = p.mediaState.audio ? 'block' : 'none';
}

// Pinning
function pinParticipant(socketId, name) {
  pinnedSocketId = socketId;
  stageArea.classList.add('has-pinned');
  pinnedStage.style.display = 'flex';
  pinnedNameTag.textContent = name;

  const tile = document.getElementById(`tile-${socketId}`);
  if (tile) {
    const video = tile.querySelector('video');
    if (video?.srcObject) {
      pinnedVideo.srcObject = video.srcObject;
    }
  }
}

function unpinParticipant() {
  pinnedSocketId = null;
  stageArea.classList.remove('has-pinned');
  pinnedStage.style.display = 'none';
  pinnedVideo.srcObject = null;
}

btnUnpin.addEventListener('click', unpinParticipant);

// Screen Sharing Logic
async function toggleScreenShare() {
  if (isScreenSharing) {
    await rtcMesh.stopScreenShare();
    stopScreenShareLocally();
    signaling.emit('stop-screen-share');
  } else {
    if (currentScreenSharer && currentScreenSharer !== signaling.getSocketId()) {
      showToast('Another participant is already sharing their screen.', 'error');
      return;
    }
    try {
      const stream = await rtcMesh.startScreenShare();
      isScreenSharing = true;
      btnDockShare.classList.add('active');
      sharingBanner.style.display = 'flex';
      screenShareVideo.srcObject = stream;
      screenShareStage.style.display = 'flex';
      signaling.emit('start-screen-share');
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        showToast('Screen sharing failed to start.', 'error');
      }
    }
  }
}

function stopScreenShareLocally() {
  isScreenSharing = false;
  btnDockShare.classList.remove('active');
  sharingBanner.style.display = 'none';
  stopScreenShareStage();
}

function stopScreenShareStage() {
  screenShareStage.style.display = 'none';
  screenShareVideo.srcObject = null;
}

document.getElementById('btn-stop-sharing-banner').addEventListener('click', () => {
  toggleScreenShare();
});

// Collaborative Whiteboard
function initWhiteboard() {
  if (!whiteboardInstance) {
    const canvas = document.getElementById('whiteboard-canvas');
    whiteboardInstance = new Whiteboard(canvas, signaling);
    setupWhiteboardUI();
  }
}

function toggleWhiteboard() {
  initWhiteboard();
  const isActive = whiteboardStage.classList.toggle('active');
  whiteboardStage.style.display = isActive ? 'flex' : 'none';
  btnDockWb.classList.toggle('active', isActive);
  if (isActive) {
    whiteboardInstance.initCanvasSize();
  }
}

function setupWhiteboardUI() {
  wbBtnClose.addEventListener('click', () => {
    whiteboardStage.classList.remove('active');
    whiteboardStage.style.display = 'none';
    btnDockWb.classList.remove('active');
  });

  // Tools
  document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.wb-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      const tool = e.currentTarget.getAttribute('data-tool');
      e.currentTarget.classList.add('active');
      whiteboardInstance.setTool(tool);
    });
  });

  // Colors
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      e.currentTarget.classList.add('active');
      whiteboardInstance.setColor(e.currentTarget.getAttribute('data-color'));
    });
  });

  // Widths
  document.querySelectorAll('.stroke-width-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.stroke-width-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      whiteboardInstance.setWidth(parseInt(e.currentTarget.getAttribute('data-width'), 10));
    });
  });

  // Undo / Redo / Clear / Export / Zoom
  document.getElementById('wb-btn-undo').addEventListener('click', () => whiteboardInstance.undo());
  document.getElementById('wb-btn-redo').addEventListener('click', () => whiteboardInstance.redo());
  document.getElementById('wb-btn-export').addEventListener('click', () => whiteboardInstance.exportPNG());
  document.getElementById('wb-btn-zoom-in').addEventListener('click', () => whiteboardInstance.applyZoom(1.15));
  document.getElementById('wb-btn-zoom-out').addEventListener('click', () => whiteboardInstance.applyZoom(0.85));
  document.getElementById('wb-btn-zoom-reset').addEventListener('click', () => whiteboardInstance.resetZoom());

  document.getElementById('wb-btn-clear').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the whiteboard for all participants?')) {
      whiteboardInstance.clearBoard();
    }
  });
}

// Side Panel Management (Chat, Files, People)
function toggleSidePanel(targetTab = null) {
  const isOpen = sidePanel.classList.contains('open');

  if (isOpen && (!targetTab || document.getElementById(`tab-btn-${targetTab}`).classList.contains('active'))) {
    sidePanel.classList.remove('open');
    [btnDockChat, btnDockFiles, btnDockPeople].forEach(b => b.classList.remove('active'));
    return;
  }

  sidePanel.classList.add('open');
  if (targetTab) switchPanelTab(targetTab);
}

function switchPanelTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-pane').forEach(p => p.classList.remove('active'));
  [btnDockChat, btnDockFiles, btnDockPeople].forEach(b => b.classList.remove('active'));

  const tabBtn = document.getElementById(`tab-btn-${tabName}`);
  const pane = document.getElementById(`pane-${tabName}`);
  const dockBtn = document.getElementById(`btn-dock-${tabName}`);

  if (tabBtn && pane) {
    tabBtn.classList.add('active');
    pane.classList.add('active');
  }
  if (dockBtn) dockBtn.classList.add('active');

  if (tabName === 'chat') {
    unreadChatCount = 0;
    chatUnreadBadge.style.display = 'none';
    chatUnreadBadge.textContent = '0';
    inputChat.focus();
  }
}

document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    const target = e.currentTarget.getAttribute('data-tab').replace('tab-', '');
    switchPanelTab(target);
  });
});

btnClosePanel.addEventListener('click', () => toggleSidePanel());

// In-Call E2EE Chat
formChat.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputChat.value.trim();
  if (!text) return;
  inputChat.value = '';

  try {
    const encrypted = await e2ee.encryptMessage(text);
    signaling.emit('chat-message', {
      messageId: `msg_${Date.now()}`,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv
    });
  } catch (err) {
    showToast('Failed to encrypt message.', 'error');
  }
});

function appendChatMessage({ senderName, isSelf, text, timestamp }) {
  const msgEl = document.createElement('div');
  msgEl.style.display = 'flex';
  msgEl.style.flexDirection = 'column';
  msgEl.style.alignItems = isSelf ? 'flex-end' : 'flex-start';

  const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgEl.innerHTML = `
    <div style="font-size: 11px; color: #71717A; margin-bottom: 2px;">
      ${escapeHtml(senderName)} • ${timeStr}
    </div>
    <div style="
      background-color: ${isSelf ? 'var(--accent)' : '#27272A'};
      color: #FFFFFF;
      padding: 8px 12px;
      border-radius: var(--radius-md);
      font-size: var(--font-size-body);
      max-width: 85%;
      word-break: break-word;
    ">
      ${escapeHtml(text)}
    </div>
  `;

  chatMessagesContainer.appendChild(msgEl);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

  // Increment unread count if chat panel is closed
  if (!sidePanel.classList.contains('open') || !document.getElementById('pane-chat').classList.contains('active')) {
    unreadChatCount++;
    chatUnreadBadge.textContent = String(unreadChatCount);
    chatUnreadBadge.style.display = 'block';
  }
}

function appendSystemMessage(text, timestamp) {
  const sysEl = document.createElement('div');
  sysEl.style.textAlign = 'center';
  sysEl.style.fontSize = '12px';
  sysEl.style.color = '#71717A';
  sysEl.style.padding = '4px 0';
  sysEl.textContent = text;
  chatMessagesContainer.appendChild(sysEl);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// File Sharing & Management
btnModeP2P.addEventListener('click', () => {
  fileUploadMode = 'p2p';
  btnModeP2P.style.backgroundColor = '#2563EB';
  btnModeP2P.style.color = '#FFFFFF';
  btnModeServer.style.backgroundColor = '#1E1E22';
  btnModeServer.style.color = '#F4F4F5';
});

btnModeServer.addEventListener('click', () => {
  fileUploadMode = 'server';
  btnModeServer.style.backgroundColor = '#2563EB';
  btnModeServer.style.color = '#FFFFFF';
  btnModeP2P.style.backgroundColor = '#1E1E22';
  btnModeP2P.style.color = '#F4F4F5';
});

btnSelectFile.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileInput.value = '';

  fileProgressContainer.style.display = 'block';
  fileProgressName.textContent = file.name;
  fileProgressBar.style.width = '0%';
  fileProgressPercent.textContent = '0%';

  try {
    if (fileUploadMode === 'p2p') {
      currentActiveTransferId = await fileManager.sendFileP2P(file);
    } else {
      // Server upload
      const csrfToken = document.cookie.split('; ').find(row => row.startsWith('csrf_token='))?.split('=')[1];
      const uploadedFile = await fileManager.uploadToServer(file, csrfToken);
      fileProgressContainer.style.display = 'none';
      appendFileItem(uploadedFile, true);
      showToast('File securely encrypted and uploaded to server.');
    }
  } catch (err) {
    fileProgressContainer.style.display = 'none';
    showToast(err.message || 'File transfer failed.', 'error');
  }
});

btnCancelFile.addEventListener('click', () => {
  if (currentActiveTransferId) {
    fileManager.cancelTransfer(currentActiveTransferId);
    fileProgressContainer.style.display = 'none';
    showToast('File transfer cancelled.');
  }
});

function handleTransferProgress({ transferId, name, percent, direction }) {
  currentActiveTransferId = transferId;
  fileProgressContainer.style.display = 'block';
  fileProgressName.textContent = `${direction === 'outgoing' ? 'Sending' : 'Receiving'} ${name}`;
  fileProgressBar.style.width = `${percent}%`;
  fileProgressPercent.textContent = `${percent}%`;

  if (percent >= 100) {
    setTimeout(() => {
      fileProgressContainer.style.display = 'none';
    }, 1000);
  }
}

function handleFileReceived(file) {
  fileProgressContainer.style.display = 'none';
  appendFileItem({
    id: file.transferId,
    originalName: file.name,
    sizeBytes: file.size,
    downloadUrl: file.downloadUrl,
    isP2P: true,
    hashVerified: file.hashVerified
  }, true);
  showToast(`Received file "${file.name}" via direct P2P.`);
}

function handleFileCancelled(transferId) {
  fileProgressContainer.style.display = 'none';
  showToast('File transfer was cancelled.');
}

async function loadServerFiles() {
  try {
    const res = await api.get(`/api/files/room/${encodeURIComponent(roomCode)}`);
    (res.files || []).forEach(f => appendFileItem(f, false));
  } catch (err) {
    console.warn('Could not load room files:', err);
  }
}

function appendFileItem(file, prepend = false) {
  const item = document.createElement('div');
  item.style.backgroundColor = '#1E1E22';
  item.style.border = '1px solid #27272A';
  item.style.borderRadius = 'var(--radius-md)';
  item.style.padding = '10px 12px';
  item.style.display = 'flex';
  item.style.alignItems = 'center';
  item.style.justifyContent = 'space-between';

  const sizeFormatted = (file.sizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
  const downloadLink = file.downloadUrl || `/api/files/${file.id}/download`;

  item.innerHTML = `
    <div style="overflow: hidden; margin-right: 12px;">
      <div style="font-size: var(--font-size-meta); font-weight: 500; color: #F4F4F5; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
        ${escapeHtml(file.originalName)}
      </div>
      <div style="font-size: 11px; color: #71717A;">
        ${sizeFormatted} • ${file.isP2P ? 'Direct P2P' : 'AES-256 Encrypted'}
      </div>
    </div>
    <a href="${downloadLink}" download="${escapeHtml(file.originalName)}" class="btn btn-secondary" style="padding: 4px 10px; font-size: var(--font-size-xs); background-color: #27272A; border-color: #3F3F46; color: #FFFFFF; flex-shrink: 0;">
      Download
    </a>
  `;

  if (prepend && filesList.firstChild) {
    filesList.insertBefore(item, filesList.firstChild);
  } else {
    filesList.appendChild(item);
  }
}

// People List Rendering & Host Controls
function renderPeopleList() {
  peopleList.innerHTML = '';

  // Render Self
  const selfRow = createParticipantRow({
    socketId: signaling.getSocketId(),
    displayName: `${currentUser.displayName} (You)`,
    isHost: isHost,
    mediaState: { audio: !isAudioMuted, video: !isVideoMuted },
    isHandRaised: isHandRaised,
    isSelf: true
  });
  peopleList.appendChild(selfRow);

  // Render Peers
  for (const [sId, p] of participants.entries()) {
    const row = createParticipantRow({ ...p, isSelf: false });
    peopleList.appendChild(row);
  }
}

function createParticipantRow(p) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.justifyContent = 'space-between';
  row.style.padding = '8px 10px';
  row.style.backgroundColor = '#1E1E22';
  row.style.borderRadius = 'var(--radius-md)';
  row.style.border = '1px solid #27272A';

  row.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: var(--font-size-meta); font-weight: 500; color: #F4F4F5;">${escapeHtml(p.displayName)}</span>
      ${p.isHost ? '<span style="font-size: 10px; color: #3B82F6;">(Host)</span>' : ''}
      ${p.isHandRaised ? '<span title="Hand Raised" style="font-size: 12px;">✋</span>' : ''}
    </div>

    <div style="display: flex; align-items: center; gap: 6px;">
      <span title="${p.mediaState.audio ? 'Mic unmuted' : 'Mic muted'}" style="color: ${p.mediaState.audio ? '#16A34A' : '#EF4444'};">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path></svg>
      </span>

      ${(isHost || currentUser?.isAdmin) && !p.isSelf ? `
        <button class="btn btn-secondary btn-mute-user" data-socket="${p.socketId}" style="padding: 2px 6px; font-size: 11px; background-color: #27272A; border-color: #3F3F46; color: #F4F4F5;">Mute</button>
        <button class="btn btn-danger btn-kick-user" data-socket="${p.socketId}" style="padding: 2px 6px; font-size: 11px;">Kick</button>
      ` : ''}
    </div>
  `;

  if ((isHost || currentUser?.isAdmin) && !p.isSelf) {
    row.querySelector('.btn-mute-user').addEventListener('click', () => {
      signaling.emit('remote-mute-participant', { targetSocketId: p.socketId });
    });

    row.querySelector('.btn-kick-user').addEventListener('click', () => {
      if (confirm(`Are you sure you want to remove ${p.displayName} from the meeting?`)) {
        signaling.emit('remove-participant', { targetSocketId: p.socketId });
      }
    });
  }

  return row;
}

// Host Lock and End All
btnHostLock.addEventListener('click', () => {
  const isCurrentlyLocked = hostLockText.textContent.includes('Unlock');
  signaling.emit('lock-room', { locked: !isCurrentlyLocked });
});

btnHostEndAll.addEventListener('click', () => {
  if (confirm('Are you sure you want to end this meeting for everyone? All participants will be disconnected.')) {
    signaling.emit('end-meeting');
  }
});

// UI Event Listeners & Shortcuts
function bindUIEvents() {
  // Toggle Mic (M)
  btnDockMic.addEventListener('click', toggleMic);
  // Toggle Cam (V)
  btnDockCam.addEventListener('click', toggleCam);
  // Share Screen (S)
  btnDockShare.addEventListener('click', toggleScreenShare);
  // Whiteboard (W)
  btnDockWb.addEventListener('click', toggleWhiteboard);

  // Raise Hand
  btnDockHand.addEventListener('click', () => {
    isHandRaised = !isHandRaised;
    btnDockHand.classList.toggle('active', isHandRaised);
    document.getElementById('badge-hand-local').style.display = isHandRaised ? 'flex' : 'none';
    signaling.emit('raise-hand-toggle');
    renderPeopleList();
  });

  // Dock Panel Toggles
  btnDockChat.addEventListener('click', () => toggleSidePanel('chat'));
  btnDockFiles.addEventListener('click', () => toggleSidePanel('files'));
  btnDockPeople.addEventListener('click', () => toggleSidePanel('people'));

  // Copy Invite Link
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText(e2ee.getShareableLink());
    showToast('Meeting link copied to clipboard!');
  });

  // Leave Dialog
  const leaveModal = document.getElementById('modal-confirm-leave');
  btnDockLeave.addEventListener('click', () => leaveModal.classList.add('active'));
  document.getElementById('btn-close-leave-modal').addEventListener('click', () => leaveModal.classList.remove('active'));
  document.getElementById('btn-cancel-leave').addEventListener('click', () => leaveModal.classList.remove('active'));

  document.getElementById('btn-confirm-leave').addEventListener('click', () => {
    signaling.emit('leave-room');
    rtcMesh.closeAll();
    window.location.href = '/dashboard';
  });

  // Keyboard Shortcuts (M, V, S, W)
  window.addEventListener('keydown', (e) => {
    // Ignore shortcuts when user is typing in chat or input
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMic();
    } else if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      toggleCam();
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      toggleScreenShare();
    } else if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      toggleWhiteboard();
    }
  });
}

function toggleMic() {
  isAudioMuted = !isAudioMuted;
  rtcMesh.setAudioEnabled(!isAudioMuted);
  updateLocalMediaUI();
  signaling.emit('media-toggle', { type: 'audio', enabled: !isAudioMuted });
  renderPeopleList();
}

function toggleCam() {
  isVideoMuted = !isVideoMuted;
  rtcMesh.setVideoEnabled(!isVideoMuted);
  updateLocalMediaUI();
  signaling.emit('media-toggle', { type: 'video', enabled: !isVideoMuted });
  renderPeopleList();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

initCall();
