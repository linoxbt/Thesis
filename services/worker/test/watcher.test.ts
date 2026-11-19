import { test } from "node:test";
import assert from "node:assert/strict";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { PriceTick } from "@thesis/chain";
import type { Ctx, TouchMarketAccount } from "../src/client";
import type { PriceSource } from "../src/sources";
import { Watcher } from "../src/watcher";

const FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const STRIKE = 7_400_000_000n;
const PROOF = Keypair.generate().publicKey;
const now = () => Math.floor(Date.now() / 1000);

/** A PriceUpdateV2 account (full verification), as the decoder reads it. */
function priceAccount(price: bigint, publishTime: number): Buffer {
  const b = Buffer.alloc(8 + 32 + 1 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8);
  Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(b, 0);
  b[40] = 1;
  FEED.copy(b, 41);
  b.writeBigInt64LE(price, 73);
  b.writeBigUInt64LE(100_000n, 81);
  b.writeInt32LE(-8, 89);
  b.writeBigInt64LE(BigInt(publishTime), 93);
  return b;
}

function market(endTs: number): { publicKey: PublicKey; account: TouchMarketAccount } {
  const z = PublicKey.default;
  return {
    publicKey: Keypair.generate().publicKey,
    account: {
      pmMarket: Keypair.generate().publicKey, feedId: [...FEED], direction: { below: {} }, strike: new BN(STRIKE.toString()), expo: -8,
      startTs: new BN(now() - 600), endTs: new BN(endTs), touched: false, settled: false, seededBy: z, originThesis: z,
    } as unknown as TouchMarketAccount,
  };
}

/** A watcher over fake chain state whose proofs succeed or fail on demand. */
class TestWatcher extends Watcher {
  failProofs = true;
  proved: string[] = [];
  protected override async prove(key: PublicKey): Promise<string> {
    if (this.failProofs) throw new Error("blockhash not found");
    this.proved.push(key.toBase58());
    return "sig";
  }
}

function harness(markets: ReturnType<typeof market>[], live: { data: Buffer }) {
  const ctx = {
    config: PublicKey.default,
    connection: { getAccountInfo: async () => ({ data: live.data }) },
    program: {
      account: {
        config: { fetch: async () => ({ maxConfBps: 50, usdcMint: PublicKey.default, graceSecs: 120 }) },
        touchMarket: { all: async () => markets },
      },
    },
  } as unknown as Ctx;
  const source: PriceSource = { name: "test", start: async () => {}, stop: async () => {} };
  const alerts: string[] = [];
  const w = new TestWatcher(ctx, source, { treasuryBuyMicroUsdc: 0, refreshMs: 60_000, alert: (k) => alerts.push(k) });
  return { w, alerts };
}

const tickAt = (price: bigint, publishTime: number): PriceTick => ({
  feedId: FEED, price, conf: 100_000n, expo: -8, publishTime, fullyVerified: true, proofAccount: PROOF,
});

test("a failed proof retries from the live account while the print is still there", async () => {
  const m = market(now() + 3_600);
  const t = now() - 10;
  const live = { data: priceAccount(STRIKE - 1n, t) };
  const { w, alerts } = harness([m], live);
  await w.refresh();
  await w.onTick(tickAt(STRIKE - 1n, t));
  assert.deepEqual(w.proved, []);
  w.failProofs = false;
  await w.refresh();
  assert.deepEqual(w.proved, [m.publicKey.toBase58()]);
  assert.deepEqual(alerts, []);
});

test("an overwritten crossing print is reported lost, unless the new print crosses too", async () => {
  const [a, b] = [market(now() + 3_600), market(now() + 3_600)];
  const t = now() - 20;
  const live = { data: priceAccount(STRIKE - 1n, t) };
  const { w, alerts } = harness([a], live);
  await w.refresh();
  await w.onTick(tickAt(STRIKE - 1n, t));
  live.data = priceAccount(STRIKE + 50n, t + 10); // Pyth moved on, back above the strike
  w.failProofs = false;
  await w.refresh();
  assert.deepEqual(w.proved, []);
  assert.deepEqual(alerts, [`lost:${a.publicKey.toBase58()}`]);

  // Same story, but the newer print also crosses: proven from it.
  const h = harness([b], { data: priceAccount(STRIKE - 1n, t) });
  await h.w.refresh();
  await h.w.onTick(tickAt(STRIKE - 1n, t));
  h.w.failProofs = false;
  (h.w as unknown as { ctx: Ctx }).ctx.connection.getAccountInfo = (async () => ({ data: priceAccount(STRIKE - 5n, t + 10) })) as never;
  await h.w.refresh();
  assert.deepEqual(h.w.proved, [b.publicKey.toBase58()]);
});

test("markets found by a refresh are checked against the last tick", async () => {
  const markets: ReturnType<typeof market>[] = [];
  const t = now() - 5;
  const { w } = harness(markets, { data: priceAccount(STRIKE - 1n, t) });
  w.failProofs = false;
  await w.refresh();
  await w.onTick(tickAt(STRIKE - 1n, t));
  const m = market(now() + 3_600);
  markets.push(m);
  await w.refresh();
  assert.deepEqual(w.proved, [m.publicKey.toBase58()]);
});
