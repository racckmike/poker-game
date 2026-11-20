import { AnimatePresence, motion } from 'motion/react';
import type { SeatView } from '@poker/shared';
import { fmt } from '../store';
import { Avatar } from './Avatar';
import { PlayingCard } from './PlayingCard';

const STATUS_ES: Partial<Record<SeatView['status'], string>> = {
  folded: 'Retirado',
  allin: 'All-in',
  out: 'Sin fichas',
  'sitting-out': 'Ausente',
  waiting: 'Próxima mano',
};

interface Props {
  p: SeatView;
  isMe: boolean;
  isTurn: boolean;
  isWinner: boolean;
  winningCards: string[];
  turnDeadline: number | null;
  turnSeconds: number;
  /** Pixel offset from this seat to the dealer, for the deal animation. */
  fromDealer: { x: number; y: number };
  handNumber: number;
  compact: boolean;
}

export function Seat({ p, isMe, isTurn, isWinner, winningCards, turnDeadline, turnSeconds, fromDealer, handNumber, compact }: Props) {
  const status = !p.connected ? 'Desconectado' : STATUS_ES[p.status];
  const faded = p.status === 'folded' || p.status === 'out' || p.status === 'sitting-out' || !p.connected;
  const cardSize = isMe ? (compact ? 'md' : 'lg') : compact ? 'xs' : 'sm';

  return (
    <div className={`flex flex-col items-center ${isMe ? 'gap-1.5' : 'gap-1'}`}>
      {/* Hole cards */}
      <div className={`flex ${isMe ? 'gap-1.5' : '-space-x-2'} ${isMe ? 'h-auto' : compact ? 'h-10' : 'h-14'}`}>
        <AnimatePresence>
          {p.cards?.map((c, i) => (
            <motion.div
              key={`${handNumber}-${i}`}
              initial={{ x: fromDealer.x, y: fromDealer.y, opacity: 0, scale: 0.5, rotate: -20 }}
              animate={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: isMe ? 0 : i === 0 ? -6 : 6 }}
              exit={{ x: fromDealer.x * 0.5, y: fromDealer.y * 0.5 + 40, opacity: 0, scale: 0.6, rotate: 25, transition: { duration: 0.45 } }}
              transition={{ delay: (p.seat * 0.05 + i * 0.35) % 1.2, type: 'spring', stiffness: 170, damping: 20 }}
              style={{ zIndex: i }}
            >
              <motion.div
                key={c ?? 'back'}
                initial={c && !isMe ? { rotateY: 90 } : false}
                animate={{ rotateY: 0 }}
                transition={{ duration: 0.35 }}
              >
                <PlayingCard card={c} size={cardSize} dim={p.status === 'folded'} highlight={!!c && winningCards.includes(c)} />
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Name plate: a paper slip; red ink border on your turn, circled in red pen when winning */}
      <div className="relative">
        <div
          className={[
            'relative flex items-center rounded-md border-2 bg-slip shadow-(--shadow-object) transition-[border-color,opacity] duration-300',
            compact ? 'gap-1.5 py-0.5 pl-0.5 pr-2' : 'gap-2 py-1 pl-1 pr-3',
            isTurn ? 'border-red' : 'border-transparent',
            faded ? 'opacity-60' : '',
          ].join(' ')}
        >
          <div className="relative">
            <Avatar name={p.name} size={compact ? 26 : isMe ? 40 : 34} />
            {p.isButton && (
              <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border border-ink bg-slip text-[9px] font-extrabold text-ink" title="Botón del repartidor">
                D
              </span>
            )}
          </div>
          <div className={`min-w-0 leading-tight ${compact ? 'max-w-[68px]' : 'max-w-[110px]'}`}>
            <p className={`truncate font-bold text-ink ${compact ? 'text-[12px]' : 'text-sm'}`}>
              {p.name}
              {isMe && <span className="font-normal text-pencil"> (tú)</span>}
            </p>
            <p className={`tabular font-bold text-pen ${compact ? 'text-[12px]' : 'text-sm'}`}>{fmt(p.stack)}</p>
          </div>

          {isTurn && turnDeadline && (
            <TurnBar key={turnDeadline} deadline={turnDeadline} total={turnSeconds * 1000} />
          )}
        </div>
        {isWinner && <PenCircle />}
      </div>

      {/* Status / last action, on its own paper tag so it reads over felt or paper */}
      <div className={`flex h-5 items-center ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {status ? (
          <span className={`rounded-[3px] px-1.5 py-px font-bold ${p.status === 'allin' ? 'bg-red text-slip' : 'bg-slip/90 text-pencil'}`}>{status}</span>
        ) : p.lastAction ? (
          <span className="rounded-[3px] bg-slip/90 px-1.5 py-px font-medium text-ink">{p.lastAction}</span>
        ) : null}
      </div>
    </div>
  );
}

/** The winner gets circled in red pen: a loose loop that draws itself, overshooting its start. */
function PenCircle() {
  return (
    <svg className="pointer-events-none absolute -inset-x-4 -inset-y-3 h-[calc(100%+1.5rem)] w-[calc(100%+2rem)] overflow-visible" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden>
      <motion.path
        d="M118 7C64 3 12 18 8 48c-4 30 50 47 100 45 52-2 88-20 86-46C192 20 150 4 96 9 70 12 52 18 40 26"
        fill="none"
        stroke="var(--color-red)"
        strokeWidth="2.6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.7, ease: [0.3, 0.7, 0.2, 1] }}
      />
    </svg>
  );
}

function TurnBar({ deadline, total }: { deadline: number; total: number }) {
  const remaining = Math.max(0, deadline - Date.now());
  return (
    <div className="absolute inset-x-3 -bottom-[2px] h-[3px] overflow-hidden rounded-full bg-ink/10">
      <motion.div
        className="h-full origin-left rounded-full bg-red"
        initial={{ scaleX: Math.min(1, remaining / total) }}
        animate={{ scaleX: 0 }}
        transition={{ duration: remaining / 1000, ease: 'linear' }}
      />
    </div>
  );
}
