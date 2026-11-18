import { test } from "node:test";
import assert from "node:assert/strict";
import { realizedVolBps, shouldPost, SECONDS_PER_YEAR } from "../src/volatility";
import { decodeSwapData, normalCdf, SWAP_DISCRIMINATOR, yesPriceBps } from "@thesis/chain";

/** Seeded PRNG + Box-Muller, so the test is deterministic. */
function gaussians(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 1) / 4294967297;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

test("realised vol recovers the volatility of a simulated random walk", () => {
  for (const [sigma, step] of [[0.6, 3600], [1.2, 1800], [0.3, 600]] as const) {
    const z = gaussians(42);
    const dtYears = step / SECONDS_PER_YEAR;
    let p = 75;
    const samples = [];
    for (let t = 0; t <= 7 * 86_400; t += step) {
      samples.push({ publishTime: t, price: p });
      p *= Math.exp(sigma * Math.sqrt(dtYears) * z());
    }
    const est = realizedVolBps(samples)! / 10_000;
    assert.ok(Math.abs(est - sigma) / sigma < 0.12, `sigma ${sigma}: estimated ${est}`);
  }
});

test("realised vol needs enough samples over a long enough span", () => {
  const few = Array.from({ length: 10 }, (_, i) => ({ publishTime: i * 86_400, price: 75 + i }));
  assert.equal(realizedVolBps(few), null);
  const short = Array.from({ length: 50 }, (_, i) => ({ publishTime: i * 60, price: 75 + (i % 2) }));
  assert.equal(realizedVolBps(short), null);
});

test("shouldPost on a 10% move or a day-old value", () => {
  assert.equal(shouldPost(6000, 6500, 3600), false);
  assert.equal(shouldPost(6000, 6700, 3600), true);
  assert.equal(shouldPost(6000, 6000, 90_000), true);
});

test("pm-AMM price and swap decoding", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  const FIX = 2n ** 48n;
  // Equal reserves -> 50%; expired or empty -> null.
  const m = { authority: "", endTs: 1_000, lZero: 10n * FIX, reserveYes: 5n * FIX, reserveNo: 5n * FIX, resolved: false, winningSide: 0 };
  assert.equal(yesPriceBps(m, 900), 5000);
  assert.equal(yesPriceBps(m, 1_000), null);
  assert.equal(yesPriceBps({ ...m, lZero: 0n }, 900), null);
  // More NO in the pool -> YES is dearer.
  assert.ok(yesPriceBps({ ...m, reserveNo: 50n * FIX }, 900)! > 5000);

  const data = Buffer.concat([SWAP_DISCRIMINATOR, Buffer.from([2]), Buffer.alloc(16)]);
  data.writeBigUInt64LE(5_000_000n, 9);
  assert.deepEqual(decodeSwapData(data), { direction: "yesToUsdc", amountIn: 5_000_000n });
  assert.equal(decodeSwapData(Buffer.alloc(25)), null);
});
