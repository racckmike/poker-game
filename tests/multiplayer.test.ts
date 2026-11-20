import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Session, TableView } from '@poker/shared';
import { startServer, type PokerServer } from '../apps/server/src/server.js';

let server: PokerServer;
let url: string;

beforeAll(async () => {
  server = await startServer({ port: 0, staticDir: '/nonexistent', joinsPerMinute: 1000, eventsPerSecond: 1000, timing: { nextHandDelayMs: 30, reconnectGraceMs: 400, disconnectedTurnMs: 100 } });
  url = `http://localhost:${server.port}`;
});
afterAll(async () => server.close());

class Client {
  socket: Socket;
  state: TableView | null = null;
  session: Session | null = null;
  states: TableView[] = [];
  constructor() {
    this.socket = io(url, { transports: ['websocket'], forceNew: true });
    this.socket.on('state', (s: TableView) => {
      this.state = s;
      this.states.push(s);
    });
  }
  async call<T = unknown>(event: string, payload?: unknown): Promise<T> {
    const res = (await (payload === undefined
      ? this.socket.timeout(3000).emitWithAck(event)
      : this.socket.timeout(3000).emitWithAck(event, payload))) as { ok: boolean; data?: T; error?: string };
    if (!res.ok) throw new Error(res.error);
    return res.data as T;
  }
  close() {
    this.socket.disconnect();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await sleep(5);
  }
}

async function setupRoom(n: number) {
  const clients = Array.from({ length: n }, () => new Client());
  const host = clients[0];
  host.session = await host.call<Session>('room:create', { name: 'Papá' });
  for (let i = 1; i < n; i++) {
    clients[i].session = await clients[i].call<Session>('room:join', { name: `Jugador${i}`, roomCode: host.session.roomCode.replace('POKER-', '').toLowerCase() });
    await clients[i].call('lobby:ready', { ready: true });
  }
  await until(() => clients.every((c) => c.state?.players.length === n));
  return clients;
}

