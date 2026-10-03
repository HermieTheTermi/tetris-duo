import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../src/engine.js';
import * as net from '../src/net.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('10. matchWinner returns correct winner and has no side effects', () => {
  assert.equal(typeof engine.matchWinner, 'function', 'matchWinner must be exported from engine.js');

  const sA = engine.createState(101);
  const sB = engine.createState(102);

  // Snapshot before
  const snapA = JSON.stringify(sA);
  const snapB = JSON.stringify(sB);

  // Both running -> 0
  assert.equal(engine.matchWinner(sA, sB), 0, 'running match must return 0');

  // No mutation side-effects
  assert.equal(JSON.stringify(sA), snapA, 'stateA must not be mutated');
  assert.equal(JSON.stringify(sB), snapB, 'stateB must not be mutated');

  // Player A tops out -> Player 2 wins (returns 2)
  sA.over = true;
  assert.equal(engine.matchWinner(sA, sB), 2, 'when A is over, winner must be 2');

  // Player B tops out instead -> Player 1 wins (returns 1)
  sA.over = false;
  sB.over = true;
  assert.equal(engine.matchWinner(sA, sB), 1, 'when B is over, winner must be 1');

  // Both over -> tie-break returns 1
  sA.over = true;
  sB.over = true;
  assert.equal(engine.matchWinner(sA, sB), 1, 'when both are over, winner must be 1 (tie-break)');

  // Verify states are not modified by the function
  assert.equal(sA.over, true);
  assert.equal(sB.over, true);
});

test('11. HTML layout and meta viewport for mobile', () => {
  const htmlPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Check viewport meta tag with viewport-fit=cover
  assert.match(
    html,
    /<meta\s+name=["']viewport["']\s+content=["'][^"']*viewport-fit=cover[^"']*["']>/i,
    'index.html must include viewport-fit=cover in meta viewport'
  );

  // Check #touchControls container
  assert.match(html, /id=["']touchControls["']/, 'index.html must contain #touchControls container');

  // Check touch control button IDs
  const requiredTouchButtons = [
    'btnLeft',
    'btnRight',
    'btnRotCW',
    'btnRotCCW',
    'btnSoftDrop',
    'btnHardDrop',
    'btnHold',
  ];
  for (const id of requiredTouchButtons) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `index.html must contain button #${id}`);
  }

  // Check mobile signaling button IDs
  const requiredSignalingButtons = [
    'btnShareOffer',
    'btnPasteOffer',
    'btnShareAnswer',
    'btnPasteAnswer',
  ];
  for (const id of requiredSignalingButtons) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `index.html must contain button #${id}`);
  }
});

test('12. CSS mobile-first responsiveness and safe area', () => {
  const cssPath = path.join(rootDir, 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Check media query for viewport < 900px
  assert.match(
    css,
    /@media\s*\(\s*max-width:\s*(?:899|900)px\s*\)/,
    'styles.css must contain responsive media query for < 900px'
  );

  // Check touch-action: manipulation
  assert.match(
    css,
    /touch-action:\s*manipulation/,
    'styles.css must contain touch-action: manipulation'
  );

  // Check safe-area-inset-bottom
  assert.match(
    css,
    /env\(\s*safe-area-inset-bottom\s*\)/,
    'styles.css must respect env(safe-area-inset-bottom)'
  );
});

test('13. WebRTC TURN fallback servers and code sanitization in net.js', () => {
  // Check ICE_SERVERS contains TURN fallback
  assert.ok(Array.isArray(net.ICE_SERVERS), 'ICE_SERVERS must be exported array');
  const hasStun = net.ICE_SERVERS.some((s) => s.urls && JSON.stringify(s.urls).includes('stun'));
  assert.ok(hasStun, 'ICE_SERVERS must include STUN');

  const turnConfig = net.ICE_SERVERS.find(
    (s) => s.urls && JSON.stringify(s.urls).includes('turn:openrelay.metered.ca:443')
  );
  assert.ok(turnConfig, 'ICE_SERVERS must include turn:openrelay.metered.ca:443');
  assert.ok(
    JSON.stringify(turnConfig.urls).includes('turns:openrelay.metered.ca:443'),
    'ICE_SERVERS must include turns:openrelay.metered.ca:443'
  );
  assert.equal(turnConfig.username, 'openrelayproject');
  assert.equal(turnConfig.credential, 'openrelayproject');

  // Check sanitizeCode function
  assert.equal(typeof net.sanitizeCode, 'function', 'sanitizeCode must be exported function');
  const rawCode = '  eyJ0eXBlIj \n\r\t  oiYW5zd2VyIn0= \n ';
  const cleaned = net.sanitizeCode(rawCode);
  assert.equal(cleaned, 'eyJ0eXBlIjoiYW5zd2VyIn0=', 'sanitizeCode must strip all whitespace and newlines');
});
