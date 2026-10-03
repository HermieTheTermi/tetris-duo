// Room link pairing and signaling via vendored PeerJS (MIT)

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;

// Active PeerJS instances for signaling
let activePeer = null;
let activeConn = null;
let connectTimeoutTimer = null;

/**
 * Generates a 6-character room code without confusing characters (no 0/O, 1/I).
 * @returns {string}
 */
export function makeRoomCode() {
  let result = '';
  const len = ROOM_CODE_ALPHABET.length;
  // Use crypto.getRandomValues if available, fallback to Math.random
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      result += ROOM_CODE_ALPHABET[bytes[i] % len];
    }
  } else {
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const idx = Math.floor(Math.random() * len);
      result += ROOM_CODE_ALPHABET[idx];
    }
  }
  return result;
}

/**
 * Builds a room link from code and optional baseUrl.
 * @param {string} code
 * @param {string} [baseUrl]
 * @returns {string} '<baseUrl>#r=<CODE>'
 */
export function roomLink(code, baseUrl) {
  let base = baseUrl;
  if (!base) {
    base = typeof window !== 'undefined' && window.location ? window.location.href : '';
  }
  const cleanBase = base.split('#')[0];
  return `${cleanBase}#r=${code}`;
}

/**
 * Parses room code from a URL hash string.
 * @param {string} hash '#r=ABC123'
 * @returns {string|null} Room code or null if invalid / foreign hash
 */
export function parseRoomFromHash(hash) {
  if (!hash || typeof hash !== 'string') return null;
  let clean = hash.trim();
  if (clean.startsWith('#')) {
    clean = clean.slice(1);
  }
  if (!clean.startsWith('r=')) {
    return null;
  }
  const code = clean.slice(2);
  if (/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/i.test(code)) {
    return code.toUpperCase();
  }
  return null;
}

function getPeerConstructor() {
  if (typeof Peer !== 'undefined') return Peer;
  if (typeof window !== 'undefined' && window.Peer) return window.Peer;
  if (typeof globalThis !== 'undefined' && globalThis.Peer) return globalThis.Peer;
  return null;
}

/**
 * Closes any active PeerJS room and connection.
 */
export function closeRoom() {
  if (connectTimeoutTimer) {
    clearTimeout(connectTimeoutTimer);
    connectTimeoutTimer = null;
  }
  if (activeConn) {
    try {
      activeConn.close();
    } catch (_) {}
    activeConn = null;
  }
  if (activePeer) {
    try {
      activePeer.destroy();
    } catch (_) {}
    activePeer = null;
  }
}

/**
 * Hosts a room with the given code.
 * @param {string} code
 * @param {Object} handlers
 * @param {function(string, string):void} [handlers.onStatus]
 * @param {function(Object):void} [handlers.onMessage]
 * @param {function(Object):void} [handlers.onPeerOpen]
 * @param {function():void} [handlers.onClose]
 * @param {function(Error):void} [handlers.onError]
 * @returns {Promise<Object>}
 */
