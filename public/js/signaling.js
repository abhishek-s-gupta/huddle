/**
 * Client Signaling Manager over Socket.io
 */

export class SignalingClient {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Connect to same origin with credentials (cookies)
      // socket.io.js is served by Express server
      if (typeof window.io === 'undefined') {
        const script = document.createElement('script');
        script.src = '/socket.io/socket.io.js';
        script.onload = () => {
          this.initSocket(resolve, reject);
        };
        script.onerror = () => reject(new Error('Failed to load socket.io client script'));
        document.head.appendChild(script);
      } else {
        this.initSocket(resolve, reject);
      }
    });
  }

  initSocket(resolve, reject) {
    this.socket = window.io({
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      resolve();
    });

    this.socket.on('connect_error', (err) => {
      reject(err);
    });

    // Replay bound event handlers
    for (const [event, callbacks] of this.handlers.entries()) {
      callbacks.forEach(cb => this.socket.on(event, cb));
    }
  }

  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn(`Cannot emit "${event}": socket not connected.`);
    }
  }

  getSocketId() {
    return this.socket ? this.socket.id : null;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
