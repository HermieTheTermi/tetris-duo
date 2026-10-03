// Wiring: mode selection, loop, network glue
import {
  COLS,
  ROWS,
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
  matchWinner,
} from './engine.js';

import { createHost, createGuest, sanitizeCode, tokenFromPeer, peerFromToken } from './net.js';
import { drawQR } from './qr.js';
import { setupCanvas, renderBoard, renderPiecePreview, bindKeyboard } from './ui.js';
import { lobbyPhase, countdownValue, applyLobbyMessage, lobbyMessageFor } from './lobby.js';
import { makeRoomCode, roomLink, parseRoomFromHash, hostRoom, joinRoom, closeRoom } from './signal.js';

// Connection timeout message with Client-Isolation note
const CONNECTION_TIMEOUT_MSG =
  'Verbindung fehlgeschlagen – Netzwerk blockiert P2P oder Hotspot hat Client-Isolation aktiv (im Gastgeber-Hotspot nachsehen)';

// DOM Elements: Navigation & Modes
const btnModeLocal = document.getElementById('btnModeLocal');
const btnModeHost = document.getElementById('btnModeHost');
const btnModeGuest = document.getElementById('btnModeGuest');

// Signaling: Host
const hostSignaling = document.getElementById('hostSignaling');
const hostRoomCode = document.getElementById('hostRoomCode');
const hostQrCanvas = document.getElementById('hostQrCanvas');
const btnShareRoomLink = document.getElementById('btnShareRoomLink');
const btnCopyRoomLink = document.getElementById('btnCopyRoomLink');
const btnShareHostLink = document.getElementById('btnShareHostLink');
const btnCopyHostLink = document.getElementById('btnCopyHostLink');
const hostStatus = document.getElementById('hostStatus');

// Host Manual Fallback
const hostOfferCode = document.getElementById('hostOfferCode');
const hostAnswerInput = document.getElementById('hostAnswerInput');
const btnCopyOffer = document.getElementById('btnCopyOffer');
const btnShareOffer = document.getElementById('btnShareOffer');
const btnPasteAnswer = document.getElementById('btnPasteAnswer');
const btnAcceptAnswer = document.getElementById('btnAcceptAnswer');

// Signaling: Guest
const guestSignaling = document.getElementById('guestSignaling');
const inputRoomCode = document.getElementById('inputRoomCode');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const guestStatus = document.getElementById('guestStatus');

// Guest Manual Fallback
const guestOfferInput = document.getElementById('guestOfferInput');
const btnPasteOffer = document.getElementById('btnPasteOffer');
const btnGenerateAnswer = document.getElementById('btnGenerateAnswer');
const guestAnswerStep = document.getElementById('guestAnswerStep');
const guestAnswerCode = document.getElementById('guestAnswerCode');
const btnShareAnswer = document.getElementById('btnShareAnswer');
const btnCopyAnswer = document.getElementById('btnCopyAnswer');
const guestQrCanvas = document.getElementById('guestQrCanvas');
const btnShareGuestLink = document.getElementById('btnShareGuestLink');
const btnCopyGuestLink = document.getElementById('btnCopyGuestLink');

// Tab Ack Modal
const tabAckNotice = document.getElementById('tabAckNotice');
const btnCloseTab = document.getElementById('btnCloseTab');

// Start-Gate DOM Elements
const btnReadyP1 = document.getElementById('btnReadyP1');
const btnReadyP2 = document.getElementById('btnReadyP2');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownText = document.getElementById('countdownText');

// URL Sharing State
let currentHostOfferUrl = '';
let currentGuestAnswerUrl = '';
let currentRoomCode = '';
let currentRoomLink = '';

// Player Panels Header & Stats
const nameP1 = document.getElementById('nameP1');
const nameP2 = document.getElementById('nameP2');
const badgeP1 = document.getElementById('badgeP1');
const badgeP2 = document.getElementById('badgeP2');

const scoreP1 = document.getElementById('scoreP1');
const linesP1 = document.getElementById('linesP1');
const levelP1 = document.getElementById('levelP1');

const scoreP2 = document.getElementById('scoreP2');
const linesP2 = document.getElementById('linesP2');
const levelP2 = document.getElementById('levelP2');

// Rematch & Toast & Overlay
const btnRematch = document.getElementById('btnRematch');
const toast = document.getElementById('toast');

const matchOverlay = document.getElementById('matchOverlay');
const matchVerdict = document.getElementById('matchVerdict');
const matchScore = document.getElementById('matchScore');
const btnOverlayRematch = document.getElementById('btnOverlayRematch');

// Canvases
const boardP1 = document.getElementById('boardP1');
const boardP2 = document.getElementById('boardP2');
const holdP1 = document.getElementById('holdCanvasP1');
const holdP2 = document.getElementById('holdCanvasP2');

const nextP1 = [
  document.getElementById('next1CanvasP1'),
  document.getElementById('next2CanvasP1'),
  document.getElementById('next3CanvasP1'),
];

const nextP2 = [
  document.getElementById('next1CanvasP2'),
  document.getElementById('next2CanvasP2'),
  document.getElementById('next3CanvasP2'),
];

// Setup high-DPI canvases
setupCanvas(boardP1, 240, 480);
setupCanvas(boardP2, 240, 480);
setupCanvas(holdP1, 64, 64);
setupCanvas(holdP2, 64, 64);
nextP1.forEach((c) => setupCanvas(c, 64, 50));
nextP2.forEach((c) => setupCanvas(c, 64, 50));

// Game & Connection State
let currentMode = 'local'; // 'local' | 'host' | 'guest'
let peer = null;
let isPeerConnected = false;
let state1 = null;
let state2 = null;
let lastTime = 0;
let lastBroadcast = 0;
let gameSeed = 100;

// Start-Gate State
let ready1 = false;
let ready2 = false;
let countdownStartedAt = null;
let isSimulationRunning = false;

// Match End State: 0 = running, 1 = P1 wins, 2 = P2 wins
let currentMatchWinner = 0;

