import { normalCdf } from "./pmamm";

/**
 * Opening price of a touch market, same formula as programs/thesis/src/pricing.rs:
 *   P(touch) = 2 * Phi( -|ln(K/S)| / (sigma * sqrt(tau)) )
 * Used for the Create screen preview; the program computes the real value.
 */
export const SECONDS_PER_YEAR = 31_536_000;

export function touchProbability(spot: number, strike: number, sigmaBps: number, tauSecs: number): number | null {
  if (spot <= 0 || strike <= 0 || sigmaBps <= 0 || tauSecs <= 0) return null;
  const sigma = sigmaBps / 10_000;
  const d = Math.abs(Math.log(strike / spot)) / (sigma * Math.sqrt(tauSecs / SECONDS_PER_YEAR));
  return Math.min(1, Math.max(0, 2 * normalCdf(-d)));
}

export function openingPriceBps(spot: number, strike: number, sigmaBps: number, tauSecs: number): number | null {
  const p = touchProbability(spot, strike, sigmaBps, tauSecs);
  return p === null ? null : Math.round(p * 10_000);
}

/** |strike - spot| / spot in bps, rounded down (as onchain). */
export function distanceBps(spot: bigint, strike: bigint): bigint {
  const diff = strike > spot ? strike - spot : spot - strike;
  return (diff * 10_000n) / spot;
}

export interface CreateRules {
  minStrikeDistanceBps: number;
  maxStrikeDistanceBps: number;
  minOpenBps: number;
  maxOpenBps: number;
}

/** The onchain create checks, for instant feedback in the form. */
export function checkStrike(
  direction: "above" | "below",
  spot: bigint,
  strike: bigint,
  openBps: number | null,
  rules: CreateRules,
): string | null {
  if (strike <= 0n) return "Enter a target price";
  if (direction === "below" && strike >= spot) return "A 'below' target must be under the current price";
  if (direction === "above" && strike <= spot) return "An 'above' target must be over the current price";
  const d = Number(distanceBps(spot, strike));
  if (d < rules.minStrikeDistanceBps) return `Target must be at least ${rules.minStrikeDistanceBps / 100}% from the current price`;
  if (d > rules.maxStrikeDistanceBps) return `Target must be within ${rules.maxStrikeDistanceBps / 100}% of the current price`;
  if (openBps !== null && (openBps < rules.minOpenBps || openBps > rules.maxOpenBps)) {
    return `Opening odds would be ${(openBps / 100).toFixed(2)}%; must be ${rules.minOpenBps / 100}–${rules.maxOpenBps / 100}%. Move the target or change the window.`;
  }
  return null;
}
