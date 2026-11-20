# Design (superseded: see note)

The green felt from Dad's pen sketch, drawn on a grid-paper notebook. Everything else is written in blue ballpoint pen. What is at stake (your turn, your bet, the winner) is marked in solid red ink.

Mode: Experience (the game table) with Operate surfaces (home, lobby).

## Colour

| Token | Value | Use |
|---|---|---|
| paper | #f3efe4 | Page; 24px grid in pen ink at 9% |
| paper-2 | #e8e1cf | Inputs, quiet fills |
| slip | #fcfaf4 | Paper slips (name plates, tags), card faces |
| felt | #2f6b3f | The table only. Matte, flat, no gradient |
| felt-line | #24552f | Inner line on the felt |
| ink | #22201c | Printed text, table outline |
| pencil | #5b564d | Secondary text (≥6:1 on paper) |
| pen | #1f3a8a | Handwritten titles, safe actions, focus |
| red | #c8322b | Only for what is at stake: your turn, bet/raise, your bet, the winner's circle |

No gold, no glows, no gradients (the grid is the only repeating pattern, plus the card back's cross-hatching).

## Type

- **Kalam** (hand): titles only, like "Mesa de Póker", "Crupier", "Información", and winner lines. Never for numbers or for body text.
- **Atkinson Hyperlegible Next** (print): all UI text. It is chosen for readers of mixed ages.
- **Atkinson Hyperlegible Mono**: chips, pots, bets and room codes (the `.tabular` class).
- No spaced capitals.

## Objects

- Cards, chips and paper slips are real objects. They use `--shadow-object` (offset plus a soft blur) and lift to `--shadow-lift`.
- The table is an ink-outlined oval with a drop shadow onto the paper.
- Suits are drawn SVG, not glyphs.

## Motion

The authored moment is that the winner gets **circled in red pen**: a hand-drawn loop draws itself around their name plate. Everything else stays functional:

- Cards are dealt from the dealer.
- Chips slide to the pot, and then to the winner.
- Board cards flip.

All motion respects reduced-motion.

> **Superseded 2026-11-20:** the user moved to a dark, cozy look (dim room, warm lamp, walnut rail, matte felt, ember for what is at stake). Tokens live in `apps/web/src/index.css`.
