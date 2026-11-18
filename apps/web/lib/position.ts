/**
 * A thesis read as the perp position behind it, from onchain data only:
 *   side        long if the call is "touches above", short if "touches below"
 *   entry       SOL spot when the conviction market opened (spot_at_open)
 *   take profit the conviction strike
 *   liquidation the protection strike (if the trader attached protection)
 *   leverage    implied by the liquidation distance: entry / |entry - liq|
 *               (isolated margin, maintenance margin ignored), so it is shown
 *               as "implied" and only when a liquidation level exists.
 */
export type Side = "long" | "short";

export interface Position {
  side: Side;
  entry: number;
  tp: number;
  liq: number | null;
  /** Implied leverage, or null without a liquidation level. */
  lev: number | null;
  /** Price move to take profit, % of entry (positive = in the position's favour). */
  tpMovePct: number;
  /** Price move to liquidation, % of entry (negative = against). */
  liqMovePct: number | null;
  /** Return on margin at take profit, % (needs leverage). */
  roeAtTp: number | null;
  /** Reward-to-risk: distance to TP over distance to liquidation. */
  rr: number | null;
}

export function sideOf(direction: "above" | "below"): Side {
  return direction === "above" ? "long" : "short";
}

export function positionOf(direction: "above" | "below", entry: number, tp: number, liq: number | null): Position {
  const side = sideOf(direction);
  const sign = side === "long" ? 1 : -1;
  const tpMovePct = (sign * (tp - entry) * 100) / entry;
  const liqMovePct = liq === null ? null : (sign * (liq - entry) * 100) / entry;
  const lev = liq === null || liq === entry ? null : entry / Math.abs(entry - liq);
  return {
    side,
    entry,
    tp,
    liq,
    lev,
    tpMovePct,
    liqMovePct,
    roeAtTp: lev === null ? null : tpMovePct * lev,
    rr: liq === null || liq === entry ? null : Math.abs(tp - entry) / Math.abs(entry - liq),
  };
}

/** Liquidation price for a leverage (isolated, maintenance margin ignored). */
export function liqFromLeverage(side: Side, entry: number, lev: number): number {
  return side === "long" ? entry * (1 - 1 / lev) : entry * (1 + 1 / lev);
}

/** Unrealised move of the position at `mark`, % of entry, and as ROE with leverage. */
export function markMove(p: Position, mark: number): { movePct: number; roe: number | null } {
  const sign = p.side === "long" ? 1 : -1;
  const movePct = (sign * (mark - p.entry) * 100) / p.entry;
  return { movePct, roe: p.lev === null ? null : movePct * p.lev };
}

export const fmtLev = (lev: number) => (lev >= 10 ? lev.toFixed(0) : lev.toFixed(1)).replace(/\.0$/, "") + "x";
export const fmtPct = (v: number, digits = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits) + "%";