// Remote guest streamed state (when playing as Guest)
let remoteGuestState = null;

function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function showMatchEnd(verdict, loserScoreVal, isLoser = false) {
  if (!matchOverlay || !matchVerdict || !matchScore) return;
  matchVerdict.textContent = verdict;
  matchVerdict.classList.toggle('loser', isLoser);
  matchScore.textContent = `Loser Final Score: ${loserScoreVal}`;
  matchOverlay.classList.remove('hidden');
}

function hideMatchEnd() {
  currentMatchWinner = 0;
  if (matchOverlay) {
    matchOverlay.classList.add('hidden');
  }
}

function hideCountdown() {
  if (countdownOverlay) {
    countdownOverlay.classList.add('hidden');
  }
}

function renderEmptyUI() {
  renderBoard(boardP1, null, null, 0, false);
  renderBoard(boardP2, null, null, 0, false);
  renderPiecePreview(holdP1, null);
  renderPiecePreview(holdP2, null);
  nextP1.forEach((c) => renderPiecePreview(c, null));
  nextP2.forEach((c) => renderPiecePreview(c, null));
  if (scoreP1) scoreP1.textContent = '0';
  if (linesP1) linesP1.textContent = '0';
  if (levelP1) levelP1.textContent = '1';
  if (scoreP2) scoreP2.textContent = '0';
  if (linesP2) linesP2.textContent = '0';
  if (levelP2) levelP2.textContent = '1';
}

function initLocalGame() {
  gameSeed += 10;
  state1 = null;
  state2 = null;
  ready1 = false;
  ready2 = false;
  countdownStartedAt = null;
  isSimulationRunning = false;

  nameP1.textContent = 'Player 1';
  nameP2.textContent = 'Player 2';
  badgeP1.textContent = 'Bereit machen';
  badgeP1.className = 'status-badge';
  badgeP2.textContent = 'Bereit machen';
  badgeP2.className = 'status-badge';

  btnReadyP1.disabled = false;
  btnReadyP1.textContent = 'Bereit machen';
  btnReadyP2.disabled = false;
  btnReadyP2.textContent = 'Bereit machen';

  hideCountdown();
  hideMatchEnd();
  renderEmptyUI();
}

// Start-Gate Button Handlers
btnReadyP1.addEventListener('click', () => {
  if (currentMode === 'local') {
    ready1 = true;
    btnReadyP1.disabled = true;
    btnReadyP1.textContent = 'Bereit ✓';
    badgeP1.textContent = 'Bereit ✓';
    checkStartGate();
  } else if (currentMode === 'host') {
    ready1 = true;
    btnReadyP1.disabled = true;
    btnReadyP1.textContent = 'Bereit ✓';
    badgeP1.textContent = 'Bereit ✓';
    if (peer) {
      peer.send(lobbyMessageFor('host', true, { ready2, countdown: null }));
    }
    checkStartGate();
  }
});

btnReadyP2.addEventListener('click', () => {
  if (currentMode === 'local') {
    ready2 = true;
    btnReadyP2.disabled = true;
    btnReadyP2.textContent = 'Bereit ✓';
    badgeP2.textContent = 'Bereit ✓';
    checkStartGate();
  } else if (currentMode === 'guest') {
    ready2 = true;
    btnReadyP2.disabled = true;
    btnReadyP2.textContent = 'Bereit ✓';
    badgeP1.textContent = 'Bereit ✓';
    if (peer) {
      peer.send(lobbyMessageFor('guest', true));
    }
  }
});

function checkStartGate() {
  if (ready1 && ready2 && countdownStartedAt == null) {
    countdownStartedAt = performance.now();
    if (countdownOverlay) {
      countdownText.textContent = '3';
      countdownText.classList.remove('go');
      countdownOverlay.classList.remove('hidden');
    }
    if (currentMode === 'host' && peer) {
      peer.send(lobbyMessageFor('host', true, { ready2: true, countdown: 3 }));
    }
  }
}

function handleInput(player, action) {
  // If match not running or already concluded, ignore input
  if (!isSimulationRunning || currentMatchWinner !== 0) return;

  if (currentMode === 'local') {
    const targetState = player === 1 ? state1 : state2;
    applyActionToState(targetState, action);
  } else if (currentMode === 'host') {
    // In host mode, host player controls state1
    applyActionToState(state1, action);
  } else if (currentMode === 'guest') {
    // In guest mode, send input action to host
    if (peer) {
      peer.send({ t: 'input', a: action });
    }
  }
}

function applyActionToState(st, action) {
  if (!st || st.over || currentMatchWinner !== 0) return;
  switch (action) {
    case 'left':
      move(st, -1);
      break;
    case 'right':
      move(st, 1);
      break;
    case 'rotCW':
      rotate(st, true);
      break;
    case 'rotCCW':
      rotate(st, false);
      break;
    case 'softDrop':
      softDrop(st);
      break;
    case 'hardDrop':
      hardDrop(st);
      checkAttacks();
      break;
    case 'hold':
      hold(st);
      break;
  }
}

function checkAttacks() {
  if (currentMode === 'local') {
    if (state1 && state1.lastAttack > 0) {
      const atk = state1.lastAttack;
      state1.lastAttack = 0;
      incomingGarbage(state2, atk);
    }
    if (state2 && state2.lastAttack > 0) {
      const atk = state2.lastAttack;
      state2.lastAttack = 0;
      incomingGarbage(state1, atk);
    }
  } else if (currentMode === 'host') {
    if (state1 && state1.lastAttack > 0) {
      const atk = state1.lastAttack;
      state1.lastAttack = 0;
      incomingGarbage(state2, atk);
      if (peer) peer.send({ t: 'garbage', n: atk });
    }
    if (state2 && state2.lastAttack > 0) {
      const atk = state2.lastAttack;
      state2.lastAttack = 0;
      incomingGarbage(state1, atk);
      if (peer) peer.send({ t: 'garbage', n: atk });
    }
  }
}

