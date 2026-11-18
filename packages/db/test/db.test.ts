import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  feed, insertCrossing, insertTrade, migrate, profile, saveSignedProfile, setMarketPrice, setMarketTx, setThesisText, sha256Hex,
  stats, thesisDetail, upsertMarket, upsertProfile, upsertThesis, type MarketRow, type TradeRow,
} from "../src";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/thesis_test";
const db = new Pool({ connectionString: URL });
const NOW = 1_800_000_000;
const TEAM = "TeamWa11et";

const market = (over: Partial<MarketRow>): MarketRow => ({
  touch_market: "TM", pm_market: "PM", market_id: "1", feed_id: "ef0d", direction: "below",
  strike: 7_000_000_000n, expo: -8, spot_at_open: 7_400_000_000n, start_ts: NOW - 3600, end_ts: NOW + 86_400,
  initial_price_bps: 2500, seed_usdc: 25_000_000n, seeded_by: "Auth", sponsored: true, creator: "Alice",
  origin_thesis: null, touched: false, touch_price: null, touch_publish_time: null, prover: null, settled: false,
  winning_side: 0, ...over,
});
const trade = (over: Partial<TradeRow>): TradeRow => ({
  signature: "sig", ix_index: 0, touch_market: "C1", thesis: "T1", wallet: "Bob", side: "buy_yes",
  usdc_amount: 10_000_000n, token_amount: 30_000_000n, fee_to_treasury: 100_000n, price_after_bps: 3000,
  ts: NOW - 60, via_thesis: true, is_creator: false, is_treasury: false, ...over,
});

before(async () => {
  await db.query("drop schema public cascade; create schema public;");
  assert.deepEqual(await migrate(db), ["001_init.sql"]);
  assert.deepEqual(await migrate(db), [], "migrations are idempotent");

  // Alice: thesis T1 (conviction C1 above, protection P1 below), and T2 (missed, old).
  await upsertMarket(db, market({ touch_market: "C1", pm_market: "PMC1", direction: "above", strike: 7_700_000_000n, origin_thesis: "T1", initial_price_bps: 3000 }));
  await upsertMarket(db, market({ touch_market: "P1", pm_market: "PMP1", origin_thesis: "T1" }));
  await upsertMarket(db, market({ touch_market: "C2", pm_market: "PMC2", origin_thesis: "T2", end_ts: NOW - 100, settled: true, winning_side: 2 }));
  // Carol: thesis T3, ending soonest, touched.
  await upsertMarket(db, market({ touch_market: "C3", pm_market: "PMC3", creator: "Carol", origin_thesis: "T3", end_ts: NOW + 600,
    touched: true, touch_price: 6_990_000_000n, touch_publish_time: NOW - 30, prover: "Watcher" }));
  await setMarketTx(db, "C3", "proof_tx", "proofSig");
  await setMarketTx(db, "C3", "proof_tx", "ignoredSecondSig");

  const thesis = (pda: string, creator: string, id: number, c: string, p: string | null, over = {}) => ({
    pda, creator, thesis_id: id, text_hash: sha256Hex(`text ${pda}`), conviction_market: c, protection_market: p,
    created_ts: NOW - 3600 + id, end_ts: NOW + 86_400, volume_usdc: 0n, self_volume_usdc: 0n, fees_attributed: 0n,
    fees_claimed: 0n, outcome: 0, ...over,
  });
  await upsertThesis(db, thesis("T1", "Alice", 0, "C1", "P1", { volume_usdc: 25_000_000n, self_volume_usdc: 5_000_000n, fees_attributed: 250_000n }));
  await upsertThesis(db, thesis("T2", "Alice", 1, "C2", null, { end_ts: NOW - 100, outcome: 2, created_ts: NOW - 90_000 }));
  await upsertThesis(db, thesis("T3", "Carol", 0, "C3", null, { end_ts: NOW + 600, created_ts: NOW - 100 }));
  await upsertThesis(db, thesis("T9", TEAM, 0, "C3", null));
  await upsertProfile(db, { wallet: "Alice", display_name: "alice", x_handle: "@alice" });

  await insertTrade(db, trade({ signature: "s1" }));
  await insertTrade(db, trade({ signature: "s2", wallet: "Alice", side: "buy_no", usdc_amount: 5_000_000n, is_creator: true }));
  await insertTrade(db, trade({ signature: "s3", touch_market: "C1", thesis: null, wallet: "Dave", via_thesis: false, usdc_amount: 4_000_000n }));
  await insertTrade(db, trade({ signature: "s4", touch_market: "P1", wallet: "Bob", usdc_amount: 6_000_000n, token_amount: 40_000_000n }));
  await insertTrade(db, trade({ signature: "s5", touch_market: "C3", thesis: "T3", wallet: TEAM, ts: NOW - 200_000 }));
  await insertTrade(db, trade({ signature: "s6", touch_market: "C3", thesis: "T3", wallet: "Auth", is_treasury: true }));
  assert.equal(await insertTrade(db, trade({ signature: "s1" })), false, "trades are idempotent");
  await insertCrossing(db, { touch_market: "C3", feed_id: "ef0d", publish_time: NOW - 30, price: 6_990_000_000n, proof_tx: "proofSig", prover: "Watcher" });
  await setMarketPrice(db, "C1", NOW - 30, 3300);
  await setMarketPrice(db, "C1", NOW, 3400);
});

