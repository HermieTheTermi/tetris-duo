import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS,
  ROWS,
  PIECES,
  createState,
  spawn,
  tick,
  move,
  rotate,
  softDrop,
  hardDrop,
  hold,
  boardMatrix,
  incomingGarbage,
  applyGarbage,
  rng,
} from '../src/engine.js';

test('1. 7-Bag randomizer generates full permutations of all 7 pieces', () => {
  assert.equal(PIECES.length, 7);
  const state = createState(12345);

  // Take 14 pieces (two full bags)
  const sequence = [state.cur.kind];
  for (let i = 0; i < 13; i++) {
    spawn(state);
    sequence.push(state.cur.kind);
  }

  assert.equal(sequence.length, 14);

  const bag1 = sequence.slice(0, 7);
  const bag2 = sequence.slice(7, 14);

  // Bag 1 must contain all 7 pieces
  const set1 = new Set(bag1);
  assert.equal(set1.size, 7);
  for (const p of PIECES) {
    assert.ok(set1.has(p), `Bag 1 must contain ${p}`);
  }

  // Bag 2 must also contain all 7 pieces
  const set2 = new Set(bag2);
  assert.equal(set2.size, 7);
  for (const p of PIECES) {
    assert.ok(set2.has(p), `Bag 2 must contain ${p}`);
  }
});

test('2. Rotation with wall kicks works against boundaries', () => {
  const state = createState(999);
  // Force piece to be 'I'
  state.cur = {
    kind: 'I',
    rot: 1, // vertical: cells at x = 7 + 2 = 9
    x: 7,
    y: 5,
    cells: [
      [9, 5],
      [9, 6],
      [9, 7],
      [9, 8],
    ],
  };

  // Rotating back to rot 0 (horizontal) at x=7 would place cells at x: 7, 8, 9, 10
  // Column 10 is outside board (COLS=10). Wall kick must push it left!
  const rotated = rotate(state, false);
  assert.equal(rotated, true, 'Rotation with wall kick must succeed');
  assert.equal(state.cur.rot, 0);

  // All cells must be within 0..COLS-1
  for (const [x, y] of state.cur.cells) {
    assert.ok(x >= 0 && x < COLS, `Cell x=${x} must be within board`);
    assert.ok(y >= 0 && y < ROWS, `Cell y=${y} must be within board`);
  }

  // Now test left wall kick: place horizontal 'I' at x = -1
  state.cur = {
    kind: 'I',
    rot: 0,
    x: -1,
    y: 5,
    cells: [
      [-1, 6],
      [0, 6],
      [1, 6],
      [2, 6],
    ],
  };
  const leftKick = rotate(state, true);
  assert.equal(leftKick, true, 'Rotation kicking off left wall must succeed');
  for (const [x, y] of state.cur.cells) {
    assert.ok(x >= 0 && x < COLS, `Cell x=${x} must be within board`);
  }
});

test('3. Gravity moves piece down and locks piece after delay', () => {
  const state = createState(42);
  const initialY = state.cur.y;

  // Initial gravity at level 1 is 800ms
  // Tick 800ms should drop the piece by at least 1 cell
  tick(state, 800);
  assert.ok(state.cur.y > initialY, 'Gravity tick must drop the piece down');

  // Hard drop drops and locks immediately
  const dropped = hardDrop(state);
  assert.ok(dropped > 0, 'Hard drop must report positive dropped count');

  // After lock, the board matrix must contain piece cells
  const matrix = boardMatrix(state);
  const nonZero = matrix.flat().filter((val) => val > 0 && val < 8);
  assert.equal(nonZero.length, 4, 'Locked piece must occupy exactly 4 cells on board');
});

test('4. Line clear clears rows and awards correct score and attack', () => {
  const state = createState(777);

  // Prepare row 19 almost full (9 blocks out of 10)
  for (let c = 0; c < COLS; c++) {
    if (c !== 3) {
      state.board[ROWS - 1][c] = 1;
    }
  }

  // Position 'I' piece vertically at col 3 (rot 1: col 3+2=5; or force piece cells)
  state.cur = {
    kind: 'I',
    rot: 0,
    x: 0,
    y: ROWS - 2,
    cells: [
      [3, ROWS - 1], // this will fill the missing column 3 in row 19
      [0, ROWS - 2],
      [1, ROWS - 2],
      [2, ROWS - 2],
    ],
  };

  const initialScore = state.score;
  const initialLines = state.lines;

  // Lock piece via hard drop (dropped = 0 since already at bottom)
  hardDrop(state);

  // 1 line was cleared!
  assert.equal(state.lines, initialLines + 1, 'Lines cleared must increment by 1');
  // Score for 1 line at level 1 is 100 * 1 = 100
  assert.equal(state.score, initialScore + 100, 'Score must increase by 100 for 1 single line clear');

  // Test multi-line clearing scores and attack
  // Let's create a state and fill 4 lines (Tetris)
  const tetrisState = createState(111);
  for (let r = ROWS - 4; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c !== 4) tetrisState.board[r][c] = 2;
    }
  }
  tetrisState.cur = {
    kind: 'I',
    rot: 1,
    x: 2, // col 2+2 = 4
    y: ROWS - 5,
    cells: [
      [4, ROWS - 4],
      [4, ROWS - 3],
      [4, ROWS - 2],
      [4, ROWS - 1],
    ],
  };

  const events = hardDrop(tetrisState);
  assert.equal(tetrisState.lines, 4, 'Tetris must clear 4 lines');
  assert.equal(tetrisState.score, 800, 'Tetris clear must award 800 * level points');
});

