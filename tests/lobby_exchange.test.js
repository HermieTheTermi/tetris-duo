import test from 'node:test';
import assert from 'node:assert/strict';
import * as lobby from '../src/lobby.js';
import * as signal from '../src/signal.js';

test('26. lobbyMessageFor generates messages with correct role readiness flags', () => {
  assert.equal(typeof lobby.lobbyMessageFor, 'function', 'lobbyMessageFor must be exported from src/lobby.js');

  // Host readiness -> ready1
  const hostReady = lobby.lobbyMessageFor('host', true);
  assert.equal(hostReady.t, 'lobby');
  assert.equal(hostReady.ready1, true);
  assert.equal(hostReady.ready2, undefined);

  const hostNotReady = lobby.lobbyMessageFor('host', false);
  assert.equal(hostNotReady.t, 'lobby');
  assert.equal(hostNotReady.ready1, false);

  // Guest readiness -> ready2
  const guestReady = lobby.lobbyMessageFor('guest', true);
  assert.equal(guestReady.t, 'lobby');
  assert.equal(guestReady.ready2, true);
  assert.equal(guestReady.ready1, undefined);

  const guestNotReady = lobby.lobbyMessageFor('guest', false);
  assert.equal(guestNotReady.t, 'lobby');
  assert.equal(guestNotReady.ready2, false);

  // Extras are preserved (e.g. countdown or started flags)
  const hostWithCountdown = lobby.lobbyMessageFor('host', true, { countdown: 3 });
  assert.equal(hostWithCountdown.ready1, true);
  assert.equal(hostWithCountdown.countdown, 3);
});

test('27. applyLobbyMessage updates readiness and transitions phase symmetrically for host and guest', () => {
  assert.equal(typeof lobby.applyLobbyMessage, 'function', 'applyLobbyMessage must be exported from src/lobby.js');

  // Case A: Host receives Guest readiness ({t:'lobby', ready2:true})
  // 1. Host is not yet ready itself -> phase remains 'waiting', ready2 is set
  const hostInitial = { connected: true, ready1: false, ready2: false };
  const hostUpdated = lobby.applyLobbyMessage(hostInitial, { t: 'lobby', ready2: true });
  assert.equal(hostUpdated.ready2, true, 'Host state must have ready2=true after receiving guest readiness');
  assert.equal(hostUpdated.ready1, false, 'Host ready1 must remain unchanged');
  assert.equal(hostUpdated.phase, 'waiting', 'Phase must be waiting when only one player is ready');

  // 2. Host then becomes ready itself -> phase transitions to 'countdown'
  const hostBothReady = lobby.applyLobbyMessage(
    { ...hostUpdated, ready1: true },
    { t: 'lobby', ready2: true }
  );
  assert.equal(hostBothReady.ready1, true);
  assert.equal(hostBothReady.ready2, true);
  assert.equal(hostBothReady.phase, 'countdown', 'Phase must be countdown once both host and guest are ready');

  // Case B: Guest receives Host readiness ({t:'lobby', ready1:true})
  // 1. Guest is already ready (ready2: true) -> receives ready1 -> phase transitions to 'countdown'
  const guestInitial = { connected: true, ready1: false, ready2: true };
  const guestUpdated = lobby.applyLobbyMessage(guestInitial, { t: 'lobby', ready1: true });
  assert.equal(guestUpdated.ready1, true, 'Guest state must have ready1=true after receiving host readiness');
  assert.equal(guestUpdated.ready2, true, 'Guest ready2 must remain unchanged');
  assert.equal(guestUpdated.phase, 'countdown', 'Phase must transition to countdown when host readiness arrives');

  // Symmetrie: pure function does not mutate input
  assert.equal(hostInitial.ready2, false, 'applyLobbyMessage must not mutate original state');
  assert.equal(guestInitial.ready1, false, 'applyLobbyMessage must not mutate original state');
});

