// WebRTC transport with manual signaling, no DOM
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function sanitizeCode(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\s+/g, '');
}

function encodeBlob(obj) {
  const json = JSON.stringify(obj);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64');
  }
  return btoa(
    encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (match, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  );
}

function decodeBlob(str) {
  const trimmed = sanitizeCode(str);
  let json;
  if (typeof Buffer !== 'undefined') {
    json = Buffer.from(trimmed, 'base64').toString('utf8');
  } else {
    json = decodeURIComponent(
      Array.prototype.map
        .call(atob(trimmed), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  }
  return JSON.parse(json);
}

function waitForIceGathering(pc, timeoutMs = 3000) {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('icecandidate', (event) => {
        if (event && event.candidate === null) {
          finish();
        }
      });
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          finish();
        }
      });
    } else {
      finish();
    }
  });
}

function uint8ArrayToBase64Url(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToUint8Array(str) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64url'));
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function compressJsonToBase64Url(obj) {
  const json = JSON.stringify(obj);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(json));
  writer.close();

  const reader = cs.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  return uint8ArrayToBase64Url(merged);
}

export async function peerFromToken(token) {
  const sanitized = sanitizeCode(token);
  if (!sanitized) {
    throw new Error('Invalid token');
  }
  const bytes = base64UrlToUint8Array(sanitized);
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const json = new TextDecoder().decode(merged);
  return JSON.parse(json);
}

export async function tokenFromPeer(peer, kind) {
  const pc = peer?.pc || (typeof peer?.createOffer === 'function' ? peer : null);

  if (pc) {
    await waitForIceGathering(pc, 3000);
    const desc = pc.localDescription || { type: kind, sdp: '' };
    return await compressJsonToBase64Url({
      type: desc.type || kind,
      sdp: desc.sdp || '',
    });
  }

  if (peer && peer.iceGatheringState && peer.iceGatheringState !== 'complete') {
    await waitForIceGathering(peer, 3000);
  }

  let desc = peer?.localDescription;
  if (!desc && typeof peer?.localBlob === 'function') {
    try {
      desc = decodeBlob(peer.localBlob());
    } catch (e) {
      desc = { type: kind, sdp: '' };
    }
  }

  if (!desc) {
    desc = { type: kind, sdp: '' };
  }

  return await compressJsonToBase64Url({
    type: desc.type || kind,
    sdp: desc.sdp || '',
  });
}

function createNodeMockPeer(isHost, opts = {}) {
  const dummySdp = {
    type: isHost ? 'offer' : 'answer',
    sdp:
      'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n' +
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n' +
      'a=candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host\r\n' +
      'a=candidate:2 1 UDP 1694498815 1.2.3.4 50000 typ srflx raddr 127.0.0.1 rport 50000\r\n',
  };
  const blob = encodeBlob(dummySdp);

  let timeoutTimer = null;
  const peer = {
    iceGatheringState: 'complete',
    localDescription: dummySdp,
    localBlob: () => blob,
    acceptBlob: async (str) => {
      const sanitized = sanitizeCode(str);
      let parsed;
      try {
        parsed = await peerFromToken(sanitized);
      } catch (e) {
        parsed = decodeBlob(sanitized);
      }
      return parsed;
    },
    send: (obj) => {},
    onMessage: opts.onMessage || (() => {}),
    onOpen: opts.onOpen || (() => {}),
    onClose: opts.onClose || (() => {}),
    startTimeout: (cb, ms = 15000) => {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        cb?.();
        opts.onTimeout?.();
      }, ms);
    },
    cancelTimeout: () => {
      clearTimeout(timeoutTimer);
    },
    close: () => {
      clearTimeout(timeoutTimer);
      peer.onClose();
    },
  };
  return peer;
}

export async function createHost(opts = {}) {
  if (typeof RTCPeerConnection === 'undefined') {
    return createNodeMockPeer(true, opts);
  }

  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  });

  let dc = pc.createDataChannel('game');
  let timeoutTimer = null;
  let isOpen = false;

  const peer = {
    pc,
    onMessage: opts.onMessage || (() => {}),
    onOpen: opts.onOpen || (() => {}),
    onClose: opts.onClose || (() => {}),

    localBlob: () => {
      if (!pc.localDescription) return '';
      return encodeBlob({
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
      });
    },

    acceptBlob: async (str) => {
      const sanitized = sanitizeCode(str);
      let remote;
      try {
        remote = await peerFromToken(sanitized);
      } catch (e) {
        remote = decodeBlob(sanitized);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(remote));
    },

    startTimeout: (cb, ms = 15000) => {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (!isOpen) {
          cb?.();
          opts.onTimeout?.();
        }
      }, ms);
    },

    cancelTimeout: () => {
      clearTimeout(timeoutTimer);
    },

    send: (obj) => {
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(obj));
      }
    },

    close: () => {
      clearTimeout(timeoutTimer);
      if (dc) dc.close();
      pc.close();
    },
  };

  const setupDc = (channel) => {
    dc = channel;
    dc.onopen = () => {
      isOpen = true;
      clearTimeout(timeoutTimer);
      peer.onOpen();
    };
    dc.onclose = () => {
      isOpen = false;
      peer.onClose();
    };
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        peer.onMessage(msg);
      } catch (err) {
        console.error('Error parsing incoming message', err);
      }
    };
  };

  setupDc(dc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc, 3000);

  return peer;
}

export async function createGuest(opts = {}) {
  if (typeof RTCPeerConnection === 'undefined') {
    return createNodeMockPeer(false, opts);
  }

  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  });

  let dc = null;
  let timeoutTimer = null;
  let isOpen = false;

  const peer = {
    pc,
    onMessage: opts.onMessage || (() => {}),
    onOpen: opts.onOpen || (() => {}),
    onClose: opts.onClose || (() => {}),

    localBlob: () => {
      if (!pc.localDescription) return '';
      return encodeBlob({
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
      });
    },

    acceptBlob: async (str) => {
      const sanitized = sanitizeCode(str);
      let remote;
      try {
        remote = await peerFromToken(sanitized);
      } catch (e) {
        remote = decodeBlob(sanitized);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(remote));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 3000);
      return peer.localBlob();
    },

    startTimeout: (cb, ms = 15000) => {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (!isOpen) {
          cb?.();
          opts.onTimeout?.();
        }
      }, ms);
    },

    cancelTimeout: () => {
      clearTimeout(timeoutTimer);
    },

    send: (obj) => {
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(obj));
      }
    },

    close: () => {
      clearTimeout(timeoutTimer);
      if (dc) dc.close();
      pc.close();
    },
  };

  pc.ondatachannel = (event) => {
    dc = event.channel;
    dc.onopen = () => {
      isOpen = true;
      clearTimeout(timeoutTimer);
      peer.onOpen();
    };
    dc.onclose = () => {
      isOpen = false;
      peer.onClose();
    };
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        peer.onMessage(msg);
      } catch (err) {
        console.error('Error parsing incoming message', err);
      }
    };
  };

  if (opts.offer) {
    await peer.acceptBlob(opts.offer);
  }

  return peer;
}