// Mode Selector Switching
btnModeLocal.addEventListener('click', () => {
  setMode('local');
});

btnModeHost.addEventListener('click', () => {
  setMode('host');
});

btnModeGuest.addEventListener('click', () => {
  setMode('guest');
});

async function setMode(mode) {
  currentMode = mode;
  btnModeLocal.classList.toggle('active', mode === 'local');
  btnModeHost.classList.toggle('active', mode === 'host');
  btnModeGuest.classList.toggle('active', mode === 'guest');

  hostSignaling.classList.add('hidden');
  guestSignaling.classList.add('hidden');

  hideMatchEnd();
  hideCountdown();

  if (peer) {
    peer.close();
    peer = null;
  }
  closeRoom();
  isPeerConnected = false;

  if (mode === 'local') {
    initLocalGame();
  } else if (mode === 'host') {
    initHostMode();
  } else if (mode === 'guest') {
    initGuestMode();
  }
}

// BroadcastChannel for cross-tab local pairing
let pairingChannel = null;
if (typeof BroadcastChannel !== 'undefined') {
  pairingChannel = new BroadcastChannel('tetris-duo');
  pairingChannel.onmessage = async (event) => {
    const data = event.data;
    if (!data) return;

    if (data.type === 'answer' && data.token) {
      if (currentMode === 'host' && peer && peer.acceptBlob) {
        pairingChannel.postMessage({ type: 'answer_ack' });
        hostAnswerInput.value = data.token;
        hostStatus.textContent = 'Antwort empfangen! Verbinde...';
        hostStatus.className = 'status-badge waiting';
        try {
          peer.startTimeout(() => {
            hostStatus.textContent = CONNECTION_TIMEOUT_MSG;
            hostStatus.className = 'status-badge waiting';
          }, 15000);
          await peer.acceptBlob(data.token);
        } catch (err) {
          hostStatus.textContent = 'Verbindung fehlgeschlagen: ' + err.message;
        }
      }
    }
  };
}

// Host Mode Setup (Room link primary, manual fallback)
async function initHostMode() {
  hostSignaling.classList.remove('hidden');
  nameP1.textContent = 'You (Host)';
  nameP2.textContent = 'Opponent (Guest)';

  state1 = null;
  state2 = null;
  ready1 = false;
  ready2 = false;
  countdownStartedAt = null;
  isSimulationRunning = false;
  isPeerConnected = false;

  btnReadyP1.disabled = false;
  btnReadyP1.textContent = 'Bereit machen';
  btnReadyP2.disabled = true;
  btnReadyP2.textContent = 'Warte auf Gast…';

  badgeP1.textContent = 'Bereit machen';
  badgeP1.className = 'status-badge';
  badgeP2.textContent = 'Warte auf Gast…';
  badgeP2.className = 'status-badge waiting';

  hideCountdown();
  hideMatchEnd();
  renderEmptyUI();

  // 1. Primary: Generate 6-char Room Code and Room Link
  const code = makeRoomCode();
  currentRoomCode = code;
  if (hostRoomCode) {
    hostRoomCode.textContent = code;
  }
  const link = roomLink(code);
  currentRoomLink = link;
  currentHostOfferUrl = link;

  if (hostQrCanvas) {
    drawQR(hostQrCanvas, link, 280);
  }

  hostStatus.textContent = `Raum ${code} erstellt. Link teilen oder QR scannen!`;
  hostStatus.className = 'status-badge waiting';

  // Start PeerJS Cloud Signaling
  try {
    const roomHandle = await hostRoom(code, {
      onStatus: (msg, statusType) => {
        hostStatus.textContent = msg;
        hostStatus.className = `status-badge ${statusType || 'waiting'}`;
      },
      onPeerOpen: (peerHandle) => {
        isPeerConnected = true;
        peer = peerHandle || peer;
        hostStatus.textContent = 'Gast verbunden! Bereit machen.';
        hostStatus.className = 'status-badge connected';
        badgeP2.textContent = 'Verbunden';
        badgeP2.className = 'status-badge connected';
        btnReadyP2.textContent = 'Gast nicht bereit';
        showToast('Gast verbunden!');
        if (peer) {
          peer.send({ t: 'hello', name: 'Host' });
          peer.send(lobbyMessageFor('host', ready1, { ready2, countdown: null }));
        }
      },
      onMessage: (msg) => {
        handleHostMessage(msg);
      },
      onClose: () => {
        isPeerConnected = false;
        hostStatus.textContent = 'Gast hat den Raum verlassen.';
        hostStatus.className = 'status-badge waiting';
        badgeP2.textContent = 'Disconnected';
        showToast('Gast hat Verbindung getrennt.');
      },
      onError: (err) => {
        isPeerConnected = false;
        hostStatus.textContent =
          'Raum nicht erreichbar – brauchst du Internet für den Handschlag? ' +
          '(Manueller QR-/Code-Austausch funktioniert auch komplett offline)';
        hostStatus.className = 'status-badge waiting';
      },
    });

    peer = roomHandle;
  } catch (err) {
    hostStatus.textContent =
      'Raum nicht erreichbar – brauchst du Internet für den Handschlag? (Manueller Weg funktioniert ohne Internet)';
  }

  // Also prepare manual fallback offer code in background if user expands details
  initManualHostFallback();
}

