// WebRTC transport with manual signaling, no DOM
const STUN_SERVER = 'stun:stun.l.google.com:19302';

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
  const trimmed = str.trim();
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

function waitForIceGathering(pc, timeoutMs = 2000) {
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
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate === null) {
        finish();
      }
    });
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        finish();
      }
    });
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

  const peer = {
    localBlob: () => blob,
    acceptBlob: async (str) => {
      const parsed = decodeBlob(str);
      return parsed;
    },
    send: (obj) => {},
    onMessage: opts.onMessage || (() => {}),
    onOpen: opts.onOpen || (() => {}),
    onClose: opts.onClose || (() => {}),
    close: () => {
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
    iceServers: [{ urls: STUN_SERVER }],
  });

  let dc = pc.createDataChannel('game');

  const peer = {
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
      const remote = decodeBlob(str);
      await pc.setRemoteDescription(new RTCSessionDescription(remote));
    },

    send: (obj) => {
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(obj));
      }
    },

    close: () => {
      if (dc) dc.close();
      pc.close();
    },
  };

  const setupDc = (channel) => {
    dc = channel;
    dc.onopen = () => {
      peer.onOpen();
    };
    dc.onclose = () => {
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
  await waitForIceGathering(pc, 2000);

  return peer;
}

export async function createGuest(opts = {}) {
  if (typeof RTCPeerConnection === 'undefined') {
    return createNodeMockPeer(false, opts);
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: STUN_SERVER }],
  });

  let dc = null;

  const peer = {
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
      const remote = decodeBlob(str);
      await pc.setRemoteDescription(new RTCSessionDescription(remote));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 2000);
      return peer.localBlob();
    },

    send: (obj) => {
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(obj));
      }
    },

    close: () => {
      if (dc) dc.close();
      pc.close();
    },
  };

  pc.ondatachannel = (event) => {
    dc = event.channel;
    dc.onopen = () => {
      peer.onOpen();
    };
    dc.onclose = () => {
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