test('28. applyLobbyMessage handles missing or malformed messages gracefully', () => {
  assert.equal(typeof lobby.applyLobbyMessage, 'function', 'applyLobbyMessage must be exported from src/lobby.js');

  const baseState = { connected: true, ready1: true, ready2: false, phase: 'waiting' };

  // Null or undefined message
  assert.deepEqual(lobby.applyLobbyMessage(baseState, null).ready1, true);
  assert.deepEqual(lobby.applyLobbyMessage(baseState, undefined).ready2, false);

  // Non-lobby messages (e.g. unknown message type) must not corrupt state
  const ignored = lobby.applyLobbyMessage(baseState, { t: 'unknown', foo: 'bar' });
  assert.equal(ignored.ready1, true);
  assert.equal(ignored.ready2, false);

  // Malformed objects
  assert.deepEqual(lobby.applyLobbyMessage(baseState, 'invalid string').ready1, true);
  assert.deepEqual(lobby.applyLobbyMessage(baseState, 12345).ready1, true);
});

test('29. joinRoom passes working send handle to onPeerOpen callback without ReferenceError', async () => {
  // Mock Peer class in global scope to simulate PeerJS connection flow in node
  const origPeer = globalThis.Peer;
  try {
    let mockPeerInstance = null;
    let mockConnInstance = null;

    class MockPeer {
      constructor(id, opts) {
        this.id = id;
        this.handlers = {};
        mockPeerInstance = this;
      }
      on(event, cb) {
        this.handlers[event] = cb;
        if (event === 'open') {
          // Trigger open asynchronously
          queueMicrotask(() => cb(this.id));
        }
      }
      connect(targetId, opts) {
        const conn = {
          targetId,
          open: true,
          handlers: {},
          sentData: [],
          on(ev, cb) {
            this.handlers[ev] = cb;
            if (ev === 'open') {
              queueMicrotask(() => cb());
            }
          },
          send(data) {
            this.sentData.push(data);
          },
          close() {
            this.open = false;
          },
        };
        mockConnInstance = conn;
        return conn;
      }
      destroy() {}
    }

    globalThis.Peer = MockPeer;

    let peerInCallback = null;
    let callbackExecuted = false;

    // Simulate joinOnlineRoom pattern:
    // When onPeerOpen is invoked, handle is passed and send() can be called immediately
    const handle = await signal.joinRoom('TEST23', {
      onPeerOpen: (peerHandle) => {
        callbackExecuted = true;
        peerInCallback = peerHandle;
        if (peerHandle && typeof peerHandle.send === 'function') {
          peerHandle.send({ t: 'hello', name: 'Guest' });
        }
      },
    });

    assert.ok(callbackExecuted, 'onPeerOpen callback must be called');
    assert.ok(peerInCallback, 'onPeerOpen must receive valid handle object with send method');
    assert.equal(typeof peerInCallback.send, 'function', 'handle in onPeerOpen must have send method');
    assert.equal(typeof handle.send, 'function', 'joinRoom resolved handle must have send method');
    assert.deepEqual(mockConnInstance.sentData, [{ t: 'hello', name: 'Guest' }]);
  } finally {
    globalThis.Peer = origPeer;
    signal.closeRoom();
  }
});

test('30. Full lobby flow: guest clicks ready, host clicks ready, countdown starts', () => {
  // Simulate Host and Guest lobbies
  let hostLobby = { connected: true, ready1: false, ready2: false, phase: 'lobby' };
  let guestLobby = { connected: true, ready1: false, ready2: false, phase: 'lobby' };

  // 1. Guest clicks ready -> sends guest ready message
  const guestMsg = lobby.lobbyMessageFor('guest', true);
  assert.equal(guestMsg.ready2, true);

  // Host receives guest ready message
  hostLobby = lobby.applyLobbyMessage(hostLobby, guestMsg);
  assert.equal(hostLobby.ready2, true);
  assert.equal(hostLobby.ready1, false);
  assert.equal(hostLobby.phase, 'waiting');

  // 2. Host clicks ready -> host becomes ready, phase becomes countdown
  hostLobby.ready1 = true;
  hostLobby.phase = lobby.lobbyPhase(hostLobby);
  assert.equal(hostLobby.phase, 'countdown');

  // Host broadcasts its lobby state (both ready, countdown: 3)
  const hostMsg = lobby.lobbyMessageFor('host', true, { ready2: true, countdown: 3 });
  assert.equal(hostMsg.ready1, true);
  assert.equal(hostMsg.countdown, 3);

  // Guest receives host lobby message
  guestLobby = lobby.applyLobbyMessage({ ...guestLobby, ready2: true }, hostMsg);
  assert.equal(guestLobby.ready1, true);
  assert.equal(guestLobby.ready2, true);
  assert.equal(guestLobby.phase, 'countdown');
  assert.equal(guestLobby.countdown, 3);
});
