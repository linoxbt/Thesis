/**
 * Dot-matrix texture for colour fields: a price path drawn in dots, dense at
 * the line and fading below it, with a dotted strike level and the touch
 * marked. Deterministic (same markup on server and client) and compact: dots
 * are grouped into a few <path>s by opacity instead of thousands of nodes.
 */
type Props = { width?: number; height?: number; cell?: number; seed?: number; touchAt?: number; className?: string };

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function DotField({ width = 720, height = 440, cell = 9, seed = 11, touchAt = 0.72, className = "" }: Props) {
  const r = rng(seed);
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const strikeRow = Math.round(rows * 0.18);
  const touchCol = Math.round(cols * touchAt);

  // Price path (in rows): climbs with noise, meets the strike at touchCol, then drifts.
  const curve: number[] = [];
  let y = rows * 0.86;
  for (let c = 0; c < cols; c++) {
    const target = c <= touchCol ? rows * 0.86 - (rows * 0.86 - strikeRow) * Math.pow(c / touchCol, 1.25) : strikeRow + (c - touchCol) * 0.35;
    y += (target - y) * 0.35 + (r() - 0.5) * 2.2;
    if (c === touchCol) y = strikeRow;
    if (c < touchCol) y = Math.max(y, strikeRow + 1);
    curve.push(y);
  }

  const buckets: string[][] = [[], [], [], []];
  const sz = Math.max(2, Math.round(cell * 0.38));
  for (let c = 0; c < cols; c++) {
    for (let row = 0; row < rows; row++) {
      const d = row - curve[c];
      let p = 0;
      if (d >= 0 && d < 1.2) p = 1;
      else if (d > 0) p = Math.exp(-d / 9) * 0.85;
      if (row === strikeRow && c % 2 === 0) p = Math.max(p, 0.9);
      if (r() > p) continue;
      const b = d >= 0 && d < 1.2 ? 3 : row === strikeRow ? 2 : d < 6 ? 1 : 0;
      buckets[b].push(`M${c * cell} ${row * cell}h${sz}v${sz}h-${sz}z`);
    }
  }
  const op = [0.16, 0.3, 0.5, 0.9];
  const tx = touchCol * cell + sz / 2;
  const ty = strikeRow * cell + sz / 2;
  return (
    <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} className={className} aria-hidden="true" preserveAspectRatio="xMaxYMid meet">
      {buckets.map((d, i) => (
        <path key={i} d={d.join("")} fill="#fff" opacity={op[i]} />
      ))}
      <circle cx={tx} cy={ty} r={cell * 1.1} fill="#fff" className="touch-pulse" />
      <circle cx={tx} cy={ty} r={cell * 0.9} fill="#fff" />
    </svg>
  );
}
