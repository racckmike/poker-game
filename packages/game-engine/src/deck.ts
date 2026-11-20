import { RANKS, SUITS, type Card } from '@poker/shared';

/** Returns a uniformly random integer in [0, max). Must be cryptographically secure in production. */
export type RandomInt = (max: number) => number;

/** Web Crypto (Node 19+, browsers, React Native with a polyfill) with rejection sampling to avoid modulo bias. */
export const secureRandomInt: RandomInt = (max) => {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max out of range');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
};

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

/** Fisher–Yates shuffle (in place, returns the same array). */
export function shuffle<T>(arr: T[], rand: RandomInt = secureRandomInt): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
