import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { provable, settleable, type MarketView } from "@thesis/chain";
import { decodePriceUpdateV2, type PriceTick } from "@thesis/chain";

const FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const STRIKE = 7_400_000_000n; // $74.00

const NOW = 2_000;
const provableAt = (m: MarketView, t: PriceTick, bps: number) => provable(m, t, bps, NOW);

const market = (over: Partial<MarketView> = {}): MarketView => ({
  feedId: FEED,
  direction: "below",
  strike: STRIKE,
  expo: -8,
  startTs: 1_000,
  endTs: 1_600,
  touched: false,
  settled: false,
  ...over,
});
const tick = (over: Partial<PriceTick> = {}): PriceTick => ({
  feedId: FEED,
  price: STRIKE - 1n,
  conf: 100_000n,
  expo: -8,
  publishTime: 1_100,
  fullyVerified: true,
  ...over,
});

test("accepts a valid crossing, at and beyond the strike, both directions", () => {
  assert.deepEqual(provableAt(market(), tick(), 50), { ok: true });
  assert.deepEqual(provableAt(market(), tick({ price: STRIKE }), 50), { ok: true });
  assert.deepEqual(provableAt(market({ direction: "above" }), tick({ price: STRIKE + 5n }), 50), { ok: true });
  assert.deepEqual(provableAt(market(), tick({ publishTime: 1_000 }), 50), { ok: true });
  assert.deepEqual(provableAt(market(), tick({ publishTime: 1_600 }), 50), { ok: true });
  // Within the clock-skew allowance.
  assert.deepEqual(provableAt(market({ endTs: 9_999 }), tick({ publishTime: NOW + 15 }), 50), { ok: true });
});

test("mirrors every onchain rejection", () => {
  const cases: [string, MarketView, PriceTick][] = [
    ["AlreadyFinal", market({ touched: true }), tick()],
    ["AlreadyFinal", market({ settled: true }), tick()],
    ["NotFullyVerified", market(), tick({ fullyVerified: false })],
    ["WrongFeed", market(), tick({ feedId: Buffer.alloc(32, 1) })],
    ["NonPositivePrice", market(), tick({ price: 0n })],
    ["ConfTooWide", market(), tick({ conf: STRIKE / 100n })],
    ["OutsideWindow", market(), tick({ publishTime: 999 })],
    ["OutsideWindow", market(), tick({ publishTime: 1_601 })],
    ["WrongExpo", market(), tick({ expo: -6 })],
    ["NoTouch", market(), tick({ price: STRIKE + 1n })],
    ["NoTouch", market({ direction: "above" }), tick({ price: STRIKE - 1n })],
    ["FuturePrice", market({ endTs: 9_999 }), tick({ publishTime: NOW + 16 })],
  ];
  for (const [reason, m, t] of cases) assert.deepEqual(provableAt(m, t, 50), { ok: false, reason }, reason);
});

test("settleable only after end + grace", () => {
  assert.equal(settleable({ endTs: 1_600, settled: false }, 120, 1_719), false);
  assert.equal(settleable({ endTs: 1_600, settled: false }, 120, 1_720), true);
  assert.equal(settleable({ endTs: 1_600, settled: true }, 120, 9_999), false);
});

test("decodes a real devnet PriceUpdateV2 account", () => {
  const data = readFileSync(resolve(__dirname, "../../../tests/fixtures/sol_usd_price_update_devnet.bin"));
  const t = decodePriceUpdateV2(data);
  assert.equal(t.fullyVerified, true);
  assert.ok(t.feedId.equals(FEED));
  assert.equal(t.price, 7_477_778_734n);
  assert.equal(t.expo, -8);
  assert.equal(t.publishTime, 1_794_993_029);
  assert.throws(() => decodePriceUpdateV2(Buffer.alloc(134)));
});
