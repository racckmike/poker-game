# Mesa de Póker

Multiplayer Texas Hold'em in real time for family and friends. Virtual chips only. **No real money.**

Phase 1: a responsive web app (desktop, tablet and phone). The table layout follows Dad's handwritten sketch: an **Información** bar on top, the **Crupier** (dealer) at top centre with the deck, five community cards in the middle, and players 1–8 going clockwise with **Jugador 4 (Yo)** always at the bottom centre.

---

## Run it locally

Requires Node.js 20+ (built with Node 22).

```bash
npm install
npm run dev
```

- Game: http://localhost:5173
- Game server (Socket.IO): http://localhost:3001 (Vite forwards `/socket.io` to it)

### Play from other devices on the same Wi-Fi

`npm run dev` also prints a **Network** address, for example `http://10.0.0.12:5173`. Phones and laptops **on the same Wi-Fi network** can open that address. `localhost` only works on the machine that runs the server.

To play with people **outside your home**, either deploy it (see below) or open a temporary tunnel:

```bash
npx cloudflared tunnel --url http://localhost:5173
```

### Production mode (one port)

```bash
npm run build
npm start          # serves the game and the server on http://localhost:3001 (or $PORT)
```

### Testing alone

You can fill a room with bots that play randomly:

```bash
npx tsx scripts/bots.ts POKER-XXXXXX 3
```

---

## How a match works

1. Open the site → type your name → **Crear partida**. You get a code such as `POKER-7KQ3M9`.
2. Others open the site → **Unirse a una partida** → type the code.
3. In the lobby each player taps **Estoy listo**. The host chooses starting chips, blinds and time per turn.
4. With **2 to 8 players**, everyone ready, the host taps **Empezar partida**.
5. Hands follow one after another automatically (6 s pause to see the winner). When one player has all the chips, the match ends and the host can start **Jugar otra partida**.

---

## Architecture

```text
poker-game/
├── apps/
│   ├── web/          React 19 + Vite + Tailwind 4 + Motion + Zustand (UI only)
│   └── server/       Node + Express 5 + Socket.IO (rooms, sessions, timers)
├── packages/
│   ├── game-engine/  Pure TypeScript Hold'em engine, with no UI or network code
│   └── shared/       Types and Socket.IO contracts shared by every layer
├── tests/            Engine unit tests + real multiplayer integration tests
└── scripts/bots.ts   Bots for local testing
```

- **The server is authoritative.** The client only sends intentions (`fold`, `call`, `raise 120`…). The engine validates everything, deals, computes pots and picks winners. The client never computes chips or results.
- **Private cards.** Each player receives a state built just for them (`HoldemGame.snapshot(viewerId)`). Opponents' cards travel as `null` until a showdown. The deck never leaves the server.
- **Future native app.** `game-engine` and `shared` don't depend on the browser. A React Native app would only need a new client that speaks the same Socket.IO contracts (`packages/shared/src/index.ts`).
- **Other variants.** `HoldemGame` keeps the variant-specific parts (number of hole cards, `bestHand`) in overridable methods. Betting, pots, side pots, turns and blinds are shared. Omaha, for example, would be a subclass.

### Game rules implemented

Blinds (with heads-up rules: the button posts the small blind and acts first preflop) · button rotation · minimum raise · incomplete all-in that **does not** reopen betting · burned cards · flop/turn/river · automatic run-out when everyone is all-in · side pots with dead money · ties and splits with the odd chip going to the first winner left of the button · win when everyone folds · players with no chips sit out · leaving mid-hand counts as a fold. Hand ranking from royal flush down to high card, with kickers.

### Security

| Threat | Protection |
|---|---|
| Seeing other players' cards | Per-player state; opponents' cards sent as `null` (covered by tests) |
| Changing chips from DevTools | All chips live on the server; the client only sends actions |
| Acting out of turn / illegal action | The engine validates turn, legality and amount (integers within the range) |
| Double-clicks / duplicate requests | Every action carries the state `version`; a stale one is rejected |
| Guessing room codes | 6 characters from a 32-symbol alphabet (~1 billion combinations) + 60 joins/min limit per IP |
| Taking someone else's seat | Random 192-bit session token, compared in constant time and never broadcast |
| Spam | Limit of ~6 events/s per connection; input sanitised (names, codes, settings) |
| Shuffling | Fisher–Yates with `crypto.getRandomValues` and rejection sampling (no modulo bias) |

