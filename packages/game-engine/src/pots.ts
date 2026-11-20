export interface Contribution { id: string; amount: number; folded: boolean }
export interface Pot { amount: number; eligible: string[] }

/**
 * Splits total hand contributions into main + side pots.
 * Folded players' chips are dead money in every pot they reached; only live players are eligible.
 * A pot with a single eligible player is an uncalled bet and simply returns to them.
 */
export function buildPots(contribs: Contribution[]): Pot[] {
  const levels = [...new Set(contribs.filter((c) => !c.folded && c.amount > 0).map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.amount, level) - prev);
    const eligible = contribs.filter((c) => !c.folded && c.amount >= level).map((c) => c.id);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // Merge pots with identical eligibility (keeps the UI clean).
      if (last && last.eligible.length === eligible.length && last.eligible.every((id, i) => id === eligible[i])) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  // Dead money above the highest live contribution (a folded player who put in more than everyone live).
  let leftover = 0;
  for (const c of contribs) leftover += Math.max(0, c.amount - prev);
  if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
  return pots;
}
