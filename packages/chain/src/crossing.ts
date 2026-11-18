import type { PriceTick } from "./pyth";

/** Same as MAX_CLOCK_SKEW_SECS in programs/thesis/src/constants.rs. */
export const MAX_CLOCK_SKEW_SECS = 15;

/** The fields of a TouchMarket the watcher needs. */
export interface MarketView {
  feedId: Buffer;
  direction: "above" | "below";
  strike: bigint;
  expo: number;
  startTs: number;
  endTs: number;
  touched: boolean;
  settled: boolean;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Mirrors every check of the onchain `prove_touch`, in the same order, so the
 * watcher only spends a transaction on a proof the program will accept.
 */
export function provable(m: MarketView, t: PriceTick, maxConfBps: number, now = Math.floor(Date.now() / 1000)): Verdict {
  if (m.touched || m.settled) return { ok: false, reason: "AlreadyFinal" };
  if (!t.fullyVerified) return { ok: false, reason: "NotFullyVerified" };
  if (!t.feedId.equals(m.feedId)) return { ok: false, reason: "WrongFeed" };
  if (t.price <= 0n) return { ok: false, reason: "NonPositivePrice" };
  if (t.conf * 10_000n > t.price * BigInt(maxConfBps)) return { ok: false, reason: "ConfTooWide" };
  if (t.publishTime < m.startTs || t.publishTime > m.endTs) return { ok: false, reason: "OutsideWindow" };
  if (t.publishTime > now + MAX_CLOCK_SKEW_SECS) return { ok: false, reason: "FuturePrice" };
  if (t.expo !== m.expo) return { ok: false, reason: "WrongExpo" };
  const crossed = m.direction === "below" ? t.price <= m.strike : t.price >= m.strike;
  return crossed ? { ok: true } : { ok: false, reason: "NoTouch" };
}

/** A market can be settled once `end_ts + grace` has passed. */
export function settleable(m: Pick<MarketView, "endTs" | "settled">, graceSecs: number, now: number): boolean {
  return !m.settled && now >= m.endTs + graceSecs;
}
