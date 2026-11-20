import { HAND_NAMES_ES, type Card, type LegalActions, type PlayerAction, type PlayerStatus, type Street } from '@poker/shared';
import { freshDeck, secureRandomInt, shuffle, type RandomInt } from './deck.js';
import { evaluateBest, type HandValue } from './evaluator.js';
import { buildPots, type Pot } from './pots.js';

export class EngineError extends Error {}

export interface EnginePlayer {
  id: string;
  name: string;
  seat: number;
  stack: number;
  hole: Card[];
  committed: number; // this street
  totalCommitted: number; // this hand
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** currentBet at the moment this player last acted on this street; null = hasn't acted yet. */
  lastActedBet: number | null;
  lastAction: string | null;
  sittingOut: boolean;
  /** Left the table mid-hand: folded now, removed when the hand ends. */
  leaving: boolean;
  shown: boolean;
}

export interface HandWinner { playerId: string; amount: number; hand?: HandValue }

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  random?: RandomInt;
  /** Tests only: returns a full deck in draw order (first element is dealt first). */
  deckFactory?: () => Card[];
}

export interface SeatSnapshot {
  id: string;
  name: string;
  seat: number;
  stack: number;
  committed: number;
  status: PlayerStatus;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  cards: (Card | null)[] | null;
  lastAction: string | null;
}

const BETTING_STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

/**
 * Server-authoritative Texas Hold'em table.
 * Variant-specific parts (hole card count, hand evaluation) live in overridable methods so
 * other variants (e.g. Omaha) can subclass without touching betting, pots or turn logic.
 */
export class HoldemGame {
  readonly variant: string = 'texas-holdem';
  protected readonly holeCardCount: number = 2;

  players: EnginePlayer[] = [];
  street: Street = 'idle';
  board: Card[] = [];
  handNumber = 0;
  buttonSeat = -1;
  sbSeat = -1;
  bbSeat = -1;
  currentBet = 0;
  /** Size of the last full bet/raise on this street (minimum legal raise increment). */
  minRaise = 0;
  toActId: string | null = null;
  winners: HandWinner[] | null = null;
  finalPots: Pot[] | null = null;
  /** Short Spanish description of the last thing that happened (for the dealer bubble). */
  lastEvent = '';

  private deck: Card[] = [];
  private readonly rand: RandomInt;

  constructor(public config: GameConfig) {
    if (!(config.smallBlind > 0 && config.bigBlind >= config.smallBlind)) throw new EngineError('Ciegas inválidas');
    this.rand = config.random ?? secureRandomInt;
  }

  // ---------------- seating ----------------

  addPlayer(id: string, name: string, seat: number, stack: number): void {
    if (this.players.some((p) => p.id === id)) throw new EngineError('Jugador ya sentado');
    if (this.players.some((p) => p.seat === seat)) throw new EngineError('Asiento ocupado');
    this.players.push({
      id, name, seat, stack, hole: [], committed: 0, totalCommitted: 0, inHand: false, folded: false,
      allIn: false, lastActedBet: null, lastAction: null, sittingOut: false, leaving: false, shown: false,
    });
    this.players.sort((a, b) => a.seat - b.seat);
  }

  /** Removes a player. Mid-hand they fold now and are removed when the hand ends. Returns the stack they leave with. */
  removePlayer(id: string): number {
    const p = this.get(id);
    if (this.isBetting() && p.inHand) {
      p.leaving = true;
      if (!p.folded) {
        p.folded = true;
        p.lastAction = 'Se retira';
        this.afterAction(this.toActId === id ? p : null);
      }
      return p.stack;
    }
    this.players = this.players.filter((x) => x.id !== id);
    return p.stack;
  }

  setSittingOut(id: string, value: boolean): void {
    this.get(id).sittingOut = value;
  }

  get(id: string): EnginePlayer {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new EngineError('Jugador no encontrado');
    return p;
  }

  isBetting(): boolean {
    return BETTING_STREETS.includes(this.street);
  }

  eligibleForNextHand(): EnginePlayer[] {
    return this.players.filter((p) => p.stack > 0 && !p.sittingOut && !p.leaving);
  }

  canStartHand(): boolean {
    return !this.isBetting() && this.eligibleForNextHand().length >= 2;
  }

  // ---------------- hand lifecycle ----------------

