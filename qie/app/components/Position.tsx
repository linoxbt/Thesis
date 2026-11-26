import { usd as usdBase } from "@/lib/format";
import { fmtPct, markMove, type Position } from "@/lib/position";

/** Dollar prices: whole dollars from $1,000 up (BTC, ETH), cents below. */
export const usdPx = (v: number) => usdBase(v, v >= 1000 ? 0 : 2);
const usd = usdPx;

/** "LONG" / "SHORT" pill, as on a perp venue. */
export function SidePill({ p, size = "sm" }: { p: Position; size?: "sm" | "lg" }) {
  const long = p.side === "long";
  return (
    <span
      className={
        "num inline-flex items-center gap-1.5 rounded-md font-medium uppercase tracking-wide " +
        (size === "lg" ? "px-2.5 py-1 text-sm " : "px-2 py-0.5 text-[11px] ") +
        (long ? "bg-yes/12 text-yes ring-1 ring-yes/30" : "bg-bad/12 text-bad ring-1 ring-bad/30")
      }
      data-testid="side-pill"
    >
      {long ? "Long" : "Short"}
    </span>
  );
}

/**
 * Entry → take profit on one line, with the live mark. The left end is
 * always the losing side, whatever the direction.
 */
function PositionBar({ p, mark }: { p: Position; mark?: number | null }) {
  const lo = p.entry - (p.tp - p.entry);
  // Map prices onto 0..1 with liquidation at 0 and take profit at 1.
  const at = (v: number) => Math.min(1, Math.max(0, (v - lo) / (p.tp - lo)));
  const entryX = at(p.entry);
  const markX = mark != null ? at(mark) : null;
  return (
    <div className="relative mt-1 h-7" aria-hidden="true">
      <div className="absolute inset-x-0 top-3 h-1.5 overflow-hidden rounded-full bg-panel-3">
        <div className="absolute inset-y-0 left-0 bg-bad/50" style={{ width: `${entryX * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-yes/50" style={{ width: `${(1 - entryX) * 100}%` }} />
      </div>
      <div className="absolute top-1.5 h-5 w-px bg-ink/70" style={{ left: `${entryX * 100}%` }} />
      {markX !== null && (
        <div className="absolute top-[7px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-panel bg-ink shadow" style={{ left: `${markX * 100}%` }} />
      )}
    </div>
  );
}

/** Entry / take profit / a third cell (usually the deadline), with each move in %. */
export function PositionLevels({ p, mark, dense = false, third }: { p: Position; mark?: number | null; dense?: boolean; third: { k: string; v: string; sub?: string } }) {
  const m = mark != null ? markMove(p, mark) : null;
  const cell = "min-w-0";
  const k = "text-[10px] uppercase tracking-wide text-faint";
  const v = dense ? "mt-0.5 text-sm text-ink" : "mt-1 text-base text-ink";
  return (
    <div className="num">
      <div className="grid grid-cols-3 gap-3">
        <div className={cell}>
          <div className={k}>Entry</div>
          <div className={v}>{usd(p.entry)}</div>
        </div>
        <div className={cell}>
          <div className={k}>Take profit</div>
          <div className={v}>{usd(p.tp)}</div>
          <div className="text-[10px] text-yes">{fmtPct(p.tpMovePct)}</div>
        </div>
        <div className={cell}>
          <div className={k}>{third.k}</div>
          <div className={v}>{third.v}</div>
          {third.sub && <div className="text-[10px] text-faint">{third.sub}</div>}
        </div>
      </div>
      <PositionBar p={p} mark={mark} />
      <div className="flex justify-between text-[11px] text-faint">
        <span>
          {m !== null ? (
            <>
              mark <span className="text-muted">{usd(mark!)}</span>{" "}
              <span className={m >= 0 ? "text-yes" : "text-bad"}>{fmtPct(m, 2)}</span>
            </>
          ) : (
            "mark …"
          )}
        </span>
      </div>
    </div>
  );
}
