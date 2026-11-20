// Shared contracts between the engine, the server and any client (web today, native later).

/** Card as two chars: rank (2-9,T,J,Q,K,A) + suit (s,h,d,c). Example: "Ah", "Td". */
export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export type Street = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface PlayerAction {
  type: ActionType;
  /** For bet/raise: total amount this player will have committed on this street ("raise to"). */
  amount?: number;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** Chips needed to call (capped at stack); 0 when calling is not legal. */
  call: number;
  /** Bet/raise "to" range; null when not legal. */
  bet: { min: number; max: number } | null;
  raise: { min: number; max: number } | null;
  /** Total committed this street if the player shoves; 0 when not legal. */
  allin: number;
}

export type HandCategory =
  | 'high-card' | 'pair' | 'two-pair' | 'trips' | 'straight'
  | 'flush' | 'full-house' | 'quads' | 'straight-flush' | 'royal-flush';

export const HAND_NAMES_ES: Record<HandCategory, string> = {
  'high-card': 'Carta alta',
  pair: 'Par',
  'two-pair': 'Doble par',
  trips: 'Trío',
  straight: 'Escalera',
  flush: 'Color',
  'full-house': 'Full',
  quads: 'Póker',
  'straight-flush': 'Escalera de color',
  'royal-flush': 'Escalera real',
};

export interface PotView { amount: number; eligible: string[] }

export interface WinnerView {
  playerId: string;
  name: string;
  amount: number;
  /** Undefined when the pot was won because everyone else folded. */
  hand?: { category: HandCategory; name: string; cards: Card[] };
}

export type PlayerStatus = 'waiting' | 'active' | 'folded' | 'allin' | 'out' | 'sitting-out';

export interface SeatView {
  id: string;
  name: string;
  seat: number; // 0..7, fixed for the whole game
  stack: number;
  committed: number; // this street
  status: PlayerStatus;
  connected: boolean;
  isHost: boolean;
  ready: boolean;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /** null = no cards; array of null = face-down cards; strings = visible cards. */
  cards: (Card | null)[] | null;
  lastAction: string | null;
  /** Camera / microphone the player chose to share (video and audio go peer-to-peer). */
  cam: boolean;
  mic: boolean;
  /** Changes on every reconnect, so peers know to open a fresh call. */
  rtc: number;
}

export interface RoomSettings {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  turnSeconds: number;
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface TableView {
  roomCode: string;
  phase: RoomPhase;
  hostId: string;
  youId: string;
  settings: RoomSettings;
  players: SeatView[];
  handNumber: number;
  street: Street;
  board: Card[];
  pots: PotView[];
  totalPot: number;
  toActId: string | null;
  /** Epoch ms (server clock) when the current turn auto-acts. */
  turnDeadline: number | null;
  /** Server clock when this view was sent, so clients can correct their own clock. */
  serverNow: number;
  /** Legal actions for the viewer only, when it is their turn. */
  legal: LegalActions | null;
  winners: WinnerView[] | null;
  dealerMessage: string;
  /** Increments on every state change; clients echo it back to prevent duplicate actions. */
  version: number;
  /** Set when the match ended (only one player with chips). */
  champion: string | null;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const DEFAULT_SETTINGS: RoomSettings = {
  startingStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
  turnSeconds: 30,
};

// ---------- Socket.IO contracts ----------

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface Session { roomCode: string; playerId: string; token: string }

export interface ClientToServer {
  'room:create': (p: { name: string }, ack: Ack<Session>) => void;
  'room:join': (p: { name: string; roomCode: string }, ack: Ack<Session>) => void;
  'room:resume': (p: { roomCode: string; token: string }, ack: Ack<Session>) => void;
  'room:leave': (ack: Ack<null>) => void;
  'lobby:ready': (p: { ready: boolean }, ack: Ack<null>) => void;
  'lobby:settings': (p: Partial<RoomSettings>, ack: Ack<null>) => void;
  'game:start': (ack: Ack<null>) => void;
  'game:action': (p: { action: PlayerAction; version: number }, ack: Ack<null>) => void;
  'game:show': (ack: Ack<null>) => void;
  'game:restart': (ack: Ack<null>) => void;
  'media:state': (p: { cam: boolean; mic: boolean }, ack: Ack<null>) => void;
  /** WebRTC offer/answer/ICE relayed to one player in the same room. No ack. */
  'rtc:signal': (p: { to: string; data: RtcSignal }) => void;
}

export type RtcSignal =
  | { kind: 'offer' | 'answer'; sdp: string; rtc: number }
  | { kind: 'ice'; candidate: unknown; rtc: number };

export interface ServerToClient {
  state: (view: TableView) => void;
  kicked: (reason: string) => void;
  'rtc:signal': (p: { from: string; data: RtcSignal }) => void;
}
