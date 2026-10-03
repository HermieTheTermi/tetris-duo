import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as net from '../src/net.js';
import * as qr from '../src/qr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to generate a realistic SDP string of ~1400 characters
function createSampleSdp(targetLength = 1400) {
  let sdp = 'v=0\r\no=- 4234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n' +
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n' +
    'a=ice-ufrag:abcd\r\na=ice-pwd:0123456789abcdef0123456789\r\n' +
    'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\n';
  let counter = 1;
  while (sdp.length < targetLength) {
    sdp += `a=candidate:${counter++} 1 UDP 2130706431 192.168.1.100 ${50000 + counter} typ host\r\n`;
  }
  return sdp.slice(0, targetLength);
}

test('14. tokenFromPeer and peerFromToken round-trip for short and ~1400 char SDP', async () => {
  assert.equal(typeof net.tokenFromPeer, 'function', 'tokenFromPeer must be exported');
  assert.equal(typeof net.peerFromToken, 'function', 'peerFromToken must be exported');

  // Test 1: Short SDP round-trip
  const shortSdp = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n' };
  const mockShortPeer = {
    iceGatheringState: 'complete',
    localDescription: shortSdp,
  };
  const shortToken = await net.tokenFromPeer(mockShortPeer, 'offer');
  assert.equal(typeof shortToken, 'string');
  assert.ok(shortToken.length > 0);

  const restoredShort = await net.peerFromToken(shortToken);
  assert.deepEqual(restoredShort, shortSdp, 'Short SDP must survive round-trip');

  // Test 2: ~1400 character SDP round-trip
  const realisticSdp = { type: 'offer', sdp: createSampleSdp(1400) };
  assert.equal(realisticSdp.sdp.length, 1400);

  const mock1400Peer = {
    iceGatheringState: 'complete',
    localDescription: realisticSdp,
  };
  const token1400 = await net.tokenFromPeer(mock1400Peer, 'offer');
  assert.equal(typeof token1400, 'string');

  const restored1400 = await net.peerFromToken(token1400);
  assert.deepEqual(restored1400, realisticSdp, '1400-char SDP must survive round-trip');
});

test('15. Token format is base64url and length is <= 900 characters for 1400-char SDP', async () => {
  const realisticSdp = { type: 'offer', sdp: createSampleSdp(1400) };
  const mockPeer = {
    iceGatheringState: 'complete',
    localDescription: realisticSdp,
  };

  const token = await net.tokenFromPeer(mockPeer, 'offer');

  // Assert base64url characters only: [A-Za-z0-9_-], NO +, NO /, NO =, NO whitespace
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'Token must contain only base64url characters (no +, /, = or whitespace)');
  assert.doesNotMatch(token, /[+/=\s]/, 'Token must not contain +, /, = or whitespace');

  // Assert length <= 900
  assert.ok(
    token.length <= 900,
    `Token length (${token.length}) must be <= 900 for typical 1400-char SDP`
  );
});

test('16. tokenFromPeer waits for ICE gathering before generating token', async () => {
  let iceComplete = false;
  const mockPeer = {
    iceGatheringState: 'gathering',
    localDescription: { type: 'answer', sdp: 'v=0\r\nsdp-with-ice-candidates\r\n' },
    addEventListener(event, cb) {
      if (event === 'icegatheringstatechange') {
        setTimeout(() => {
          this.iceGatheringState = 'complete';
          iceComplete = true;
          cb();
        }, 50);
      }
    },
  };

  const token = await net.tokenFromPeer(mockPeer, 'answer');
  assert.ok(iceComplete, 'tokenFromPeer must wait for iceGatheringState to be complete');
  const restored = await net.peerFromToken(token);
  assert.deepEqual(restored, mockPeer.localDescription);
});

test('17. QR code generator: drawQR and getQRMatrix', () => {
  assert.equal(typeof qr.drawQR, 'function', 'drawQR must be exported from src/qr.js');
  assert.equal(typeof qr.getQRMatrix, 'function', 'getQRMatrix must be exported from src/qr.js');

  // Empty text should throw an error
  assert.throws(() => qr.getQRMatrix(''), /empty|invalid/i, 'getQRMatrix must throw on empty string');
  assert.throws(() => qr.drawQR(null, ''), /empty|invalid/i, 'drawQR must throw on empty string');

  // Two different texts should produce different matrices
  const matrix1 = qr.getQRMatrix('https://example.com/#s=offer1');
  const matrix2 = qr.getQRMatrix('https://example.com/#a=answer2');

  assert.ok(Array.isArray(matrix1), 'Matrix must be an array');
  assert.ok(Array.isArray(matrix2), 'Matrix must be an array');
  assert.notDeepEqual(matrix1, matrix2, 'Two different texts must produce different QR matrices');

  // Test drawing on mock canvas (width/height >= 280, 4-module quiet zone)
  const drawCalls = [];
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: (type) => {
      assert.equal(type, '2d');
      return {
        fillStyle: '',
        fillRect: (x, y, w, h) => drawCalls.push({ x, y, w, h }),
      };
    },
  };

  qr.drawQR(mockCanvas, 'https://example.com/#s=test', 280);
  assert.ok(mockCanvas.width >= 280, 'Canvas width must be >= 280');
  assert.ok(mockCanvas.height >= 280, 'Canvas height must be >= 280');
  assert.ok(drawCalls.length > 0, 'drawQR must render modules to canvas');
});

