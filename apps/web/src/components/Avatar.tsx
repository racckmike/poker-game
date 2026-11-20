/** Initials inside a pen-drawn circle. `seat` is kept for API stability. */
export function Avatar({ name, size = 44 }: { name: string; seat?: number; size?: number }) {
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full border-2 border-pen bg-slip font-display font-bold leading-none text-pen"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      <span className="translate-y-[0.06em]">{initials}</span>
    </div>
  );
}