after(() => db.end());

test("feed sorts hot, new and ending", async () => {
  const hot = await feed(db, { sort: "hot", now: NOW });
  assert.equal(hot[0].pda, "T1", "most 24h volume first");
  assert.equal(hot[0].volume_24h, "25000000", "conviction + protection + direct swaps, 24h");
  assert.equal(hot[0].yes_price_bps, 3400, "latest pool price");
  assert.equal(hot[0].has_protection, true);
  assert.equal(hot[0].display_name, "alice");
  assert.equal(hot.find((r) => r.pda === "T3")?.volume_24h, "0", "treasury buys and old trades don't count");
  const fresh = await feed(db, { sort: "new", now: NOW });
  assert.equal(fresh[0].pda, "T3", "newest first");
  assert.equal(fresh.at(-1)?.pda, "T2", "oldest last");
  const ending = await feed(db, { sort: "ending", now: NOW });
  assert.equal(ending[0].pda, "T3", "ending soonest first");
  assert.ok(!ending.some((r) => r.pda === "T2"), "finished theses are not 'ending'");
});

test("thesis detail has both markets, trades, prices and creator stats", async () => {
  const d = await thesisDetail(db, "T1");
  assert.ok(d);
  assert.equal(d.conviction?.touch_market, "C1");
  assert.equal(d.protection?.touch_market, "P1");
  assert.deepEqual(d.trades.map((t) => t.signature).sort(), ["s1", "s2", "s3", "s4"]);
  assert.equal(d.prices.length, 2);
  const s = d.creator.stats as Record<string, string>;
  assert.equal(Number(s.posted), 2);
  assert.equal(Number(s.missed), 1);
  assert.equal(await thesisDetail(db, "nope"), null);
});

test("thesis text is stored only when it matches the onchain hash", async () => {
  assert.equal(await setThesisText(db, "T1", "wrong"), "hash_mismatch");
  assert.equal(await setThesisText(db, "T1", "text T1"), "ok");
  assert.equal(await setThesisText(db, "nope", "x"), "not_found");
  assert.equal((await thesisDetail(db, "T1"))?.thesis.text, "text T1");
});

test("profile: raw numbers, self volume, fees earned, cover", async () => {
  const p = await profile(db, "Alice");
  const s = p.stats as Record<string, string>;
  assert.equal(Number(s.posted), 2);
  assert.equal(s.self_volume_usdc, "5000000");
  assert.equal(p.fees_earned, "125000", "50% of 0.25 USDC attributed");
  assert.equal(p.history.length, 2);
  const bob = await profile(db, "Bob");
  assert.equal(bob.protection_bought_usdc, "6000000");
  assert.equal(bob.protection_paid_out_usdc, "0", "protection market not settled YES");
});

test("stats exclude team wallets and the treasury, and list proofs", async () => {
  const s = await stats(db, [TEAM]);
  assert.equal(Number(s.wallets), 3, "Bob, Alice, Dave");
  assert.equal(Number(s.trades), 4);
  assert.equal(s.volume_usdc, "25000000");
  assert.equal(s.volume_via_thesis_usdc, "21000000");
  assert.equal(Number(s.theses), 3);
  assert.equal(Number(s.creators), 2);
  assert.equal(s.cover_bought_usdc, "6000000");
  assert.equal(s.touches_proven, 1);
  assert.equal(s.touches[0].proof_tx, "proofSig", "first proof tx kept");
});

test("signed profile edits apply only when newer than the stored one", async () => {
  const w = "Signer";
  const save = (name: string, at: number) => saveSignedProfile(db, { wallet: w, display_name: name, x_handle: null, issued_at: at });
  assert.equal(await save("first", NOW), true, "first edit stored");
  assert.equal(await save("replayed", NOW), false, "same issued_at is a replay");
  assert.equal(await save("older", NOW - 10), false, "older edit refused");
  assert.equal(await save("newer", NOW + 10), true, "newer edit applied");
  const p = (await profile(db, w)).profile as { display_name: string };
  assert.equal(p.display_name, "newer");
});
