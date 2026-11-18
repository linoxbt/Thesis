import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStrike, openingPriceBps, touchProbability } from "../src/pricing";

const RULES = { minStrikeDistanceBps: 50, maxStrikeDistanceBps: 5000, minOpenBps: 100, maxOpenBps: 9900 };

test("matches the Rust/Python reference values", () => {
  const s = 7_477_778_734;
  // Same table as programs/thesis/src/pricing.rs (Python math.erfc).
  for (const [ratio, sigma, tau, want] of [
    [0.95, 6000, 48 * 3600, 0.2481353044],
    [1.1, 6000, 7 * 86_400, 0.2513575718],
    [0.995, 6000, 600, 0.0554555865],
    [0.999, 6000, 7 * 86_400, 0.9903928852],
  ]) {
    const got = touchProbability(s, Math.round(s * ratio), sigma, tau)!;
    assert.ok(Math.abs(got - want) < 2e-6, `${ratio}: ${got} vs ${want}`);
  }
  // Same bps as the onchain values seen in the LiteSVM tests.
  const spot = 7_477_780_000;
  assert.equal(openingPriceBps(spot, spot - Math.trunc((spot * 500) / 10_000), 6000, 48 * 3600), 2481);
  assert.equal(openingPriceBps(spot, spot - Math.trunc((spot * 50) / 10_000), 6000, 600), 555);
});

test("strike checks mirror the program", () => {
  const spot = 7_500_000_000n;
  assert.equal(checkStrike("below", spot, 7_400_000_000n, 2500, RULES), null);
  assert.match(checkStrike("below", spot, 7_600_000_000n, 2500, RULES)!, /under/);
  assert.match(checkStrike("above", spot, 7_400_000_000n, 2500, RULES)!, /over/);
  assert.match(checkStrike("below", spot, 7_480_000_000n, 2500, RULES)!, /at least 0.5%/);
  assert.match(checkStrike("below", spot, 3_000_000_000n, 2500, RULES)!, /within 50%/);
  assert.match(checkStrike("below", spot, 7_400_000_000n, 50, RULES)!, /Opening odds/);
});
