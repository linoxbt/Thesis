/** Formatting helpers. Every number shows its unit (spec section 8). */

export const pythToNumber = (v: string | number | bigint, expo: number) => Number(v) * 10 ** expo;

export function usd(v: number, digits = 2): string {
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** USDC micro-units -> "$12.34". */
export const usdc = (micro: string | number | bigint, digits = 2) => usd(Number(micro) / 1e6, digits);

export const pct = (bps: number, digits = 1) => (bps / 100).toFixed(digits) + "%";

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

/** "3h 12m", "45m", "2d 4h", "ended". */
export function timeLeft(endTs: number, now = Date.now() / 1000): string {
  const s = Math.floor(endTs - now);
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

export function ago(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** "SOL ↓ $73.94 by Fri 18:00" — the call in one line. */
export function callLine(direction: string, strike: string | number, expo: number, endTs: number): string {
  return `SOL ${direction === "above" ? "↑" : "↓"} ${usd(pythToNumber(strike, expo))} by ${when(endTs)}`;
}

/** Skill score from bps of one call (10000 = +1.00): "+0.80", "−0.25". */
export function fmtSkill(bps: number): string {
  const v = Math.abs(bps) / 10_000;
  return (bps > 0 ? "+" : bps < 0 ? "−" : "") + v.toFixed(2);
}