export async function hostRoom(code, handlers = {}) {
  closeRoom();
  const PeerClass = getPeerConstructor();
  if (!PeerClass) {
    throw new Error('PeerJS nicht geladen. vendor/peerjs.min.js einbinden.');
  }

  const peerId = `td-${code.toUpperCase()}-h`;
  return new Promise((resolve, reject) => {
    try {
      activePeer = new PeerClass(peerId, {
        debug: 1,
      });

      const hostHandle = {
        peer: activePeer,
        send: (data) => {
          if (activeConn && activeConn.open) {
            activeConn.send(data);
          }
        },
        close: closeRoom,
      };

      activePeer.on('open', (id) => {
        if (handlers.onStatus) {
          handlers.onStatus('Raum bereit. Warte auf Gast…', 'waiting');
        }
        resolve(hostHandle);
      });

      activePeer.on('connection', (conn) => {
        activeConn = conn;
        conn.on('open', () => {
          if (handlers.onStatus) {
            handlers.onStatus('Gast verbunden! Bereit machen.', 'connected');
          }
          if (handlers.onPeerOpen) {
            handlers.onPeerOpen(hostHandle);
          }
        });

        conn.on('data', (data) => {
          if (handlers.onMessage) {
            handlers.onMessage(data);
          }
        });

        conn.on('close', () => {
          if (handlers.onClose) {
            handlers.onClose();
          }
        });

        conn.on('error', (err) => {
          if (handlers.onError) handlers.onError(err);
        });
      });

      activePeer.on('error', (err) => {
        const errorMsg =
          'Raum nicht erreichbar – brauchst du Internet für den Handschlag? ' +
          '(Manueller QR-/Code-Austausch funktioniert auch komplett offline)';
        if (handlers.onStatus) {
          handlers.onStatus(errorMsg, 'error');
        }
        if (handlers.onError) {
          handlers.onError(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Joins a room hosted by another player.
 * @param {string} code
 * @param {Object} handlers
 * @param {function(string, string):void} [handlers.onStatus]
 * @param {function(Object):void} [handlers.onMessage]
 * @param {function(Object):void} [handlers.onPeerOpen]
 * @param {function():void} [handlers.onClose]
 * @param {function(Error):void} [handlers.onError]
 * @returns {Promise<Object>}
 */
export async function joinRoom(code, handlers = {}) {
  closeRoom();
  const PeerClass = getPeerConstructor();
  if (!PeerClass) {
    throw new Error('PeerJS nicht geladen. vendor/peerjs.min.js einbinden.');
  }

  const targetHostId = `td-${code.toUpperCase()}-h`;
  const guestPeerId = `td-${code.toUpperCase()}-g-${Math.floor(Math.random() * 10000)}`;

  if (handlers.onStatus) {
    handlers.onStatus(`Verbinde mit Raum ${code.toUpperCase()}…`, 'waiting');
  }

  return new Promise((resolve, reject) => {
    try {
      activePeer = new PeerClass(guestPeerId, {
        debug: 1,
      });

      connectTimeoutTimer = setTimeout(() => {
        const timeoutMsg =
          'Raum nicht erreichbar – brauchst du Internet für den Handschlag? ' +
          '(Manueller QR-/Code-Austausch funktioniert auch komplett offline)';
        if (handlers.onStatus) {
          handlers.onStatus(timeoutMsg, 'error');
        }
      }, 15000);

      activePeer.on('open', () => {
        const conn = activePeer.connect(targetHostId, {
          label: 'game',
          reliable: true,
        });
        activeConn = conn;

        conn.on('open', () => {
          if (connectTimeoutTimer) {
            clearTimeout(connectTimeoutTimer);
            connectTimeoutTimer = null;
          }
          if (handlers.onStatus) {
            handlers.onStatus('Verbunden! Bereit?', 'connected');
          }
          const handle = {
            peer: activePeer,
            conn: activeConn,
            send: (data) => {
              if (activeConn && activeConn.open) {
                activeConn.send(data);
              }
            },
            close: closeRoom,
          };
          if (handlers.onPeerOpen) {
            handlers.onPeerOpen(handle);
          }
          resolve(handle);
        });

        conn.on('data', (data) => {
          if (handlers.onMessage) {
            handlers.onMessage(data);
          }
        });

        conn.on('close', () => {
          if (handlers.onClose) {
            handlers.onClose();
          }
        });

        conn.on('error', (err) => {
          if (handlers.onError) handlers.onError(err);
        });
      });

      activePeer.on('error', (err) => {
        if (connectTimeoutTimer) {
          clearTimeout(connectTimeoutTimer);
          connectTimeoutTimer = null;
        }
        const errorMsg =
          'Raum nicht erreichbar – brauchst du Internet für den Handschlag? ' +
          '(Manueller QR-/Code-Austausch funktioniert auch komplett offline)';
        if (handlers.onStatus) {
          handlers.onStatus(errorMsg, 'error');
        }
        if (handlers.onError) {
          handlers.onError(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
