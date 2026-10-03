# INTERFACE — tetris-duo

Static site, no build step, no npm dependencies. Runs from `file://` and from GitHub Pages
(`https://<user>.github.io/tetris-duo/`). Vanilla ES modules + Canvas 2D only.

## File layout (must match)

```
index.html            entry page, <script type="module" src="src/main.js">
styles.css            all styles, no external fonts/CDN
src/engine.js         pure logic, no DOM, no timers
src/net.js            WebRTC transport with manual signaling, no DOM
src/ui.js             rendering + input (canvas)
src/main.js           wiring: mode selection, loop, network glue
tests/engine.test.js  node:test suite, imports ../src/engine.js
README.md             how to play, how to test online, deploy note
```

## engine.js — exported API (exact names)

```js
export const COLS = 10, ROWS = 20;
export function createState(seed = 1)        // -> state
export function spawn(state)                  // adds a piece from state.bag
export function tick(state, dtMs)             // gravity + lock + clear, returns events[]
export function move(state, dir)              // -1 | 1, false if blocked
export function rotate(state, cw)             // true | false
export function softDrop(state)               // boolean
export function hardDrop(state)               // lines dropped (number)
export function hold(state)                   // boolean
export function boardMatrix(state)            // number[][] ROWS x COLS, 0 = empty, 1..7 piece id, 8 = garbage
export function incomingGarbage(state, n)     // queue n garbage lines
export function applyGarbage(state)           // push queued garbage into board, returns pushed count
export const PIECES = ['I','J','L','O','S','T','Z'];
```

Rules: 7-bag randomizer (deterministic from `seed`), SRS rotation with wall kicks (at minimum
basic kicks: try 0/-1/+1/-2/+2 x-offsets), gravity interval `800 - (level-1)*70` ms, soft drop
= gravity/20, line clears score 100/300/500/800 × level, level = 1 + floor(totalLines/10),
game over when a spawned piece collides at spawn. Attack: clear 2/3/4 lines -> 1/2/4 garbage
lines queued to the opponent (1 line -> 0). Garbage rows are full except one random hole.

Determinism: same seed + same input sequence = same state. No `Date.now()` in engine, no
`Math.random()` — use the seeded PRNG exported from engine (`export function rng(state)`).

## net.js — host-authoritative WebRTC, manual signaling

```js
export async function createHost(opts)     // -> peer
export async function createGuest(opts)    // -> peer
peer.localBlob()                            // string the other side has to paste
peer.acceptBlob(str)                        // apply the other side's blob
peer.send(obj)                              // JSON over data channel
peer.onMessage = (obj) => {}                // set before send
peer.onOpen = () => {}                      // data channel open
peer.onClose = () => {}
peer.close()
```

Blobs are base64-encoded JSON of the local/remote SDP (`{type, sdp}`) so they survive copy/paste.
ICE: `stun:stun.l.google.com:19302` only, no TURN. Data channel label `game`, ordered/unreliable
not required.

## Message protocol (JSON)

- guest -> host: `{t:'input', a:'left'|'right'|'rotCW'|'rotCCW'|'softDrop'|'hardDrop'|'hold'}`
- host -> guest: `{t:'state', board:number[][], cur:{cells:number[][], kind:string}, next:string[],
  score:number, lines:number, level:number, queued:number, over:boolean}`
- host -> guest: `{t:'garbage', n:number}` (guest applies it to its own board)
- guest -> host: `{t:'garbage', n:number}`
- either side: `{t:'hello', name:string}`, `{t:'rematch'}`

## Input mapping

- Player 1: `A`/`D` move, `W` rotate CW, `Q` rotate CCW, `S` soft drop, `Space` hard drop, `Shift` hold
- Player 2: `←`/`→` move, `↑` rotate CW, `,` rotate CCW, `↓` soft drop, `.` hard drop, `/` hold

## Modes

- `local` — two boards side by side on one keyboard, independent games, no network
- `host` / `guest` — online 1v1, manual code exchange; guest sends inputs, host owns the simulation
  and streams state; garbage flows both ways; rematch button

## Mobile (phones, two players on separate devices)

