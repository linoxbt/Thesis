import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createLinkCode, insertTrade, isLocalUrl, migrate, Pool, upsertMarket, upsertThesis, type MarketRow } from "@thesis/db";
import { AlertNotifier, settleText, TelegramBot, touchText, tradeLine, tradeText, type TelegramApi } from "../src/telegram";

const SITE = "https://thesis.test";
const NOW = Math.floor(Date.now() / 1000);
// A long: entry 73.04, take profit 75.24, liquidation 69.39 (Pyth expo -8) -> 20x.
const T = {
  pda: "T1", creator: "Alice", direction: "above" as const, strike: "7524000000", expo: -8,
  spot_at_open: "7304000000", liq_strike: "6939000000", end_ts: String(NOW + 86_400),
};

test("trade line reads as the perp position", () => {
  assert.equal(tradeLine(T), "Long SOL 20x · TP $75.24 · liq $69.39");
  assert.equal(tradeLine({ ...T, direction: "below", strike: "7000000000", liq_strike: null }), "Short SOL · TP $70.00");
});

test("touch, settle and trade texts", () => {
  const tp = touchText(SITE, { ...T, is_conviction: true, is_creator: true, touch_price: "7531000000" });
  assert.match(tp, /Take profit hit/);
  assert.match(tp, /\$75\.31/);
  assert.match(tp, /href="https:\/\/thesis\.test\/t\/T1"/);
  assert.match(touchText(SITE, { ...T, is_conviction: false, is_creator: false, touch_price: "6935000000" }), /The cover you bought pays/);
  assert.match(settleText(SITE, { ...T, is_conviction: true, is_creator: true, winning_side: 1, sides: null }), /Called it/);
  assert.match(settleText(SITE, { ...T, is_conviction: true, is_creator: true, winning_side: 2, sides: null }), /Missed it/);
  assert.match(settleText(SITE, { ...T, is_conviction: true, is_creator: false, winning_side: 2, sides: "buy_no" }), /Your side won/);
  assert.match(tradeText(SITE, { ...T, side: "buy_no", usdc_amount: "10000000", is_conviction: true, price_after_bps: 3600 }), /Challenged.*\$10\.00 of NO \(YES now 36%\)/);
  assert.match(tradeText(SITE, { ...T, side: "buy_yes", usdc_amount: "2000000", is_conviction: false, price_after_bps: null }), /Cover bought/);
});

// ---- bot + notifier against Postgres, with a fake Telegram API ----

const BASE = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5433";
// These tests drop schemas and databases: never point them at a shared server.
if (!isLocalUrl(BASE) && process.env.ALLOW_REMOTE_TEST_DB !== "1") throw new Error(`refusing to run destructive tests against ${BASE}`);
const DB_NAME = "thesis_test_alerts";
let db: Pool;
const sent: { method: string; params: Record<string, unknown> }[] = [];
let failNext = false;
const api: TelegramApi = {
  async call<R>(method: string, params: Record<string, unknown>) {
    if (failNext) {
      failNext = false;
      throw new Error("telegram down");
    }
    sent.push({ method, params });
    return [] as R;
  },
};
const market = (over: Partial<MarketRow>): MarketRow => ({
  touch_market: "C1", pm_market: "PMC1", market_id: "1", feed_id: "ef0d", direction: "above", strike: 7_524_000_000n, expo: -8,
  spot_at_open: 7_304_000_000n, start_ts: NOW - 3600, end_ts: NOW + 86_400, initial_price_bps: 5000, seed_usdc: 25_000_000n,
  seeded_by: "Alice", sponsored: false, creator: "Alice", origin_thesis: "T1", touched: false, touch_price: null,
  touch_publish_time: null, prover: null, settled: false, winning_side: 0, ...over,
});

before(async () => {
  const admin = new Pool({ connectionString: `${BASE}/postgres` });
  await admin.query(`drop database if exists ${DB_NAME}`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  db = new Pool({ connectionString: `${BASE}/${DB_NAME}` });
  await migrate(db);
  await upsertMarket(db, market({}));
  await upsertMarket(db, market({ touch_market: "P1", pm_market: "PMP1", direction: "below", strike: 6_939_000_000n }));
  await upsertThesis(db, {
    pda: "T1", creator: "Alice", thesis_id: 0, text_hash: "00", conviction_market: "C1", protection_market: "P1",
    created_ts: NOW - 3600, end_ts: NOW + 86_400, volume_usdc: 0n, self_volume_usdc: 0n, fees_attributed: 0n, fees_claimed: 0n, outcome: 0,
  });
});

after(() => db.end());

test("bot links a chat with /start <code>, refuses reuse, unlinks with /stop", async () => {
  const bot = new TelegramBot(api, db, { siteUrl: SITE });
  const code = await createLinkCode(db, "Alice");
  await bot.handle({ update_id: 1, message: { chat: { id: 4242 }, from: { username: "alice" }, text: `/start ${code}` } });
  assert.match(String(sent.at(-1)?.params.text), /Linked to wallet/);
  await bot.handle({ update_id: 2, message: { chat: { id: 9999 }, text: `/start ${code}` } });
  assert.match(String(sent.at(-1)?.params.text), /expired/);
  const linked = await db.query("select chat_id from telegram_links where wallet = 'Alice'");
  assert.equal(Number(linked.rows[0].chat_id), 4242);
});

test("notifier: sends each alert once, retries a failed send", async () => {
  const notifier = new AlertNotifier(api, db, { siteUrl: SITE, intervalMs: 60_000 });
  assert.equal(await notifier.tick(), 0, "nothing has happened since linking");

  // Take profit touched after Alice linked.
  await upsertMarket(db, market({ touched: true, touch_price: 7_531_000_000n, touch_publish_time: NOW + 5 }));
  sent.length = 0;
  assert.equal(await notifier.tick(), 1);
  assert.equal(sent[0].params.chat_id, "4242");
  assert.match(String(sent[0].params.text), /Take profit hit/);
  assert.equal(await notifier.tick(), 0, "not repeated");

  // Bob challenges Alice's call; the first send fails, the next pass retries it.
  await insertTrade(db, {
    signature: "sig1", ix_index: 0, touch_market: "C1", thesis: "T1", wallet: "Bob", side: "buy_no", usdc_amount: 10_000_000n,
    token_amount: 25_000_000n, fee_to_treasury: 100_000n, price_after_bps: 3600, ts: NOW + 10, via_thesis: true, is_creator: false, is_treasury: false,
  });
  failNext = true;
  sent.length = 0;
  assert.equal(await notifier.tick(), 0, "send failed");
  assert.equal(await notifier.tick(), 1, "retried");
  assert.match(String(sent[0].params.text), /Challenged/);
});
