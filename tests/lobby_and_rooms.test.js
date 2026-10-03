import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lobby from '../src/lobby.js';
import * as signal from '../src/signal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('20. lobbyPhase transitions through idle, waiting, lobby, countdown, playing and rematch', () => {
  assert.equal(typeof lobby.lobbyPhase, 'function', 'lobbyPhase must be exported from src/lobby.js');

  // 1. Not connected -> idle
  assert.equal(
    lobby.lobbyPhase({ connected: false, ready1: false, ready2: false, countdownStartedAt: null, now: 0 }),
    'idle',
    'Disconnected state must be idle'
  );
  assert.equal(
    lobby.lobbyPhase({ connected: false }),
    'idle',
    'connected: false must default to idle'
  );

  // 2. Connected, neither player ready -> lobby
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: false, ready2: false, countdownStartedAt: null, now: 0 }),
    'lobby',
    'Connected with neither player ready must be lobby'
  );

  // 3. Connected, only one player ready -> waiting
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: true, ready2: false, countdownStartedAt: null, now: 0 }),
    'waiting',
    'Only P1 ready must be waiting'
  );
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: false, ready2: true, countdownStartedAt: null, now: 0 }),
    'waiting',
    'Only P2 ready must be waiting'
  );

  // 4. Both ready, countdown in progress -> countdown
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: true, ready2: true, countdownStartedAt: 1000, now: 1000 }),
    'countdown',
    'At countdown start (0ms elapsed), phase must be countdown'
  );
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: true, ready2: true, countdownStartedAt: 1000, now: 2500 }),
    'countdown',
    'Mid-countdown (1500ms elapsed), phase must be countdown'
  );
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: true, ready2: true, countdownStartedAt: 1000, now: 4500 }),
    'countdown',
    'During GO overlay (3500ms elapsed), phase must still be countdown'
  );

  // 5. Both ready, countdown finished (>= 4000ms elapsed) -> playing
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: true, ready2: true, countdownStartedAt: 1000, now: 5000 }),
    'playing',
    'After 4000ms countdown completion, phase must be playing'
  );
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: true, ready2: true, countdownStartedAt: 1000, now: 10000 }),
    'playing',
    'Well after countdown, phase must remain playing'
  );

  // 6. Rematch resets ready states -> back to lobby
  assert.equal(
    lobby.lobbyPhase({ connected: true, ready1: false, ready2: false, countdownStartedAt: null, now: 10000 }),
    'lobby',
    'Rematch reset must return phase to lobby'
  );

  // 7. Disconnection during playing or lobby -> back to idle
  assert.equal(
    lobby.lobbyPhase({ connected: false, ready1: true, ready2: true, countdownStartedAt: 1000, now: 5000 }),
    'idle',
    'Disconnection at any point must drop phase back to idle'
  );
});

test('21. countdownValue returns 3, 2, 1, 0 (GO) at boundary values 0ms, 999ms, 1000ms, 3000ms', () => {
  assert.equal(typeof lobby.countdownValue, 'function', 'countdownValue must be exported from src/lobby.js');

  const start = 10000;

  // Boundary 0 ms -> 3
  assert.equal(lobby.countdownValue(start, start + 0), 3, 'At 0ms elapsed, countdownValue must be 3');

  // Boundary 999 ms -> 3
  assert.equal(lobby.countdownValue(start, start + 999), 3, 'At 999ms elapsed, countdownValue must still be 3');

  // Boundary 1000 ms -> 2
  assert.equal(lobby.countdownValue(start, start + 1000), 2, 'At 1000ms elapsed, countdownValue must be 2');
  assert.equal(lobby.countdownValue(start, start + 1999), 2, 'At 1999ms elapsed, countdownValue must still be 2');

  // 2000 ms -> 1
  assert.equal(lobby.countdownValue(start, start + 2000), 1, 'At 2000ms elapsed, countdownValue must be 1');
  assert.equal(lobby.countdownValue(start, start + 2999), 1, 'At 2999ms elapsed, countdownValue must still be 1');

  // Boundary 3000 ms -> 0 ('GO')
  assert.equal(lobby.countdownValue(start, start + 3000), 0, 'At 3000ms elapsed, countdownValue must be 0 (GO)');
  assert.equal(lobby.countdownValue(start, start + 3999), 0, 'At 3999ms elapsed, countdownValue must be 0 (GO)');
});

