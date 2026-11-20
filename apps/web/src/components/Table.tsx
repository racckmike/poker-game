import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { TableView } from '@poker/shared';
import { fmt, useStore } from '../store';
import { CENTER, DEALER_POS, betPoint, delta, seatPoint, useSize, type Pt } from '../layout';
import { ActionPanel } from './ActionPanel';
import { ChipStack } from './Chips';
import { Dealer } from './Dealer';
import { PlayingCard } from './PlayingCard';
import { Seat } from './Seat';

export function Table({ view }: { view: TableView }) {
  const [stageRef, size] = useSize<HTMLDivElement>();
  const portrait = size.w > 0 && size.w / size.h < 1.05;
  const compact = size.w < 640;
  const me = view.players.find((p) => p.id === view.youId)!;

  // Spread whoever is seated evenly around the 8 sketch positions, keeping clockwise order (me = sketch seat 4).
  const clockwise = [...view.players].sort((a, b) => ((a.seat - me.seat + 8) % 8) - ((b.seat - me.seat + 8) % 8));
  const slotOf = new Map(clockwise.map((p, i) => [p.seat, Math.round((i * 8) / clockwise.length) % 8]));
  const pointOf = (seat: number): Pt => seatPoint(slotOf.get(seat) ?? 0, portrait);
  const winnerIds = new Set(view.winners?.map((w) => w.playerId));
  const winningCards = view.winners?.flatMap((w) => w.hand?.cards ?? []) ?? [];
  const shuffling = useJustChanged(view.handNumber, 1200);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <InfoBar view={view} />

      <div ref={stageRef} className="relative min-h-0 flex-1">
        {size.w > 0 && (
          <>
            {/* Table: Dad's sketch, a matte felt oval outlined in ink */}
            <div
              className="absolute rounded-[999px] border-[3px] border-ink bg-felt shadow-[0_3px_3px_rgb(34_32_28/.2),0_24px_40px_-18px_rgb(34_32_28/.6)]"
              style={portrait ? { left: '8%', right: '8%', top: '9%', bottom: '13%' } : { left: '9%', right: '9%', top: '13%', bottom: '15%' }}
            >
              <div className="absolute inset-[6%] rounded-[999px] border-2 border-felt-line" />
            </div>

            {/* Dealer, top centre */}
            <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2 sm:top-3">
              <Dealer message={view.dealerMessage} shuffling={shuffling} />
            </div>

            {/* Pot + community cards */}
            <Positioned at={CENTER} className="z-10">
              <div className="flex flex-col items-center gap-2 sm:gap-3">
                <div className="grid min-h-[3.5rem] place-items-end sm:min-h-[4rem]">
                  <AnimatePresence mode="wait">
                    {view.street === 'complete' && view.winners?.length && view.phase === 'playing' ? (
                      <WinnerBanner key={`w-${view.handNumber}`} view={view} />
                    ) : (
                      <motion.div key="pot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center text-slip">
                        <p className="font-display text-lg leading-none sm:text-xl">Bote</p>
                        <motion.p key={view.totalPot} initial={{ scale: 1.12 }} animate={{ scale: 1 }} className="tabular mt-1 text-2xl font-bold leading-none sm:text-3xl">
                          {fmt(view.totalPot)} <span className="font-sans text-base font-medium text-slip/75 sm:text-lg">fichas</span>
                        </motion.p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <Board view={view} winningCards={winningCards} compact={compact} />
              </div>
            </Positioned>

            {/* Bets in front of players; they slide to the pot when the street ends */}
            <AnimatePresence>
              {view.players.filter((p) => p.committed > 0).map((p) => {
                const at = betPoint(pointOf(p.seat), p.id === me.id, portrait);
                const fromSeat = delta(pointOf(p.seat), at, size);
                const toPot = delta(CENTER, at, size);
                return (
                  <Positioned key={`${view.handNumber}-${view.street}-${p.id}`} at={at} className="z-10">
                    <motion.div
                      initial={{ x: fromSeat.x, y: fromSeat.y, opacity: 0 }}
                      animate={{ x: 0, y: 0, opacity: 1 }}
                      exit={{ x: toPot.x, y: toPot.y, opacity: 0, transition: { duration: 0.5, ease: 'easeIn' } }}
                      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                    >
                      <ChipStack amount={p.committed} compact={compact} mine={p.id === me.id} />
                    </motion.div>
                  </Positioned>
                );
              })}
            </AnimatePresence>

            {/* Pot flies to the winners */}
            <AnimatePresence>
              {view.street === 'complete' && view.winners?.map((w) => {
                const p = view.players.find((x) => x.id === w.playerId);
                if (!p) return null;
                const to = delta(pointOf(p.seat), CENTER, size);
                return (
                  <Positioned key={`win-${view.handNumber}-${w.playerId}`} at={CENTER} className="z-30">
                    <motion.div initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: to.x, y: to.y, opacity: [1, 1, 0] }} transition={{ delay: 0.9, duration: 0.9, ease: 'easeInOut' }}>
                      <ChipStack amount={w.amount} compact={compact} />
                    </motion.div>
                  </Positioned>
                );
              })}
            </AnimatePresence>

            {/* Players */}
            {view.players.map((p) => (
              <Positioned key={p.id} at={pointOf(p.seat)} className={p.id === me.id ? 'z-20' : 'z-10'}>
                <Seat
                  p={p}
                  isMe={p.id === me.id}
                  isTurn={view.toActId === p.id}
                  isWinner={view.street === 'complete' && winnerIds.has(p.id)}
                  winningCards={winningCards}
                  turnDeadline={view.toActId === p.id ? view.turnDeadline : null}
                  turnSeconds={view.settings.turnSeconds}
                  fromDealer={delta(DEALER_POS, pointOf(p.seat), size)}
                  handNumber={view.handNumber}
                  compact={compact}
                />
              </Positioned>
            ))}

            {view.phase === 'finished' && <Champion name={view.champion} />}
          </>
        )}
      </div>

      <ActionPanel view={view} />
    </div>
  );
}

