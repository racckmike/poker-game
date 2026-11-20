import { AnimatePresence, motion } from 'motion/react';

/** The dealer at the top centre: a paper tag with the deck, and a note slip for announcements. */
export function Dealer({ message, shuffling }: { message: string; shuffling: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3 rounded-md border border-ink/15 bg-slip py-1 pl-3 pr-2.5 shadow-(--shadow-object)">
        <p className="font-display text-lg font-bold leading-none text-pen sm:text-xl">Crupier</p>
        <motion.div
          className="relative h-8 w-6"
          animate={shuffling ? { rotate: [0, -8, 8, -6, 6, 0] } : { rotate: 0 }}
          transition={{ duration: 0.9 }}
          aria-hidden
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-back absolute inset-0 rounded-[3px] border border-ink/30" style={{ transform: `translate(${i * 1.5}px, ${-i * 1.5}px)` }} />
          ))}
        </motion.div>
      </div>
      <div className="relative mt-2 flex h-8 items-start justify-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={message}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="max-w-[78vw] truncate rounded-[3px] bg-slip/95 px-2.5 py-1 text-center text-[13px] font-medium text-ink shadow-(--shadow-object) sm:max-w-md sm:text-sm"
            aria-live="polite"
          >
            {message}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
