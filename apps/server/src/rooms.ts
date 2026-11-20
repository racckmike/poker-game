import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EngineError, HoldemGame } from '@poker/game-engine';
import {
  DEFAULT_SETTINGS, HAND_NAMES_ES, MAX_PLAYERS, MIN_PLAYERS,
  type PlayerAction, type RoomPhase, type RoomSettings, type TableView, type WinnerView,
} from '@poker/shared';

export interface Timing {
  /** How long a disconnected player keeps their seat. */
  reconnectGraceMs: number;
  /** Pause between hands so everyone can see the result. */
  nextHandDelayMs: number;
  /** Turn time for a player who is currently disconnected. */
  disconnectedTurnMs: number;
}

export const DEFAULT_TIMING: Timing = {
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 120_000),
  nextHandDelayMs: Number(process.env.NEXT_HAND_DELAY_MS ?? 6_000),
  disconnectedTurnMs: Number(process.env.DISCONNECTED_TURN_MS ?? 8_000),
};

export class UserError extends Error {}

interface Member {
  id: string;
  name: string;
  token: string;
  seat: number;
  ready: boolean;
  socketId: string | null;
  disconnectTimer: NodeJS.Timeout | null;
  cam: boolean;
  mic: boolean;
  rtc: number;
}

type Emit = (socketId: string, view: TableView) => void;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function newRoomCode(): string {
  let s = 'POKER-';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export class Room {
  phase: RoomPhase = 'lobby';
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  hostId = '';
  members = new Map<string, Member>();
  game: HoldemGame | null = null;
  version = 0;
  champion: string | null = null;
  turnDeadline: number | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private nextHandTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly code: string,
    private readonly emit: Emit,
    private readonly timing: Timing,
    private readonly onEmpty: (room: Room) => void,
  ) {}

  // ---------- membership ----------

  addMember(name: string): Member {
    if (this.members.size >= MAX_PLAYERS) throw new UserError('La sala está llena (máximo 8 jugadores)');
    if ([...this.members.values()].some((m) => m.name.toLowerCase() === name.toLowerCase()))
      throw new UserError('Ese nombre ya está en uso en esta sala');
    // A player who left mid-hand keeps their seat in the game until the hand ends.
    const used = new Set([...this.members.values()].map((m) => m.seat).concat(this.game?.players.map((p) => p.seat) ?? []));
    let seat = 0;
    while (used.has(seat)) seat++;
    const m: Member = { id: randomUUID(), name, token: randomBytes(24).toString('base64url'), seat, ready: false, socketId: null, disconnectTimer: null, cam: false, mic: false, rtc: 0 };
    this.members.set(m.id, m);
    if (!this.hostId) this.hostId = m.id;
    // Late joiners sit down with a fresh stack and play from the next hand.
    if (this.game) this.game.addPlayer(m.id, m.name, m.seat, this.settings.startingStack);
    this.changed();
    return m;
  }

  memberByToken(token: string): Member | undefined {
    for (const m of this.members.values()) if (safeEqual(m.token, token)) return m;
    return undefined;
  }

  attach(m: Member, socketId: string): string | null {
    const previous = m.socketId;
    m.socketId = socketId;
    m.rtc++;
    m.cam = m.mic = false; // a new connection starts with media off until the client re-announces it
    if (m.disconnectTimer) clearTimeout(m.disconnectTimer);
    m.disconnectTimer = null;
    if (this.game?.players.some((p) => p.id === m.id)) this.game.setSittingOut(m.id, false);
    // Back in time for their own turn: give them the normal turn time instead of the short disconnected one.
    if (this.game?.toActId === m.id) this.scheduleTurnTimer();
    this.changed();
    this.maybeContinue();
    return previous && previous !== socketId ? previous : null;
  }

  detach(m: Member, socketId: string): void {
    if (m.socketId !== socketId) return; // an older socket closing after a resume
    m.socketId = null;
    m.cam = m.mic = false;
    // Keep the seat, but don't deal them into new hands until they're back.
    if (this.game?.players.some((p) => p.id === m.id)) this.game.setSittingOut(m.id, true);
    m.disconnectTimer = setTimeout(() => this.removeMember(m.id), this.timing.reconnectGraceMs);
    if (this.game?.toActId === m.id) this.scheduleTurnTimer();
    this.changed();
  }

  removeMember(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (m.disconnectTimer) clearTimeout(m.disconnectTimer);
    this.members.delete(id);
    if (this.game?.players.some((p) => p.id === id)) {
      this.game.removePlayer(id);
      this.afterGameChange();
    }
    if (this.hostId === id) this.hostId = [...this.members.values()][0]?.id ?? '';
    if (this.members.size === 0) {
      this.dispose();
      this.onEmpty(this);
      return;
    }
    if (this.phase === 'playing' && this.game && !this.game.isBetting()) this.maybeContinue();
    this.changed();
  }

  setMedia(id: string, cam: boolean, mic: boolean): void {
    const m = this.requireMember(id);
    m.cam = cam;
    m.mic = mic;
    this.changed();
  }

  // ---------- lobby ----------

  setReady(id: string, ready: boolean): void {
    this.requireMember(id).ready = ready;
    this.changed();
  }

  updateSettings(id: string, patch: Partial<RoomSettings>): void {
    if (id !== this.hostId) throw new UserError('Solo el anfitrión puede cambiar la configuración');
    if (this.phase !== 'lobby') throw new UserError('La partida ya empezó');
    const next = { ...this.settings };
    if (patch.startingStack !== undefined) next.startingStack = intIn(patch.startingStack, 100, 1_000_000, 'Fichas iniciales');
    if (patch.bigBlind !== undefined) {
      next.bigBlind = intIn(patch.bigBlind, 2, 100_000, 'Ciega grande');
      next.smallBlind = Math.max(1, Math.floor(next.bigBlind / 2));
    }
    if (patch.turnSeconds !== undefined) next.turnSeconds = intIn(patch.turnSeconds, 10, 180, 'Tiempo por turno');
    if (next.bigBlind * 10 > next.startingStack) throw new UserError('Las fichas iniciales deben ser al menos 10 ciegas grandes');
    this.settings = next;
    this.changed();
  }

  start(id: string): void {
    if (id !== this.hostId) throw new UserError('Solo el anfitrión puede iniciar la partida');
    if (this.phase !== 'lobby') throw new UserError('La partida ya empezó');
    if (this.members.size < MIN_PLAYERS) throw new UserError(`Se necesitan al menos ${MIN_PLAYERS} jugadores`);
    const notReady = [...this.members.values()].filter((m) => m.id !== this.hostId && !m.ready);
    if (notReady.length) throw new UserError(`Faltan por estar listos: ${notReady.map((m) => m.name).join(', ')}`);
    this.newGame();
  }

  restart(id: string): void {
    if (id !== this.hostId) throw new UserError('Solo el anfitrión puede reiniciar');
    if (this.phase !== 'finished') throw new UserError('La partida sigue en curso');
    if ([...this.members.values()].length < 2) throw new UserError('Se necesitan al menos 2 jugadores');
    this.newGame();
  }

  private newGame(): void {
    const game = new HoldemGame({ smallBlind: this.settings.smallBlind, bigBlind: this.settings.bigBlind });
    for (const m of this.members.values()) {
      game.addPlayer(m.id, m.name, m.seat, this.settings.startingStack);
      if (!m.socketId) game.setSittingOut(m.id, true);
    }
    this.game = game;
    this.phase = 'playing';
    this.champion = null;
    this.startHand();
  }

  // ---------- game ----------

  act(id: string, action: PlayerAction, version: number): void {
    const game = this.requireGame();
    if (version !== this.version) throw new UserError('La mesa cambió, inténtalo de nuevo');
    try {
      game.act(id, action);
    } catch (e) {
      if (e instanceof EngineError) throw new UserError(e.message);
      throw e;
    }
    this.afterGameChange();
  }

  show(id: string): void {
    try {
      this.requireGame().show(id);
    } catch (e) {
      if (e instanceof EngineError) throw new UserError(e.message);
      throw e;
    }
    this.changed();
  }

  private startHand(): void {
    const game = this.requireGame();
    game.startHand();
    this.afterGameChange();
  }

  private afterGameChange(): void {
    const game = this.game!;
    // Only game moves bump the version, so a reconnect or "ready" toggle never voids a valid click.
    this.version++;
    if (game.isBetting()) this.scheduleTurnTimer();
    else {
      this.clearTurnTimer();
      if (game.street === 'complete' && !this.nextHandTimer) {
        this.nextHandTimer = setTimeout(() => {
          this.nextHandTimer = null;
          this.maybeContinue();
        }, this.timing.nextHandDelayMs);
      }
    }
    this.changed();
  }

  /** Starts the next hand if possible, or ends the match. */
  private maybeContinue(): void {
    const game = this.game;
    if (this.phase !== 'playing' || !game || game.isBetting() || this.nextHandTimer) return;
    if (game.canStartHand()) return this.startHand();
    const withChips = game.players.filter((p) => p.stack > 0);
    if (withChips.length <= 1) {
      this.phase = 'finished';
      this.champion = withChips[0]?.name ?? null;
      this.changed();
    }
    // Otherwise we are waiting for disconnected players to come back.
  }

  private scheduleTurnTimer(): void {
    this.clearTurnTimer();
    const id = this.game?.toActId;
    if (!id) return;
    const connected = !!this.members.get(id)?.socketId;
    const ms = connected ? this.settings.turnSeconds * 1000 : this.timing.disconnectedTurnMs;
    this.turnDeadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      const game = this.game;
      if (!game || game.toActId !== id) return;
      game.autoAct(id);
      this.afterGameChange();
    }, ms);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
  }

  dispose(): void {
    this.clearTurnTimer();
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
    this.nextHandTimer = null;
    for (const m of this.members.values()) if (m.disconnectTimer) clearTimeout(m.disconnectTimer);
  }

  // ---------- views ----------

  private changed(): void {
    for (const m of this.members.values()) if (m.socketId) this.emit(m.socketId, this.viewFor(m.id));
  }

  viewFor(viewerId: string): TableView {
    const game = this.game;
    const seats = game ? game.snapshot(viewerId) : [];
    const players = [...this.members.values()].map((m) => {
      const s = seats.find((x) => x.id === m.id);
      return {
        id: m.id,
        name: m.name,
        seat: m.seat,
        stack: s?.stack ?? this.settings.startingStack,
        committed: s?.committed ?? 0,
        status: s?.status ?? 'waiting',
        connected: !!m.socketId,
        isHost: m.id === this.hostId,
        ready: m.ready || m.id === this.hostId,
        isButton: s?.isButton ?? false,
        isSmallBlind: s?.isSmallBlind ?? false,
        isBigBlind: s?.isBigBlind ?? false,
        cards: s?.cards ?? null,
        lastAction: s?.lastAction ?? null,
        cam: m.cam,
        mic: m.mic,
        rtc: m.rtc,
      };
    });
    const nameOf = (id: string) => this.members.get(id)?.name ?? game?.players.find((p) => p.id === id)?.name ?? '—';
    const winners: WinnerView[] | null = game?.street === 'complete' && game.winners
      ? game.winners.map((w) => ({
          playerId: w.playerId,
          name: nameOf(w.playerId),
          amount: w.amount,
          hand: w.hand && { category: w.hand.category, name: HAND_NAMES_ES[w.hand.category], cards: w.hand.cards },
        }))
      : null;
    const pots = game?.street === 'complete' ? game.finalPots ?? [] : game ? [{ amount: game.potTotal(), eligible: [] }] : [];

    return {
      roomCode: this.code,
      phase: this.phase,
      hostId: this.hostId,
      youId: viewerId,
      settings: this.settings,
      players,
      handNumber: game?.handNumber ?? 0,
      street: game?.street ?? 'idle',
      board: game?.board ?? [],
      pots,
      totalPot: pots.reduce((s, p) => s + p.amount, 0),
      toActId: game?.toActId ?? null,
      turnDeadline: game?.toActId ? this.turnDeadline : null,
      serverNow: Date.now(),
      legal: game?.legalActions(viewerId) ?? null,
      winners,
      dealerMessage: this.dealerMessage(),
      version: this.version,
      champion: this.champion,
    };
  }

  private dealerMessage(): string {
    if (this.phase === 'lobby') {
      const n = this.members.size;
      return n < MIN_PLAYERS ? `Esperando jugadores (${n}/${MIN_PLAYERS})` : 'Listos para empezar';
    }
    if (this.phase === 'finished') return this.champion ? `¡${this.champion} gana la partida!` : 'Partida terminada';
    const game = this.game!;
    if (!game.isBetting() && game.street !== 'complete') return 'Esperando a que vuelvan los jugadores…';
    return game.lastEvent;
  }

  // ---------- helpers ----------

  private requireMember(id: string): Member {
    const m = this.members.get(id);
    if (!m) throw new UserError('No estás en esta sala');
    return m;
  }

  private requireGame(): HoldemGame {
    if (this.phase !== 'playing' || !this.game) throw new UserError('La partida no está en curso');
    return this.game;
  }
}

function intIn(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new UserError(`${label}: entre ${min} y ${max}`);
  return v;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
