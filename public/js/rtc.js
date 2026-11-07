/**
 * WebRTC Mesh Manager for Huddle
 * Manages peer connections, media tracks, audio level analysis,
 * automatic ICE restarts, and connection quality stats.
 */

export class RTCMeshManager {
  constructor(signaling, callbacks = {}) {
    this.signaling = signaling;
    this.callbacks = {
      onRemoteStream: callbacks.onRemoteStream || (() => {}),
      onRemoteStreamRemoved: callbacks.onRemoteStreamRemoved || (() => {}),
      onSpeakingChange: callbacks.onSpeakingChange || (() => {}),
      onQualityChange: callbacks.onQualityChange || (() => {}),
      onDataChannelMessage: callbacks.onDataChannelMessage || (() => {}),
      onDataChannelOpen: callbacks.onDataChannelOpen || (() => {}),
      onDataChannelClose: callbacks.onDataChannelClose || (() => {}),
      onScreenShareEndedLocally: callbacks.onScreenShareEndedLocally || (() => {})
    };

    this.localStream = null;
    this.screenStream = null;
    this.screenTrackSenders = new Map(); // socketId -> RTCRtpSender

    this.peers = new Map(); // socketId -> { pc, dataChannel, stream, statsInterval, analyser }
    this.audioContext = null;
    this.localAudioAnalyser = null;
    this.speakingState = new Map(); // socketId -> boolean

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    this.initAudioContext();
  }

  initAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    } catch (e) {
      console.warn('Web Audio API not supported for speaking detection:', e);
    }
  }

  async initLocalStream({ audio = true, video = true, camId = null, micId = null }) {
    const constraints = {
      audio: micId ? { deviceId: { exact: micId } } : true,
      video: camId ? { deviceId: { exact: camId } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('Failed with full constraints, falling back to basic audio/video:', err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (fallbackErr) {
        console.warn('Camera/mic completely unavailable, creating empty tracks fallback:', fallbackErr);
        // Create silent dummy stream if hardware is completely unavailable/denied
        this.localStream = new MediaStream();
      }
    }

    // Apply initial mute states
    this.setAudioEnabled(audio);
    this.setVideoEnabled(video);

    // Setup local audio level analyser
    if (this.audioContext && this.localStream.getAudioTracks().length > 0) {
      this.setupSpeakingDetector('local', this.localStream);
    }

    return this.localStream;
  }

  setupSpeakingDetector(id, stream) {
    if (!this.audioContext) return;
    try {
      if (stream.getAudioTracks().length === 0) return;
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let speakingFrames = 0;

      const checkAudio = () => {
        if (!this.audioContext || (id !== 'local' && !this.peers.has(id))) return;

        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const average = sum / data.length;

        // Threshold for speaking
        const isSpeakingNow = average > 14;
        if (isSpeakingNow) {
          speakingFrames = Math.min(speakingFrames + 1, 10);
        } else {
          speakingFrames = Math.max(speakingFrames - 1, 0);
        }

        const isSpeaking = speakingFrames >= 3;
        const currentSpeaking = this.speakingState.get(id) || false;

        if (isSpeaking !== currentSpeaking) {
          this.speakingState.set(id, isSpeaking);
          this.callbacks.onSpeakingChange(id, isSpeaking);
        }

        setTimeout(checkAudio, 150);
      };

      checkAudio();
    } catch (e) {
      console.warn('Failed to attach speaking detector to stream:', e);
    }
  }

  setAudioEnabled(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  setVideoEnabled(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  async createPeer(targetSocketId, isInitiator, userData = {}) {
    if (this.peers.has(targetSocketId)) {
      this.removePeer(targetSocketId);
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    const peerInfo = {
      pc,
      dataChannel: null,
      stream: new MediaStream(),
      userData,
      statsInterval: null
    };

    this.peers.set(targetSocketId, peerInfo);

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // If screen share is currently active, also send screen video track
    if (this.screenStream) {
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack) {
        const sender = pc.addTrack(screenTrack, this.screenStream);
        this.screenTrackSenders.set(targetSocketId, sender);
      }
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        if (!peerInfo.stream.getTracks().includes(track)) {
          peerInfo.stream.addTrack(track);
        }
      });

      this.callbacks.onRemoteStream(targetSocketId, peerInfo.stream, event.track);
      if (event.track.kind === 'audio') {
        this.setupSpeakingDetector(targetSocketId, peerInfo.stream);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.emit('ice-candidate', {
          toSocketId: targetSocketId,
          candidate: event.candidate
        });
      }
    };

    // Connection state monitoring & Automatic ICE restart on network drop
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        console.warn(`Connection to peer ${targetSocketId} ${state}. Attempting ICE restart...`);
        this.restartIce(targetSocketId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this.restartIce(targetSocketId);
      }
    };

    // Setup RTCDataChannel for peer-to-peer file transfer
    if (isInitiator) {
      const dc = pc.createDataChannel('huddle-files', { ordered: true });
      this.setupDataChannel(targetSocketId, dc);
      peerInfo.dataChannel = dc;

      // Create and send offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.signaling.emit('signal-offer', {
          toSocketId: targetSocketId,
          offer
        });
      } catch (err) {
        console.error(`Error creating offer for ${targetSocketId}:`, err);
      }
    } else {
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        peerInfo.dataChannel = dc;
        this.setupDataChannel(targetSocketId, dc);
      };
    }

    // Monitor connection quality
    this.startQualityStats(targetSocketId, pc);

    return peerInfo;
  }

  setupDataChannel(socketId, dc) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      this.callbacks.onDataChannelOpen(socketId, dc);
    };

    dc.onclose = () => {
      this.callbacks.onDataChannelClose(socketId);
    };

    dc.onmessage = (event) => {
      this.callbacks.onDataChannelMessage(socketId, event.data);
    };

    dc.onerror = (err) => {
      console.warn(`DataChannel error with ${socketId}:`, err);
    };
  }

  async handleOffer(fromSocketId, offer) {
    let peer = this.peers.get(fromSocketId);
    if (!peer) {
      peer = await this.createPeer(fromSocketId, false);
    }

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);

      this.signaling.emit('signal-answer', {
        toSocketId: fromSocketId,
        answer
      });
    } catch (err) {
      console.error(`Error handling offer from ${fromSocketId}:`, err);
    }
  }

  async handleAnswer(fromSocketId, answer) {
    const peer = this.peers.get(fromSocketId);
    if (!peer) return;

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error(`Error handling answer from ${fromSocketId}:`, err);
    }
  }

  async handleCandidate(fromSocketId, candidate) {
    const peer = this.peers.get(fromSocketId);
    if (!peer) return;

    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`Error adding ICE candidate from ${fromSocketId}:`, err);
    }
  }

  async restartIce(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer || peer.pc.signalingState === 'closed') return;

    try {
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      this.signaling.emit('signal-offer', {
        toSocketId: socketId,
        offer
      });
    } catch (err) {
      console.warn(`ICE restart failed for ${socketId}:`, err);
    }
  }

  startQualityStats(socketId, pc) {
    const interval = setInterval(async () => {
      if (!pc || pc.connectionState === 'closed') {
        clearInterval(interval);
        return;
      }
      try {
        const stats = await pc.getStats();
        let quality = 'good';
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            const rtt = report.currentRoundTripTime * 1000;
            if (rtt > 300) quality = 'poor';
            else if (rtt > 150) quality = 'fair';
            else quality = 'good';
          }
        });
        this.callbacks.onQualityChange(socketId, quality);
      } catch (e) {
        // Ignored
      }
    }, 4000);

    const peer = this.peers.get(socketId);
    if (peer) peer.statsInterval = interval;
  }

  // Screen Sharing
  async startScreenShare() {
    if (this.screenStream) return this.screenStream;

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];

      // Handle browser native "Stop Sharing" button
      screenTrack.onended = () => {
        this.stopScreenShare();
        this.callbacks.onScreenShareEndedLocally();
      };

      // Add track to each peer connection
      for (const [socketId, peer] of this.peers.entries()) {
        const sender = peer.pc.addTrack(screenTrack, this.screenStream);
        this.screenTrackSenders.set(socketId, sender);

        // Renegotiate
        try {
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          this.signaling.emit('signal-offer', {
            toSocketId: socketId,
            offer
          });
        } catch (e) {
          console.error('Renegotiation error on screen share start:', e);
        }
      }

      return this.screenStream;
    } catch (err) {
      throw err;
    }
  }

  async stopScreenShare() {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach(t => t.stop());

    for (const [socketId, sender] of this.screenTrackSenders.entries()) {
      const peer = this.peers.get(socketId);
      if (peer && peer.pc) {
        try {
          peer.pc.removeTrack(sender);
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          this.signaling.emit('signal-offer', {
            toSocketId: socketId,
            offer
          });
        } catch (e) {
          console.warn('Renegotiation error on screen share stop:', e);
        }
      }
    }

    this.screenTrackSenders.clear();
    this.screenStream = null;
  }

  removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    if (peer.statsInterval) clearInterval(peer.statsInterval);
    if (peer.dataChannel) peer.dataChannel.close();

    peer.pc.close();
    this.peers.delete(socketId);
    this.screenTrackSenders.delete(socketId);
    this.speakingState.delete(socketId);

    this.callbacks.onRemoteStreamRemoved(socketId);
  }

  closeAll() {
    for (const socketId of this.peers.keys()) {
      this.removePeer(socketId);
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