  startHand(): void {
    if (!this.canStartHand()) throw new EngineError('No hay suficientes jugadores con fichas');
    for (const p of this.players) {
      Object.assign(p, {
        hole: [], committed: 0, totalCommitted: 0, folded: false, allIn: false,
        lastActedBet: null, lastAction: null, shown: false,
      });
      p.inHand = p.stack > 0 && !p.sittingOut;
    }
    this.handNumber++;
    this.board = [];
    this.winners = null;
    this.finalPots = null;

    const live = this.players.filter((p) => p.inHand);
    if (this.buttonSeat < 0) this.buttonSeat = live[this.rand(live.length)].seat;
    else this.buttonSeat = this.nextSeat(this.buttonSeat, (p) => p.inHand).seat;

    if (live.length === 2) {
      // Heads-up: the button posts the small blind and acts first preflop.
      this.sbSeat = this.buttonSeat;
      this.bbSeat = this.nextSeat(this.buttonSeat, (p) => p.inHand).seat;
    } else {
      this.sbSeat = this.nextSeat(this.buttonSeat, (p) => p.inHand).seat;
      this.bbSeat = this.nextSeat(this.sbSeat, (p) => p.inHand).seat;
    }

    this.deck = this.config.deckFactory ? this.config.deckFactory().reverse() : shuffle(freshDeck(), this.rand);
    this.street = 'preflop';
    this.currentBet = this.config.bigBlind;
    this.minRaise = this.config.bigBlind;
    this.put(this.bySeat(this.sbSeat), this.config.smallBlind, 'Ciega pequeña');
    this.put(this.bySeat(this.bbSeat), this.config.bigBlind, 'Ciega grande');

    // Deal one card at a time, starting left of the button.
    for (let r = 0; r < this.holeCardCount; r++) {
      let p = this.nextSeat(this.buttonSeat, (x) => x.inHand);
      for (let i = 0; i < live.length; i++) {
        p.hole.push(this.draw());
        p = this.nextSeat(p.seat, (x) => x.inHand);
      }
    }

    this.lastEvent = `Mano #${this.handNumber}: cartas repartidas`;
    const first = live.length === 2 ? this.bySeat(this.sbSeat) : this.nextSeat(this.bbSeat, (p) => p.inHand);
    this.toActId = null;
    this.setNextToAct(first.seat, true);
  }

  legalActions(id: string): LegalActions | null {
    if (!this.isBetting() || this.toActId !== id) return null;
    const p = this.get(id);
    const toCall = Math.max(0, this.currentBet - p.committed);
    const maxTo = p.committed + p.stack;
    const mayRaise = p.lastActedBet === null || this.currentBet - p.lastActedBet >= this.minRaise;
    const othersCanRespond = this.players.some((x) => x.id !== id && this.canAct(x));
    const legal: LegalActions = { fold: toCall > 0, check: toCall === 0, call: toCall > 0 ? Math.min(toCall, p.stack) : 0, bet: null, raise: null, allin: 0 };

    if (p.stack > 0 && othersCanRespond) {
      if (this.currentBet === 0) {
        const min = Math.min(this.config.bigBlind, maxTo);
        legal.bet = { min, max: maxTo };
      } else if (maxTo > this.currentBet && mayRaise) {
        const min = Math.min(this.currentBet + this.minRaise, maxTo);
        legal.raise = { min, max: maxTo };
      }
    }
    // All-in is offered when it is a call for less/equal, or a legal bet/raise.
    if (p.stack > 0 && (maxTo <= this.currentBet || legal.bet || legal.raise)) legal.allin = maxTo;
    return legal;
  }

  act(id: string, action: PlayerAction): void {
    if (!this.isBetting()) throw new EngineError('No hay una ronda de apuestas en curso');
    if (this.toActId !== id) throw new EngineError('No es tu turno');
    const legal = this.legalActions(id)!;
    const p = this.get(id);
    const amount = action.amount;

    switch (action.type) {
      case 'fold':
        if (!legal.fold) throw new EngineError('No puedes retirarte: puedes pasar gratis');
        p.folded = true;
        p.lastAction = 'Se retira';
        break;
      case 'check':
        if (!legal.check) throw new EngineError('No puedes pasar: hay una apuesta');
        p.lastAction = 'Pasa';
        break;
      case 'call':
        if (!legal.call) throw new EngineError('No hay nada que igualar');
        this.put(p, legal.call, p.stack === legal.call ? 'All-in' : 'Iguala');
        break;
      case 'bet':
      case 'raise': {
        const range = action.type === 'bet' ? legal.bet : legal.raise;
        if (!range) throw new EngineError(action.type === 'bet' ? 'No puedes apostar ahora' : 'No puedes subir ahora');
        if (!Number.isSafeInteger(amount) || amount! < range.min || amount! > range.max)
          throw new EngineError(`Cantidad inválida (entre ${range.min} y ${range.max})`);
        this.raiseTo(p, amount!, action.type === 'bet' ? 'Apuesta' : 'Sube');
        break;
      }
      case 'allin': {
        if (!legal.allin) throw new EngineError('No puedes ir all-in ahora');
        const to = legal.allin;
        if (to <= this.currentBet) this.put(p, p.stack, 'All-in');
        else this.raiseTo(p, to, 'All-in');
        break;
      }
      default:
        throw new EngineError('Acción desconocida');
    }
    p.lastActedBet = this.currentBet;
    this.lastEvent = `${p.name}: ${p.lastAction}`;
    this.afterAction(p);
  }

