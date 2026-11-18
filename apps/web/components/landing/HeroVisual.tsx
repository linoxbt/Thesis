import { Clock, Shield } from "lucide-react";

/**
 * Illustrative product frame for the landing hero: one example call, its odds,
 * and the price path touching the strike. Static and deterministic (same on
 * server and client), clearly labelled as an example.
 */
const W = 560;
const H = 236;
const STRIKE_Y = 52;
const GUARD_Y = 196;
const TOUCH_X = 418;

function pricePath() {
  // Seeded walk that drifts up and meets the strike exactly at TOUCH_X.
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const pts: [number, number][] = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * W;
    let y: number;
    if (x <= TOUCH_X) {
      const t = x / TOUCH_X;
      y = 172 - (172 - STRIKE_Y) * Math.pow(t, 1.35) + rnd() * 26 * (1 - t * 0.85);
      if (i > 0 && x > TOUCH_X - 10) y = STRIKE_Y;
      y = Math.max(y, STRIKE_Y + (x < TOUCH_X - 10 ? 4 : 0));
    } else {
      const t = (x - TOUCH_X) / (W - TOUCH_X);
      y = STRIKE_Y + 18 * t + rnd() * 16 * t + 6 * Math.sin(t * 6);
    }
    pts.push([x, y]);
  }
  pts.push([TOUCH_X, STRIKE_Y]);
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

const PTS = pricePath();
const LINE = PTS.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
const AREA = `${LINE} L${W} ${H} L0 ${H} Z`;

export function HeroVisual() {
  return (
    <div className="relative">
      <div className="glow panel relative overflow-hidden p-5 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.45)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="num grid h-7 w-7 place-items-center rounded-full bg-panel-3 text-[10px] uppercase ring-1 ring-line-2">7x</span>
            <span>Example call</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="num flex items-center gap-1 rounded-full bg-guard/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-guard ring-1 ring-guard/30">
              <Shield size={10} /> Protected
            </span>
            <span className="num rounded-full bg-yes/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-yes ring-1 ring-yes/30">
              Touched
            </span>
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="display whitespace-nowrap text-[32px] leading-none sm:text-[40px]">
              SOL ↑ <span className="num text-[26px] tracking-tight sm:text-[34px]">$260.00</span>
            </div>
            <div className="num mt-2 flex items-center gap-1.5 text-xs text-faint">
              <Clock size={11} /> by Dec 31
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-[30px] leading-none sm:text-[34px]">
              64.0<span className="text-xl text-muted">%</span>
            </div>
            <div className="num mt-2 text-xs text-yes">+23.6 pts since open</div>
          </div>
        </div>
        <p className="display mt-4 border-l-2 border-brand pl-3 text-lg italic text-muted">“ETF flows keep compounding into year end.”</p>

        <svg viewBox={`0 0 ${W} ${H}`} className="mt-5 h-auto w-full" role="img" aria-label="SOL price rising until it touches the $260 strike">
          <defs>
            <linearGradient id="hv-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.10" />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={STRIKE_Y} y2={STRIKE_Y} stroke="var(--color-ink)" strokeWidth="1.25" strokeDasharray="5 5" opacity="0.6" />
          <text x="4" y={STRIKE_Y - 8} className="num" fontSize="11" fill="var(--color-muted)">
            strike $260
          </text>
          <line x1="0" x2={W} y1={GUARD_Y} y2={GUARD_Y} stroke="var(--color-guard-mark)" strokeWidth="1.25" strokeDasharray="5 5" />
          <text x={W - 4} y={GUARD_Y + 16} textAnchor="end" className="num" fontSize="11" fill="var(--color-guard)">
            protection $198
          </text>
          <path d={AREA} fill="url(#hv-fill)" />
          <path d={LINE} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <line x1={TOUCH_X} x2={TOUCH_X} y1={STRIKE_Y} y2={H} stroke="var(--color-brand)" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" />
          <circle cx={TOUCH_X} cy={STRIKE_Y} r="6" fill="var(--color-brand)" className="touch-pulse" />
          <circle cx={TOUCH_X} cy={STRIKE_Y} r="6" fill="var(--color-brand)" stroke="var(--color-panel)" strokeWidth="3" />
        </svg>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <span className="btn btn-yes pointer-events-none text-sm">Back · 64¢</span>
          <span className="btn btn-ghost pointer-events-none text-sm">Challenge · 36¢</span>
        </div>
      </div>

      {/* Floating proof receipt */}
      <div className="panel absolute -bottom-14 -right-3 hidden w-60 p-4 shadow-2xl sm:block lg:-right-10">
        <div className="label text-[11px]">Touch proven</div>
        <div className="num mt-3 space-y-1.5 text-[11px] text-muted">
          <div className="flex justify-between">
            <span>feed</span>
            <span className="text-ink">Pyth SOL/USD</span>
          </div>
          <div className="flex justify-between">
            <span>print</span>
            <span className="text-ink">$260.07</span>
          </div>
          <div className="flex justify-between">
            <span>confidence</span>
            <span className="text-ink">0.03%</span>
          </div>
          <div className="flex justify-between">
            <span>signed by</span>
            <span className="text-ink">Wormhole guardians</span>
          </div>
        </div>
      </div>
    </div>
  );
}
