import Link from "next/link";

/**
 * The Thesis mark: a T drawn as a market event. The crossbar is the strike
 * line, the stem is price rising into it, and the vermilion dot is the touch,
 * the moment the call is proven. Both strokes are notched around the dot, so
 * the mark works on any background without a mask.
 *
 * Geometry (48 grid): bar 38x7 at y=7, stem 9 wide, dot r=4.5 at (24,16),
 * 2.5 clearance all round.
 */
export const MARK_PATHS = {
  bar: "M5 8.5A1.5 1.5 0 0 1 6.5 7H41.5A1.5 1.5 0 0 1 43 8.5V12.5A1.5 1.5 0 0 1 41.5 14H30.708A7 7 0 0 0 17.292 14H6.5A1.5 1.5 0 0 1 5 12.5Z",
  stem: "M19.5 21.362A7 7 0 0 0 28.5 21.362V41.5A1.5 1.5 0 0 1 27 43H21A1.5 1.5 0 0 1 19.5 41.5Z",
  dot: { cx: 24, cy: 16, r: 4.5 },
};

export function LogoMark({ size = 28, className = "", pulse = false }: { size?: number; className?: string; pulse?: boolean }) {
  const { bar, stem, dot } = MARK_PATHS;
  return (
    <svg width={size} height={size} viewBox="4 5 40 40" className={className} aria-hidden="true">
      <path d={bar} fill="currentColor" />
      <path d={stem} fill="currentColor" />
      {pulse && <circle {...dot} fill="var(--color-brand)" className="touch-pulse" />}
      <circle {...dot} fill="var(--color-brand)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={"font-display font-semibold leading-none tracking-[-0.035em] " + className}>Thesis</span>;
}

/** Mark + wordmark lockup, linking home. */
export function Logo({ href = "/", size = 24, text = "text-[21px]" }: { href?: string; size?: number; text?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-ink" aria-label="Thesis home">
      <LogoMark size={size} />
      <Wordmark className={text} />
    </Link>
  );
}
