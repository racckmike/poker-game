import { describe, expect, it } from 'vitest';
import { HoldemGame } from '../packages/game-engine/src/index.js';

/** Seeded PRNG so a failure can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('unmatched bets', () => {
  it('an all-in bigger than the caller goes back to its owner, it is not announced as a win', () => {
    for (let k = 0; k < 40; k++) {
      const game = new HoldemGame({ smallBlind: 5, bigBlind: 10 });
      game.addPlayer('a', 'Ana', 0, 1000);
      game.addPlayer('b', 'Beto', 1, 100);
      game.startHand();
      game.act(game.toActId!, { type: 'allin' });
      game.act(game.toActId!, game.legalActions(game.toActId!)!.call ? { type: 'call' } : { type: 'allin' });
      expect(game.street).toBe('complete');
      expect(game.winners!.reduce((s, w) => s + w.amount, 0)).toBe(200); // only the matched part is a pot
      expect(game.finalPots!.every((p) => p.eligible.length === 2)).toBe(true);
      expect(game.get('a').stack + game.get('b').stack).toBe(1100);
      expect(game.get('a').stack).toBeGreaterThanOrEqual(900);
    }
  });
});

describe('engine fuzz: random tables, random actions, players leaving and joining', () => {
  it('keeps every rule invariant over thousands of hands', () => {
    let hands = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const r = rng(seed);
      const ri = (n: number) => Math.floor(r() * n);
      const game = new HoldemGame({ smallBlind: 5, bigBlind: 10, random: ri });
      let nextId = 0;
      const n = 2 + ri(7);
      for (let i = 0; i < n; i++) game.addPlayer(`p${nextId++}`, `P${i}`, i, 20 + ri(400));
      let total = game.totalChips();

      for (let h = 0; h < 60 && game.canStartHand(); h++) {
        game.startHand();
        hands++;
        let steps = 0;
        while (game.isBetting()) {
          if (++steps > 500) throw new Error(`seed ${seed}: hand never ends`);
          const id = game.toActId!;
          expect(id, `seed ${seed}: betting without a player to act`).toBeTruthy();
          const actor = game.get(id);
          expect(actor.folded || actor.allIn || !actor.inHand).toBe(false);
          const legal = game.legalActions(id)!;
          expect(legal.fold || legal.check || legal.call > 0 || legal.allin > 0).toBe(true);

          // Rarely someone leaves mid-hand (sometimes not the actor), or a newcomer sits down.
          if (r() < 0.02) {
            const others = game.players.filter((p) => !p.leaving);
            const leaver = others[ri(others.length)];
            total -= leaver.stack; // they walk away with their stack; chips already bet stay in the pot
            game.removePlayer(leaver.id);
            continue;
          }
          if (r() < 0.01) {
            const used = new Set(game.players.map((p) => p.seat));
            const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => !used.has(s));
            if (free.length) {
              game.addPlayer(`p${nextId++}`, 'Nuevo', free[0], 100);
              total += 100;
            }
          }

          const options: (() => void)[] = [];
          if (legal.fold) options.push(() => game.act(id, { type: 'fold' }));
          if (legal.check) options.push(() => game.act(id, { type: 'check' }), () => game.act(id, { type: 'check' }));
          if (legal.call) options.push(() => game.act(id, { type: 'call' }), () => game.act(id, { type: 'call' }));
          if (legal.bet) {
            const { min, max } = legal.bet;
            options.push(() => game.act(id, { type: 'bet', amount: min + ri(max - min + 1) }));
          }
          if (legal.raise) {
            const { min, max } = legal.raise;
            options.push(() => game.act(id, { type: 'raise', amount: min + ri(max - min + 1) }));
          }
          if (legal.allin) options.push(() => game.act(id, { type: 'allin' }));
          options[ri(options.length)]();

          // Someone who left mid-hand still sits in the engine (with their stack) until the hand ends.
          const leaving = game.players.filter((p) => p.leaving).reduce((t, p) => t + p.stack, 0);
          expect(game.totalChips() - leaving, `seed ${seed}: chips not conserved mid-hand`).toBe(total);
          for (const p of game.players) expect(p.stack).toBeGreaterThanOrEqual(0);
        }

        // Hand over.
        expect(game.street).toBe('complete');
        expect(game.totalChips(), `seed ${seed}: chips not conserved after hand`).toBe(total);
        const won = game.winners!.reduce((s, w) => s + w.amount, 0);
        const potIn = game.finalPots!.reduce((s, p) => s + p.amount, 0);
        expect(won, `seed ${seed}: winners don't add up to the pot`).toBe(potIn);
        // A showdown deals the full board with no duplicate cards.
        if (game.winners!.some((w) => w.hand)) {
          expect(game.board).toHaveLength(5);
          const seen = [...game.board, ...game.players.flatMap((p) => p.hole)];
          expect(new Set(seen).size).toBe(seen.length);
        }
      }
    }
    expect(hands).toBeGreaterThan(2000);
  });
});
