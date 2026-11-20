import { useState } from 'react';
import { motion } from 'motion/react';
import { savedName, useStore } from '../store';
import { PlayingCard } from './PlayingCard';

export function Home() {
  const [name, setName] = useState(savedName);
  const [mode, setMode] = useState<'menu' | 'join'>('menu');
  const [code, setCode] = useState('');
  const { createRoom, joinRoom, busy } = useStore();
  const nameOk = name.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-5 py-10">
      <div className="relative mb-8 h-28 w-56" aria-hidden>
        {(['As', 'Kh'] as const).map((c, i) => (
          <motion.div
            key={c}
            className="absolute left-1/2 top-2"
            initial={{ opacity: 0, y: 20, rotate: 0, x: '-50%' }}
            animate={{ opacity: 1, y: 0, rotate: i === 0 ? -9 : 9, x: i === 0 ? '-78%' : '-22%' }}
            transition={{ delay: 0.15 + i * 0.12, type: 'spring', stiffness: 160, damping: 18 }}
          >
            <PlayingCard card={c} size="lg" />
          </motion.div>
        ))}
      </div>

      <h1 className="whitespace-nowrap text-center font-display text-5xl font-bold leading-none text-pen sm:text-7xl">Mesa de Póker</h1>
      <p className="mt-3 text-lg font-medium text-pencil">Tu mesa. Tus amigos. Tu partida.</p>

      <form
        className="mt-10 w-full space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!nameOk) return;
          if (mode === 'join') void joinRoom(name.trim(), code);
          else void createRoom(name.trim());
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-ink">Tu nombre en la mesa</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            autoComplete="nickname"
            placeholder="Ej. Carlos"
            className="h-14 w-full border-0 border-b-2 border-ink/60 bg-transparent px-1 font-display text-2xl text-pen placeholder:text-pencil/60 focus:border-pen focus:outline-none"
          />
        </label>

        {mode === 'menu' ? (
          <>
            <button type="submit" disabled={!nameOk || busy} className="h-14 w-full rounded-md bg-red text-lg font-bold text-slip shadow-(--shadow-object) transition hover:bg-red-dark active:scale-[.98] disabled:opacity-40">
              Crear partida
            </button>
            <button type="button" disabled={!nameOk} onClick={() => setMode('join')} className="h-14 w-full rounded-md border-2 border-pen bg-slip text-lg font-bold text-pen transition hover:bg-pen hover:text-slip active:scale-[.98] disabled:opacity-40">
              Unirse a una partida
            </button>
            {!nameOk && <p className="text-center text-sm text-pencil">Escribe tu nombre para empezar.</p>}
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-ink">Código de la sala</span>
              <div className="flex h-14 items-center border-b-2 border-ink/60 focus-within:border-pen">
                <span className="tabular pl-1 text-xl font-bold text-pencil">POKER-</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/^POKER-?/, '').replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  autoFocus
                  autoCapitalize="characters"
                  autoComplete="off"
                  inputMode="text"
                  placeholder="7KQ3M9"
                  className="tabular h-full w-full bg-transparent pr-1 text-xl font-bold text-pen placeholder:text-pencil/40 focus:outline-none"
                />
              </div>
            </label>
            <button type="submit" disabled={code.length !== 6 || busy} className="h-14 w-full rounded-md bg-red text-lg font-bold text-slip shadow-(--shadow-object) transition hover:bg-red-dark active:scale-[.98] disabled:opacity-40">
              Entrar a la mesa
            </button>
            <button type="button" onClick={() => setMode('menu')} className="h-12 w-full font-medium text-pencil hover:text-ink">
              Volver
            </button>
          </>
        )}
      </form>

      <p className="mt-12 text-center text-sm text-pencil">Juego amistoso con fichas virtuales. Sin dinero real.</p>
    </main>
  );
}