test('18. Offline PWA: sw.js, manifest.json, icon.svg and client-isolation note', () => {
  // 1. Service Worker file sw.js
  const swPath = path.join(rootDir, 'sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist at project root');
  const swContent = fs.readFileSync(swPath, 'utf8');

  // Must have cache version constant and cache-first fetch strategy
  assert.match(swContent, /CACHE_NAME\s*=\s*['"][^'"]+['"]|CACHE_VERSION\s*=\s*['"][^'"]+['"]/i, 'sw.js must define cache version constant');
  assert.match(swContent, /caches\.match/i, 'sw.js must implement cache-first fetch with caches.match');
  assert.match(swContent, /index\.html/i, 'sw.js must cache index.html');
  assert.match(swContent, /styles\.css/i, 'sw.js must cache styles.css');
  assert.match(swContent, /src\/main\.js/i, 'sw.js must cache src/main.js');
  assert.match(swContent, /src\/qr\.js/i, 'sw.js must cache src/qr.js');

  // 2. manifest.json
  const manifestPath = path.join(rootDir, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist at project root');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.display, 'standalone', 'manifest.json display must be standalone');
  assert.ok(manifest.theme_color, 'manifest.json must define theme_color');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.json must define icons');

  // 3. icon.svg
  const iconPath = path.join(rootDir, 'icon.svg');
  assert.ok(fs.existsSync(iconPath), 'icon.svg must exist at project root');
  const iconContent = fs.readFileSync(iconPath, 'utf8');
  assert.match(iconContent, /<svg[^>]*>/i, 'icon.svg must be a valid SVG file');

  // 4. index.html references manifest and icon
  const htmlPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<link[^>]+rel=["']manifest["'][^>]*>/i, 'index.html must link to manifest.json');
  assert.match(html, /<link[^>]+(?:rel=["']icon["']|type=["']image\/svg\+xml["'])[^>]*>/i, 'index.html must link to icon.svg');

  // 5. Client-Isolation note in main.js timeout / error handling
  const mainJsPath = path.join(rootDir, 'src', 'main.js');
  const mainJs = fs.readFileSync(mainJsPath, 'utf8');
  assert.match(mainJs, /Client-Isolation/i, 'main.js must mention Client-Isolation in connection failure / timeout message');
});

test('19. QR backing store: qrBackingSize scales with devicePixelRatio (min 2x)', () => {
  assert.equal(typeof qr.qrBackingSize, 'function', 'qrBackingSize must be exported from src/qr.js');

  // Must round and ensure minimum 2x cssSize
  assert.equal(qr.qrBackingSize(280, 1), 560, 'qrBackingSize(280, 1) must return min 2x cssSize (560)');
  assert.equal(qr.qrBackingSize(280, 2), 560, 'qrBackingSize(280, 2) must return 560');
  assert.equal(qr.qrBackingSize(280, 0.5), 560, 'qrBackingSize(280, 0.5) must return min 2x cssSize (560)');

  // At dpr 3, must return exactly 3x cssSize (840)
  assert.equal(qr.qrBackingSize(280, 3), 840, 'qrBackingSize(280, 3) must return exactly 3x cssSize (840)');
  assert.equal(qr.qrBackingSize(100, 3), 300, 'qrBackingSize(100, 3) must return 300');

  // Fractional dpr rounding
  assert.equal(qr.qrBackingSize(280, 2.5), 700, 'qrBackingSize(280, 2.5) must return 700');
  assert.equal(qr.qrBackingSize(280, 2.625), 735, 'qrBackingSize(280, 2.625) must return 735');

  // Without dpr parameter in node (window undefined), defaults to min 2x
  assert.equal(qr.qrBackingSize(280), 560, 'qrBackingSize(280) default without dpr must be min 2x (560)');

  // drawQR on canvas sets backing store width/height to scaled pixels and keeps CSS size
  const drawCalls = [];
  const mockCanvasDpr3 = {
    width: 0,
    height: 0,
    style: {},
    getContext: (type) => {
      assert.equal(type, '2d');
      return {
        fillStyle: '',
        fillRect: (x, y, w, h) => drawCalls.push({ x, y, w, h }),
      };
    },
  };

  qr.drawQR(mockCanvasDpr3, 'https://example.com/#s=test', 280, 3);
  assert.equal(mockCanvasDpr3.width, 840, 'Canvas backing store width must be 840 at dpr 3');
  assert.equal(mockCanvasDpr3.height, 840, 'Canvas backing store height must be 840 at dpr 3');
  assert.equal(mockCanvasDpr3.style.width, '280px', 'Canvas CSS style.width must remain 280px');
  assert.equal(mockCanvasDpr3.style.height, '280px', 'Canvas CSS style.height must remain 280px');
  assert.ok(drawCalls.length > 0, 'drawQR must render QR modules to canvas');

  // Verify automatic detection of window.devicePixelRatio when dpr argument is omitted
  const prevWindow = globalThis.window;
  try {
    globalThis.window = { devicePixelRatio: 3 };
    assert.equal(qr.qrBackingSize(280), 840, 'qrBackingSize must read window.devicePixelRatio when dpr is omitted');
    const autoCanvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: () => ({ fillStyle: '', fillRect: () => {} }),
    };
    qr.drawQR(autoCanvas, 'https://example.com/#s=test', 280);
    assert.equal(autoCanvas.width, 840, 'drawQR must scale backing store to window.devicePixelRatio automatically');
  } finally {
    globalThis.window = prevWindow;
  }
});