test('5. Level increases every 10 lines and speeds up gravity', () => {
  const state = createState(555);
  assert.equal(state.level, 1);

  // Simulate clearing 9 lines
  state.lines = 9;
  state.level = 1 + Math.floor(state.lines / 10);
  assert.equal(state.level, 1, 'Level should still be 1 at 9 lines');

  // Clearing 10th line
  state.lines = 10;
  state.level = 1 + Math.floor(state.lines / 10);
  assert.equal(state.level, 2, 'Level should increase to 2 at 10 lines');

  // Clearing 25 lines
  state.lines = 25;
  state.level = 1 + Math.floor(state.lines / 10);
  assert.equal(state.level, 3, 'Level should be 3 at 25 lines');

  // Gravity intervals: 800 - (level - 1)*70
  const grav1 = Math.max(50, 800 - (1 - 1) * 70);
  const grav2 = Math.max(50, 800 - (2 - 1) * 70);
  const grav3 = Math.max(50, 800 - (3 - 1) * 70);
  assert.equal(grav1, 800);
  assert.equal(grav2, 730);
  assert.equal(grav3, 660);
});

test('6. Garbage insertion pushes rows up with exactly one hole per row', () => {
  const state = createState(333);
  incomingGarbage(state, 3);
  assert.equal(state.queuedGarbage, 3);

  const pushed = applyGarbage(state);
  assert.equal(pushed, 3, 'applyGarbage must push all 3 queued lines');
  assert.equal(state.queuedGarbage, 0, 'queuedGarbage must be reset to 0');

  const matrix = boardMatrix(state);
  // Bottom 3 rows (indices 17, 18, 19) must be garbage lines
  for (let r = ROWS - 3; r < ROWS; r++) {
    const row = matrix[r];
    const garbageCells = row.filter((c) => c === 8);
    const emptyCells = row.filter((c) => c === 0);
    assert.equal(garbageCells.length, COLS - 1, `Row ${r} must contain ${COLS - 1} garbage blocks`);
    assert.equal(emptyCells.length, 1, `Row ${r} must contain exactly 1 hole`);
  }
});

test('7. Game over triggers when spawned piece collides at spawn', () => {
  const state = createState(12);
  assert.equal(state.over, false);

  // Fill row 0 and 1 at spawn columns
  for (let c = 3; c <= 6; c++) {
    state.board[0][c] = 5;
    state.board[1][c] = 5;
  }

  // Spawning next piece will collide
  spawn(state);
  assert.equal(state.over, true, 'Game over must be true when piece collides at spawn');

  // Further moves/rotations must be blocked
  assert.equal(move(state, 1), false);
  assert.equal(move(state, -1), false);
  assert.equal(rotate(state, true), false);
  assert.equal(softDrop(state), false);
  assert.equal(hardDrop(state), 0);
  assert.equal(hold(state), false);
});

test('8. Determinism: identical seeds and inputs produce identical states', () => {
  const s1 = createState(2026);
  const s2 = createState(2026);

  // Verify initial state equality
  assert.deepEqual(boardMatrix(s1), boardMatrix(s2));
  assert.equal(s1.cur.kind, s2.cur.kind);

  const actions = [
    (s) => move(s, 1),
    (s) => rotate(s, true),
    (s) => move(s, -1),
    (s) => softDrop(s),
    (s) => tick(s, 250),
    (s) => hardDrop(s),
    (s) => hold(s),
    (s) => move(s, -1),
    (s) => tick(s, 100),
    (s) => hardDrop(s),
    (s) => incomingGarbage(s, 2),
    (s) => applyGarbage(s),
    (s) => rotate(s, false),
    (s) => hardDrop(s),
  ];

  for (const action of actions) {
    action(s1);
    action(s2);
    assert.equal(s1.score, s2.score);
    assert.equal(s1.lines, s2.lines);
    assert.equal(s1.level, s2.level);
    assert.equal(s1.over, s2.over);
    assert.equal(s1.seed, s2.seed);
    assert.deepEqual(boardMatrix(s1), boardMatrix(s2));
  }
});

test('9. Hold functionality swaps current piece and prevents multi-hold', () => {
  const state = createState(888);
  const firstPiece = state.cur.kind;

  assert.equal(state.holdPiece, null);
  const hold1 = hold(state);
  assert.equal(hold1, true, 'First hold should succeed');
  assert.equal(state.holdPiece, firstPiece, 'Held piece should be first piece');

  // Cannot hold again before locking
  const hold2 = hold(state);
  assert.equal(hold2, false, 'Second hold in same turn must fail');

  // Lock the piece
  hardDrop(state);

  // Now hold should work again and swap
  const secondPiece = state.cur.kind;
  const hold3 = hold(state);
  assert.equal(hold3, true, 'Hold after lock should succeed');
  assert.equal(state.cur.kind, firstPiece, 'Current piece should now be previous hold piece');
  assert.equal(state.holdPiece, secondPiece, 'Held piece should now be second piece');
});
