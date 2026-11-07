/**
 * Collaborative Real-Time Whiteboard for Huddle
 * Features: Pen, Highlighter, Eraser, Line, Rectangle, Ellipse, Arrow, Text,
 * Undo/Redo, Clear, Pan/Zoom, PNG Export, Late-Join Sync, and Throttled Socket.io updates.
 */

export class Whiteboard {
  constructor(canvasElement, signalingClient) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.signaling = signalingClient;

    this.currentTool = 'pen'; // pen, highlighter, eraser, line, rectangle, ellipse, arrow, text, pan
    this.currentColor = '#111111';
    this.currentWidth = 3;

    this.elements = []; // Array of drawn elements
    this.undoStack = []; // For local undo/redo
    this.redoStack = [];

    // Viewport transform (Pan & Zoom)
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // Drawing state
    this.isDrawing = false;
    this.currentStroke = null;
    this.startPoint = null;

    // Throttled batch queue for Socket.io
    this.pendingBatch = [];
    this.batchInterval = null;

    this.initCanvasSize();
    this.bindEvents();
    this.bindSocketEvents();
    this.startBatchTimer();
  }

  initCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    this.redraw();
  }

  setTool(tool) {
    this.currentTool = tool;
    this.canvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'text' ? 'text' : 'crosshair');
  }

  setColor(color) {
    this.currentColor = color;
  }

  setWidth(width) {
    this.currentWidth = width;
  }

  // Transform screen coordinate to canvas virtual coordinate taking pan/zoom into account
  toVirtualCoord(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    return {
      x: (screenX - this.panX) / this.scale,
      y: (screenY - this.panY) / this.scale
    };
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    // Pointer events (unifies mouse and touch)
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // Wheel event for Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.applyZoom(zoomFactor, e.clientX, e.clientY);
    }, { passive: false });
  }

  applyZoom(factor, clientX = null, clientY = null) {
    const newScale = Math.min(Math.max(this.scale * factor, 0.4), 3.0);
    if (clientX !== null && clientY !== null) {
      const rect = this.canvas.getBoundingClientRect();
      const originX = clientX - rect.left;
      const originY = clientY - rect.top;
      this.panX = originX - (originX - this.panX) * (newScale / this.scale);
      this.panY = originY - (originY - this.panY) * (newScale / this.scale);
    }
    this.scale = newScale;
    this.redraw();

    const badge = document.getElementById('wb-zoom-level');
    if (badge) badge.textContent = `${Math.round(this.scale * 100)}%`;
  }

  resetZoom() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.redraw();

    const badge = document.getElementById('wb-zoom-level');
    if (badge) badge.textContent = '100%';
  }

  onPointerDown(e) {
    if (e.target !== this.canvas) return;

    if (this.currentTool === 'pan' || e.button === 1 || e.altKey) {
      this.isPanning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const pt = this.toVirtualCoord(e.clientX, e.clientY);
    this.isDrawing = true;
    this.startPoint = pt;

    if (this.currentTool === 'text') {
      this.promptTextInput(pt.x, pt.y, e.clientX, e.clientY);
      this.isDrawing = false;
      return;
    }

    if (['pen', 'highlighter', 'eraser'].includes(this.currentTool)) {
      this.currentStroke = {
        id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        points: [pt]
      };
    } else {
      // Shape tools (line, rectangle, ellipse, arrow)
      this.currentStroke = {
        id: `shape_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y
      };
    }
  }

  onPointerMove(e) {
    if (this.isPanning) {
      this.panX = e.clientX - this.panStartX;
      this.panY = e.clientY - this.panStartY;
      this.redraw();
      return;
    }

    if (!this.isDrawing || !this.currentStroke) return;

    const pt = this.toVirtualCoord(e.clientX, e.clientY);

    if (['pen', 'highlighter', 'eraser'].includes(this.currentStroke.type)) {
      this.currentStroke.points.push(pt);
      this.redraw();
    } else {
      this.currentStroke.endX = pt.x;
      this.currentStroke.endY = pt.y;
      this.redraw();
    }
  }

  onPointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.currentTool === 'pan' ? 'grab' : 'crosshair';
      return;
    }

    if (!this.isDrawing || !this.currentStroke) return;

    this.isDrawing = false;
    const finalElement = this.currentStroke;
    this.currentStroke = null;

    this.elements.push(finalElement);
    this.undoStack.push(finalElement);
    this.redoStack = []; // Clear redo stack on new action

    // Queue for throttled broadcast
    this.pendingBatch.push(finalElement);
    this.redraw();
  }

  promptTextInput(virtualX, virtualY, screenX, screenY) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type text and press Enter...';
    input.style.position = 'absolute';
    input.style.left = `${screenX}px`;
    input.style.top = `${screenY}px`;
    input.style.zIndex = '100';
    input.style.fontSize = `${Math.max(14, this.currentWidth * 4 * this.scale)}px`;
    input.style.fontFamily = 'Inter, sans-serif';
    input.style.color = this.currentColor;
    input.style.background = '#FFFFFF';
    input.style.border = '1px solid #2563EB';
    input.style.borderRadius = '4px';
    input.style.padding = '4px 8px';
    input.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

    document.body.appendChild(input);
    input.focus();

    const commit = () => {
      const text = input.value.trim();
      input.remove();
      if (!text) return;

      const element = {
        id: `text_${Date.now()}`,
        type: 'text',
        text,
        x: virtualX,
        y: virtualY,
        color: this.currentColor,
        fontSize: Math.max(14, this.currentWidth * 4)
      };

      this.elements.push(element);
      this.undoStack.push(element);
      this.pendingBatch.push(element);
      this.redraw();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') input.remove();
    });

    input.addEventListener('blur', commit);
  }

  startBatchTimer() {
    this.batchInterval = setInterval(() => {
      if (this.pendingBatch.length > 0) {
        const batch = [...this.pendingBatch];
        this.pendingBatch = [];
        this.signaling.emit('whiteboard-stroke', { elements: batch });
      }
    }, 40); // 40ms batching (25 updates/sec max over socket)
  }

  bindSocketEvents() {
    this.signaling.on('whiteboard-stroke', ({ elements }) => {
      if (Array.isArray(elements)) {
        elements.forEach(el => this.elements.push(el));
        this.redraw();
      }
    });

    this.signaling.on('whiteboard-cleared', () => {
      this.elements = [];
      this.undoStack = [];
      this.redoStack = [];
      this.redraw();
    });
  }

  loadInitialState(elements) {
    if (Array.isArray(elements) && elements.length > 0) {
      this.elements = [...elements];
      this.redraw();
    }
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const last = this.undoStack.pop();
    this.redoStack.push(last);

    const index = this.elements.findIndex(el => el.id === last.id);
    if (index !== -1) {
      this.elements.splice(index, 1);
    }
    this.redraw();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const item = this.redoStack.pop();
    this.undoStack.push(item);
    this.elements.push(item);
    this.redraw();
  }

  clearBoard() {
    this.elements = [];
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
    this.signaling.emit('whiteboard-clear');
  }

  redraw() {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply viewport pan and zoom
    this.ctx.scale(dpr, dpr);
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.scale, this.scale);

    // Render stored elements
    this.elements.forEach(el => this.renderElement(el));

    // Render actively drawn element
    if (this.currentStroke) {
      this.renderElement(this.currentStroke);
    }

    this.ctx.restore();
  }

  renderElement(el) {
    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (el.type === 'eraser') {
      this.ctx.strokeStyle = '#FAFAFA'; // canvas background color
      this.ctx.lineWidth = el.width * 3;
    } else if (el.type === 'highlighter') {
      this.ctx.strokeStyle = el.color;
      this.ctx.globalAlpha = 0.35;
      this.ctx.lineWidth = el.width * 4;
    } else {
      this.ctx.strokeStyle = el.color;
      this.ctx.fillStyle = el.color;
      this.ctx.lineWidth = el.width;
      this.ctx.globalAlpha = 1.0;
    }

    if (['pen', 'highlighter', 'eraser'].includes(el.type)) {
      if (!el.points || el.points.length === 0) return;
      this.ctx.beginPath();
      this.ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        this.ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      this.ctx.stroke();
    } else if (el.type === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(el.startX, el.startY);
      this.ctx.lineTo(el.endX, el.endY);
      this.ctx.stroke();
    } else if (el.type === 'rectangle') {
      this.ctx.beginPath();
      const x = Math.min(el.startX, el.endX);
      const y = Math.min(el.startY, el.endY);
      const w = Math.abs(el.endX - el.startX);
      const h = Math.abs(el.endY - el.startY);
      this.ctx.strokeRect(x, y, w, h);
    } else if (el.type === 'ellipse') {
      this.ctx.beginPath();
      const centerX = (el.startX + el.endX) / 2;
      const centerY = (el.startY + el.endY) / 2;
      const radiusX = Math.abs(el.endX - el.startX) / 2;
      const radiusY = Math.abs(el.endY - el.startY) / 2;
      this.ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (el.type === 'arrow') {
      this.drawArrow(el.startX, el.startY, el.endX, el.endY, el.width);
    } else if (el.type === 'text') {
      this.ctx.font = `${el.fontSize || 16}px Inter, sans-serif`;
      this.ctx.fillText(el.text, el.x, el.y);
    }

    this.ctx.restore();
  }

  drawArrow(fromX, fromY, toX, toY, width) {
    const headLength = 14 + width;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();

    // Arrowhead
    this.ctx.beginPath();
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.closePath();
    this.ctx.fill();
  }

  exportPNG() {
    // Render to an offscreen canvas with white background
    const offscreen = document.createElement('canvas');
    offscreen.width = this.width * 2;
    offscreen.height = this.height * 2;
    const offCtx = offscreen.getContext('2d');

    offCtx.fillStyle = '#FFFFFF';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    offCtx.scale(2, 2);

    this.elements.forEach(el => {
      this.ctx.save();
      // Temporarily swap ctx to offscreen
      const originalCtx = this.ctx;
      this.ctx = offCtx;
      this.renderElement(el);
      this.ctx = originalCtx;
    });

    const link = document.createElement('a');
    link.download = `huddle-whiteboard-${Date.now()}.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
  }

  destroy() {
    if (this.batchInterval) clearInterval(this.batchInterval);
  }
}