### Disconnections

| Situation | Rule |
|---|---|
| Lose connection or close the tab | The seat and chips are kept for **2 minutes** (`RECONNECT_GRACE_MS`) |
| Your turn comes while you're disconnected | Auto-play after **8 s** (`DISCONNECTED_TURN_MS`): check if free, otherwise fold |
| Your turn comes while you're connected | Configurable timer (20–60 s, default 30); when it runs out: check or fold |
| New hands while you're away | You're dealt out (no blinds taken) until you return |
| You come back | Reopening the page reconnects you automatically (token stored in the browser) |
| 2 minutes go by | Your seat is freed; if you were in a hand, it counts as a fold |
| You open the game in another tab | The new tab takes over; the old one is disconnected |

---

## Tests

```bash
npm test
```

- `tests/engine.test.ts` (28 tests): deck integrity, uniform shuffle, unique cards for 8 players, every hand ranking, kickers, wheel straight (A-2-3-4-5), side pots, multiple all-ins, ties and odd chip, minimum raise, incomplete all-in, turn order, blind rotation, heads-up, short stacks, players leaving mid-hand, illegal actions, private cards, plus a **random simulation of ~1,200 hands** that checks chip conservation after every action.
- `tests/multiplayer.test.ts` (7 tests): a real server with 4 Socket.IO clients playing 8 consecutive hands. It checks that nobody sees other players' cards in any message, that chips add up in every state, that out-of-turn and duplicate actions are rejected, reconnection with a valid token only, the seat being freed after the grace period, auto-fold when disconnected, the 4-player minimum and rate limiting.

---

## Provisional assumptions (to confirm with Dad)

Confirmed by Dad (2026-11-20): **virtual chips**, **automatic dealer**, **Texas Hold'em**.

| Topic | Current decision | Where to change it |
|---|---|---|
| Variant | Texas Hold'em ✅ confirmed | `packages/game-engine` (subclass `HoldemGame`) |
| Players | 2 to 8 | `MIN_PLAYERS` / `MAX_PLAYERS` in `packages/shared` |
| Decks | **A single 52-card deck** | see note below |
| Chips | ✅ Virtual (confirmed): 1,000 to start, blinds 5/10 (editable in the lobby) | `DEFAULT_SETTINGS` |
| Rooms | Private with a code; no accounts, name only | — |
| Language | Spanish | interface texts |
| Card showing | All cards are shown automatically at showdown; whoever wins because everyone folded can choose **Mostrar mis cartas** | `HoldemGame.show` |
| Turn time | 30 s by default | lobby |

**Note on decks:** Dad mentioned adapting "the number of decks depending on the number of players." International Texas Hold'em uses **a single deck** for up to 22 players (8 players use 21 cards), and with two decks there would be repeated cards and impossible hands. That's why it uses one deck. If he means another variant, it can be added.

## Known limitations

- **Games live in memory.** If the server restarts (a deploy or a crash), open rooms are lost. For a family game this is acceptable; the next step would be saving state to Redis or a database.
- A single server instance (no horizontal scaling).
- No chat, sounds, accounts, statistics or rebuys (left for later, as the brief says).
- The dealer is a badge with a deck and messages, not an animated character.

## Deployment

The project is **prepared** to deploy as a single service, but **it is not deployed**.

**Render / Railway / Fly.io (Node):**
- Build: `npm install && npm run build`
- Start: `npm start`
- The platform sets `PORT`. It needs WebSocket support (all three have it).

**Docker:**

```bash
docker build -t mesa-de-poker .
docker run -p 3001:3001 mesa-de-poker
```

Optional variables: `PORT`, `RECONNECT_GRACE_MS`, `NEXT_HAND_DELAY_MS`, `DISCONNECTED_TURN_MS`, `JOINS_PER_MINUTE`, `CORS_ORIGIN` (only if the web app is served from another domain).