function Positioned({ at, children, className = '' }: { at: Pt; children: React.ReactNode; className?: string }) {
  return (
    <div className={`absolute -translate-x-1/2 -translate-y-1/2 ${className}`} style={{ left: `${at[0]}%`, top: `${at[1]}%` }}>
      {children}
    </div>
  );
}

function Board({ view, winningCards, compact }: { view: TableView; winningCards: string[]; compact: boolean }) {
  return (
    <div className="flex gap-1.5 sm:gap-2">
      {Array.from({ length: 5 }).map((_, i) => {
        const c = view.board[i];
        return (
          <div key={i} className={`relative ${compact ? 'h-14 w-10' : 'h-20 w-14 sm:h-[5.6rem] sm:w-16'} rounded-md border-2 border-dashed border-slip/25`} style={{ perspective: 600 }}>
            <AnimatePresence>
              {c && (
                <motion.div
                  key={`${view.handNumber}-${c}`}
                  className="absolute inset-0"
                  initial={{ rotateY: 180, opacity: 0, y: -30 }}
                  animate={{ rotateY: 0, opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: i < 3 ? i * 0.15 : 0.05, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <PlayingCard card={c} size={compact ? 'sm' : 'md'} highlight={view.street === 'complete' && winningCards.includes(c)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function WinnerBanner({ view }: { view: TableView }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.25 }}
      className="rounded-md bg-slip px-4 py-2 text-center shadow-(--shadow-lift) sm:px-5"
      role="status"
    >
      {view.winners!.map((w) => (
        <div key={w.playerId}>
          <p className="whitespace-nowrap font-display text-xl font-bold leading-tight text-pen sm:text-2xl">
            ¡{w.name} gana <span className="tabular text-red">{fmt(w.amount)}</span>!
          </p>
          {w.hand && <p className="text-[13px] font-medium text-pencil sm:text-sm">con {w.hand.name.toLowerCase()}</p>}
        </div>
      ))}
    </motion.div>
  );
}

function Champion({ name }: { name: string | null }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-40 grid place-items-center bg-ink/40">
      <motion.div initial={{ scale: 0.9, y: 10, rotate: -2 }} animate={{ scale: 1, y: 0, rotate: -1 }} className="mx-4 rounded-md bg-slip px-8 py-7 text-center shadow-(--shadow-lift)">
        <p className="text-sm font-bold text-pencil">Fin de la partida</p>
        <p className="mt-2 font-display text-4xl font-bold text-red sm:text-5xl">{name ? `¡${name} gana!` : 'Partida terminada'}</p>
      </motion.div>
    </motion.div>
  );
}

function InfoBar({ view }: { view: TableView }) {
  const leave = useStore((s) => s.leave);
  const conn = useStore((s) => s.conn);
  const [confirm, setConfirm] = useState(false);
  const seated = view.players.length;

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b-2 border-ink/80 bg-paper px-3 text-[13px] sm:h-14 sm:gap-4 sm:px-5 sm:text-sm">
      <span className="hidden font-display text-xl font-bold text-pen sm:inline">Información</span>
      <Item label="Sala" value={view.roomCode} hideLabelOnMobile />
      <Item label="Mano" value={`#${view.handNumber}`} />
      <Item label="Ciegas" value={`${fmt(view.settings.smallBlind)}/${fmt(view.settings.bigBlind)}`} />
      <Item label="Jugadores" value={String(seated)} hideOnMobile />
      <span className={`ml-auto h-2.5 w-2.5 rounded-full ${conn === 'online' ? 'bg-felt' : 'bg-red'}`} title={conn === 'online' ? 'Conectado' : 'Reconectando'} role="img" aria-label={conn === 'online' ? 'Conectado' : 'Reconectando'} />
      {confirm ? (
        <span className="flex items-center gap-1">
          <button onClick={() => void leave()} className="rounded-md bg-red px-2.5 py-1.5 font-bold text-slip hover:bg-red-dark">Salir</button>
          <button onClick={() => setConfirm(false)} className="rounded-md px-2 py-1.5 font-medium text-pencil hover:text-ink">Cancelar</button>
        </span>
      ) : (
        <button onClick={() => setConfirm(true)} className="rounded-md px-2.5 py-1.5 font-medium text-pencil hover:bg-paper-2 hover:text-ink">Salir</button>
      )}
    </header>
  );
}

function Item({ label, value, hideOnMobile, hideLabelOnMobile }: { label: string; value: string; hideOnMobile?: boolean; hideLabelOnMobile?: boolean }) {
  return (
    <span className={`${hideOnMobile ? 'hidden sm:flex' : 'flex'} items-baseline gap-1.5`}>
      <span className={`text-pencil ${hideLabelOnMobile ? 'hidden sm:inline' : ''}`}>{label}</span>
      <span className="tabular whitespace-nowrap font-bold text-ink">{value}</span>
    </span>
  );
}

/** True for `ms` after `value` changes (used for the dealer's shuffle wiggle). */
function useJustChanged(value: unknown, ms: number) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return on;
}
