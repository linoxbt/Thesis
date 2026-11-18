import type { ReactNode } from "react";
import { Tick } from "./Tick";

/**
 * The hero product shot: an example Thesis market rendered as the trading
 * screen, always dark (like a terminal). Static and deterministic.
 */
const W = 640;
const H = 250;
// An example long: entry 73.04, 20x (liquidation 5% below), take profit +5%.
const ENTRY = 73.04;
const LO = 68.6;
const HI = 77.3;
const STRIKE = 76.69;
const GUARD = 69.39;
const N = 54;
const TOUCH = 41;
const R = (HI - LO) / 78; // noise scale

function candles() {
  let s = 5;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const out: { o: number; c: number; h: number; l: number; v: number }[] = [];
  const start = 71.2;
  let p = start;
  for (let i = 0; i < N; i++) {
    const target = i <= TOUCH ? start + (STRIKE - start) * Math.pow(i / TOUCH, 1.3) : STRIKE - (i - TOUCH) * 0.9 * R;
    const o = p;
    let c = o + (target - o) * 0.45 + r() * 5 * R;
    let h = Math.max(o, c) + Math.abs(r()) * 3.2 * R;
    const l = Math.min(o, c) - Math.abs(r()) * 3.2 * R;
    if (i === TOUCH) h = STRIKE;
    if (i !== TOUCH) h = Math.min(h, STRIKE - 0.6 * R);
    c = Math.min(c, STRIKE - 0.8 * R);
    out.push({ o, c, h, l, v: 0.3 + Math.abs(r()) * 1.4 + (i > TOUCH - 4 && i < TOUCH + 3 ? 0.8 : 0) });
    p = c;
  }
  return out;
}
const C = candles();
const y = (v: number) => 8 + ((HI - v) / (HI - LO)) * (H - 56);
const cw = W / N;

const TRADES: [string, string, string, string][] = [
  ["Back", "$25.00", "64.0¢", "now"],
  ["Cover", "$40.00", "12.1¢", "2m"],
  ["Challenge", "$10.00", "36.4¢", "4m"],
  ["Back", "$120.00", "63.2¢", "9m"],
  ["Back", "$15.00", "61.8¢", "14m"],
  ["Challenge", "$60.00", "38.9¢", "21m"],
  ["Cover", "$25.00", "11.4¢", "33m"],
  ["Back", "$8.00", "60.5¢", "41m"],
];

