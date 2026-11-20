import { fmt } from '../store';

const COLORS = ['#c8322b', '#1f3a8a', '#22201c', '#2f6b3f'];

/** A small stack of chips with the amount on a paper tag. `mine` marks your own bet in red ink. */
export function ChipStack({ amount, compact = false, mine = false }: { amount: number; compact?: boolean; mine?: boolean }) {
  const n = Math.min(5, Math.max(1, Math.ceil(Math.log10(amount + 1))));
  const size = compact ? 16 : 20;
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size + (n - 1) * 3 }}>
        {Array.from({ length: n }).map((_, i) => (
          <Chip key={i} color={COLORS[(amount + i) % COLORS.length]} size={size} style={{ position: 'absolute', bottom: i * 3, left: 0 }} />
        ))}
      </div>
      <span
        className={`tabular rounded-[3px] px-1.5 py-0.5 font-bold shadow-(--shadow-object) ${compact ? 'text-[12px]' : 'text-sm'} ${mine ? 'bg-red text-slip' : 'bg-slip text-ink'}`}
      >
        {fmt(amount)}
      </span>
    </div>
  );
}

/** A flat clay chip: coloured disc with cream edge marks and a real drop shadow. */
export function Chip({ color, size = 20, style }: { color: string; size?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `repeating-conic-gradient(${color} 0 36deg, #fcfaf4 36deg 54deg)`,
        boxShadow: '0 1px 1px rgb(34 32 28 / .35), 0 2px 4px -1px rgb(34 32 28 / .4)',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', inset: size * 0.22, borderRadius: '50%', background: color, boxShadow: 'inset 0 0 0 1px rgb(252 250 244 / .5)' }} />
    </div>
  );
}