- Responsive, **mobile-first**: below 900 px viewport width the layout collapses to a single column
  — the player's **own board large, the opponent's board small (scaled preview)** — and nothing may
  overflow horizontally. Desktop keeps the two-board side-by-side arena.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  `touch-action: manipulation` on the control buttons (no double-tap zoom), safe-area insets
  respected (`env(safe-area-inset-bottom)`).
- **Touch controls** as fixed bottom buttons, tap target ≥ 44×44 px, pointer events (not just click),
  with visual pressed feedback: `←`, `→`, `⟳` (rotCW), `⟲` (rotCCW), `↓` (softDrop), `⇓` (hardDrop),
  `HOLD`. Each dispatches exactly the same action as its keyboard equivalent. Keys keep working.
- **Host/touch split on phones:** in the online modes the *host* drives its own board with the
  touch controls; the *guest* sends its inputs over the wire (unchanged protocol).
- Signaling must be thumb-friendly: **"'Code teilen' via `navigator.share`** with a clipboard
  fallback, and a **"Einfügen"** button that reads `navigator.clipboard.readText()`; pasted codes are
  sanitized (all whitespace/newlines stripped) before use. Every code step is a single tap.
- Connectivity: `iceServers` = STUN **plus a public TURN fallback** (e.g.
  `turn:openrelay.metered.ca:443`, both `turn:` and `turns:`), so two phones on mobile networks can
  connect; if TURN is unreachable the game must still work on STUN-only paths and say so instead of
  hanging. ICE gathering timeout with a clear error message after ~15 s.

## Match end — "bis einer verliert"

- The match is over as soon as **one** player tops out. Both sides must show the same verdict:
  `You win 🏆` / `You lose`, plus the loser's final score, and a `Rematch` button that resets both
  boards for both players over the wire (works in `local`, `host` and `guest`).
- Engine API (add, keep everything else stable):
  `export function matchWinner(stateA, stateB) // -> 1 | 2 | 0 (0 = running)`.
- The dying player's board freezes; the winner's board stops accepting input too (match decided).
- Unit tests must cover: running match → 0, A over → 2, B over → 1, both over → 1 (first one wins /
  documented tie-break), and that `matchWinner` has no side effects.

## Start-Gate (Chunk D)

- Neither board drops a piece until both players have confirmed readiness.
- Readiness buttons `#btnReadyP1` and `#btnReadyP2` (local: both; host/guest: own player).
  Buttons show "Bereit ✓" and become disabled when ready.
- Once both ready: countdown 3 – 2 – 1 – GO! (each ~1 s, overlay), then simulation starts.
- Host runs and streams countdown via `{t:'lobby', ready1, ready2, countdown}`. Guest never starts
  simulation on its own.
- Rematch returns to Start-Gate with empty and still boards.

## lobby.js — pure state logic

```js
export function lobbyPhase({ connected, ready1, ready2, countdownStartedAt, now })
// -> 'idle' | 'waiting' | 'lobby' | 'countdown' | 'playing'
export function countdownValue(countdownStartedAt, now) // 3 | 2 | 1 | 0 ('GO')
```

## signal.js — room link pairing & vendored PeerJS

```js
export function makeRoomCode()            // 6 chars from safe alphabet (no O/0/I/1)
export function roomLink(code, baseUrl)   // -> '<baseUrl>#r=<CODE>'
export function parseRoomFromHash(hash)   // '#r=ABC123' -> 'ABC123' | null
export async function hostRoom(code, handlers)
export async function joinRoom(code, handlers)
export function closeRoom()
```

Vendored library: `vendor/peerjs.min.js` (PeerJS v1.5.5, MIT License).
Room links format: `#r=<CODE>`. When a guest navigates to a room link, pairing is automatic without
requiring manual code copying. Manual QR/SDP pairing (`#s=`, `#a=`) remains preserved as offline fallback.

Message protocol additions:
- host -> guest: `{t:'lobby', ready1:boolean, ready2:boolean, countdown:number|null, started?:boolean}`
- guest -> host: `{t:'ready', ready:boolean}`

