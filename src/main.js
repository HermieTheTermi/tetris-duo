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

import { createHost, createGuest, sanitizeCode } from './net.js';
import { setupCanvas, renderBoard, renderPiecePreview, bindKeyboard } from './ui.js';

// DOM Elements: Navigation & Modes
const btnModeLocal = document.getElementById('btnModeLocal');
const btnModeHost = document.getElementById('btnModeHost');
const btnModeGuest = document.getElementById('btnModeGuest');

// Signaling: Host
const hostSignaling = document.getElementById('hostSignaling');
const hostOfferCode = document.getElementById('hostOfferCode');
const hostAnswerInput = document.getElementById('hostAnswerInput');
const btnCopyOffer = document.getElementById('btnCopyOffer');
const btnShareOffer = document.getElementById('btnShareOffer');
const btnPasteAnswer = document.getElementById('btnPasteAnswer');
const btnAcceptAnswer = document.getElementById('btnAcceptAnswer');
const hostStatus = document.getElementById('hostStatus');

// Signaling: Guest
const guestSignaling = document.getElementById('guestSignaling');
const guestOfferInput = document.getElementById('guestOfferInput');
const btnPasteOffer = document.getElementById('btnPasteOffer');
const btnGenerateAnswer = document.getElementById('btnGenerateAnswer');
const guestAnswerStep = document.getElementById('guestAnswerStep');
const guestAnswerCode = document.getElementById('guestAnswerCode');
const btnShareAnswer = document.getElementById('btnShareAnswer');
const btnCopyAnswer = document.getElementById('btnCopyAnswer');
const guestStatus = document.getElementById('guestStatus');

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

// Game State
let currentMode = 'local'; // 'local' | 'host' | 'guest'
let peer = null;
let state1 = null;
let state2 = null;
let lastTime = 0;
let lastBroadcast = 0;
let gameSeed = 100;

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

function initLocalGame() {
  gameSeed += 10;
  state1 = createState(gameSeed);
  state2 = createState(gameSeed + 1);
  nameP1.textContent = 'Player 1';
  nameP2.textContent = 'Player 2';
  badgeP1.textContent = 'Playing';
  badgeP1.className = 'status-badge';
  badgeP2.textContent = 'Playing';
  badgeP2.className = 'status-badge';
  hideMatchEnd();
}

