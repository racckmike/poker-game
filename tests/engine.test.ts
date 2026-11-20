import { describe, expect, it } from 'vitest';
import {
  HoldemGame, EngineError, buildPots, evaluate5, evaluateBest, freshDeck, shuffle, secureRandomInt,
} from '@poker/game-engine';
import type { Card, PlayerAction } from '@poker/shared';

// ---------- helpers ----------

/** Deck in draw order for a table whose button is seat 0 (deal starts at seat 1). */
function stackedDeck(holes: Card[][], board: Card[]): () => Card[] {
  const n = holes.length;
  const order = [...Array(n).keys()].map((i) => (i + 1) % n);
  const top: Card[] = [];
  for (let r = 0; r < 2; r++) for (const s of order) top.push(holes[s][r]);
  const filler = freshDeck().filter((c) => !top.includes(c) && !board.includes(c));
  const burn = () => filler.shift()!;
  top.push(burn(), board[0], board[1], board[2], burn(), board[3], burn(), board[4]);
  return () => [...top, ...filler];
}

function table(stacks: number[], opts: { holes?: Card[][]; board?: Card[]; sb?: number; bb?: number } = {}) {
  const g = new HoldemGame({
    smallBlind: opts.sb ?? 5,
    bigBlind: opts.bb ?? 10,
    random: () => 0, // button starts at seat 0
    deckFactory: opts.holes ? stackedDeck(opts.holes, opts.board!) : undefined,
  });
  stacks.forEach((s, i) => g.addPlayer(`p${i}`, `P${i}`, i, s));
  return g;
}

const act = (g: HoldemGame, a: PlayerAction) => g.act(g.toActId!, a);
const total = (g: HoldemGame) => g.totalChips();
const handRank = (cards: string) => evaluate5(cards.split(' '));

// ---------- deck & shuffle ----------

describe('deck', () => {
  it('has 52 unique cards', () => {
    const d = freshDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });

  it('shuffle is a permutation and roughly uniform', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5200; i++) {
      const d = shuffle(freshDeck());
      expect(new Set(d).size).toBe(52);
      counts.set(d[0], (counts.get(d[0]) ?? 0) + 1);
    }
    for (const c of freshDeck()) {
      const n = counts.get(c) ?? 0;
      expect(n).toBeGreaterThan(45); // expected 100
      expect(n).toBeLessThan(170);
    }
  });

  it('secure random stays in range', () => {
    for (let i = 0; i < 1000; i++) {
      const r = secureRandomInt(7);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(7);
    }
  });

  it('deals unique cards to 8 players', () => {
    const g = new HoldemGame({ smallBlind: 5, bigBlind: 10 });
    for (let i = 0; i < 8; i++) g.addPlayer(`p${i}`, `P${i}`, i, 1000);
    g.startHand();
    // Everyone checks/calls to showdown so the full board is dealt.
    while (g.isBetting()) {
      const l = g.legalActions(g.toActId!)!;
      act(g, l.check ? { type: 'check' } : { type: 'call' });
    }
    const all = [...g.players.flatMap((p) => p.hole), ...g.board];
    expect(all).toHaveLength(21);
    expect(new Set(all).size).toBe(21);
  });
});

// ---------- hand evaluation ----------

