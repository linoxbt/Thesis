import { formatUnits, type Address } from "viem";

/** What a call is staked in. `NATIVE` (the zero address) is QIE itself, sent as value. */
export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

export interface StakeToken {
  address: Address;
  symbol: string;
  decimals: number;
  native: boolean;
  /** New calls can use it (open calls keep working either way). */
  enabled: boolean;
  minSeed: bigint;
  maxSeed: bigint;
  /** Smallest bet. */
  minStake: bigint;
  /** A call counts toward skill if its creator seeded at least this (fixed at posting). */
  minScoredSeed: bigint;
}

export const isNative = (a: string) => a.toLowerCase() === NATIVE;
export const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Stands in until the token list loads (or for a token the contract no longer lists). */
export const unknownToken = (address: Address): StakeToken => ({
  address,
  symbol: isNative(address) ? "QIE" : "…",
  decimals: isNative(address) ? 18 : 6,
  native: isNative(address),
  enabled: false,
  minSeed: 0n,
  maxSeed: 0n,
  minStake: 0n,
  minScoredSeed: 0n,
});

/** A token amount as number text: "12.34"; amounts under 1 keep up to 4 decimals ("0.005"). */
export function amt(v: bigint, t: Pick<StakeToken, "decimals">, digits = 2): string {
  const n = Number(formatUnits(v, t.decimals));
  const max = n !== 0 && Math.abs(n) < 1 ? Math.max(digits, 4) : digits;
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, max), maximumFractionDigits: max });
}

/** A token amount with its symbol: "12.34 QIE". */
export const amtSym = (v: bigint, t: Pick<StakeToken, "decimals" | "symbol">, digits = 2) => `${amt(v, t, digits)} ${t.symbol}`;

/**
 * Sums kept per token, shown together: "1,240 QUSDC · 3,500 QIE". Tokens with
 * nothing are left out; with nothing at all, the first token shows 0.
 */
export function perToken(items: { token: Address; value: bigint }[], tokens: StakeToken[], digits = 0): string {
  const sums = new Map<string, bigint>();
  for (const i of items) sums.set(i.token.toLowerCase(), (sums.get(i.token.toLowerCase()) ?? 0n) + i.value);
  const parts = tokens.filter((t) => (sums.get(t.address.toLowerCase()) ?? 0n) > 0n).map((t) => amtSym(sums.get(t.address.toLowerCase())!, t, digits));
  if (parts.length) return parts.join(" · ");
  return tokens[0] ? amtSym(0n, tokens[0], digits) : "0";
}

/** Parses a typed amount ("5", "2.5") into token units, at most 6 decimals; null if invalid or zero. */
export function parseTokenAmount(s: string, decimals: number): bigint | null {
  if (!/^\d{1,12}(\.\d{0,6})?$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  const frac = f.slice(0, Math.min(6, decimals)).padEnd(decimals, "0");
  const v = BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
  return v > 0n ? v : null;
}

