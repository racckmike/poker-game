import { useState } from 'react';
import { motion } from 'motion/react';
import { MAX_PLAYERS, MIN_PLAYERS, type TableView } from '@poker/shared';
import { fmt, useStore } from '../store';
import { Avatar, MediaControls } from './MediaControls';

const STACKS = [500, 1000, 2000, 5000];
const BLINDS = [10, 20, 50, 100];
const TIMERS = [20, 30, 45, 60];

export function Lobby({ view }: { view: TableView }) {
  const { setReady, updateSettings, startGame, leave, busy } = useStore();
  const me = view.players.find((p) => p.id === view.youId)!;
  const isHost = view.hostId === view.youId;
  const notReady = view.players.filter((p) => !p.ready);
  const enough = view.players.length >= MIN_PLAYERS;
  const canStart = isHost && enough && notReady.length === 0;
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const text = `Únete a mi mesa de póker con el código ${view.roomCode}: ${location.origin}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Mesa de Póker', text });
      else {
        await navigator.clipboard.writeText(view.roomCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };

  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => view.players.find((p) => p.seat === i) ?? null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between">
        <button onClick={() => void leave()} className="rounded-md px-3 py-2 text-sm font-medium text-dim hover:bg-room-3 hover:text-cream">
          ← Salir
        </button>
        <span className="text-xl font-extrabold tracking-tight text-cream">Sala privada</span>
        <MediaControls className="items-end" />
      </header>

      <section className="rail mt-6 rounded-2xl p-2.5 text-center shadow-(--shadow-lift)">
        <div className="felt rounded-xl p-6 text-cream shadow-[inset_0_3px_10px_rgb(0_0_0/.45)]">
        <p className="text-lg font-bold text-cream/85">Código de invitación</p>
        <p className="tabular mt-1 text-3xl font-bold sm:text-5xl">{view.roomCode}</p>
        <button onClick={share} className="mt-4 rounded-md bg-cream px-5 py-2.5 text-sm font-bold text-room shadow-(--shadow-object) transition hover:bg-white active:scale-95">
          {copied ? 'Código copiado' : 'Compartir código'}
        </button>
        <p className="mt-3 text-sm text-cream/85">Compártelo con tus amigos para que se unan desde su teléfono o computadora.</p>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl font-extrabold tracking-tight text-cream">Jugadores</h2>
          <span className="text-sm font-medium text-dim">
            {view.players.length} de {MAX_PLAYERS} asientos
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {seats.map((p, i) => (
            <motion.li
              key={p?.id ?? `empty-${i}`}
              layout
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`flex h-16 items-center gap-3 rounded-md px-3 ${p ? 'bg-room-2 shadow-(--shadow-object)' : 'border-2 border-dashed border-cream/20 text-dim'}`}
            >
              <span className="tabular w-5 text-center text-sm text-dim">{i + 1}</span>
              {p ? (
                <>
                  <Avatar p={p} isMe={p.id === view.youId} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-cream">
                      {p.name} {p.id === view.youId && <span className="font-normal text-dim">(tú)</span>}
                    </p>
                    <p className="text-[13px] text-dim">
                      {p.connected ? 'Conectado' : 'Desconectado'}
                    </p>
                  </div>
                  {p.isHost ? (
                    <span className="rounded-[3px] border border-cream/50 px-2 py-0.5 text-[13px] font-bold text-cream">Anfitrión</span>
                  ) : (
                    <span className={`rounded-[3px] px-2 py-0.5 text-[13px] font-bold ${p.ready ? 'bg-sage text-room' : 'border border-cream/25 text-dim'}`}>
                      {p.ready ? 'Listo' : 'No listo'}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm font-medium">Asiento libre</span>
              )}
            </motion.li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-extrabold tracking-tight text-cream">Reglas de la mesa</h2>
        <p className="mt-1 text-sm text-dim">Texas Hold'em · fichas virtuales {isHost ? '' : '· solo el anfitrión puede cambiarlas'}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select label="Fichas iniciales" value={view.settings.startingStack} options={STACKS} disabled={!isHost || busy} format={fmt}
            onChange={(v) => void updateSettings({ startingStack: v, ...(view.settings.bigBlind * 10 > v ? { bigBlind: 10 } : {}) })} />
          <Select label="Ciegas" value={view.settings.bigBlind} options={BLINDS.filter((b) => b * 10 <= view.settings.startingStack)} disabled={!isHost || busy}
            format={(b) => `${fmt(Math.floor(b / 2))} / ${fmt(b)}`} onChange={(v) => void updateSettings({ bigBlind: v })} />
          <Select label="Tiempo por turno" value={view.settings.turnSeconds} options={TIMERS} disabled={!isHost || busy}
            format={(t) => `${t} segundos`} onChange={(v) => void updateSettings({ turnSeconds: v })} />
        </div>
      </section>

      <div className="sticky bottom-0 mt-auto bg-room/95 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        {isHost ? (
          <>
            <button disabled={!canStart || busy} onClick={() => void startGame()} className="h-14 w-full rounded-md bg-ember text-lg font-bold text-room shadow-(--shadow-object) transition hover:bg-ember-dark active:scale-[.98] disabled:opacity-40">
              Empezar partida
            </button>
            <p className="mt-2 text-center text-sm font-medium text-dim">
              {!enough
                ? `Se necesitan al menos ${MIN_PLAYERS} jugadores (faltan ${MIN_PLAYERS - view.players.length}).`
                : notReady.length
                  ? `Esperando a: ${notReady.map((p) => p.name).join(', ')}`
                  : '¡Todos listos!'}
            </p>
          </>
        ) : (
          <>
            <button onClick={() => void setReady(!me.ready)} disabled={busy}
              className={`h-14 w-full rounded-md text-lg font-bold transition active:scale-[.98] ${me.ready ? 'border-2 border-cream/30 text-cream' : 'bg-ember text-room shadow-(--shadow-object) hover:bg-ember-dark'}`}>
              {me.ready ? 'Ya no estoy listo' : 'Estoy listo'}
            </button>
            <p className="mt-2 text-center text-sm font-medium text-dim">El anfitrión iniciará la partida cuando todos estén listos.</p>
          </>
        )}
      </div>
    </main>
  );
}

function Select({ label, value, options, onChange, disabled, format }: {
  label: string; value: number; options: number[]; onChange: (v: number) => void; disabled: boolean; format: (v: number) => string;
}) {
  const opts = options.includes(value) ? options : [value, ...options];
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-cream">{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
        className="h-12 w-full rounded-md border-2 border-cream/15 bg-room-2 px-3 font-medium text-cream focus:border-ember focus:outline-none disabled:border-cream/15 disabled:text-dim">
        {opts.map((o) => <option key={o} value={o}>{format(o)}</option>)}
      </select>
    </label>
  );
}
