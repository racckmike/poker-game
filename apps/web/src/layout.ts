import { useEffect, useRef, useState } from 'react';

export type Pt = [x: number, y: number]; // percent of the stage

/**
 * Seat positions follow the handwritten sketch: seats are numbered 1–8 clockwise,
 * "Jugador 4 (Yo)" sits at the bottom centre and the dealer is at the top centre.
 * Keys are sketch numbers; the local player is always sketch seat 4.
 */
const LANDSCAPE: Record<number, Pt> = {
  4: [50, 87], 5: [27, 86], 6: [8.5, 68], 7: [7, 36], 8: [23, 16], 1: [77, 16], 2: [93, 36], 3: [91.5, 68],
};
const PORTRAIT: Record<number, Pt> = {
  4: [50, 88], 5: [17, 78], 6: [11, 63], 7: [11, 37], 8: [25, 19], 1: [75, 19], 2: [89, 37], 3: [89, 63],
};

export const DEALER_POS: Pt = [50, 6]; // deck position, origin of the deal animation
export const CENTER: Pt = [50, 47];

/** Screen position for a player, given how many seats clockwise they sit from me. */
export function seatPoint(offset: number, portrait: boolean): Pt {
  const sketch = ((4 - 1 + offset) % 8) + 1; // me = 4, next clockwise = 5, …, 8, 1, 2, 3
  return (portrait ? PORTRAIT : LANDSCAPE)[sketch];
}

/** Where a player's bet sits: between the seat and the centre, kept clear of the board on narrow screens. */
export function betPoint(seat: Pt, isMe: boolean, portrait: boolean): Pt {
  if (isMe) return lerp(seat, CENTER, 0.62);
  if (portrait) return [seat[0] + (CENTER[0] - seat[0]) * 0.42, seat[1] + (CENTER[1] - seat[1]) * (seat[1] < 30 ? 0.42 : 0.12)];
  return lerp(seat, CENTER, 0.38);
}

export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Pixel delta between two stage points. */
export const delta = (from: Pt, to: Pt, size: { w: number; h: number }) => ({
  x: ((from[0] - to[0]) / 100) * size.w,
  y: ((from[1] - to[1]) / 100) * size.h,
});

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