async function initManualHostFallback() {
  try {
    hostOfferCode.value = 'Generiere manuellen Offline-Code...';
    const manualPeer = await createHost({
      onOpen: () => {
        isPeerConnected = true;
        peer = manualPeer;
        hostStatus.textContent = 'Gast manuell verbunden! Bereit machen.';
        hostStatus.className = 'status-badge connected';
        badgeP2.textContent = 'Connected';
        badgeP2.className = 'status-badge connected';
        btnReadyP2.textContent = 'Gast nicht bereit';
        showToast('Guest connected via manual fallback!');
        peer.send({ t: 'hello', name: 'Host' });
        peer.send(lobbyMessageFor('host', ready1, { ready2, countdown: null }));
      },
      onClose: () => {
        isPeerConnected = false;
        hostStatus.textContent = 'Guest disconnected.';
        hostStatus.className = 'status-badge waiting';
        badgeP2.textContent = 'Disconnected';
      },
      onTimeout: () => {
        hostStatus.textContent = CONNECTION_TIMEOUT_MSG;
        hostStatus.className = 'status-badge waiting';
      },
      onMessage: (msg) => {
        handleHostMessage(msg);
      },
    });

    const offerToken = await tokenFromPeer(manualPeer, 'offer');
    hostOfferCode.value = offerToken;

    // If PeerJS isn't used, manual peer can take over when answer is pasted
    btnAcceptAnswer.onclick = async () => {
      const answer = sanitizeCode(hostAnswerInput.value);
      if (!answer) {
        alert('Please paste the Guest answer code first.');
        return;
      }
      try {
        hostStatus.textContent = 'Connecting via manual code...';
        hostStatus.className = 'status-badge waiting';
        peer = manualPeer;
        manualPeer.startTimeout(() => {
          hostStatus.textContent = CONNECTION_TIMEOUT_MSG;
          hostStatus.className = 'status-badge waiting';
        }, 15000);
        await manualPeer.acceptBlob(answer);
      } catch (err) {
        hostStatus.textContent = 'Connection failed: ' + err.message;
      }
    };
  } catch (_) {}
}

function handleHostMessage(msg) {
  if (!msg || !msg.t) return;

  if (msg.t === 'lobby' || msg.t === 'ready') {
    const updated = applyLobbyMessage({ connected: isPeerConnected, ready1, ready2 }, msg);
    ready2 = !!updated.ready2;
    btnReadyP2.textContent = ready2 ? 'Gast bereit ✓' : 'Gast nicht bereit';
    badgeP2.textContent = ready2 ? 'Gast bereit ✓' : 'Verbunden';
    if (ready1 && ready2 && countdownStartedAt == null) {
      checkStartGate();
    } else if (peer) {
      peer.send(lobbyMessageFor('host', ready1, { ready2, countdown: null }));
    }
  } else if (msg.t === 'input') {
    if (isSimulationRunning) {
      applyActionToState(state2, msg.a);
    }
  } else if (msg.t === 'garbage') {
    if (state1 && typeof msg.n === 'number') {
      incomingGarbage(state1, msg.n);
    }
  } else if (msg.t === 'rematch') {
    resetMatchToGate();
    if (peer) {
      peer.send({ t: 'rematch' });
      peer.send(lobbyMessageFor('host', false, { ready2: false, countdown: null }));
    }
    showToast('Rematch gestartet!');
  }
}

// Sharing & Copying Room Link
if (btnShareRoomLink) {
  btnShareRoomLink.addEventListener('click', () => {
    shareLink(currentRoomLink || currentHostOfferUrl, 'Tetris Duo — Raum-Link');
  });
}

if (btnCopyRoomLink) {
  btnCopyRoomLink.addEventListener('click', () => {
    copyLink(currentRoomLink || currentHostOfferUrl);
  });
}

if (btnShareHostLink) {
  btnShareHostLink.addEventListener('click', () => {
    shareLink(currentRoomLink || currentHostOfferUrl, 'Tetris Duo — Verbindungslink');
  });
}

if (btnCopyHostLink) {
  btnCopyHostLink.addEventListener('click', () => {
    copyLink(currentRoomLink || currentHostOfferUrl);
  });
}

function copyLink(url) {
  if (!url) {
    showToast('Kein Link vorhanden');
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url);
    showToast('Link kopiert!');
  } else {
    showToast('Bitte manuell kopieren');
  }
}

btnCopyOffer.addEventListener('click', () => {
  const code = sanitizeCode(hostOfferCode.value);
  if (code) {
    navigator.clipboard.writeText(code);
    showToast('Host offer copied to clipboard!');
  }
});

btnShareOffer.addEventListener('click', () => {
  shareCode(hostOfferCode.value);
});

btnPasteAnswer.addEventListener('click', () => {
  pasteCodeInto(hostAnswerInput);
});

// Guest Mode Setup
function initGuestMode() {
  guestSignaling.classList.remove('hidden');
  guestAnswerStep.classList.add('hidden');
  guestStatus.textContent = 'Warte auf Raum-Code...';
  guestStatus.className = 'status-badge waiting';
  nameP1.textContent = 'You (Guest)';
  nameP2.textContent = 'Opponent (Host)';

  state1 = null;
  state2 = null;
  remoteGuestState = null;
  ready1 = false;
  ready2 = false;
  countdownStartedAt = null;
  isSimulationRunning = false;
  isPeerConnected = false;

  btnReadyP1.disabled = true;
  btnReadyP1.textContent = 'Warte auf Host…';
  btnReadyP2.disabled = false;
  btnReadyP2.textContent = 'Bereit machen';

  badgeP1.textContent = 'Warte auf Host…';
  badgeP2.textContent = 'Nicht verbunden';

  hideCountdown();
  hideMatchEnd();
  renderEmptyUI();
}

if (btnJoinRoom) {
  btnJoinRoom.addEventListener('click', async () => {
    const raw = inputRoomCode ? inputRoomCode.value.trim().toUpperCase() : '';
    if (!raw || raw.length !== 6) {
      alert('Bitte einen 6-stelligen Raum-Code eingeben.');
      return;
    }
    await joinOnlineRoom(raw);
  });
}

if (inputRoomCode) {
  inputRoomCode.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const raw = inputRoomCode.value.trim().toUpperCase();
      if (raw && raw.length === 6) {
        await joinOnlineRoom(raw);
      }
    }
  });
}

