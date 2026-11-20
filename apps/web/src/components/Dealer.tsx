import { AnimatePresence, motion } from 'motion/react';

/** The dealer at the top centre: a tag with the deck, and a line for announcements. */
export function Dealer({ message, shuffling }: { message: string; shuffling: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3 rounded-md border border-cream/10 bg-room-2 py-1 pl-3 pr-2.5 shadow-(--shadow-object)">
        <p className="text-base font-extrabold leading-none tracking-tight text-cream sm:text-lg">Crupier</p>
        <motion.div
          className="relative h-8 w-6"
          animate={shuffling ? { rotate: [0, -8, 8, -6, 6, 0] } : { rotate: 0 }}
          transition={{ duration: 0.9 }}
          aria-hidden
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-back absolute inset-0 rounded-[3px] border border-black/40" style={{ transform: `translate(${i * 1.5}px, ${-i * 1.5}px)` }} />
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
            className="max-w-[78vw] truncate rounded-[3px] bg-room-2/95 px-2.5 py-1 text-center text-[13px] font-medium text-cream shadow-(--shadow-object) sm:max-w-md sm:text-sm"
            aria-live="polite"
          >
            {message}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