describe('multiplayer server', () => {
  it('someone joining while a leaver still sits in the hand gets a free seat and is dealt in next hand', async () => {
    const clients = await setupRoom(3);
    await clients[0].call('game:start');
    await until(() => clients.every((c) => c.state?.handNumber === 1));
    const leaver = clients[2];
    const leaverSeat = leaver.state!.players.find((p) => p.id === leaver.session!.playerId)!.seat;
    await leaver.call('room:leave');
    const late = new Client();
    late.session = await late.call<Session>('room:join', { name: 'Tarde', roomCode: clients[0].session!.roomCode });
    await until(() => !!late.state);
    const lateSeat = late.state!.players.find((p) => p.id === late.session!.playerId)!.seat;
    expect(lateSeat).not.toBe(leaverSeat);
    // Play on (always the cheapest move) until the newcomer is dealt cards.
    const table = [clients[0], clients[1], late];
    for (let i = 0; i < 400 && !late.state!.players.find((p) => p.id === late.session!.playerId)!.cards; i++) {
      const actor = table.find((c) => c.state?.legal && c.state.toActId === c.session!.playerId);
      if (actor) await actor.call('game:action', { action: { type: actor.state!.legal!.check ? 'check' : 'fold' }, version: actor.state!.version }).catch(() => {});
      await sleep(10);
    }
    expect(late.state!.players.find((p) => p.id === late.session!.playerId)!.cards).not.toBeNull();
    [...table, leaver].forEach((c) => c.close());
  });

  it('relays WebRTC signals only inside the room and shares cam/mic state', async () => {
    const [a, b] = await setupRoom(2);
    const outsider = new Client();
    outsider.session = await outsider.call<Session>('room:create', { name: 'Fuera' });
    const got: { from: string; data: unknown }[] = [];
    b.socket.on('rtc:signal', (m: { from: string; data: unknown }) => got.push(m));
    a.socket.emit('rtc:signal', { to: b.session!.playerId, data: { kind: 'offer', sdp: 'x', rtc: 1 } });
    outsider.socket.emit('rtc:signal', { to: b.session!.playerId, data: { kind: 'offer', sdp: 'evil', rtc: 1 } });
    a.socket.emit('rtc:signal', { to: b.session!.playerId, data: { kind: 'bogus' } });
    await until(() => got.length >= 1);
    await sleep(50);
    expect(got).toEqual([{ from: a.session!.playerId, data: { kind: 'offer', sdp: 'x', rtc: 1 } }]);

    await a.call('media:state', { cam: true, mic: false });
    await until(() => !!b.state?.players.find((p) => p.id === a.session!.playerId)?.cam);
    expect(b.state!.players.find((p) => p.id === a.session!.playerId)!.mic).toBe(false);
    [a, b, outsider].forEach((c) => c.close());
  });

  it('a lobby/connection change does not void a pending action', async () => {
    const clients = await setupRoom(4);
    await clients[0].call('game:start');
    await until(() => clients.some((c) => c.state?.legal && c.state.toActId === c.session!.playerId));
    const actor = clients.find((c) => c.state?.legal && c.state.toActId === c.session!.playerId)!;
    const v = actor.state!.version;
    const other = clients.find((c) => c !== actor && c !== clients[0])!;
    await other.call('lobby:ready', { ready: false });
    await until(() => actor.states.filter((s) => s.version === v).length > 1);
    await actor.call('game:action', { action: { type: 'fold' }, version: v });
    clients.forEach((c) => c.close());
  });

  it('rate-limits room creation per IP', async () => {
    const small = await startServer({ port: 0, staticDir: '/nonexistent', joinsPerMinute: 3 });
    const c = io(`http://localhost:${small.port}`, { transports: ['websocket'], forceNew: true });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(((await c.timeout(2000).emitWithAck('room:create', { name: `N${i}` })) as { ok: boolean }).ok);
    expect(results).toEqual([true, true, true, false, false]);
    c.disconnect();
    await small.close();
  });

  it('rejects bad input and unknown rooms', async () => {
    const c = new Client();
    await expect(c.call('room:join', { name: 'X', roomCode: 'POKER-ZZZZZZ' })).rejects.toThrow(/No encontramos/);
    await expect(c.call('room:create', { name: '' })).rejects.toThrow(/nombre/);
    await expect(c.call('room:create', { name: 'x'.repeat(40) })).rejects.toThrow(/nombre/);
    await expect(c.call('game:action', { action: { type: 'check' }, version: 0 })).rejects.toThrow(/ninguna sala/);
    await expect(c.call('room:resume', { roomCode: 'POKER-ZZZZZZ', token: 'nope' })).rejects.toThrow();
    c.close();
  });

  it('needs two players to start, and two are enough', async () => {
    const [solo] = await setupRoom(1);
    await expect(solo.call('game:start')).rejects.toThrow(/al menos 2/);
    solo.close();
    const clients = await setupRoom(2);
    await expect(clients[1].call('game:start')).rejects.toThrow(/anfitrión/);
    await clients[0].call('game:start');
    await until(() => clients.every((c) => c.state?.phase === 'playing' && c.state.handNumber === 1));
    clients.forEach((c) => c.close());
  });

  it('plays many consecutive hands with private cards and conserved chips', async () => {
    const clients = await setupRoom(4);
    const [host] = clients;
    expect(host.state!.roomCode).toMatch(/^POKER-[A-Z2-9]{6}$/);
    await host.call('game:start');
    await until(() => clients.every((c) => c.state?.phase === 'playing' && c.state.handNumber >= 1));

    // Session tokens are never broadcast.
    for (const c of clients) for (const s of c.states) expect(JSON.stringify(s)).not.toContain(c.session!.token);

    const TARGET_HANDS = 8;
    let actions = 0;
    let rejectedOutOfTurn = false;
    let rejectedDuplicate = false;

    while (clients[0].state!.handNumber <= TARGET_HANDS && clients[0].state!.phase === 'playing') {
      const actor = clients.find((c) => c.state?.legal && c.state.toActId === c.session!.playerId);
      if (!actor) {
        await sleep(5);
        continue;
      }
      const s = actor.state!;
      const legal = s.legal!;

      if (!rejectedOutOfTurn) {
        const other = clients.find((c) => c !== actor)!;
        await expect(other.call('game:action', { action: { type: 'fold' }, version: other.state!.version })).rejects.toThrow();
        rejectedOutOfTurn = true;
      }

      const pick = actions % 7;
      const action =
        pick === 0 && legal.raise ? { type: 'raise', amount: legal.raise.min } :
        pick === 1 && legal.bet ? { type: 'bet', amount: legal.bet.min } :
        pick === 2 && legal.fold ? { type: 'fold' } :
        legal.check ? { type: 'check' } : { type: 'call' };
      await actor.call('game:action', { action, version: s.version });
      actions++;

      if (!rejectedDuplicate) {
        // Same request again with the old version must be rejected.
        await expect(actor.call('game:action', { action, version: s.version })).rejects.toThrow();
        rejectedDuplicate = true;
      }
      await until(() => clients.every((c) => c.state!.version > s.version));
    }

    expect(actions).toBeGreaterThan(10);
    expect(rejectedOutOfTurn && rejectedDuplicate).toBe(true);

    // Every state each client ever received: only their own hole cards are visible, except at showdown.
    for (const c of clients) {
      for (const st of c.states) {
        for (const p of st.players) {
          if (p.id === c.session!.playerId || !p.cards) continue;
          if (st.street !== 'complete') expect(p.cards.every((x) => x === null)).toBe(true);
        }
        // Chip conservation: stacks + chips in the middle always equal 4 × 1000.
        if (st.phase === 'playing' && st.street !== 'complete') {
          const sum = st.players.reduce((a, p) => a + p.stack, 0) + st.totalPot;
          expect(sum).toBe(4000);
        }
      }
    }
    // All clients agree on the public state.
    const last = clients.map((c) => c.state!);
    expect(new Set(last.map((s) => s.version)).size).toBe(1);
    expect(new Set(last.map((s) => JSON.stringify(s.board))).size).toBe(1);
    clients.forEach((c) => c.close());
  });

  it('lets a disconnected player reclaim their seat with the session token only', async () => {
    const clients = await setupRoom(4);
    await clients[0].call('game:start');
    await until(() => clients[2].state?.handNumber === 1);
    const victim = clients[2];
    const { roomCode, token, playerId } = victim.session!;
    const stackBefore = victim.state!.players.find((p) => p.id === playerId)!.stack;
    victim.close();
    await until(() => clients[0].state!.players.find((p) => p.id === playerId)!.connected === false);

    // A stranger can't take the seat with a wrong token.
    const intruder = new Client();
    await expect(intruder.call('room:resume', { roomCode, token: token.slice(0, -2) + 'xx' })).rejects.toThrow();

    const back = new Client();
    const s = await back.call<Session>('room:resume', { roomCode, token });
    expect(s.playerId).toBe(playerId);
    await until(() => !!back.state);
    const me = back.state!.players.find((p) => p.id === playerId)!;
    expect(me.connected).toBe(true);
    expect(me.seat).toBe(2);
    expect(me.stack).toBeLessThanOrEqual(stackBefore);
    intruder.close();
    [...clients, back].forEach((c) => c.close());
  });

  it('frees the seat after the reconnection grace period', async () => {
    const clients = await setupRoom(4);
    const gone = clients[3];
    const id = gone.session!.playerId;
    gone.close();
    await until(() => !clients[0].state!.players.some((p) => p.id === id), 3000);
    expect(clients[0].state!.players).toHaveLength(3);
    clients.forEach((c) => c.close());
  });

  it('auto-folds a disconnected player on their turn so the game continues', async () => {
    const clients = await setupRoom(4);
    await clients[0].call('game:start');
    await until(() => !!clients[0].state?.toActId);
    const actorId = clients[0].state!.toActId!;
    const actor = clients.find((c) => c.session!.playerId === actorId)!;
    actor.close();
    await until(() => clients.find((c) => c !== actor)!.state!.toActId !== actorId, 3000);
    clients.forEach((c) => c.close());
  });
});
