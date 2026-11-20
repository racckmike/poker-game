import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Ack, ActionType, ClientToServer, PlayerAction, ServerToClient, Session } from '@poker/shared';
import { DEFAULT_TIMING, Room, UserError, newRoomCode, type Timing } from './rooms.js';

type PokerSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, { roomCode?: string; playerId?: string }>;

const ACTION_TYPES: ActionType[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

export interface PokerServer {
  port: number;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export async function startServer(opts: { port?: number; timing?: Partial<Timing>; staticDir?: string; joinsPerMinute?: number; eventsPerSecond?: number } = {}): Promise<PokerServer> {
  const timing = { ...DEFAULT_TIMING, ...opts.timing };
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const staticDir = opts.staticDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: '1h', index: false }));
    app.get(/.*/, (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }

  const http: HttpServer = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
    maxHttpBufferSize: 10_000,
  });

  const rooms = new Map<string, Room>();
  const joinLimiter = new SlidingWindow(opts.joinsPerMinute ?? Number(process.env.JOINS_PER_MINUTE ?? 60), 60_000);

  const makeRoom = () => {
    let code = newRoomCode();
    while (rooms.has(code)) code = newRoomCode();
    const room = new Room(code, (sid, view) => io.to(sid).emit('state', view), timing, (r) => rooms.delete(r.code));
    rooms.set(code, room);
    return room;
  };

  io.on('connection', (socket: PokerSocket) => {
    const ip = (socket.handshake.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || socket.handshake.address;
    const bucket = new TokenBucket(12, opts.eventsPerSecond ?? 6); // burst 12, 6 events/s sustained

    const current = () => {
      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      const id = socket.data.playerId;
      if (!room || !id || !room.members.has(id)) throw new UserError('No estás en ninguna sala');
      return { room, id };
    };

    const bind = (room: Room, memberId: string): Session => {
      const m = room.members.get(memberId)!;
      if (socket.data.roomCode && socket.data.roomCode !== room.code) leaveCurrent(false);
      socket.data.roomCode = room.code;
      socket.data.playerId = m.id;
      const old = room.attach(m, socket.id);
      if (old) {
        io.to(old).emit('kicked', 'Abriste esta partida en otra ventana');
        io.in(old).disconnectSockets(true);
      }
      return { roomCode: room.code, playerId: m.id, token: m.token };
    };

    const leaveCurrent = (explicit: boolean) => {
      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      const m = room && socket.data.playerId ? room.members.get(socket.data.playerId) : undefined;
      if (room && m) explicit ? room.removeMember(m.id) : room.detach(m, socket.id);
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
    };

    /** Wraps a handler: rate limit, error mapping, always ack exactly once. */
    function handle<A extends unknown[], T>(fn: (...args: A) => T) {
      return (...args: [...A, Ack<T>]) => {
        const ack = args[args.length - 1];
        const reply: Ack<T> = typeof ack === 'function' ? (ack as Ack<T>) : () => {};
        if (!bucket.take()) return reply({ ok: false, error: 'Demasiadas solicitudes, espera un momento' });
        try {
          reply({ ok: true, data: fn(...(args.slice(0, -1) as A)) });
        } catch (e) {
          if (e instanceof UserError) return reply({ ok: false, error: e.message });
          console.error(e);
          reply({ ok: false, error: 'Error inesperado del servidor' });
        }
      };
    }

    socket.on('room:create', handle((p: { name: string }) => {
      if (!joinLimiter.hit(ip)) throw new UserError('Demasiados intentos, espera un minuto');
      const name = cleanName(p?.name);
      const room = makeRoom();
      const m = room.addMember(name);
      return bind(room, m.id);
    }));

    socket.on('room:join', handle((p: { name: string; roomCode: string }) => {
      if (!joinLimiter.hit(ip)) throw new UserError('Demasiados intentos, espera un minuto');
      const name = cleanName(p?.name);
      const room = rooms.get(normalizeCode(p?.roomCode));
      if (!room) throw new UserError('No encontramos esa sala. Revisa el código.');
      const m = room.addMember(name);
      return bind(room, m.id);
    }));

    socket.on('room:resume', handle((p: { roomCode: string; token: string }) => {
      if (!joinLimiter.hit(ip)) throw new UserError('Demasiados intentos, espera un minuto');
      const room = rooms.get(normalizeCode(p?.roomCode));
      const m = room && typeof p?.token === 'string' ? room.memberByToken(p.token) : undefined;
      if (!room || !m) throw new UserError('Tu lugar en la sala ya no existe');
      return bind(room, m.id);
    }));

    socket.on('room:leave', handle(() => {
      leaveCurrent(true);
      return null;
    }));

    socket.on('lobby:ready', handle((p: { ready: boolean }) => {
      const { room, id } = current();
      room.setReady(id, p?.ready === true);
      return null;
    }));

    socket.on('lobby:settings', handle((p: Record<string, unknown>) => {
      const { room, id } = current();
      if (!p || typeof p !== 'object') throw new UserError('Configuración inválida');
      room.updateSettings(id, {
        startingStack: p.startingStack as number | undefined,
        bigBlind: p.bigBlind as number | undefined,
        turnSeconds: p.turnSeconds as number | undefined,
      });
      return null;
    }));

    socket.on('game:start', handle(() => {
      const { room, id } = current();
      room.start(id);
      return null;
    }));

    socket.on('game:action', handle((p: { action: PlayerAction; version: number }) => {
      const { room, id } = current();
      const a = p?.action;
      if (!a || !ACTION_TYPES.includes(a.type)) throw new UserError('Acción inválida');
      if (a.amount !== undefined && !Number.isSafeInteger(a.amount)) throw new UserError('Cantidad inválida');
      if (!Number.isSafeInteger(p.version)) throw new UserError('Versión inválida');
      room.act(id, { type: a.type, amount: a.amount }, p.version);
      return null;
    }));

    socket.on('game:show', handle(() => {
      const { room, id } = current();
      room.show(id);
      return null;
    }));

    socket.on('game:restart', handle(() => {
      const { room, id } = current();
      room.restart(id);
      return null;
    }));

    socket.on('disconnect', () => leaveCurrent(false));
  });

  await new Promise<void>((r) => http.listen(opts.port ?? 0, r));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    port,
    rooms,
    close: async () => {
      for (const r of rooms.values()) r.dispose();
      io.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw new UserError('Escribe tu nombre');
  // Strip control characters and collapse whitespace.
  const name = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 16) throw new UserError('El nombre debe tener entre 1 y 16 caracteres');
  return name;
}

export function normalizeCode(v: unknown): string {
  if (typeof v !== 'string') return '';
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^POKER/, '');
  return raw.length === 6 ? `POKER-${raw}` : '';
}

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private perSecond: number) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class SlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  hit(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.hits.clear(); // shortcut: crude memory cap, fine for a family-sized server
    return true;
  }
}
