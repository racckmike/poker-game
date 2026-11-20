import { RANKS, type Card, type HandCategory } from '@poker/shared';

export interface HandValue {
  category: HandCategory;
  /** Comparable score: higher wins, equal = tie. */
  score: number;
  /** The best five cards. */
  cards: Card[];
}

const CATEGORY_ORDER: HandCategory[] = [
  'high-card', 'pair', 'two-pair', 'trips', 'straight',
  'flush', 'full-house', 'quads', 'straight-flush', 'royal-flush',
];

const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2; // 2..14

function encode(cat: HandCategory, kickers: number[]): number {
  // Royal flush is just the top straight flush; keep it in the straight-flush bucket for scoring.
  const bucket = cat === 'royal-flush' ? CATEGORY_ORDER.indexOf('straight-flush') : CATEGORY_ORDER.indexOf(cat);
  let s = bucket;
  for (let i = 0; i < 5; i++) s = s * 15 + (kickers[i] ?? 0);
  return s;
}

/** Evaluates exactly five cards. */
export function evaluate5(cards: Card[]): HandValue {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
  }
  // Group by count desc, then rank desc.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);

  let category: HandCategory;
  let kickers: number[];
  if (straightHigh && flush) {
    category = straightHigh === 14 ? 'royal-flush' : 'straight-flush';
    kickers = [straightHigh];
  } else if (groups[0][1] === 4) {
    category = 'quads'; kickers = byGroup;
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 'full-house'; kickers = byGroup;
  } else if (flush) {
    category = 'flush'; kickers = ranks;
  } else if (straightHigh) {
    category = 'straight'; kickers = [straightHigh];
  } else if (groups[0][1] === 3) {
    category = 'trips'; kickers = byGroup;
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = 'two-pair'; kickers = byGroup;
  } else if (groups[0][1] === 2) {
    category = 'pair'; kickers = byGroup;
  } else {
    category = 'high-card'; kickers = ranks;
  }
  return { category, score: encode(category, kickers), cards: [...cards] };
}

/** Best five-card hand from 5–7 cards. */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('need at least 5 cards');
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}
