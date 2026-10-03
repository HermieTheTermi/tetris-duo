// Pure state logic for start-gate and lobby phases

export const COUNTDOWN_STEP_MS = 1000;
export const COUNTDOWN_TOTAL_MS = 4000; // 3 -> 2 -> 1 -> GO! (each ~1s)

/**
 * Computes current lobby phase.
 * @param {Object} params
 * @param {boolean} [params.connected=false] Whether network peer is connected (or local game active)
 * @param {boolean} [params.ready1=false] Player 1 readiness
 * @param {boolean} [params.ready2=false] Player 2 readiness
 * @param {number|null} [params.countdownStartedAt=null] Timestamp in ms when countdown started
 * @param {number} [params.now=Date.now()] Current timestamp in ms
 * @returns {'idle' | 'waiting' | 'lobby' | 'countdown' | 'playing'}
 */
export function lobbyPhase({
  connected = false,
  ready1 = false,
  ready2 = false,
  countdownStartedAt = null,
  now = Date.now(),
} = {}) {
  if (!connected) {
    return 'idle';
  }

  if (!ready1 && !ready2) {
    return 'lobby';
  }

  if (!ready1 || !ready2) {
    return 'waiting';
  }

  // Both players ready: check countdown
  if (countdownStartedAt != null && now != null && now - countdownStartedAt >= COUNTDOWN_TOTAL_MS) {
    return 'playing';
  }

  return 'countdown';
}

/**
 * Calculates numeric countdown value (3, 2, 1, 0 for GO).
 * @param {number} countdownStartedAt Timestamp in ms
 * @param {number} now Current timestamp in ms
 * @returns {number} 3 | 2 | 1 | 0
 */
export function countdownValue(countdownStartedAt, now) {
  if (countdownStartedAt == null || now == null) {
    return 3;
  }
  const elapsed = Math.max(0, now - countdownStartedAt);
  if (elapsed < 1000) return 3;
  if (elapsed < 2000) return 2;
  if (elapsed < 3000) return 1;
  return 0; // 'GO'
}

/**
 * Creates a lobby signaling message carrying role readiness and optional extras.
 * @param {'host' | 'guest' | 'p1' | 'p2'} role
 * @param {boolean} ready
 * @param {Object} [extra]
 * @returns {Object}
 */
export function lobbyMessageFor(role, ready, extra = {}) {
  const norm = typeof role === 'string' ? role.toLowerCase() : '';
  const msg = {
    t: 'lobby',
    ...extra,
  };
  if (norm === 'host' || norm === 'p1') {
    msg.ready1 = !!ready;
  } else if (norm === 'guest' || norm === 'p2') {
    msg.ready2 = !!ready;
  }
  return msg;
}

/**
 * Pure function: applies an incoming lobby message to local lobby state and recalculates phase.
 * @param {Object} localLobby
 * @param {Object} msg
 * @returns {Object} updated lobby state copy
 */
export function applyLobbyMessage(localLobby, msg) {
  if (!localLobby || typeof localLobby !== 'object') {
    return localLobby;
  }
  const next = { ...localLobby };
  if (!msg || typeof msg !== 'object') {
    return next;
  }
  if (msg.t !== 'lobby' && msg.t !== 'ready') {
    return next;
  }

  if (typeof msg.ready1 === 'boolean') {
    next.ready1 = msg.ready1;
  }
  if (typeof msg.ready2 === 'boolean') {
    next.ready2 = msg.ready2;
  }
  // Support legacy msg.t === 'ready' from guest
  if (msg.t === 'ready' && typeof msg.ready === 'boolean') {
    next.ready2 = msg.ready;
  }

  if (msg.countdown !== undefined) {
    next.countdown = msg.countdown;
  }
  if (msg.countdownStartedAt !== undefined) {
    next.countdownStartedAt = msg.countdownStartedAt;
  }
  if (typeof msg.started === 'boolean') {
    next.started = msg.started;
  }

  next.phase = lobbyPhase({
    connected: next.connected ?? true,
    ready1: next.ready1 ?? false,
    ready2: next.ready2 ?? false,
    countdownStartedAt: next.countdownStartedAt ?? null,
    now: next.now ?? Date.now(),
  });

  return next;
}
