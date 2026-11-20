import type { Card } from '@poker/shared';

const SUIT: Record<string, { red: boolean; label: string }> = {
  s: { red: false, label: 'picas' },
  h: { red: true, label: 'corazones' },
  d: { red: true, label: 'diamantes' },
  c: { red: false, label: 'tréboles' },
};
const RANK_LABEL: Record<string, string> = { T: '10' };
const RANK_NAME: Record<string, string> = { A: 'As', K: 'Rey', Q: 'Reina', J: 'Jota', T: '10' };

/** Drawn suit marks (glyphs render as emoji on some phones). */
const SUIT_PATH: Record<string, string> = {
  h: 'M12 21.3 3.6 13C1.4 10.8 1.5 7.2 3.8 5.2c2.2-1.9 5.4-1.6 7.3.6l.9 1 .9-1c1.9-2.2 5.1-2.5 7.3-.6 2.3 2 2.4 5.6.2 7.8z',
  d: 'M12 1.8 20.2 12 12 22.2 3.8 12z',
  s: 'M12 1.8c-2.8 3.6-9.4 7.2-9.4 12 0 3 2.4 5 5 5 1.4 0 2.6-.6 3.4-1.5-.3 1.9-1.1 3.5-2.4 4.9h6.8c-1.3-1.4-2.1-3-2.4-4.9.8.9 2 1.5 3.4 1.5 2.6 0 5-2 5-5 0-4.8-6.6-8.4-9.4-12z',
  c: 'M12 2.2a4.6 4.6 0 0 0-3.9 7A4.6 4.6 0 1 0 10.9 17c-.3 1.9-1.1 3.6-2.3 5h6.8c-1.2-1.4-2-3.1-2.3-5a4.6 4.6 0 1 0 2.8-7.8 4.6 4.6 0 0 0-3.9-7z',
};

export function Suit({ s, className = '' }: { s: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={SUIT_PATH[s]} />
    </svg>
  );
}

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<CardSize, { box: string; rank: string; pip: string; center: string }> = {
  xs: { box: 'w-7 h-10 rounded-[4px]', rank: 'text-[12px]', pip: 'size-2', center: 'size-3.5' },
  sm: { box: 'w-10 h-14 rounded-[5px]', rank: 'text-[15px]', pip: 'size-2.5', center: 'size-5' },
  md: { box: 'w-14 h-20 sm:w-16 sm:h-[5.6rem] rounded-md', rank: 'text-lg sm:text-xl', pip: 'size-3', center: 'size-7 sm:size-8' },
  lg: { box: 'w-[4.5rem] h-[6.3rem] sm:w-20 sm:h-28 rounded-lg', rank: 'text-xl sm:text-2xl', pip: 'size-3.5', center: 'size-9 sm:size-10' },
};

/** A single card. `card === null` renders the back. */
export function PlayingCard({ card, size = 'md', dim = false, highlight = false }: { card: Card | null; size?: CardSize; dim?: boolean; highlight?: boolean }) {
  const s = SIZES[size];
  const base = `${s.box} relative shrink-0 select-none overflow-hidden border shadow-(--shadow-object)`;

  if (!card) {
    return (
      <div className={`${base} card-back border-black/40`} aria-label="Carta boca abajo">
        <div className="absolute inset-[3px] rounded-[inherit] border border-ivory/30" />
      </div>
    );
  }

  const rank = card[0];
  const suit = SUIT[card[1]];
  const corner = (
    <>
      <span>{RANK_LABEL[rank] ?? rank}</span>
      <Suit s={card[1]} className={`${s.pip} mt-0.5`} />
    </>
  );
  return (
    <div
      className={`${base} bg-ivory ${suit.red ? 'text-suit' : 'text-ink'} ${dim ? 'opacity-45' : ''} ${highlight ? 'border-ember ring-2 ring-ember' : 'border-black/15'}`}
      aria-label={`${RANK_NAME[rank] ?? rank} de ${suit.label}`}
      role="img"
    >
      <div className={`absolute left-[9%] top-[5%] flex flex-col items-center leading-none font-extrabold ${s.rank}`}>{corner}</div>
      {size !== 'xs' && (
        <div className={`absolute bottom-[5%] right-[9%] flex rotate-180 flex-col items-center leading-none font-extrabold ${s.rank}`}>{corner}</div>
      )}
      <div className={`absolute inset-0 grid place-items-center ${size === 'xs' ? 'pl-2 pt-3' : ''}`}>
        <Suit s={card[1]} className={s.center} />
      </div>
    </div>
  );
}
