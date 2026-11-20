import { useState } from 'react';
import { motion } from 'motion/react';
import { MAX_PLAYERS, MIN_PLAYERS, type TableView } from '@poker/shared';
import { fmt, useStore } from '../store';
import { Avatar } from './Avatar';

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
        <button onClick={() => void leave()} className="rounded-md px-3 py-2 text-sm font-medium text-pencil hover:bg-paper-2 hover:text-ink">
          ← Salir
        </button>
        <span className="font-display text-2xl font-bold text-pen">Sala privada</span>
        <span className="w-16" />
      </header>

      <section className="mt-6 rounded-md border-[3px] border-ink bg-felt p-6 text-center text-slip shadow-(--shadow-lift)">
        <p className="font-display text-xl">Código de invitación</p>
        <p className="tabular mt-1 text-3xl font-bold sm:text-5xl">{view.roomCode}</p>
        <button onClick={share} className="mt-4 rounded-md bg-slip px-5 py-2.5 text-sm font-bold text-pen shadow-(--shadow-object) transition hover:bg-paper active:scale-95">
          {copied ? 'Código copiado' : 'Compartir código'}
        </button>
        <p className="mt-3 text-sm text-slip/85">Compártelo con tus amigos para que se unan desde su teléfono o computadora.</p>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-3xl font-bold text-pen">Jugadores</h2>
          <span className="text-sm font-medium text-pencil">
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
              className={`flex h-16 items-center gap-3 rounded-md px-3 ${p ? 'bg-slip shadow-(--shadow-object)' : 'border-2 border-dashed border-ink/20 text-pencil'}`}
            >
              <span className="w-5 text-center font-display text-lg text-pencil">{i + 1}</span>
              {p ? (
                <>
                  <Avatar name={p.name} seat={p.seat} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">
                      {p.name} {p.id === view.youId && <span className="font-normal text-pencil">(tú)</span>}
                    </p>
                    <p className="text-[13px] text-pencil">
                      {p.connected ? 'Conectado' : 'Desconectado'}
                    </p>
                  </div>
                  {p.isHost ? (
                    <span className="rounded-[3px] border border-pen px-2 py-0.5 text-[13px] font-bold text-pen">Anfitrión</span>
                  ) : (
                    <span className={`rounded-[3px] px-2 py-0.5 text-[13px] font-bold ${p.ready ? 'bg-felt text-slip' : 'border border-ink/25 text-pencil'}`}>
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
        <h2 className="font-display text-3xl font-bold text-pen">Reglas de la mesa</h2>
        <p className="mt-1 text-sm text-pencil">Texas Hold'em · fichas virtuales {isHost ? '' : '· solo el anfitrión puede cambiarlas'}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select label="Fichas iniciales" value={view.settings.startingStack} options={STACKS} disabled={!isHost || busy} format={fmt}
            onChange={(v) => void updateSettings({ startingStack: v, ...(view.settings.bigBlind * 10 > v ? { bigBlind: 10 } : {}) })} />
          <Select label="Ciegas" value={view.settings.bigBlind} options={BLINDS.filter((b) => b * 10 <= view.settings.startingStack)} disabled={!isHost || busy}
            format={(b) => `${fmt(Math.floor(b / 2))} / ${fmt(b)}`} onChange={(v) => void updateSettings({ bigBlind: v })} />
          <Select label="Tiempo por turno" value={view.settings.turnSeconds} options={TIMERS} disabled={!isHost || busy}
            format={(t) => `${t} segundos`} onChange={(v) => void updateSettings({ turnSeconds: v })} />
        </div>
      </section>

      <div className="sticky bottom-0 mt-auto bg-paper/95 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        {isHost ? (
          <>
            <button disabled={!canStart || busy} onClick={() => void startGame()} className="h-14 w-full rounded-md bg-red text-lg font-bold text-slip shadow-(--shadow-object) transition hover:bg-red-dark active:scale-[.98] disabled:opacity-40">
              Empezar partida
            </button>
            <p className="mt-2 text-center text-sm font-medium text-pencil">
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
              className={`h-14 w-full rounded-md text-lg font-bold transition active:scale-[.98] ${me.ready ? 'border-2 border-pen bg-slip text-pen' : 'bg-red text-slip shadow-(--shadow-object) hover:bg-red-dark'}`}>
              {me.ready ? 'Ya no estoy listo' : 'Estoy listo'}
            </button>
            <p className="mt-2 text-center text-sm font-medium text-pencil">El anfitrión iniciará la partida cuando todos estén listos.</p>
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
      <span className="mb-1 block text-sm font-bold text-ink">{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
        className="h-12 w-full rounded-md border-2 border-ink/30 bg-slip px-3 font-medium text-ink focus:border-pen focus:outline-none disabled:border-ink/15 disabled:text-pencil">
        {opts.map((o) => <option key={o} value={o}>{format(o)}</option>)}
      </select>
    </label>
  );
}
