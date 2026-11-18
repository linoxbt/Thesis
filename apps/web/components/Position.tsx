import { fmtLev, fmtPct, markMove, type Position } from "@/lib/position";
import { usd } from "@/lib/client/format";

/** "LONG 20x" / "SHORT" pill, as on a perp venue. */
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
      {p.lev !== null && <span className="normal-case opacity-80">{fmtLev(p.lev)}</span>}
    </span>
  );
}

/**
 * Liquidation ← entry → take profit on one line, with the live mark. The
 * left end is always the losing side, whatever the direction.
 */
export function PositionBar({ p, mark }: { p: Position; mark?: number | null }) {
  const lo = p.liq ?? p.entry - (p.tp - p.entry);
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

/** Entry / take profit / liquidation, with each move in % and the ROE at take profit. */
export function PositionLevels({ p, mark, dense = false }: { p: Position; mark?: number | null; dense?: boolean }) {
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
          <div className={k}>Liquidation</div>
          <div className={v}>{p.liq !== null ? usd(p.liq) : "—"}</div>
          {p.liqMovePct !== null ? <div className="text-[10px] text-bad">{fmtPct(p.liqMovePct)}</div> : <div className="text-[10px] text-faint">not set</div>}
        </div>
      </div>
      <PositionBar p={p} mark={mark} />
      <div className="flex justify-between text-[11px] text-faint">
        <span>
          {m ? (
            <>
              mark <span className="text-muted">{usd(mark!)}</span>{" "}
              <span className={m.movePct >= 0 ? "text-yes" : "text-bad"}>
                {fmtPct(m.movePct, 2)}
                {m.roe !== null && !dense ? ` · ${fmtPct(m.roe, 0)} ROE` : ""}
              </span>
            </>
          ) : (
            "mark …"
          )}
        </span>
        {p.roeAtTp !== null && <span className="text-yes">{fmtPct(p.roeAtTp, 0)} ROE at TP</span>}
      </div>
    </div>
  );
}
