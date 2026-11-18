/**
 * Annualised realised volatility from irregular spot samples:
 *   sigma^2 ~= sum(r_i^2) / sum(dt_i),  r_i = ln(p_i / p_{i-1}), dt in years.
 * Returns bps (6000 = 60%), or null if there isn't enough data.
 */
export const SECONDS_PER_YEAR = 31_536_000;

export interface Sample {
  publishTime: number;
  price: number;
}

export function realizedVolBps(samples: Sample[], opts = { minSamples: 20, minSpanSecs: 86_400 }): number | null {
  const s = [...samples].sort((a, b) => a.publishTime - b.publishTime).filter((x) => x.price > 0);
  if (s.length < opts.minSamples) return null;
  if (s[s.length - 1].publishTime - s[0].publishTime < opts.minSpanSecs) return null;
  let sumSq = 0;
  let years = 0;
  for (let i = 1; i < s.length; i++) {
    const dt = s[i].publishTime - s[i - 1].publishTime;
    if (dt <= 0) continue;
    const r = Math.log(s[i].price / s[i - 1].price);
    sumSq += r * r;
    years += dt / SECONDS_PER_YEAR;
  }
  if (years === 0) return null;
  return Math.round(Math.sqrt(sumSq / years) * 10_000);
}

/** Post a new value when it moved by more than `threshold` or the onchain one is getting old. */
export function shouldPost(current: number, next: number, ageSecs: number, opts = { threshold: 0.1, refreshSecs: 86_400 }) {
  return Math.abs(next - current) / current > opts.threshold || ageSecs > opts.refreshSecs;
}