async function joinOnlineRoom(code) {
  currentRoomCode = code;
  guestStatus.textContent = `Verbinde mit Raum ${code}…`;
  guestStatus.className = 'status-badge waiting';

  try {
    let handle;
    handle = await joinRoom(code, {
      onStatus: (msg, statusType) => {
        guestStatus.textContent = msg;
        guestStatus.className = `status-badge ${statusType || 'waiting'}`;
      },
      onPeerOpen: (peerHandle) => {
        isPeerConnected = true;
        peer = peerHandle || handle;
        guestStatus.textContent = 'Verbunden! Bereit?';
        guestStatus.className = 'status-badge connected';
        badgeP1.textContent = 'Bereit machen';
        badgeP2.textContent = 'Verbunden';
        btnReadyP1.textContent = 'Host nicht bereit';
        showToast('Mit Host verbunden! Bereit?');
        if (peer) {
          peer.send({ t: 'hello', name: 'Guest' });
          if (ready2) {
            peer.send(lobbyMessageFor('guest', true));
          }
        }
      },
      onMessage: (msg) => {
        handleGuestMessage(msg);
      },
      onClose: () => {
        isPeerConnected = false;
        guestStatus.textContent = 'Verbindung zum Host unterbrochen.';
        guestStatus.className = 'status-badge waiting';
        badgeP2.textContent = 'Disconnected';
        showToast('Verbindung getrennt.');
      },
      onError: (err) => {
        isPeerConnected = false;
        guestStatus.textContent =
          'Raum nicht erreichbar – brauchst du Internet für den Handschlag? ' +
          '(Manueller QR-/Code-Austausch funktioniert auch komplett offline)';
        guestStatus.className = 'status-badge waiting';
      },
    });
    peer = handle;
  } catch (err) {
    guestStatus.textContent =
      'Raum nicht erreichbar – brauchst du Internet für den Handschlag? (Manueller Weg funktioniert ohne Internet)';
  }
}

btnPasteOffer.addEventListener('click', () => {
  pasteCodeInto(guestOfferInput);
});

async function generateAnswerFromOffer(offerStr) {
  const offer = sanitizeCode(offerStr);
  if (!offer) {
    alert('Please paste the Host connection code first.');
    return;
  }
  guestStatus.textContent = 'Generating answer...';
  guestStatus.className = 'status-badge waiting';
  try {
    const manualPeer = await createGuest({
      onOpen: () => {
        isPeerConnected = true;
        peer = manualPeer;
        guestStatus.textContent = 'Connected to Host!';
        guestStatus.className = 'status-badge connected';
        badgeP1.textContent = 'Bereit machen';
        badgeP2.textContent = 'Connected';
        showToast('Connected to Host!');
        peer.send({ t: 'hello', name: 'Guest' });
      },
      onClose: () => {
        isPeerConnected = false;
        guestStatus.textContent = 'Disconnected from Host.';
        guestStatus.className = 'status-badge waiting';
      },
      onTimeout: () => {
        guestStatus.textContent = CONNECTION_TIMEOUT_MSG;
        guestStatus.className = 'status-badge waiting';
      },
      onMessage: (msg) => {
        handleGuestMessage(msg);
      },
    });

    manualPeer.startTimeout(() => {
      guestStatus.textContent = CONNECTION_TIMEOUT_MSG;
      guestStatus.className = 'status-badge waiting';
    }, 15000);

    await manualPeer.acceptBlob(offer);
    const answerToken = await tokenFromPeer(manualPeer, 'answer');
    guestAnswerCode.value = answerToken;
    guestAnswerStep.classList.remove('hidden');

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const answerUrl = `${origin}${pathname}#a=${answerToken}`;
    currentGuestAnswerUrl = answerUrl;

    if (guestQrCanvas) {
      drawQR(guestQrCanvas, answerUrl, 280);
    }
    guestStatus.textContent = 'Answer generated. Scan QR or share back to Host!';
  } catch (err) {
    guestStatus.textContent = 'Error: ' + err.message;
  }
}

btnGenerateAnswer.addEventListener('click', async () => {
  await generateAnswerFromOffer(guestOfferInput.value);
});

btnCopyAnswer.addEventListener('click', () => {
  const code = sanitizeCode(guestAnswerCode.value);
  if (code) {
    navigator.clipboard.writeText(code);
    showToast('Guest answer copied to clipboard!');
  }
});

btnShareAnswer.addEventListener('click', () => {
  shareCode(guestAnswerCode.value);
});

if (btnShareGuestLink) {
  btnShareGuestLink.addEventListener('click', () => {
    shareLink(currentGuestAnswerUrl, 'Tetris Duo — Antwortlink');
  });
}

if (btnCopyGuestLink) {
  btnCopyGuestLink.addEventListener('click', () => {
    if (currentGuestAnswerUrl) {
      navigator.clipboard.writeText(currentGuestAnswerUrl);
      showToast('Link kopiert!');
    }
  });
}

if (btnCloseTab) {
  btnCloseTab.addEventListener('click', () => {
    window.close();
  });
}

async function shareLink(url, title = 'Tetris Duo') {
  if (!url) {
    showToast('Kein Link vorhanden');
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        url,
      });
      showToast('Link geteilt!');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link in die Zwischenablage kopiert!');
      return;
    } catch (err) {
      // fallback
    }
  }
  showToast('Bitte manuell kopieren');
}

async function shareCode(rawCode) {
  const clean = sanitizeCode(rawCode);
  if (!clean) {
    showToast('Kein Code vorhanden');
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Tetris Duo Code',
        text: clean,
      });
      showToast('Code geteilt!');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(clean);
      showToast('In die Zwischenablage kopiert!');
      return;
    } catch (err) {
      // Fallback below
    }
  }
  showToast('Bitte manuell kopieren');
}

async function pasteCodeInto(targetInput) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      showToast('Zwischenablage nicht verfügbar – bitte manuell einfügen');
      return;
    }
    const text = await navigator.clipboard.readText();
    const clean = sanitizeCode(text);
    if (!clean) {
      showToast('Zwischenablage ist leer');
      return;
    }
    targetInput.value = clean;
    showToast('Code eingefügt!');
  } catch (err) {
    showToast('Einfügen fehlgeschlagen – bitte manuell einfügen');
  }
}

