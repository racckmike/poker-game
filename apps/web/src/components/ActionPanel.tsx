import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { TableView } from '@poker/shared';
import { fmt, useStore } from '../store';

/** Bottom panel: legal actions on my turn, otherwise a calm status line. */
export function ActionPanel({ view }: { view: TableView }) {
  const { act, show, restart, busy } = useStore();
  const me = view.players.find((p) => p.id === view.youId);
  const l = view.legal;
  const range = l?.bet ?? l?.raise ?? null;
  const [amount, setAmount] = useState(range?.min ?? 0);
  const [shownHand, setShownHand] = useState(0);

  // Reset the selector whenever a new decision starts.
  useEffect(() => {
    if (range) setAmount(range.min);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.toActId, view.street, view.handNumber, range?.min, range?.max]);

  if (!me) return null;

  if (view.phase === 'finished') {
    return (
      <Shell>
        <p className="text-center text-sm text-dim">
          {view.champion ? `${view.champion} se quedó con todas las fichas.` : 'La partida terminó.'}
        </p>
        {view.hostId === view.youId ? (
          <BigButton onClick={() => void restart()} disabled={busy} tone="stake">Jugar otra partida</BigButton>
        ) : (
          <p className="text-center text-sm text-dim">El anfitrión puede empezar otra partida.</p>
        )}
      </Shell>
    );
  }

  if (!l) {
    const actor = view.players.find((p) => p.id === view.toActId);
    // Winning without a showdown: the winner may choose to show their hand ("mostrar su juego").
    const canShow = view.street === 'complete' && !!view.winners?.some((w) => w.playerId === me.id && !w.hand) && shownHand !== view.handNumber;
    let text = actor ? `Turno de ${actor.name}…` : 'El crupier prepara la siguiente mano…';
    if (me.status === 'folded' && view.street !== 'complete') text = `Te retiraste. ${actor ? `Turno de ${actor.name}.` : ''}`;
    if (me.status === 'waiting') text = 'Entrarás en la próxima mano.';
    if (me.status === 'out') text = 'Te quedaste sin fichas. Puedes seguir mirando la partida.';
    if (!me.connected) text = 'Reconectando…';
    return (
      <Shell>
        <div className="flex min-h-14 items-center justify-center gap-3">
          <p className="text-center text-[15px] font-medium text-cream sm:text-base">{text}</p>
          {canShow && (
            <button onClick={() => { setShownHand(view.handNumber); void show(); }} disabled={busy} className="rounded-md border-2 border-cream/50 px-4 py-2 text-sm font-bold text-cream hover:bg-cream hover:text-room">
              Mostrar mis cartas
            </button>
          )}
        </div>
      </Shell>
    );
  }

  const pot = view.totalPot;
  const toCall = l.call;
  const presets = range
    ? [
        { label: 'Mín.', v: range.min },
        { label: '½ bote', v: Math.round(me.committed + toCall + (pot + toCall) / 2) },
        { label: 'Bote', v: me.committed + toCall + pot + toCall },
      ].map((p) => ({ ...p, v: Math.min(range.max, Math.max(range.min, p.v)) }))
    : [];
  const isAllIn = range && amount >= range.max;

  return (
    <Shell>
      <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }} className="space-y-3">
        {range && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex gap-1.5">
              {presets.map((p) => (
                <button key={p.label} onClick={() => setAmount(p.v)} className="rounded-md border border-cream/25 bg-room-2 px-3 py-1.5 text-[13px] font-bold text-cream hover:border-cream/60">
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={Math.max(1, Math.floor(view.settings.bigBlind / 2))}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Cantidad"
              className="order-first h-8 min-w-[120px] basis-full sm:order-none sm:basis-auto sm:flex-1"
            />
            <input
              type="number"
              inputMode="numeric"
              min={range.min}
              max={range.max}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              onBlur={() => setAmount((a) => Math.min(range.max, Math.max(range.min, Math.round(a) || range.min)))}
              aria-label="Cantidad exacta"
              className="tabular ml-auto h-10 w-24 rounded-md border-2 border-cream/30 bg-room-2 px-2 text-center font-bold text-cream focus:border-ember focus:outline-none sm:ml-0"
            />
          </div>
        )}
        <div className="grid grid-flow-col auto-cols-fr gap-2">
          {l.fold && <BigButton onClick={() => void act({ type: 'fold' })} disabled={busy} tone="quiet">Retirarse</BigButton>}
          {l.check && <BigButton onClick={() => void act({ type: 'check' })} disabled={busy} tone="safe">Pasar</BigButton>}
          {l.call > 0 && (
            <BigButton onClick={() => void act({ type: 'call' })} disabled={busy} tone="safe">
              Igualar <span className="tabular text-[15px] sm:text-base">{fmt(l.call)}</span>
            </BigButton>
          )}
          {range && (
            <BigButton
              onClick={() => {
                const a = Math.min(range.max, Math.max(range.min, Math.round(amount)));
                void act(a >= range.max ? { type: 'allin' } : { type: l.bet ? 'bet' : 'raise', amount: a });
              }}
              disabled={busy}
              tone="stake"
            >
              {isAllIn ? 'All-in' : l.bet ? 'Apostar' : 'Subir a'} <span className="tabular text-[15px] sm:text-base">{fmt(Math.min(range.max, Math.max(range.min, amount)))}</span>
            </BigButton>
          )}
          {l.allin > 0 && range && !isAllIn && (
            <BigButton onClick={() => void act({ type: 'allin' })} disabled={busy} tone="outline">All-in</BigButton>
          )}
        </div>
      </motion.div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[8.5rem] shrink-0 items-center border-t border-cream/10 bg-room-2 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-3">{children}</div>
    </div>
  );
}

function BigButton({ children, onClick, disabled, tone = 'safe' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: 'safe' | 'stake' | 'quiet' | 'outline' }) {
  // Ember is reserved for what is at stake (bet/raise/all-in); cream for the safe moves; outline for folding.
  const tones = {
    safe: 'bg-cream text-room hover:bg-white shadow-(--shadow-object)',
    stake: 'bg-ember text-room hover:bg-ember-dark shadow-(--shadow-object)',
    quiet: 'border-2 border-cream/30 text-cream hover:border-cream/70',
    outline: 'border-2 border-ember text-ember hover:bg-ember hover:text-room',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`flex h-14 flex-col items-center justify-center whitespace-nowrap rounded-md px-1 text-base font-bold leading-tight sm:flex-row sm:gap-1.5 sm:px-2 transition active:scale-[.97] disabled:opacity-50 sm:text-base ${tones[tone]}`}>
      {children}
    </button>
  );
}