describe('hand evaluator', () => {
  it('recognises every category', () => {
    expect(handRank('Ah Kh Qh Jh Th').category).toBe('royal-flush');
    expect(handRank('9h Kh Qh Jh Th').category).toBe('straight-flush');
    expect(handRank('9h 9s 9d 9c Th').category).toBe('quads');
    expect(handRank('9h 9s 9d Tc Th').category).toBe('full-house');
    expect(handRank('2h 9h 4h Jh Th').category).toBe('flush');
    expect(handRank('9h 8s 7d 6c 5h').category).toBe('straight');
    expect(handRank('Ah 2s 3d 4c 5h').category).toBe('straight');
    expect(handRank('9h 9s 9d 2c Th').category).toBe('trips');
    expect(handRank('9h 9s 2d 2c Th').category).toBe('two-pair');
    expect(handRank('9h 9s 2d 3c Th').category).toBe('pair');
    expect(handRank('9h Js 2d 3c Th').category).toBe('high-card');
  });

  it('orders categories correctly', () => {
    const order = [
      '9h Js 2d 3c Th', '9h 9s 2d 3c Th', '9h 9s 2d 2c Th', '9h 9s 9d 2c Th', '9h 8s 7d 6c 5h',
      '2h 9h 4h Jh Th', '9h 9s 9d Tc Th', '9h 9s 9d 9c Th', '9h Kh Qh Jh Th', 'Ah Kh Qh Jh Th',
    ].map((h) => handRank(h).score);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('wheel is the lowest straight', () => {
    expect(handRank('Ah 2s 3d 4c 5h').score).toBeLessThan(handRank('2h 3s 4d 5c 6h').score);
  });

  it('compares kickers', () => {
    expect(handRank('Ah As Kd 7c 2h').score).toBeGreaterThan(handRank('Ad Ac Qd Jc 9h').score);
    expect(handRank('Kh Ks 5d 5c Ah').score).toBeGreaterThan(handRank('Kd Kc 5h 5s Qh').score);
    expect(handRank('Ah Jh 9h 6h 3h').score).toBeGreaterThan(handRank('As Js 9s 6s 2s').score);
    expect(handRank('Ah Kd 9s 6c 3h').score).toBe(handRank('As Kh 9d 6s 3c').score);
  });

  it('picks the best 5 of 7', () => {
    const v = evaluateBest(['Ah', 'Kh', 'Qh', 'Jh', '2c', 'Th', '3d']);
    expect(v.category).toBe('royal-flush');
    expect(v.cards).toHaveLength(5);
    expect(evaluateBest(['2c', '2d', 'Ah', 'Ad', 'Kh', 'Ks', 'Qc']).category).toBe('two-pair');
  });
});

// ---------- pots ----------

describe('side pots', () => {
  it('builds main and side pots with dead money', () => {
    const pots = buildPots([
      { id: 'a', amount: 50, folded: false }, // all-in short
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 200, folded: false },
      { id: 'd', amount: 30, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 180, eligible: ['a', 'b', 'c'] },
      { amount: 300, eligible: ['b', 'c'] },
    ]);
  });

  it('returns uncalled chips as a single-eligible pot', () => {
    const pots = buildPots([
      { id: 'a', amount: 100, folded: false },
      { id: 'b', amount: 40, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 80, eligible: ['a', 'b'] },
      { amount: 60, eligible: ['a'] },
    ]);
  });
});

// ---------- game flow ----------

describe('Texas Hold’em game', () => {
  it('posts blinds and sets turn order (4 players)', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    expect(g.buttonSeat).toBe(0);
    expect(g.get('p1').committed).toBe(5);
    expect(g.get('p2').committed).toBe(10);
    expect(g.toActId).toBe('p3'); // UTG
    act(g, { type: 'call' });
    expect(g.toActId).toBe('p0');
    act(g, { type: 'call' });
    act(g, { type: 'call' }); // SB completes
    expect(g.toActId).toBe('p2'); // BB option
    expect(g.legalActions('p2')!.check).toBe(true);
    act(g, { type: 'check' });
    expect(g.street).toBe('flop');
    expect(g.board).toHaveLength(3);
    expect(g.toActId).toBe('p1'); // first live player left of the button
  });

  it('rejects illegal and out-of-turn actions', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    expect(() => g.act('p0', { type: 'call' })).toThrow(EngineError);
    expect(() => act(g, { type: 'check' })).toThrow(/pasar/);
    expect(() => act(g, { type: 'raise', amount: 15 })).toThrow(/Cantidad/); // min raise is to 20
    expect(() => act(g, { type: 'raise', amount: 20.5 })).toThrow(EngineError);
    expect(() => act(g, { type: 'raise', amount: 5000 })).toThrow(EngineError);
    expect(() => act(g, { type: 'bet', amount: 50 })).toThrow(/apostar/);
    expect(() => act(g, { type: 'dance' } as never)).toThrow(EngineError);
    act(g, { type: 'raise', amount: 20 });
    expect(g.currentBet).toBe(20);
    expect(() => g.act('nobody', { type: 'fold' })).toThrow(EngineError);
  });

  it('enforces minimum re-raise size', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    act(g, { type: 'raise', amount: 40 }); // raise by 30
    expect(g.legalActions(g.toActId!)!.raise!.min).toBe(70);
    expect(() => act(g, { type: 'raise', amount: 60 })).toThrow(EngineError);
    act(g, { type: 'raise', amount: 70 });
    expect(g.minRaise).toBe(30);
  });

  it('incomplete all-in raise does not reopen betting', () => {
    const h = table([1000, 1000, 1000, 1000, 45]);
    h.startHand(); // button p0, sb p1, bb p2, utg p3, p4
    act(h, { type: 'raise', amount: 30 }); // p3 raises to 30 (full raise of 20)
    act(h, { type: 'allin' }); // p4 all-in to 45: +15, less than min raise 20
    expect(h.currentBet).toBe(45);
    act(h, { type: 'fold' }); // p0
    act(h, { type: 'fold' }); // p1
    act(h, { type: 'call' }); // p2 hasn't acted on the raise: may call
    expect(h.toActId).toBe('p3');
    const l = h.legalActions('p3')!;
    expect(l.raise).toBeNull(); // action not reopened for p3
    expect(l.call).toBe(15);
  });

  it('showdown awards the best hand and conserves chips', () => {
    const g = table([1000, 1000, 1000, 1000], {
      holes: [['2c', '7d'], ['Ah', 'Ad'], ['Kh', 'Kd'], ['3c', '8s']],
      board: ['As', 'Kc', '9d', '4h', '2s'],
    });
    g.startHand();
    const before = total(g);
    act(g, { type: 'fold' }); // p3
    act(g, { type: 'fold' }); // p0
    act(g, { type: 'raise', amount: 100 }); // p1
    act(g, { type: 'call' }); // p2
    while (g.isBetting()) act(g, { type: 'check' });
    expect(g.street).toBe('complete');
    expect(g.winners).toHaveLength(1);
    expect(g.winners![0].playerId).toBe('p1');
    expect(g.winners![0].hand!.category).toBe('trips');
    expect(g.get('p1').stack).toBe(1100);
    expect(g.get('p2').stack).toBe(900);
    expect(total(g)).toBe(before);
  });

  it('splits pots on ties', () => {
    const g = table([1000, 1000, 1000], {
      holes: [['2c', '3d'], ['4c', '5d'], ['4h', '5s']],
      board: ['Ah', 'Kh', 'Qd', 'Jc', 'Ts'],
    });
    g.startHand();
    act(g, { type: 'call' }); // p0 calls 10
    act(g, { type: 'call' }); // p1 completes
    act(g, { type: 'check' }); // p2
    while (g.isBetting()) act(g, { type: 'check' });
    expect(g.winners!.map((w) => w.amount)).toEqual([10, 10, 10]);
    expect(g.players.map((p) => p.stack)).toEqual([1000, 1000, 1000]);
  });

  it('odd chip goes to first winner left of the button', () => {
    const g = table([1000, 1000, 1000], {
      holes: [['2c', '3d'], ['4c', '5d'], ['4h', '5s']],
      board: ['Ah', 'Kh', 'Qd', 'Jc', 'Ts'],
    });
    g.startHand();
    act(g, { type: 'call' }); // p0 10
    act(g, { type: 'call' }); // p1 completes
    act(g, { type: 'check' }); // p2
    act(g, { type: 'check' }); // flop: p1
    act(g, { type: 'check' }); // p2
    act(g, { type: 'bet', amount: 11 }); // p0
    act(g, { type: 'raise', amount: 22 }); // p1
    act(g, { type: 'call' }); // p2
    act(g, { type: 'fold' }); // p0 → 21 dead chips, pot 85 split between p1 and p2
    while (g.isBetting()) act(g, { type: 'check' });
    expect(g.get('p1').stack).toBe(1011); // first winner left of the button gets the odd chip
    expect(g.get('p2').stack).toBe(1010);
  });

  it('handles multiple all-ins with side pots', () => {
    // p1 (short, best hand), p2 (medium, 2nd best), p3 (big), p0 (big, worst)
    const g = table([1000, 100, 300, 1000], {
      holes: [['2c', '7d'], ['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']],
      board: ['As', 'Kc', 'Qs', '4h', '3s'],
    });
    g.startHand();
    const before = total(g);
    act(g, { type: 'allin' }); // p3 1000
    act(g, { type: 'call' }); // p0 calls 1000
    act(g, { type: 'allin' }); // p1 100
    act(g, { type: 'allin' }); // p2 300
    expect(g.street).toBe('complete');
    expect(g.board).toHaveLength(5);
    expect(total(g)).toBe(before);
    // Main pot 400 → p1 (trip aces). Side pot (300-100)*3=600 → p2 (trip kings). Rest 1400 → p3 (trip queens).
    expect(g.get('p1').stack).toBe(400);
    expect(g.get('p2').stack).toBe(600);
    expect(g.get('p3').stack).toBe(1400);
    expect(g.get('p0').stack).toBe(0);
  });

  it('awards the pot when everyone folds', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    act(g, { type: 'raise', amount: 50 }); // p3
    act(g, { type: 'fold' });
    act(g, { type: 'fold' });
    act(g, { type: 'fold' });
    expect(g.street).toBe('complete');
    expect(g.winners).toEqual([{ playerId: 'p3', amount: 25 }]); // blinds 15 + the matched 10 of the raise; the other 40 simply goes back
    expect(g.get('p3').stack).toBe(1015);
  });

  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    const g = table([1000, 1000]);
    g.startHand();
    expect(g.sbSeat).toBe(0);
    expect(g.bbSeat).toBe(1);
    expect(g.toActId).toBe('p0');
    act(g, { type: 'call' });
    act(g, { type: 'check' });
    expect(g.street).toBe('flop');
    expect(g.toActId).toBe('p1');
  });

  it('rotates the button and blinds each hand', () => {
    const g = table([1000, 1000, 1000, 1000]);
    const seen: number[][] = [];
    for (let h = 0; h < 5; h++) {
      g.startHand();
      seen.push([g.buttonSeat, g.sbSeat, g.bbSeat]);
      while (g.isBetting()) {
        const l = g.legalActions(g.toActId!)!;
        act(g, l.fold ? { type: 'fold' } : { type: 'check' });
      }
    }
    expect(seen).toEqual([[0, 1, 2], [1, 2, 3], [2, 3, 0], [3, 0, 1], [0, 1, 2]]);
  });

  it('skips busted players and transitions to heads-up', () => {
    const g = table([1000, 1000, 1000, 20]);
    g.startHand();
    act(g, { type: 'allin' }); // p3 all-in 20
    act(g, { type: 'call' });
    act(g, { type: 'fold' });
    act(g, { type: 'fold' });
    // p0 vs p3 board runs; whoever wins, continue until a heads-up appears.
    expect(g.street).toBe('complete');
    for (const p of g.players) if (p.id !== 'p0') p.stack = p.id === 'p1' ? p.stack : 0;
    g.startHand();
    expect(g.players.filter((p) => p.inHand)).toHaveLength(2);
    expect(g.sbSeat).toBe(g.buttonSeat); // heads-up rule
  });

  it('short big blind all-in still lets the table act', () => {
    const g = table([1000, 1000, 4, 1000]);
    g.startHand();
    expect(g.get('p2').allIn).toBe(true);
    expect(g.currentBet).toBe(10);
    act(g, { type: 'call' }); // p3 10
    act(g, { type: 'call' }); // p0
    act(g, { type: 'call' }); // p1
    expect(g.street).toBe('flop');
  });

  it('player leaving mid-hand folds and is removed after the hand', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    const before = total(g);
    g.removePlayer('p0'); // not his turn (p3 is)
    expect(g.get('p0').folded).toBe(true);
    expect(g.toActId).toBe('p3');
    g.removePlayer('p3'); // his turn
    expect(g.toActId).toBe('p1');
    act(g, { type: 'fold' });
    expect(g.street).toBe('complete');
    expect(g.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(total(g)).toBe(before - 2000);
  });

  it('auto-acts: checks when free, folds otherwise', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    g.autoAct('p3');
    expect(g.get('p3').folded).toBe(true);
    act(g, { type: 'call' });
    act(g, { type: 'call' });
    g.autoAct('p2');
    expect(g.street).toBe('flop');
  });

  it('never reveals opponents\' cards in snapshots', () => {
    const g = table([1000, 1000, 1000, 1000]);
    g.startHand();
    const snap = g.snapshot('p1');
    for (const s of snap) {
      if (s.id === 'p1') expect(s.cards!.every((c) => typeof c === 'string')).toBe(true);
      else expect(s.cards).toEqual([null, null]);
    }
    expect(JSON.stringify(snap)).not.toContain(`"${g.get('p2').hole[0]}"`);
  });

  it('survives hundreds of random hands without corrupting state', () => {
    const rand = (n: number) => Math.floor(Math.random() * n);
    for (let t = 0; t < 30; t++) {
      const n = 2 + rand(7);
      const g = new HoldemGame({ smallBlind: 5, bigBlind: 10 });
      for (let i = 0; i < n; i++) g.addPlayer(`p${i}`, `P${i}`, i, 200 + rand(800));
      const chips = total(g);
      for (let h = 0; h < 40 && g.canStartHand(); h++) {
        g.startHand();
        let guard = 0;
        while (g.isBetting()) {
          if (++guard > 500) throw new Error('infinite betting round');
          const id = g.toActId!;
          expect(id).toBeTruthy();
          const l = g.legalActions(id)!;
          const opts: PlayerAction[] = [];
          if (l.fold) opts.push({ type: 'fold' });
          if (l.check) opts.push({ type: 'check' }, { type: 'check' });
          if (l.call) opts.push({ type: 'call' }, { type: 'call' });
          if (l.bet) opts.push({ type: 'bet', amount: l.bet.min + rand(l.bet.max - l.bet.min + 1) });
          if (l.raise) opts.push({ type: 'raise', amount: l.raise.min + rand(l.raise.max - l.raise.min + 1) });
          if (l.allin && rand(10) === 0) opts.push({ type: 'allin' });
          g.act(id, opts[rand(opts.length)]);
          expect(total(g)).toBe(chips);
          for (const p of g.players) expect(p.stack).toBeGreaterThanOrEqual(0);
        }
        expect(g.street).toBe('complete');
        expect(total(g)).toBe(chips);
        const winnings = g.winners!.reduce((s, w) => s + w.amount, 0);
        expect(winnings).toBeGreaterThan(0);
      }
    }
  });
});
