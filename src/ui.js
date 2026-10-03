// Rendering + input (canvas)
import { COLS, ROWS, PIECE_IDS } from './engine.js';

export const COLORS = {
  0: '#0f172a', // empty
  1: '#06b6d4', // I: cyan
  2: '#3b82f6', // J: blue
  3: '#f97316', // L: orange
  4: '#eab308', // O: yellow
  5: '#22c55e', // S: green
  6: '#a855f7', // T: purple
  7: '#ef4444', // Z: red
  8: '#64748b', // Garbage: metallic slate
};

const PIECE_SHAPES_PREVIEW = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

export function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

export function drawCell(ctx, x, y, size, colorId, isGhost = false) {
  const px = x * size;
  const py = y * size;

  if (isGhost) {
    ctx.strokeStyle = COLORS[colorId] || '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
    ctx.fillStyle = (COLORS[colorId] || '#ffffff') + '22';
    ctx.fillRect(px + 2, py + 2, size - 4, size - 4);
    return;
  }

  const baseColor = COLORS[colorId] || '#334155';
  ctx.fillStyle = baseColor;
  ctx.fillRect(px, py, size, size);

  // Bevel highlights
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(px, py, size, 2);
  ctx.fillRect(px, py, 2, size);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(px, py + size - 2, size, 2);
  ctx.fillRect(px + size - 2, py, 2, size);
}

export function computeGhostCells(board, cur) {
  if (!cur || !cur.cells) return [];
  let dy = 0;
  while (true) {
    const next = cur.cells.map(([x, y]) => [x, y + dy + 1]);
    const blocked = next.some(([x, y]) => {
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y] && board[y][x] !== 0) return true;
      return false;
    });
    if (blocked) break;
    dy++;
  }
  return cur.cells.map(([x, y]) => [x, y + dy]);
}

export function renderBoard(canvas, board, cur, queued = 0, isOver = false) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const cellSize = width / COLS;

  // Background
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, width, height);

  // Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellSize, 0);
    ctx.lineTo(c * cellSize, height);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellSize);
    ctx.lineTo(width, r * cellSize);
    ctx.stroke();
  }

  // Draw placed cells on board
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const val = board && board[r] ? board[r][c] : 0;
      if (val !== 0) {
        drawCell(ctx, c, r, cellSize, val);
      }
    }
  }

  // Draw Ghost piece
  if (cur && cur.cells && !isOver) {
    const ghostCells = computeGhostCells(board, cur);
    const pieceId = PIECE_IDS[cur.kind] || 1;
    for (const [x, y] of ghostCells) {
      if (y >= 0) {
        drawCell(ctx, x, y, cellSize, pieceId, true);
      }
    }

    // Draw Active piece
    for (const [x, y] of cur.cells) {
      if (y >= 0) {
        drawCell(ctx, x, y, cellSize, pieceId, false);
      }
    }
  }

  // Queued garbage warning bar on left edge
  if (queued > 0) {
    const barHeight = Math.min(height, queued * cellSize);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(0, height - barHeight, 4, barHeight);
  }

  // Game over overlay
  if (isOver) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GAME OVER', width / 2, height / 2);
  }
}

export function renderPiecePreview(canvas, kind) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.clearRect(0, 0, width, height);

  if (!kind || !PIECE_SHAPES_PREVIEW[kind]) return;

  const shape = PIECE_SHAPES_PREVIEW[kind];
  const pieceId = PIECE_IDS[kind] || 1;
  const cellSize = 16;

  // Compute bounding box to center piece
  let minX = 4, maxX = 0, minY = 4, maxY = 0;
  for (const [x, y] of shape) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pieceWidth = (maxX - minX + 1) * cellSize;
  const pieceHeight = (maxY - minY + 1) * cellSize;
  const offsetX = (width - pieceWidth) / 2 - minX * cellSize;
  const offsetY = (height - pieceHeight) / 2 - minY * cellSize;

  for (const [x, y] of shape) {
    drawCell(
      ctx,
      (offsetX + x * cellSize) / cellSize,
      (offsetY + y * cellSize) / cellSize,
      cellSize,
      pieceId
    );
  }
}

export function bindKeyboard(onAction) {
  const keyState = new Map();
  const timers = new Map();

  const DAS = 160; // Initial repeat delay in ms
  const ARR = 40;  // Repeat interval in ms

  // Input mapping per INTERFACE.md:
  // Player 1: A/D move, W rotate CW, Q rotate CCW, S soft drop, Space hard drop, Shift hold
  // Player 2: Left/Right move, Up rotate CW, comma rotate CCW, Down soft drop, period hard drop, slash hold
  const ACTION_MAP = {
    // Player 1
    KeyA: { player: 1, action: 'left', repeat: true },
    KeyD: { player: 1, action: 'right', repeat: true },
    KeyW: { player: 1, action: 'rotCW', repeat: false },
    KeyQ: { player: 1, action: 'rotCCW', repeat: false },
    KeyS: { player: 1, action: 'softDrop', repeat: true, arr: 35 },
    Space: { player: 1, action: 'hardDrop', repeat: false },
    ShiftLeft: { player: 1, action: 'hold', repeat: false },
    ShiftRight: { player: 1, action: 'hold', repeat: false },

    // Player 2
    ArrowLeft: { player: 2, action: 'left', repeat: true },
    ArrowRight: { player: 2, action: 'right', repeat: true },
    ArrowUp: { player: 2, action: 'rotCW', repeat: false },
    Comma: { player: 2, action: 'rotCCW', repeat: false },
    ArrowDown: { player: 2, action: 'softDrop', repeat: true, arr: 35 },
    Period: { player: 2, action: 'hardDrop', repeat: false },
    Slash: { player: 2, action: 'hold', repeat: false },
  };

  const handleKeyDown = (e) => {
    const mapping = ACTION_MAP[e.code];
    if (!mapping) return;

    // Prevent default browser scrolling for game keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) {
      e.preventDefault();
    }

    if (keyState.get(e.code)) return; // Already pressed
    keyState.set(e.code, true);

    // Initial trigger
    onAction(mapping.player, mapping.action);

    if (mapping.repeat) {
      const arrInterval = mapping.arr || ARR;
      const initialTimer = setTimeout(() => {
        const repeatTimer = setInterval(() => {
          if (keyState.get(e.code)) {
            onAction(mapping.player, mapping.action);
          } else {
            clearInterval(repeatTimer);
          }
        }, arrInterval);
        timers.set(e.code + '_repeat', repeatTimer);
      }, DAS);
      timers.set(e.code + '_das', initialTimer);
    }
  };

  const handleKeyUp = (e) => {
    keyState.delete(e.code);
    if (timers.has(e.code + '_das')) {
      clearTimeout(timers.get(e.code + '_das'));
      timers.delete(e.code + '_das');
    }
    if (timers.has(e.code + '_repeat')) {
      clearInterval(timers.get(e.code + '_repeat'));
      timers.delete(e.code + '_repeat');
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    for (const timer of timers.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    timers.clear();
    keyState.clear();
  };
}
