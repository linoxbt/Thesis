/** Stake token (QUSDC) has 6 decimals. */
export const USD = 10n ** 6n;

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function usd(v: number, digits = 2): string {
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Token amount (6 dp) as "12.34 QUSDC"-style number text. */
export function qusdc(v: bigint, digits = 2): string {
  return (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const price = (v: bigint, decimals = 8) => Number(v) / 10 ** decimals;

export function pct(bps: number, digits = 1): string {
  return (bps / 100).toFixed(digits) + "%";
}

/** Skill from bps of one call (10000 = +1.00): "+0.80", "−0.25". */
export function fmtSkill(bps: number): string {
  const v = Math.abs(bps) / 10_000;
  return (bps > 0 ? "+" : bps < 0 ? "−" : "") + v.toFixed(2);
}

export function timeLeft(end: number, now: number): string {
  let s = Math.max(0, Math.floor(end - now));
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ago(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/**
 * Cleans what's typed into an amount or price field: a comma decimal ("2,5")
 * becomes a dot; anything but digits and the first dot is dropped.
 */
export function decimalInput(v: string): string {
  const s = v.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
}

/** UTF-8 byte length (the contract limits text by bytes, not characters). */
export const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** |strike - spot| / spot in bps, rounded down like the contract. */
export function distanceBps(spot: bigint, strike: bigint): number {
  if (spot <= 0n) return 0;
  const d = strike > spot ? strike - spot : spot - strike;
  return Number((d * 10_000n) / spot);
}

/** Parses a token amount ("5", "2.5"), at most 6 decimals; null if invalid or zero. */
export function parseAmount(s: string): bigint | null {
  if (!/^\d{1,9}(\.\d{0,6})?$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  const v = BigInt(w || "0") * USD + BigInt((f + "000000").slice(0, 6));
  return v > 0n ? v : null;
}

/** A call as one line: "SOL ≥ $73.10" / "BTC ≤ $58,000". */
export function callLine(asset: string, above: boolean, strike: bigint, decimals = 8): string {
  const p = price(strike, decimals);
  return `${asset} ${above ? "≥" : "≤"} ${usd(p, p >= 1000 ? 0 : 2)}`;
}
