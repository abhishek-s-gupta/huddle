import { api } from '/js/api.js';

const roomCode = window.location.pathname.split('/').pop().trim();
let localStream = null;
let audioContext = null;
let analyser = null;
let animationFrameId = null;

let isAudioEnabled = true;
let isVideoEnabled = true;
let roomInfo = null;

const previewVideo = document.getElementById('preview-video');
const previewAvatar = document.getElementById('preview-avatar');
const avatarInitials = document.getElementById('avatar-initials');
const btnToggleMic = document.getElementById('btn-toggle-mic');
const btnToggleCam = document.getElementById('btn-toggle-cam');
const selectCam = document.getElementById('select-camera');
const selectMic = document.getElementById('select-mic');
const selectSpeaker = document.getElementById('select-speaker');
const groupSpeaker = document.getElementById('group-speaker');
const micMeterFill = document.getElementById('mic-meter-fill');
const micStatusText = document.getElementById('mic-status-text');
const btnJoin = document.getElementById('btn-join');
const groupPasscode = document.getElementById('group-passcode');
const inputPasscode = document.getElementById('input-passcode');
const errorPasscode = document.getElementById('error-passcode');
const errorGeneral = document.getElementById('error-general');
const permissionWarning = document.getElementById('permission-warning');

// Retrieve saved room passcode from sessionStorage if creator set one
const savedPasscode = sessionStorage.getItem(`huddle_passcode_${roomCode}`);
if (savedPasscode) {
  inputPasscode.value = savedPasscode;
}

