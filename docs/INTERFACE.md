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