export function ProductWindow() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#09090b] text-[#e9e7e1] shadow-[0_50px_140px_-30px_rgb(0_0_0/0.65)]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="num ml-3 truncate text-[11px] text-white/45">thesis · Long SOL 20x · example position</span>
      </div>

      <div className="num flex gap-7 overflow-hidden border-b border-white/[0.07] px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40">
        <Stat k="Position" v="Long 20x" tone="text-[#3ecf8e]" />
        <Stat k="Mark" v={<Tick base={75.82} />} tone="text-white" sub="+3.8%" />
        <Stat k="Entry" v="$73.04" />
        <Stat k="Take profit" v="$76.69" tone="text-[#3ecf8e]" />
        <Stat k="Liquidation" v="$69.39" tone="text-[#ff6b6b]" />
        <Stat k="Crowd YES" v="64.0%" />
        <Stat k="Ends in" v="1d 22h" />
      </div>

      <div className="grid md:grid-cols-[1.7fr_0.95fr_0.95fr]">
        {/* Chart */}
        <div className="border-white/[0.07] md:border-r">
          <div className="flex items-center justify-between px-4 py-2 text-[11px] text-white/50">
            <span>SOL / USD · Pyth</span>
            <span className="num flex gap-3">
              <span className="text-white">Candles</span>
              <span>Odds</span>
              <span>1h</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-label="Example: a 20x long on SOL; candles rise until a wick touches the $76.69 take profit">
            <line x1="0" x2={W} y1={y(STRIKE)} y2={y(STRIKE)} stroke="#fff" strokeOpacity="0.5" strokeDasharray="4 4" />
            <text x={W - 6} y={y(STRIKE) - 6} textAnchor="end" fontSize="10" fill="#3ecf8e" className="num">
              take profit 76.69
            </text>
            <line x1="0" x2={W} y1={y(ENTRY)} y2={y(ENTRY)} stroke="#fff" strokeOpacity="0.35" strokeDasharray="2 4" />
            <text x={6} y={y(ENTRY) - 6} fontSize="10" fill="#fff" fillOpacity="0.55" className="num">
              entry 73.04
            </text>
            <line x1="0" x2={W} y1={y(GUARD)} y2={y(GUARD)} stroke="#ff6b6b" strokeOpacity="0.7" strokeDasharray="4 4" />
            <text x={W - 6} y={y(GUARD) + 14} textAnchor="end" fontSize="10" fill="#ff6b6b" className="num">
              liquidation 69.39 · covered
            </text>
            <g className="draw">
            {C.map((k, i) => {
              const up = k.c >= k.o;
              const col = up ? "#3ecf8e" : "#ff6b6b";
              const x = i * cw + cw / 2;
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth="1" />
                  <rect x={x - cw * 0.32} width={cw * 0.64} y={y(Math.max(k.o, k.c))} height={Math.max(1, Math.abs(y(k.o) - y(k.c)))} fill={col} />
                  <rect x={x - cw * 0.32} width={cw * 0.64} y={H - 8 - k.v * 16} height={k.v * 16} fill={col} opacity="0.28" />
                </g>
              );
            })}
            <circle cx={TOUCH * cw + cw / 2} cy={y(STRIKE)} r="5" fill="#ff6a3d" className="touch-pulse" />
            <circle cx={TOUCH * cw + cw / 2} cy={y(STRIKE)} r="4.5" fill="#ff6a3d" stroke="#09090b" strokeWidth="2" />
            </g>
          </svg>
        </div>

        {/* Trades */}
        <div className="hidden border-r border-white/[0.07] md:block">
          <div className="flex justify-between px-4 py-2 text-[11px] text-white/50">
            <span>Trades</span>
            <span className="num">size · price</span>
          </div>
          <ul className="num text-[11px]">
            {TRADES.map(([side, amt, px, t], i) => {
              const tone = side === "Back" ? "text-[#3ecf8e]" : side === "Cover" ? "text-[#7aa2ff]" : "text-white/80";
              const bar = side === "Back" ? "bg-[#3ecf8e]/10" : side === "Cover" ? "bg-[#7aa2ff]/10" : "bg-white/[0.05]";
              return (
                <li key={i} className="relative flex items-center justify-between px-4 py-[7px]">
                  <span className={"absolute inset-y-0.5 right-0 " + bar} style={{ width: `${18 + ((i * 37) % 60)}%` }} />
                  <span className={"relative " + tone}>{side}</span>
                  <span className="relative text-white/80">{amt}</span>
                  <span className="relative text-white/60">{px}</span>
                  <span className="relative w-7 text-right text-white/35">{t}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Ticket */}
        <div className="hidden p-4 md:block">
          <div className="text-[11px] text-white/50">Quick trade</div>
          <div className="mt-3 grid grid-cols-2 rounded-full bg-white/[0.06] p-1 text-[11px]">
            <span className="rounded-full bg-[#3ecf8e] py-1.5 text-center font-medium text-[#03170d]">Back · YES</span>
            <span className="py-1.5 text-center text-white/60">Challenge · NO</span>
          </div>
          <div className="num mt-3 flex items-center justify-between rounded-xl border border-white/[0.08] px-3 py-2.5 text-sm">
            25.00 <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] text-white/70">USDC</span>
          </div>
          <div className="num mt-2 flex items-center justify-between rounded-xl border border-white/[0.08] px-3 py-2.5 text-sm">
            38.28 <span className="rounded-full bg-[#3ecf8e]/15 px-2 py-0.5 text-[10px] text-[#3ecf8e]">YES</span>
          </div>
          <dl className="num mt-3 space-y-1.5 text-[10.5px] text-white/45">
            <div className="flex justify-between">
              <dt>pays if it hits</dt>
              <dd className="text-white/85">$38.28</dd>
            </div>
            <div className="flex justify-between">
              <dt>avg price</dt>
              <dd className="text-white/85">64.0¢</dd>
            </div>
            <div className="flex justify-between">
              <dt>fee</dt>
              <dd className="text-white/85">2% incl.</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-full bg-[#3ecf8e] py-2 text-center text-xs font-medium text-[#03170d]">Back it</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, tone = "text-white/85", sub }: { k: string; v: ReactNode; tone?: string; sub?: string }) {
  return (
    <div className="shrink-0">
      <div>{k}</div>
      <div className={"mt-0.5 text-[12px] normal-case tracking-normal " + tone}>
        {v}
        {sub && <span className="ml-1 text-[10px] text-[#3ecf8e]">{sub}</span>}
      </div>
    </div>
  );
}
