/**
 * A call read as the perp-style position behind it, from onchain data only:
 *   side        long if the call is "touches above", short if "touches below"
 *   entry       the QIE Oracle price when the call opened (spotAtOpen)
 *   take profit the call's strike
 * Calls on QIE have no liquidation level or leverage: the stake is the risk.
 */
export type Side = "long" | "short";

export interface Position {
  side: Side;
  entry: number;
  tp: number;
  /** Price move to take profit, % of entry (positive = in the position's favour). */
  tpMovePct: number;
}

export function sideOf(direction: "above" | "below"): Side {
  return direction === "above" ? "long" : "short";
}

export function positionOf(direction: "above" | "below", entry: number, tp: number): Position {
  const side = sideOf(direction);
  const sign = side === "long" ? 1 : -1;
  return { side, entry, tp, tpMovePct: (sign * (tp - entry) * 100) / entry };
}

/** Move of the position at `mark`, % of entry (positive = towards take profit). */
export function markMove(p: Position, mark: number): number {
  const sign = p.side === "long" ? 1 : -1;
  return (sign * (mark - p.entry) * 100) / p.entry;
}

/** How far from entry to take profit the mark has got, 0..1 (clamped). */
export function progressToTp(p: Position, mark: number): number {
  const span = p.tp - p.entry;
  if (span === 0) return 1;
  return Math.min(1, Math.max(0, (mark - p.entry) / span));
}

export const fmtPct = (v: number, digits = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits) + "%";
