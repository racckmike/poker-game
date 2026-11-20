import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store';

/** Errors from the server, shown briefly at the top. */
export function Toast() {
  const error = useStore((s) => s.error);
  const conn = useStore((s) => s.conn);
  const clear = useStore((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clear, 4500);
    return () => clearTimeout(t);
  }, [error, clear]);

  const message = error ?? (conn === 'offline' || conn === 'connecting' ? 'Reconectando con el servidor…' : null);
  const show = !!error || conn === 'offline';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence>
        {show && message && (
          <motion.button
            type="button"
            onClick={clear}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="pointer-events-auto max-w-md rounded-md border-2 border-ember bg-room-2 px-4 py-3 text-sm font-medium text-cream shadow-(--shadow-lift)"
          >
            {message}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