function handleGuestMessage(msg) {
  if (!msg || !msg.t) return;

  if (msg.t === 'lobby' || msg.t === 'ready') {
    const updated = applyLobbyMessage({ connected: isPeerConnected, ready1, ready2 }, msg);
    ready1 = !!updated.ready1;
    btnReadyP1.textContent = ready1 ? 'Host bereit ✓' : 'Host nicht bereit';
    badgeP2.textContent = ready1 ? 'Host bereit ✓' : 'Verbunden';

    if (msg.countdown !== null && msg.countdown !== undefined) {
      countdownOverlay.classList.remove('hidden');
      if (msg.countdown === 0) {
        countdownText.textContent = 'GO!';
        countdownText.classList.add('go');
      } else {
        countdownText.textContent = String(msg.countdown);
        countdownText.classList.remove('go');
      }
    } else {
      countdownOverlay.classList.add('hidden');
    }

    if (msg.started) {
      isSimulationRunning = true;
      countdownOverlay.classList.add('hidden');
      badgeP1.textContent = 'Playing';
      badgeP2.textContent = 'Playing';
    }
  } else if (msg.t === 'state') {
    isSimulationRunning = true;
    countdownOverlay.classList.add('hidden');
    remoteGuestState = msg;

    // Check match end from streamed host state
    if (msg.winner && currentMatchWinner === 0) {
      currentMatchWinner = msg.winner;
      const isWinner = msg.winner === 2; // In Host sim, state2 is Guest
      showMatchEnd(
        isWinner ? 'You win 🏆' : 'You lose',
        msg.loserScore ?? 0,
        !isWinner
      );
    }
  } else if (msg.t === 'garbage') {
    showToast(`Incoming Garbage: +${msg.n} lines!`);
  } else if (msg.t === 'rematch') {
    resetGuestToLobby();
    showToast('Rematch gestartet! Bereit machen.');
  }
}

// Rematch Button
function triggerRematch() {
  if (currentMode === 'local') {
    initLocalGame();
    showToast('Neues Spiel im Start-Gate!');
  } else if (currentMode === 'host') {
    resetMatchToGate();
    if (peer) {
      peer.send({ t: 'rematch' });
      peer.send(lobbyMessageFor('host', false, { ready2: false, countdown: null }));
    }
    showToast('Rematch gestartet! Bereit machen.');
  } else if (currentMode === 'guest') {
    if (peer) {
      peer.send({ t: 'rematch' });
    }
    resetGuestToLobby();
    showToast('Rematch angefragt!');
  }
}

btnRematch.addEventListener('click', triggerRematch);
if (btnOverlayRematch) {
  btnOverlayRematch.addEventListener('click', triggerRematch);
}

function resetMatchToGate() {
  gameSeed += 10;
  state1 = null;
  state2 = null;
  ready1 = false;
  ready2 = false;
  countdownStartedAt = null;
  isSimulationRunning = false;

  btnReadyP1.disabled = false;
  btnReadyP1.textContent = 'Bereit machen';
  btnReadyP2.disabled = true;
  btnReadyP2.textContent = isPeerConnected ? 'Gast nicht bereit' : 'Warte auf Gast…';

  badgeP1.textContent = 'Bereit machen';
  badgeP1.className = 'status-badge';
  badgeP2.textContent = isPeerConnected ? 'Verbunden' : 'Warte auf Gast…';
  badgeP2.className = 'status-badge ' + (isPeerConnected ? 'connected' : 'waiting');

  hideCountdown();
  hideMatchEnd();
  renderEmptyUI();
}

function resetGuestToLobby() {
  remoteGuestState = null;
  state1 = null;
  state2 = null;
  ready1 = false;
  ready2 = false;
  countdownStartedAt = null;
  isSimulationRunning = false;

  btnReadyP1.disabled = true;
  btnReadyP1.textContent = 'Host nicht bereit';
  btnReadyP2.disabled = false;
  btnReadyP2.textContent = 'Bereit machen';

  badgeP1.textContent = 'Bereit machen';
  badgeP1.className = 'status-badge';
  badgeP2.textContent = isPeerConnected ? 'Verbunden' : 'Nicht verbunden';
  badgeP2.className = 'status-badge ' + (isPeerConnected ? 'connected' : 'waiting');

  hideCountdown();
  hideMatchEnd();
  renderEmptyUI();
}