function handleInput(player, action) {
  // If match has concluded, no board accepts inputs anymore
  if (currentMatchWinner !== 0) return;

  if (currentMode === 'local') {
    const targetState = player === 1 ? state1 : state2;
    applyActionToState(targetState, action);
  } else if (currentMode === 'host') {
    // In host mode, host player controls state1 using touch or keys
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

  if (peer) {
    peer.close();
    peer = null;
  }

  if (mode === 'local') {
    initLocalGame();
  } else if (mode === 'host') {
    initHostMode();
  } else if (mode === 'guest') {
    initGuestMode();
  }
}

// Host Mode Setup
async function initHostMode() {
  hostSignaling.classList.remove('hidden');
  hostOfferCode.value = 'Generating connection offer...';
  hostStatus.textContent = 'Generating offer...';
  hostStatus.className = 'status-badge waiting';
  nameP1.textContent = 'You (Host)';
  nameP2.textContent = 'Opponent (Guest)';

  gameSeed += 10;
  state1 = createState(gameSeed);
  state2 = createState(gameSeed + 1);
  hideMatchEnd();

  try {
    peer = await createHost({
      onOpen: () => {
        hostStatus.textContent = 'Connected! Match starting.';
        hostStatus.className = 'status-badge connected';
        badgeP2.textContent = 'Connected';
        badgeP2.className = 'status-badge connected';
        showToast('Guest connected!');
        peer.send({ t: 'hello', name: 'Host' });
      },
      onClose: () => {
        hostStatus.textContent = 'Guest disconnected.';
        hostStatus.className = 'status-badge waiting';
        badgeP2.textContent = 'Disconnected';
      },
      onTimeout: () => {
        hostStatus.textContent = 'Verbindung fehlgeschlagen – Netzwerk blockiert vermutlich P2P';
        hostStatus.className = 'status-badge waiting';
      },
      onMessage: (msg) => {
        handleHostMessage(msg);
      },
    });

    const offerBlob = peer.localBlob();
    hostOfferCode.value = offerBlob;
    hostStatus.textContent = 'Offer ready. Copy or share with Guest!';
  } catch (err) {
    hostStatus.textContent = 'Error: ' + err.message;
  }
}

function handleHostMessage(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === 'input') {
    // Guest input simulated on state2
    applyActionToState(state2, msg.a);
  } else if (msg.t === 'garbage') {
    if (state1 && typeof msg.n === 'number') {
      incomingGarbage(state1, msg.n);
    }
  } else if (msg.t === 'rematch') {
    resetMatch();
    if (peer) peer.send({ t: 'rematch' });
    showToast('Rematch started!');
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

btnAcceptAnswer.addEventListener('click', async () => {
  const answer = sanitizeCode(hostAnswerInput.value);
  if (!answer) {
    alert('Please paste the Guest answer code first.');
    return;
  }
  try {
    hostStatus.textContent = 'Connecting...';
    hostStatus.className = 'status-badge waiting';

    // 15 second timeout for DataChannel connection
    peer.startTimeout(() => {
      hostStatus.textContent = 'Verbindung fehlgeschlagen – Netzwerk blockiert vermutlich P2P';
      hostStatus.className = 'status-badge waiting';
    }, 15000);

    await peer.acceptBlob(answer);
  } catch (err) {
    hostStatus.textContent = 'Connection failed: ' + err.message;
  }
});

// Guest Mode Setup
function initGuestMode() {
  guestSignaling.classList.remove('hidden');
  guestAnswerStep.classList.add('hidden');
  guestStatus.textContent = 'Waiting for Host Code...';
  guestStatus.className = 'status-badge waiting';
  nameP1.textContent = 'You (Guest)';
  nameP2.textContent = 'Opponent (Host)';

  state1 = null;
  state2 = null;
  remoteGuestState = null;
  hideMatchEnd();
}

btnPasteOffer.addEventListener('click', () => {
  pasteCodeInto(guestOfferInput);
});

btnGenerateAnswer.addEventListener('click', async () => {
  const offer = sanitizeCode(guestOfferInput.value);
  if (!offer) {
    alert('Please paste the Host connection code first.');
    return;
  }
  guestStatus.textContent = 'Generating answer...';
  guestStatus.className = 'status-badge waiting';
  try {
    peer = await createGuest({
      onOpen: () => {
        guestStatus.textContent = 'Connected to Host!';
        guestStatus.className = 'status-badge connected';
        badgeP1.textContent = 'Connected';
        badgeP1.className = 'status-badge connected';
        showToast('Connected to Host!');
        peer.send({ t: 'hello', name: 'Guest' });
      },
      onClose: () => {
        guestStatus.textContent = 'Disconnected from Host.';
        guestStatus.className = 'status-badge waiting';
      },
      onTimeout: () => {
        guestStatus.textContent = 'Verbindung fehlgeschlagen – Netzwerk blockiert vermutlich P2P';
        guestStatus.className = 'status-badge waiting';
      },
      onMessage: (msg) => {
        handleGuestMessage(msg);
      },
    });

    // 15 second timeout for DataChannel connection
    peer.startTimeout(() => {
      guestStatus.textContent = 'Verbindung fehlgeschlagen – Netzwerk blockiert vermutlich P2P';
      guestStatus.className = 'status-badge waiting';
    }, 15000);

    await peer.acceptBlob(offer);
    const answerBlob = peer.localBlob();
    guestAnswerCode.value = answerBlob;
    guestAnswerStep.classList.remove('hidden');
    guestStatus.textContent = 'Answer generated. Copy or share back to Host!';
  } catch (err) {
    guestStatus.textContent = 'Error: ' + err.message;
  }
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
      // Fallback to clipboard if share was rejected
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
  if (msg.t === 'state') {
    // Receive state stream from host
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
    hideMatchEnd();
    showToast('Rematch gestartet!');
  }
}

// Rematch Button
function triggerRematch() {
  if (currentMode === 'local') {
    initLocalGame();
    showToast('Game restarted!');
  } else if (currentMode === 'host') {
    resetMatch();
    if (peer) peer.send({ t: 'rematch' });
    showToast('Rematch started!');
  } else if (currentMode === 'guest') {
    if (peer) peer.send({ t: 'rematch' });
    showToast('Rematch requested!');
  }
}

btnRematch.addEventListener('click', triggerRematch);
if (btnOverlayRematch) {
  btnOverlayRematch.addEventListener('click', triggerRematch);
}

function resetMatch() {
  gameSeed += 10;
  state1 = createState(gameSeed);
  state2 = createState(gameSeed + 1);
  badgeP1.textContent = 'Playing';
  badgeP1.className = 'status-badge';
  badgeP2.textContent = 'Playing';
  badgeP2.className = 'status-badge';
  hideMatchEnd();
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
      if (isPressed || currentMatchWinner !== 0) return;
      isPressed = true;
      btn.classList.add('pressed');

      // Player 1 input: host drives own board; guest sends over wire; local drives P1
      handleInput(1, action);

      if (repeat) {
        dasTimer = setTimeout(() => {
          repeatTimer = setInterval(() => {
            if (isPressed && currentMatchWinner === 0) {
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
    if (currentMatchWinner === 0) {
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
    if (currentMatchWinner === 0) {
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
    if (peer && timestamp - lastBroadcast >= 50 && state2) {
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
  }
}

// Keyboard binding
bindKeyboard((player, action) => {
  handleInput(player, action);
});

// Initialize Touch Controls
setupTouchControls();

// Start with Local Game
initLocalGame();
requestAnimationFrame(loop);
