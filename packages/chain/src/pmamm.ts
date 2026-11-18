import { BorshAccountsCoder, type Idl } from "@anchor-lang/core";
import pmAmmIdl from "../idl/pm_amm.json";

export const PM_AMM_IDL = pmAmmIdl as unknown as Idl & { instructions: { name: string; discriminator: number[] }[] };
const idl = PM_AMM_IDL;
const accounts = new BorshAccountsCoder(idl);

export const SWAP_DISCRIMINATOR = Buffer.from(idl.instructions.find((i) => i.name === "swap")!.discriminator);
export const SWAP_DIRECTIONS = ["usdcToYes", "usdcToNo", "yesToUsdc", "noToUsdc", "yesToNo", "noToYes"] as const;

export interface PmMarket {
  authority: string;
  endTs: number;
  lZero: bigint;
  reserveYes: bigint;
  reserveNo: bigint;
  resolved: boolean;
  winningSide: number;
}

export function decodePmMarket(data: Buffer): PmMarket {
  const m = accounts.decode("Market", data);
  const big = (v: { toString(): string }) => BigInt(v.toString());
  return {
    authority: m.authority.toBase58(),
    endTs: Number(m.end_ts ?? m.endTs),
    lZero: big(m.l_zero ?? m.lZero),
    reserveYes: big(m.reserve_yes ?? m.reserveYes),
    reserveNo: big(m.reserve_no ?? m.reserveNo),
    resolved: m.resolved,
    winningSide: m.winning_side ?? m.winningSide,
  };
}

/** Standard normal CDF, Abramowitz & Stegun 7.1.26 (same as the program). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const FIX = 2 ** 48; // I80F48
/**
 * pm-AMM spot YES price in bps, paper section 7: P = Phi((y - x) / L_eff),
 * x = YES reserve, y = NO reserve, L_eff = L_0 * sqrt(T - t). Null when the
 * pool is empty or expired.
 */
export function yesPriceBps(m: PmMarket, now: number): number | null {
  const remaining = m.endTs - now;
  if (m.lZero === 0n || remaining <= 0) return null;
  const lEff = (Number(m.lZero) / FIX) * Math.sqrt(remaining);
  const z = (Number(m.reserveNo) / FIX - Number(m.reserveYes) / FIX) / lEff;
  return Math.round(10_000 * normalCdf(z));
}

/** Decodes a pm-AMM `swap` instruction's data, or null if it isn't one. */
export function decodeSwapData(data: Buffer): { direction: (typeof SWAP_DIRECTIONS)[number]; amountIn: bigint } | null {
  if (data.length < 8 + 1 + 8 || !data.subarray(0, 8).equals(SWAP_DISCRIMINATOR)) return null;
  const direction = SWAP_DIRECTIONS[data[8]];
  if (!direction) return null;
  return { direction, amountIn: data.readBigUInt64LE(9) };
}