// Touch Controls Setup
function setupTouchControls() {
  const touchMap = [
    { id: 'btnLeft', action: 'left', repeat: true, arr: 40 },
    { id: 'btnRight', action: 'right', repeat: true, arr: 40 },
    { id: 'btnRotCW', action: 'rotCW', repeat: false },
    { id: 'btnRotCCW', action: 'rotCCW', repeat: false },
    { id: 'btnSoftDrop', action: 'softDrop', repeat: true, arr: 35 },
    { id: 'btnHardDrop', action: 'hardDrop', repeat: false },
    { id: 'btnHold', action: 'hold', repeat: false },
  ];

  touchMap.forEach(({ id, action, repeat, arr }) => {
    const btn = document.getElementById(id);
    if (!btn) return;

    let dasTimer = null;
    let repeatTimer = null;
    let isPressed = false;

    const stopRepeat = () => {
      if (!isPressed) return;
      isPressed = false;
      btn.classList.remove('pressed');
      if (dasTimer) clearTimeout(dasTimer);
      if (repeatTimer) clearInterval(repeatTimer);
      dasTimer = null;
      repeatTimer = null;
    };

    const startAction = (e) => {
      e.preventDefault();
      if (isPressed || currentMatchWinner !== 0 || !isSimulationRunning) return;
      isPressed = true;
      btn.classList.add('pressed');

      // Player 1 input: host drives own board; guest sends over wire; local drives P1
      handleInput(1, action);

      if (repeat) {
        dasTimer = setTimeout(() => {
          repeatTimer = setInterval(() => {
            if (isPressed && currentMatchWinner === 0 && isSimulationRunning) {
              handleInput(1, action);
            } else {
              stopRepeat();
            }
          }, arr || 40);
        }, 160);
      }
    };

    btn.addEventListener('pointerdown', startAction);
    btn.addEventListener('pointerup', stopRepeat);
    btn.addEventListener('pointercancel', stopRepeat);
    btn.addEventListener('pointerleave', stopRepeat);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// Game Loop
function loop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min(100, timestamp - lastTime);
  lastTime = timestamp;

  if (currentMode === 'local') {
    // Check countdown progression in local start gate
    if (!isSimulationRunning && countdownStartedAt != null) {
      const now = performance.now();
      const val = countdownValue(countdownStartedAt, now);
      if (val === 0) {
        countdownText.textContent = 'GO!';
        countdownText.classList.add('go');
      } else {
        countdownText.textContent = String(val);
        countdownText.classList.remove('go');
      }
      countdownOverlay.classList.remove('hidden');

      const phase = lobbyPhase({
        connected: true,
        ready1,
        ready2,
        countdownStartedAt,
        now,
      });

      if (phase === 'playing') {
        isSimulationRunning = true;
        countdownOverlay.classList.add('hidden');
        gameSeed += 10;
        state1 = createState(gameSeed);
        state2 = createState(gameSeed + 1);
        badgeP1.textContent = 'Playing';
        badgeP2.textContent = 'Playing';
      }
    }

    if (isSimulationRunning && currentMatchWinner === 0) {
      if (state1 && !state1.over) {
        const ev1 = tick(state1, dt);
        for (const ev of ev1) {
          if (ev.type === 'clear' && ev.attack > 0) {
            incomingGarbage(state2, ev.attack);
          }
        }
      }
      if (state2 && !state2.over) {
        const ev2 = tick(state2, dt);
        for (const ev of ev2) {
          if (ev.type === 'clear' && ev.attack > 0) {
            incomingGarbage(state1, ev.attack);
          }
        }
      }

      // Check match end
      const winner = matchWinner(state1, state2);
      if (winner !== 0) {
        currentMatchWinner = winner;
        const loserScore = winner === 1 ? state2.score : state1.score;
        showMatchEnd(winner === 1 ? 'Player 1 wins 🏆' : 'Player 2 wins 🏆', loserScore, false);
      }
    }

    renderLocalUI();
  } else if (currentMode === 'host') {
    // Check countdown progression in host start gate
    if (!isSimulationRunning && countdownStartedAt != null) {
      const now = performance.now();
      const val = countdownValue(countdownStartedAt, now);
      if (val === 0) {
        countdownText.textContent = 'GO!';
        countdownText.classList.add('go');
      } else {
        countdownText.textContent = String(val);
        countdownText.classList.remove('go');
      }
      countdownOverlay.classList.remove('hidden');

      // Stream countdown to guest
      if (peer && timestamp - lastBroadcast >= 50) {
        lastBroadcast = timestamp;
        peer.send(lobbyMessageFor('host', true, { ready2: true, countdown: val }));
      }

      const phase = lobbyPhase({
        connected: isPeerConnected,
        ready1,
        ready2,
        countdownStartedAt,
        now,
      });

      if (phase === 'playing') {
        isSimulationRunning = true;
        countdownOverlay.classList.add('hidden');
        gameSeed += 10;
        state1 = createState(gameSeed);
        state2 = createState(gameSeed + 1);
        badgeP1.textContent = 'Playing';
        badgeP2.textContent = 'Playing';
        if (peer) {
          peer.send(lobbyMessageFor('host', true, { ready2: true, countdown: null, started: true }));
        }
      }
    }

    if (isSimulationRunning && currentMatchWinner === 0) {
      if (state1 && !state1.over) {
        const ev1 = tick(state1, dt);
        for (const ev of ev1) {
          if (ev.type === 'clear' && ev.attack > 0) {
            incomingGarbage(state2, ev.attack);
            if (peer) peer.send({ t: 'garbage', n: ev.attack });
          }
        }
      }
      if (state2 && !state2.over) {
        const ev2 = tick(state2, dt);
        for (const ev of ev2) {
          if (ev.type === 'clear' && ev.attack > 0) {
            incomingGarbage(state1, ev.attack);
            if (peer) peer.send({ t: 'garbage', n: ev.attack });
          }
        }
      }

      // Check match end
      const winner = matchWinner(state1, state2);
      if (winner !== 0) {
        currentMatchWinner = winner;
        const loserScore = winner === 1 ? state2.score : state1.score;
        showMatchEnd(
          winner === 1 ? 'You win 🏆' : 'You lose',
          loserScore,
          winner !== 1
        );
      }
    }

    // Stream state to guest: <= 20 messages per second (50ms interval)
    if (isSimulationRunning && peer && timestamp - lastBroadcast >= 50 && state2) {
      lastBroadcast = timestamp;
      peer.send({
        t: 'state',
        board: boardMatrix(state2),
        cur: state2.cur ? { cells: state2.cur.cells, kind: state2.cur.kind } : null,
        next: state2.bag.slice(0, 3),
        score: state2.score,
        lines: state2.lines,
        level: state2.level,
        queued: state2.queuedGarbage,
        over: state2.over,

        // Opponent (Host) info for guest's view
        oppBoard: boardMatrix(state1),
        oppCur: state1.cur ? { cells: state1.cur.cells, kind: state1.cur.kind } : null,
        oppNext: state1.bag.slice(0, 3),
        oppScore: state1.score,
        oppLines: state1.lines,
        oppLevel: state1.level,
        oppQueued: state1.queuedGarbage,
        oppOver: state1.over,

        // Match end verdict
        winner: currentMatchWinner,
        loserScore: currentMatchWinner === 1 ? state2.score : state1.score,
      });
    }

    renderHostUI();
  } else if (currentMode === 'guest') {
    renderGuestUI();
  }

  requestAnimationFrame(loop);
}

// UI Renderers
function renderLocalUI() {
  if (state1) {
    renderBoard(boardP1, state1.board, state1.cur, state1.queuedGarbage, state1.over);
    renderPiecePreview(holdP1, state1.holdPiece);
    for (let i = 0; i < 3; i++) {
      renderPiecePreview(nextP1[i], state1.bag[i]);
    }
    scoreP1.textContent = state1.score;
    linesP1.textContent = state1.lines;
    levelP1.textContent = state1.level;
    if (state1.over) badgeP1.textContent = 'Game Over';
  } else {
    renderBoard(boardP1, null, null, 0, false);
  }

  if (state2) {
    renderBoard(boardP2, state2.board, state2.cur, state2.queuedGarbage, state2.over);
    renderPiecePreview(holdP2, state2.holdPiece);
    for (let i = 0; i < 3; i++) {
      renderPiecePreview(nextP2[i], state2.bag[i]);
    }
    scoreP2.textContent = state2.score;
    linesP2.textContent = state2.lines;
    levelP2.textContent = state2.level;
    if (state2.over) badgeP2.textContent = 'Game Over';
  } else {
    renderBoard(boardP2, null, null, 0, false);
  }
}

function renderHostUI() {
  if (state1) {
    renderBoard(boardP1, state1.board, state1.cur, state1.queuedGarbage, state1.over);
    renderPiecePreview(holdP1, state1.holdPiece);
    for (let i = 0; i < 3; i++) {
      renderPiecePreview(nextP1[i], state1.bag[i]);
    }
    scoreP1.textContent = state1.score;
    linesP1.textContent = state1.lines;
    levelP1.textContent = state1.level;
    if (state1.over) badgeP1.textContent = 'Game Over';
  } else {
    renderBoard(boardP1, null, null, 0, false);
  }

  if (state2) {
    renderBoard(boardP2, state2.board, state2.cur, state2.queuedGarbage, state2.over);
    renderPiecePreview(holdP2, state2.holdPiece);
    for (let i = 0; i < 3; i++) {
      renderPiecePreview(nextP2[i], state2.bag[i]);
    }
    scoreP2.textContent = state2.score;
    linesP2.textContent = state2.lines;
    levelP2.textContent = state2.level;
    if (state2.over) badgeP2.textContent = 'Game Over';
  } else {
    renderBoard(boardP2, null, null, 0, false);
  }
}

function renderGuestUI() {
  if (remoteGuestState) {
    // Panel 1: You (Guest)
    renderBoard(
      boardP1,
      remoteGuestState.board,
      remoteGuestState.cur,
      remoteGuestState.queued,
      remoteGuestState.over
    );
    if (remoteGuestState.next) {
      for (let i = 0; i < 3; i++) {
        renderPiecePreview(nextP1[i], remoteGuestState.next[i]);
      }
    }
    scoreP1.textContent = remoteGuestState.score;
    linesP1.textContent = remoteGuestState.lines;
    levelP1.textContent = remoteGuestState.level;
    if (remoteGuestState.over) badgeP1.textContent = 'Game Over';

    // Panel 2: Opponent (Host)
    if (remoteGuestState.oppBoard) {
      renderBoard(
        boardP2,
        remoteGuestState.oppBoard,
        remoteGuestState.oppCur,
        remoteGuestState.oppQueued,
        remoteGuestState.oppOver
      );
      if (remoteGuestState.oppNext) {
        for (let i = 0; i < 3; i++) {
          renderPiecePreview(nextP2[i], remoteGuestState.oppNext[i]);
        }
      }
      scoreP2.textContent = remoteGuestState.oppScore ?? 0;
      linesP2.textContent = remoteGuestState.oppLines ?? 0;
      levelP2.textContent = remoteGuestState.oppLevel ?? 1;
      if (remoteGuestState.oppOver) badgeP2.textContent = 'Game Over';
    }
  } else {
    renderBoard(boardP1, null, null, 0, false);
    renderBoard(boardP2, null, null, 0, false);
  }
}

// Keyboard binding
bindKeyboard((player, action) => {
  handleInput(player, action);
});

// Initialize Touch Controls
setupTouchControls();

// Start with Local Game in Start-Gate
initLocalGame();
requestAnimationFrame(loop);

// URL Hash Pairing Protocol
async function checkUrlHash() {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash) return;

  // 1. Room Code Hash: #r=ABC123
  const roomCode = parseRoomFromHash(hash);
  if (roomCode) {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    await setMode('guest');
    if (inputRoomCode) inputRoomCode.value = roomCode;
    await joinOnlineRoom(roomCode);
    return;
  }

  // 2. Legacy Manual Offer Hash: #s=token
  if (hash.startsWith('#s=')) {
    const token = hash.slice(3);
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    await setMode('guest');
    guestOfferInput.value = token;
    await generateAnswerFromOffer(token);
    return;
  }

  // 3. Legacy Manual Answer Hash: #a=token
  if (hash.startsWith('#a=')) {
    const token = hash.slice(3);
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    if (pairingChannel) {
      let ackReceived = false;
      const ackHandler = (e) => {
        if (e.data && e.data.type === 'answer_ack') {
          ackReceived = true;
          pairingChannel.removeEventListener('message', ackHandler);
          showTabAckNotice();
        }
      };
      pairingChannel.addEventListener('message', ackHandler);
      pairingChannel.postMessage({ type: 'answer', token });

      setTimeout(() => {
        pairingChannel.removeEventListener('message', ackHandler);
        if (!ackReceived) {
          fallbackToHostAnswer(token);
        }
      }, 500);
    } else {
      fallbackToHostAnswer(token);
    }
  }
}

function showTabAckNotice() {
  if (tabAckNotice) {
    tabAckNotice.classList.remove('hidden');
  }
}

async function fallbackToHostAnswer(token) {
  await setMode('host');
  hostAnswerInput.value = token;
  hostStatus.textContent = 'Antwort übernommen. Drücke "Connect" zum Starten.';
}

// ServiceWorker Registration (Offline PWA)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('ServiceWorker registration failed:', err);
  });
}

// Initial hash check and listener
checkUrlHash();
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', checkUrlHash);
}
