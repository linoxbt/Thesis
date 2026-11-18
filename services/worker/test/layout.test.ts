import { test } from "node:test";
import assert from "node:assert/strict";
import { BN, BorshAccountsCoder } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { THESIS_IDL } from "@thesis/chain";
import { TOUCH_SEEDED_BY_OFFSET, TOUCH_SETTLED_OFFSET } from "../src/client";

test("memcmp offsets match the TouchMarket layout", async () => {
  const coder = new BorshAccountsCoder(THESIS_IDL as never);
  const seededBy = Keypair.generate().publicKey;
  const z = PublicKey.default;
  const data = await coder.encode("TouchMarket", {
    pm_market: z, market_id: new BN(1), feed_id: Array(32).fill(0), direction: { Below: {} }, strike: new BN(1), expo: -8,
    start_ts: new BN(0), end_ts: new BN(0), initial_price_bps: 0, touched: false, touch_price: new BN(0), touch_publish_time: new BN(0),
    prover: z, settled: true, winning_side: 2, origin_thesis: z, creator: z, seeded_by: seededBy, seed_amount: new BN(0), spot_at_open: new BN(0), bump: 0,
  });
  assert.equal(data[TOUCH_SETTLED_OFFSET], 1);
  assert.equal(data[TOUCH_SETTLED_OFFSET + 1], 2, "winning_side follows settled");
  assert.deepEqual(new PublicKey(data.subarray(TOUCH_SEEDED_BY_OFFSET, TOUCH_SEEDED_BY_OFFSET + 32)), seededBy);
});
