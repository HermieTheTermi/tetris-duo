// Pure logic, no DOM, no timers, fully deterministic from seed
export const COLS = 10;
export const ROWS = 20;
export const PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

export const PIECE_IDS = {
  I: 1,
  J: 2,
  L: 3,
  O: 4,
  S: 5,
  T: 6,
  Z: 7,
  GARBAGE: 8,
};

// Standard SRS relative cell shapes: [x, y] coordinates in 4 rotation states
const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
};

// Wall kick tests (basic kicks: try 0/-1/+1/-2/+2 x-offsets and vertical offsets)
const WALL_KICKS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];

// Seeded PRNG (Mulberry32)
export function rng(state) {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function computeCells(piece) {
  const shape = SHAPES[piece.kind][piece.rot];
  return shape.map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
}

function isValidPosition(board, cells) {
  for (const [x, y] of cells) {
    if (x < 0 || x >= COLS || y >= ROWS) {
      return false;
    }
    if (y >= 0 && board[y][x] !== 0) {
      return false;
    }
  }
  return true;
}

function refillBag(state) {
  const pool = [...PIECES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng(state) * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  state.bag.push(...pool);
}

export function createState(seed = 1) {
  const state = {
    seed: (seed >>> 0) || 1,
    board: Array.from({ length: ROWS }, () => Array(COLS).fill(0)),
    bag: [],
    holdPiece: null,
    canHold: true,
    cur: null,
    score: 0,
    lines: 0,
    level: 1,
    queuedGarbage: 0,
    over: false,
    dropTimer: 0,
    lockTimer: 0,
  };
  refillBag(state);
  spawn(state);
  return state;
}

export function spawn(state) {
  if (state.over) return null;
  if (state.bag.length < 7) {
    refillBag(state);
  }
  const kind = state.bag.shift();
  const spawnY = kind === 'I' ? -1 : 0;
  const piece = {
    kind,
    rot: 0,
    x: 3,
    y: spawnY,
  };
  piece.cells = computeCells(piece);
  state.cur = piece;
  state.canHold = true;
  state.dropTimer = 0;
  state.lockTimer = 0;

  // Collision at spawn -> game over
  if (!isValidPosition(state.board, piece.cells)) {
    state.over = true;
    return piece;
  }
  return piece;
}

export function move(state, dir) {
  if (state.over || !state.cur) return false;
  if (dir !== -1 && dir !== 1) return false;
  const newCells = state.cur.cells.map(([x, y]) => [x + dir, y]);
  if (isValidPosition(state.board, newCells)) {
    state.cur.x += dir;
    state.cur.cells = newCells;
    return true;
  }
  return false;
}

export function rotate(state, cw) {
  if (state.over || !state.cur) return false;
  const nextRot = (state.cur.rot + (cw ? 1 : 3)) % 4;

  for (const [dx, dy] of WALL_KICKS) {
    const testPiece = {
      kind: state.cur.kind,
      rot: nextRot,
      x: state.cur.x + dx,
      y: state.cur.y + dy,
    };
    const testCells = computeCells(testPiece);
    if (isValidPosition(state.board, testCells)) {
      state.cur.rot = nextRot;
      state.cur.x += dx;
      state.cur.y += dy;
      state.cur.cells = testCells;
      return true;
    }
  }
  return false;
}

export function softDrop(state) {
  if (state.over || !state.cur) return false;
  const newCells = state.cur.cells.map(([x, y]) => [x, y + 1]);
  if (isValidPosition(state.board, newCells)) {
    state.cur.y += 1;
    state.cur.cells = newCells;
    state.dropTimer = 0;
    return true;
  }
  return false;
}

function lockPiece(state) {
  const events = [];
  if (!state.cur) return events;

  let lockout = false;
  for (const [x, y] of state.cur.cells) {
    if (y < 0) {
      lockout = true;
    } else {
      state.board[y][x] = PIECE_IDS[state.cur.kind] || 1;
    }
  }

  events.push({ type: 'lock', piece: state.cur });

  if (lockout) {
    state.over = true;
    events.push({ type: 'gameover' });
    return events;
  }

  // Check line clears
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (state.board[r].every((c) => c !== 0)) {
      state.board.splice(r, 1);
      state.board.unshift(Array(COLS).fill(0));
      cleared++;
      r++; // Check same row index again since upper rows shifted down
    }
  }

  if (cleared > 0) {
    state.lines += cleared;
    state.level = 1 + Math.floor(state.lines / 10);

    // Scoring: 100/300/500/800 * level
    const scoreTable = { 1: 100, 2: 300, 3: 500, 4: 800 };
    const scoreAdd = (scoreTable[cleared] || 100 * cleared) * state.level;
    state.score += scoreAdd;

    // Attack: 2/3/4 lines -> 1/2/4 garbage lines (1 line -> 0)
    const attackTable = { 1: 0, 2: 1, 3: 2, 4: 4 };
    const attack = attackTable[cleared] || 0;
    state.lastAttack = attack;
    state.lastCleared = cleared;

    events.push({
      type: 'clear',
      lines: cleared,
      attack,
      score: scoreAdd,
    });
  } else {
    state.lastAttack = 0;
    state.lastCleared = 0;
  }

  // Apply queued garbage after locking
  if (state.queuedGarbage > 0) {
    const pushed = applyGarbage(state);
    events.push({ type: 'garbage', lines: pushed });
  }

  // Spawn next piece
  spawn(state);
  if (state.over) {
    events.push({ type: 'gameover' });
  }

  return events;
}

export function hardDrop(state) {
  if (state.over || !state.cur) return 0;
  let dropped = 0;
  while (true) {
    const nextCells = state.cur.cells.map(([x, y]) => [x, y + 1]);
    if (isValidPosition(state.board, nextCells)) {
      state.cur.y += 1;
      state.cur.cells = nextCells;
      dropped += 1;
    } else {
      break;
    }
  }
  lockPiece(state);
  return dropped;
}

export function hold(state) {
  if (state.over || !state.cur || !state.canHold) return false;

  const currentKind = state.cur.kind;
  if (state.holdPiece === null) {
    state.holdPiece = currentKind;
    spawn(state);
  } else {
    const nextKind = state.holdPiece;
    state.holdPiece = currentKind;
    const spawnY = nextKind === 'I' ? -1 : 0;
    const piece = {
      kind: nextKind,
      rot: 0,
      x: 3,
      y: spawnY,
    };
    piece.cells = computeCells(piece);
    state.cur = piece;
    state.dropTimer = 0;
    state.lockTimer = 0;
    if (!isValidPosition(state.board, piece.cells)) {
      state.over = true;
      return false;
    }
  }
  state.canHold = false;
  return true;
}

export function boardMatrix(state) {
  return state.board.map((row) => [...row]);
}

export function incomingGarbage(state, n) {
  if (typeof n === 'number' && n > 0) {
    state.queuedGarbage = (state.queuedGarbage || 0) + n;
  }
}

export function applyGarbage(state) {
  const count = state.queuedGarbage || 0;
  if (count <= 0) return 0;
  state.queuedGarbage = 0;

  for (let i = 0; i < count; i++) {
    const holeCol = Math.floor(rng(state) * COLS);
    const row = Array(COLS).fill(PIECE_IDS.GARBAGE);
    row[holeCol] = 0;
    state.board.shift();
    state.board.push(row);
  }

  // If active piece now collides with newly risen garbage, shift up or check collision
  if (state.cur) {
    while (!isValidPosition(state.board, state.cur.cells) && state.cur.y > -2) {
      state.cur.y -= 1;
      state.cur.cells = computeCells(state.cur);
    }
    if (!isValidPosition(state.board, state.cur.cells)) {
      state.over = true;
    }
  }
  return count;
}

export function tick(state, dtMs) {
  if (state.over) return [];
  if (!state.cur) {
    spawn(state);
    if (state.over) return [{ type: 'gameover' }];
  }

  const events = [];
  const gravity = Math.max(50, 800 - (state.level - 1) * 70);
  state.dropTimer += dtMs;

  const canMoveDown = isValidPosition(
    state.board,
    state.cur.cells.map(([x, y]) => [x, y + 1])
  );

  if (canMoveDown) {
    state.lockTimer = 0;
    while (state.dropTimer >= gravity) {
      state.dropTimer -= gravity;
      const nextCells = state.cur.cells.map(([x, y]) => [x, y + 1]);
      if (isValidPosition(state.board, nextCells)) {
        state.cur.y += 1;
        state.cur.cells = nextCells;
      } else {
        break;
      }
    }
  } else {
    // Piece is resting on a surface
    state.lockTimer += dtMs;
    if (state.lockTimer >= 500 || state.dropTimer >= gravity) {
      events.push(...lockPiece(state));
    }
  }

  return events;
}
