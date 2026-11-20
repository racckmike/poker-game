import { AnimatePresence, motion } from 'motion/react';
import { useStore } from './store';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Table } from './components/Table';
import { Toast } from './components/Toast';
import { RemoteAudio } from './components/MediaControls';

export function App() {
  const view = useStore((s) => s.view);
  const resuming = useStore((s) => s.resuming);
  const screen = !view ? (resuming ? 'loading' : 'home') : view.phase === 'lobby' ? 'lobby' : 'table';

  return (
    <div className="min-h-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="min-h-full"
        >
          {screen === 'loading' && (
            <div className="grid min-h-dvh place-items-center text-lg font-bold text-dim">Volviendo a tu mesa…</div>
          )}
          {screen === 'home' && <Home />}
          {screen === 'lobby' && <Lobby view={view!} />}
          {screen === 'table' && <Table view={view!} />}
        </motion.div>
      </AnimatePresence>
      <Toast />
      <RemoteAudio />
    </div>
  );
}
