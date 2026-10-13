/**
 * The OpenRemarkable mark: a tablet whose corner is left open, with a pen
 * writing its way out of it. Drawn in currentColor so it fits any surface.
 */
export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* the tablet, open at the top-right */}
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
      {/* the pen, leaving through the open corner */}
      <path d="M20.5 3.5a1.4 1.4 0 0 0-2-2L11 9l-.6 2.6L13 11z" />
      {/* a line of handwriting */}
      <path d="M8.5 16.5c1.2-1.2 2.2.8 3.4-.4s2.2.8 3.6-.6" />
    </svg>
  );
}