test('22. makeRoomCode generates 6-character safe codes without O, 0, I, 1 over 1000 draws', () => {
  assert.equal(typeof signal.makeRoomCode, 'function', 'makeRoomCode must be exported from src/signal.js');

  const forbiddenChars = /[O0I1]/;
  const allowedChars = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = signal.makeRoomCode();
    assert.equal(typeof code, 'string', 'Code must be a string');
    assert.equal(code.length, 6, `Code "${code}" must have length 6`);
    assert.doesNotMatch(code, forbiddenChars, `Code "${code}" must not contain confusing chars O, 0, I, 1`);
    assert.match(code, allowedChars, `Code "${code}" must consist only of characters from safe alphabet`);
    seen.add(code);
  }

  // Across 1000 draws from 32^6 combinations, we expect many distinct codes
  assert.ok(seen.size > 950, `Expected high entropy across 1000 draws, got ${seen.size} unique codes`);
});

test('23. parseRoomFromHash extracts valid codes and rejects invalid or foreign hashes', () => {
  assert.equal(typeof signal.parseRoomFromHash, 'function', 'parseRoomFromHash must be exported from src/signal.js');

  // Valid room hashes
  assert.equal(signal.parseRoomFromHash('#r=ABC234'), 'ABC234');
  assert.equal(signal.parseRoomFromHash('r=ABC234'), 'ABC234');
  assert.equal(signal.parseRoomFromHash('#r=XYZ89K'), 'XYZ89K');
  assert.equal(signal.parseRoomFromHash('#r=abc234'), 'ABC234', 'Should normalize lowercase room code to uppercase');

  // Foreign hashes (Chunk C manual pairing) must be ignored / return null
  assert.equal(signal.parseRoomFromHash('#s=offerToken123'), null, 'Manual offer hash #s= must not parse as room');
  assert.equal(signal.parseRoomFromHash('#a=answerToken456'), null, 'Manual answer hash #a= must not parse as room');

  // Invalid room formats
  assert.equal(signal.parseRoomFromHash(''), null, 'Empty string must return null');
  assert.equal(signal.parseRoomFromHash('#r='), null, 'Empty room code must return null');
  assert.equal(signal.parseRoomFromHash('#r=123'), null, 'Too short room code must return null');
  assert.equal(signal.parseRoomFromHash('#r=TOOLONGCODE'), null, 'Too long room code must return null');
  assert.equal(signal.parseRoomFromHash('#r=AB!@45'), null, 'Invalid symbols must return null');
  assert.equal(signal.parseRoomFromHash(null), null, 'null input must return null');
  assert.equal(signal.parseRoomFromHash(undefined), null, 'undefined input must return null');
});

test('24. roomLink constructs proper #r=<CODE> links', () => {
  assert.equal(typeof signal.roomLink, 'function', 'roomLink must be exported from src/signal.js');

  assert.equal(
    signal.roomLink('ABC234', 'https://example.com/tetris/'),
    'https://example.com/tetris/#r=ABC234'
  );
  assert.equal(
    signal.roomLink('ABC234', 'https://example.com/tetris'),
    'https://example.com/tetris#r=ABC234'
  );
  // Replaces existing hash if present in baseUrl
  assert.equal(
    signal.roomLink('ABC234', 'https://example.com/tetris/#s=oldToken'),
    'https://example.com/tetris/#r=ABC234'
  );
});

test('25. UI start-gate readiness buttons and signaling elements exist in HTML', () => {
  const htmlPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Readiness buttons for start-gate
  assert.match(html, /id=["']btnReadyP1["']/, 'index.html must contain #btnReadyP1');
  assert.match(html, /id=["']btnReadyP2["']/, 'index.html must contain #btnReadyP2');

  // Room link sharing buttons / inputs
  assert.match(html, /id=["']roomCodeDisplay["']|id=["']hostRoomCode["']/, 'index.html must contain room code display');
  assert.match(html, /id=["']btnShareRoomLink["']/, 'index.html must contain #btnShareRoomLink');
  assert.match(html, /id=["']btnCopyRoomLink["']/, 'index.html must contain #btnCopyRoomLink');

  // Countdown overlay
  assert.match(html, /id=["']countdownOverlay["']/, 'index.html must contain #countdownOverlay');
  assert.match(html, /id=["']countdownText["']/, 'index.html must contain #countdownText');
});