  /** Default action when the turn timer runs out: check if free, otherwise fold. */
  autoAct(id: string): void {
    const legal = this.legalActions(id);
    if (!legal) return;
    this.act(id, { type: legal.check ? 'check' : 'fold' });
  }

  /** Voluntarily reveal hole cards once the hand is over ("mostrar su juego"). */
  show(id: string): void {
    const p = this.get(id);
    if (this.street !== 'complete' || p.hole.length === 0) throw new EngineError('Solo puedes mostrar al terminar la mano');
    p.shown = true;
  }

  /** Total chips owned by seated players plus chips in the middle (for conservation checks). */
  totalChips(): number {
    return this.players.reduce((s, p) => s + p.stack + p.totalCommitted, 0);
  }

  potTotal(): number {
    return this.players.reduce((s, p) => s + p.totalCommitted, 0);
  }

  // ---------------- views ----------------

  /** Seat data for one viewer. Hole cards of other players are never included unless revealed at showdown. */
  snapshot(viewerId: string | null): SeatSnapshot[] {
    const reveal = (p: EnginePlayer) => p.id === viewerId || (p.shown && (this.street === 'complete' || this.street === 'showdown'));
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      stack: p.stack,
      committed: p.committed,
      status: this.statusOf(p),
      isButton: this.handNumber > 0 && p.seat === this.buttonSeat,
      isSmallBlind: this.isBetting() && p.seat === this.sbSeat,
      isBigBlind: this.isBetting() && p.seat === this.bbSeat,
      cards: p.hole.length === 0 || (p.folded && p.id !== viewerId) ? null : p.hole.map((c) => (reveal(p) ? c : null)),
      lastAction: p.lastAction,
    }));
  }

  private statusOf(p: EnginePlayer): PlayerStatus {
    if (!p.inHand || this.street === 'idle') return p.stack === 0 ? 'out' : p.sittingOut ? 'sitting-out' : 'waiting';
    if (p.folded) return 'folded';
    if (this.street === 'complete') return p.stack === 0 ? 'out' : 'active';
    return p.allIn ? 'allin' : 'active';
  }

  // ---------------- internals ----------------

  protected bestHand(p: EnginePlayer): HandValue {
    return evaluateBest([...p.hole, ...this.board]);
  }

  private draw(): Card {
    const c = this.deck.pop();
    if (!c) throw new Error('Deck exhausted');
    return c;
  }

  private bySeat(seat: number): EnginePlayer {
    return this.players.find((p) => p.seat === seat)!;
  }

  /** Next player clockwise (strictly after `seat`) matching the predicate. */
  private nextSeat(seat: number, pred: (p: EnginePlayer) => boolean): EnginePlayer {
    const n = this.players.length;
    const start = this.players.findIndex((p) => p.seat > seat);
    for (let i = 0; i < n; i++) {
      const p = this.players[((start === -1 ? 0 : start) + i) % n];
      if (pred(p)) return p;
    }
    throw new Error('No matching seat');
  }

  private canAct(p: EnginePlayer): boolean {
    return p.inHand && !p.folded && !p.allIn;
  }

  private needsAction(p: EnginePlayer): boolean {
    return this.canAct(p) && (p.lastActedBet === null || p.committed < this.currentBet);
  }

  private put(p: EnginePlayer, chips: number, label: string): void {
    const amt = Math.min(chips, p.stack);
    p.stack -= amt;
    p.committed += amt;
    p.totalCommitted += amt;
    if (p.stack === 0) p.allIn = true;
    p.lastAction = p.allIn ? 'All-in' : label;
  }

  private raiseTo(p: EnginePlayer, to: number, label: string): void {
    const increment = to - this.currentBet;
    this.put(p, to - p.committed, label);
    if (increment >= this.minRaise) this.minRaise = increment; // full raise reopens action
    this.currentBet = to;
  }

  private afterAction(actor: EnginePlayer | null): void {
    const live = this.players.filter((p) => p.inHand && !p.folded);
    if (live.length === 1) return this.awardUncontested(live[0]);

    const actors = live.filter((p) => this.canAct(p));
    const roundDone =
      !live.some((p) => this.needsAction(p)) ||
      (actors.length <= 1 && actors.every((p) => p.committed >= this.currentBet));

    if (!roundDone) {
      const from = actor ? actor.seat : this.toActId ? this.get(this.toActId).seat : this.buttonSeat;
      // If the folding player was not the one to act, keep the current turn.
      if (!actor && this.toActId && this.needsAction(this.get(this.toActId))) return;
      return this.setNextToAct(from, false);
    }
    this.endStreet();
  }

  private setNextToAct(fromSeat: number, inclusive: boolean): void {
    const start = inclusive ? this.bySeat(fromSeat) : this.nextSeat(fromSeat, () => true);
    let p = start;
    for (let i = 0; i < this.players.length; i++) {
      if (this.needsAction(p)) {
        this.toActId = p.id;
        // Nobody else can respond and this player already matches: nothing to decide.
        if (!this.players.some((x) => x.id !== p.id && this.canAct(x)) && p.committed >= this.currentBet) break;
        return;
      }
      p = this.nextSeat(p.seat, () => true);
    }
    this.toActId = null;
    this.endStreet();
  }

  private endStreet(): void {
    this.toActId = null;
    for (const p of this.players) {
      p.committed = 0;
      p.lastActedBet = null;
    }
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;

    const live = this.players.filter((p) => p.inHand && !p.folded);
    const actors = live.filter((p) => this.canAct(p));

    if (this.street === 'river') return this.showdown();
    this.dealNextStreet();
    if (actors.length <= 1) {
      // Everyone (or all but one) is all-in: run out the board.
      while ((this.street as Street) !== 'river') this.dealNextStreet();
      for (const p of live) p.shown = true; // all-in hands are tabled
      return this.showdown();
    }
    for (const p of this.players) if (p.inHand && !p.folded && !p.allIn) p.lastAction = null;
    this.setNextToAct(this.nextSeat(this.buttonSeat, (p) => this.canAct(p)).seat, true);
  }

  private dealNextStreet(): void {
    this.draw(); // burn
    if (this.street === 'preflop') {
      this.board.push(this.draw(), this.draw(), this.draw());
      this.street = 'flop';
      this.lastEvent = 'Flop';
    } else if (this.street === 'flop') {
      this.board.push(this.draw());
      this.street = 'turn';
      this.lastEvent = 'Turn';
    } else if (this.street === 'turn') {
      this.board.push(this.draw());
      this.street = 'river';
      this.lastEvent = 'River';
    }
  }

  private contributions() {
    return this.players
      .filter((p) => p.totalCommitted > 0)
      .map((p) => ({ id: p.id, amount: p.totalCommitted, folded: p.folded || !p.inHand }));
  }

  private awardUncontested(winner: EnginePlayer): void {
    const total = this.potTotal();
    winner.stack += total;
    this.finalPots = [{ amount: total, eligible: [winner.id] }];
    this.winners = [{ playerId: winner.id, amount: total }];
    this.lastEvent = `${winner.name} gana ${total} fichas`;
    this.finishHand();
  }

  private showdown(): void {
    this.street = 'showdown';
    const live = this.players.filter((p) => p.inHand && !p.folded);
    const values = new Map(live.map((p) => [p.id, this.bestHand(p)]));
    for (const p of live) p.shown = true;

    const pots = buildPots(this.contributions());
    const won = new Map<string, number>();
    for (const pot of pots) {
      const contenders = pot.eligible.map((id) => this.get(id));
      const best = Math.max(...contenders.map((p) => values.get(p.id)!.score));
      // Order winners clockwise from the button so the odd chip goes to the first one.
      const winners = contenders
        .filter((p) => values.get(p.id)!.score === best)
        .sort((a, b) => this.distFromButton(a.seat) - this.distFromButton(b.seat));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (odd-- > 0 ? 1 : 0);
        w.stack += amt;
        won.set(w.id, (won.get(w.id) ?? 0) + amt);
      }
    }
    this.finalPots = pots;
    this.winners = [...won.entries()].map(([playerId, amount]) => ({ playerId, amount, hand: values.get(playerId) }));
    const names = this.winners.map((w) => `${this.get(w.playerId).name} gana ${w.amount} fichas con ${HAND_NAMES_ES[w.hand!.category].toLowerCase()}`);
    this.lastEvent = names.join(' · ');
    this.finishHand();
  }

  private distFromButton(seat: number): number {
    return (seat - this.buttonSeat + 8) % 8 || 8; // button itself goes last
  }

  private finishHand(): void {
    for (const p of this.players) {
      p.totalCommitted = 0;
      p.committed = 0;
    }
    this.street = 'complete';
    this.toActId = null;
    this.players = this.players.filter((p) => !p.leaving);
  }
}