async function init() {
  try {
    // Verify current user
    const me = await api.getMe();
    if (!me.user) {
      window.location.href = `/?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    const initials = me.user.displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    avatarInitials.textContent = initials;
    const colors = ['#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#059669', '#0891B2', '#4F46E5', '#D97706'];
    let hash = 0;
    for (let i = 0; i < (me.user.displayName || '').length; i++) {
      hash = me.user.displayName.charCodeAt(i) + ((hash << 5) - hash);
    }
    avatarInitials.style.backgroundColor = colors[Math.abs(hash) % colors.length];
    const chip = document.getElementById('lobby-user-chip');
    if (chip) chip.textContent = `${me.user.displayName} (You)`;

    // Fetch room info
    roomInfo = await api.get(`/api/rooms/${encodeURIComponent(roomCode)}`);
    document.getElementById('room-title').textContent = roomInfo.title || 'Meeting Room';
    document.getElementById('room-code-badge').textContent = roomInfo.code;

    if (roomInfo.requiresPasscode) {
      groupPasscode.style.display = 'block';
    }

    // Initialize user media
    await setupMedia();
    await enumerateDevices();
  } catch (err) {
    if (err.status === 404) {
      window.location.href = '/404.html';
    } else if (err.status === 410) {
      errorGeneral.textContent = 'This meeting has ended.';
      errorGeneral.style.display = 'block';
      btnJoin.disabled = true;
    } else if (err.status === 423) {
      errorGeneral.textContent = 'This meeting is locked by the host.';
      errorGeneral.style.display = 'block';
      btnJoin.disabled = true;
    } else {
      errorGeneral.textContent = err.message || 'Failed to initialize lobby.';
      errorGeneral.style.display = 'block';
    }
  }
}

async function setupMedia(videoSource = null, audioSource = null) {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  const constraints = {
    video: videoSource ? { deviceId: { exact: videoSource } } : true,
    audio: audioSource ? { deviceId: { exact: audioSource } } : true
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    previewVideo.srcObject = localStream;
    previewVideo.style.display = 'block';
    previewAvatar.style.display = 'none';

    // Setup audio analyser for mic meter
    setupAudioAnalyser(localStream);
  } catch (err) {
    console.warn('Media access error in lobby:', err);
    permissionWarning.style.display = 'flex';
    previewVideo.style.display = 'none';
    previewAvatar.style.display = 'flex';
    isVideoEnabled = false;
    isAudioEnabled = false;
    updateMediaUI();
  }
}

function setupAudioAnalyser(stream) {
  if (audioContext) {
    audioContext.close();
  }
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateMeter() {
      if (!isAudioEnabled) {
        micMeterFill.style.width = '0%';
        micStatusText.textContent = 'Microphone muted';
        animationFrameId = requestAnimationFrame(updateMeter);
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const percent = Math.min(100, Math.round((avg / 128) * 100));
      micMeterFill.style.width = `${percent}%`;
      micStatusText.textContent = percent > 5 ? 'Active' : 'Silent';

      animationFrameId = requestAnimationFrame(updateMeter);
    }

    updateMeter();
  } catch (e) {
    console.warn('AudioContext not available:', e);
  }
}

async function enumerateDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    selectCam.innerHTML = '<option value="">Default Camera</option>';
    selectMic.innerHTML = '<option value="">Default Microphone</option>';
    selectSpeaker.innerHTML = '<option value="">Default Speaker</option>';

    let camCount = 0;
    let micCount = 0;
    let spkCount = 0;

    devices.forEach(device => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      if (device.kind === 'videoinput') {
        camCount++;
        opt.textContent = device.label || `Camera ${camCount}`;
        selectCam.appendChild(opt);
      } else if (device.kind === 'audioinput') {
        micCount++;
        opt.textContent = device.label || `Microphone ${micCount}`;
        selectMic.appendChild(opt);
      } else if (device.kind === 'audiooutput') {
        spkCount++;
        opt.textContent = device.label || `Speaker ${spkCount}`;
        selectSpeaker.appendChild(opt);
      }
    });

    if ('setSinkId' in HTMLMediaElement.prototype && spkCount > 0) {
      groupSpeaker.style.display = 'block';
    }
  } catch (err) {
    console.warn('Device enumeration error:', err);
  }
}

selectCam.addEventListener('change', () => {
  setupMedia(selectCam.value, selectMic.value);
});

selectMic.addEventListener('change', () => {
  setupMedia(selectCam.value, selectMic.value);
});

// Toggle Mic
btnToggleMic.addEventListener('click', () => {
  isAudioEnabled = !isAudioEnabled;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
  }
  updateMediaUI();
});

// Toggle Cam
btnToggleCam.addEventListener('click', () => {
  isVideoEnabled = !isVideoEnabled;
  if (localStream) {
    localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
  }
  previewVideo.style.display = isVideoEnabled ? 'block' : 'none';
  previewAvatar.style.display = isVideoEnabled ? 'none' : 'flex';
  updateMediaUI();
});

function updateMediaUI() {
  if (isAudioEnabled) {
    btnToggleMic.classList.remove('btn-muted');
  } else {
    btnToggleMic.classList.add('btn-muted');
  }

  if (isVideoEnabled) {
    btnToggleCam.classList.remove('btn-muted');
  } else {
    btnToggleCam.classList.add('btn-muted');
  }
}

// Join Action
btnJoin.addEventListener('click', async () => {
  errorPasscode.style.display = 'none';
  errorGeneral.style.display = 'none';

  const passcode = inputPasscode.value.trim();

  if (roomInfo?.requiresPasscode) {
    if (!passcode) {
      errorPasscode.textContent = 'Room passcode is required to enter.';
      errorPasscode.style.display = 'block';
      inputPasscode.focus();
      return;
    }

    // Verify passcode
    try {
      btnJoin.disabled = true;
      btnJoin.textContent = 'Verifying...';
      await api.post(`/api/rooms/${encodeURIComponent(roomCode)}/verify-passcode`, { passcode });
    } catch (err) {
      btnJoin.disabled = false;
      btnJoin.textContent = 'Join Meeting';
      errorPasscode.textContent = err.message || 'Incorrect passcode.';
      errorPasscode.style.display = 'block';
      return;
    }
  }

  // Save preferences to sessionStorage for room.html
  sessionStorage.setItem('huddle_pref_audio', isAudioEnabled ? '1' : '0');
  sessionStorage.setItem('huddle_pref_video', isVideoEnabled ? '1' : '0');
  if (passcode) {
    sessionStorage.setItem(`huddle_passcode_${roomCode}`, passcode);
  }
  if (selectCam.value) sessionStorage.setItem('huddle_pref_cam', selectCam.value);
  if (selectMic.value) sessionStorage.setItem('huddle_pref_mic', selectMic.value);

  // Clean up lobby stream before transitioning
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  const hash = window.location.hash || '';
  window.location.href = `/room/${encodeURIComponent(roomCode)}${hash}`;
});

init();
