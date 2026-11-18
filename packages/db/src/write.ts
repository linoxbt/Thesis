import { createHash } from "node:crypto";
import type { Db } from "./client";

export interface MarketRow {
  touch_market: string;
  pm_market: string;
  market_id: string;
  feed_id: string;
  direction: "above" | "below";
  strike: bigint;
  expo: number;
  spot_at_open: bigint;
  start_ts: number;
  end_ts: number;
  initial_price_bps: number;
  seed_usdc: bigint;
  seeded_by: string;
  sponsored: boolean;
  creator: string;
  origin_thesis: string | null;
  touched: boolean;
  touch_price: bigint | null;
  touch_publish_time: number | null;
  prover: string | null;
  settled: boolean;
  winning_side: number;
}

/** Account state wins: every state column is overwritten; tx columns are kept. */
export async function upsertMarket(db: Db, m: MarketRow): Promise<void> {
  await db.query(
    `insert into markets (touch_market, pm_market, market_id, feed_id, direction, strike, expo, spot_at_open,
       start_ts, end_ts, initial_price_bps, seed_usdc, seeded_by, sponsored, creator, origin_thesis, touched,
       touch_price, touch_publish_time, prover, settled, winning_side)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     on conflict (touch_market) do update set
       origin_thesis = excluded.origin_thesis, touched = excluded.touched, touch_price = excluded.touch_price,
       touch_publish_time = excluded.touch_publish_time, prover = excluded.prover, settled = excluded.settled,
       winning_side = excluded.winning_side, updated_at = now()`,
    [
      m.touch_market, m.pm_market, m.market_id, m.feed_id, m.direction, m.strike.toString(), m.expo,
      m.spot_at_open.toString(), m.start_ts, m.end_ts, m.initial_price_bps, m.seed_usdc.toString(), m.seeded_by,
      m.sponsored, m.creator, m.origin_thesis, m.touched, m.touch_price?.toString() ?? null, m.touch_publish_time,
      m.prover, m.settled, m.winning_side,
    ],
  );
}

export async function setMarketTx(db: Db, touchMarket: string, column: "created_tx" | "proof_tx" | "settle_tx", sig: string) {
  await db.query(`update markets set ${column} = $2, updated_at = now() where touch_market = $1 and ${column} is null`, [
    touchMarket,
    sig,
  ]);
}

export async function setMarketPrice(db: Db, touchMarket: string, ts: number, yesPriceBps: number): Promise<void> {
  await db.query("update markets set yes_price_bps = $2, updated_at = now() where touch_market = $1", [touchMarket, yesPriceBps]);
  await db.query(
    "insert into price_points (touch_market, ts, yes_price_bps) values ($1,$2,$3) on conflict do nothing",
    [touchMarket, ts, yesPriceBps],
  );
}

export interface ThesisRow {
  pda: string;
  creator: string;
  thesis_id: number;
  text_hash: string;
  conviction_market: string;
  protection_market: string | null;
  created_ts: number;
  end_ts: number;
  volume_usdc: bigint;
  self_volume_usdc: bigint;
  fees_attributed: bigint;
  fees_claimed: bigint;
  outcome: number;
}

export async function upsertThesis(db: Db, t: ThesisRow): Promise<void> {
  await db.query(
    `insert into theses (pda, creator, thesis_id, text_hash, conviction_market, protection_market, created_ts, end_ts,
       volume_usdc, self_volume_usdc, fees_attributed, fees_claimed, outcome)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (pda) do update set
       volume_usdc = excluded.volume_usdc, self_volume_usdc = excluded.self_volume_usdc,
       fees_attributed = excluded.fees_attributed, fees_claimed = excluded.fees_claimed,
       outcome = excluded.outcome, updated_at = now()`,
    [
      t.pda, t.creator, t.thesis_id, t.text_hash, t.conviction_market, t.protection_market, t.created_ts, t.end_ts,
      t.volume_usdc.toString(), t.self_volume_usdc.toString(), t.fees_attributed.toString(), t.fees_claimed.toString(),
      t.outcome,
    ],
  );
}

export async function setThesisCreatedTx(db: Db, pda: string, sig: string): Promise<void> {
  await db.query("update theses set created_tx = $2 where pda = $1 and created_tx is null", [pda, sig]);
}

export type TradeSide = "buy_yes" | "buy_no" | "sell_yes" | "sell_no" | "other";

export interface TradeRow {
  signature: string;
  ix_index: number;
  touch_market: string;
  thesis: string | null;
  wallet: string;
  side: TradeSide;
  usdc_amount: bigint;
  token_amount: bigint;
  fee_to_treasury: bigint;
  price_after_bps: number | null;
  ts: number;
  via_thesis: boolean;
  is_creator: boolean;
  is_treasury: boolean;
}

/** Idempotent: a trade is keyed by (signature, instruction index). */
export async function insertTrade(db: Db, t: TradeRow): Promise<boolean> {
  const r = await db.query(
    `insert into trades (signature, ix_index, touch_market, thesis, wallet, side, usdc_amount, token_amount,
       fee_to_treasury, price_after_bps, ts, via_thesis, is_creator, is_treasury)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict do nothing returning signature`,
    [
      t.signature, t.ix_index, t.touch_market, t.thesis, t.wallet, t.side, t.usdc_amount.toString(),
      t.token_amount.toString(), t.fee_to_treasury.toString(), t.price_after_bps, t.ts, t.via_thesis, t.is_creator,
      t.is_treasury,
    ],
  );
  return r.rows.length > 0;
}

export async function insertCrossing(
  db: Db,
  c: { touch_market: string; feed_id: string; publish_time: number; price: bigint; proof_tx: string; prover: string },
): Promise<void> {
  await db.query(
    `insert into crossings (touch_market, feed_id, publish_time, price, proof_tx, prover)
     values ($1,$2,$3,$4,$5,$6) on conflict (proof_tx) do nothing`,
    [c.touch_market, c.feed_id, c.publish_time, c.price.toString(), c.proof_tx, c.prover],
  );
}

export async function insertFeeClaim(
  db: Db,
  c: { signature: string; thesis: string; creator: string; amount: bigint; ts: number },
): Promise<void> {
  await db.query(
    "insert into fee_claims (signature, thesis, creator, amount, ts) values ($1,$2,$3,$4,$5) on conflict do nothing",
    [c.signature, c.thesis, c.creator, c.amount.toString(), c.ts],
  );
}

export async function insertSpotSample(db: Db, s: { feed_id: string; publish_time: number; price: bigint; expo: number }) {
  await db.query(
    "insert into spot_samples (feed_id, publish_time, price, expo) values ($1,$2,$3,$4) on conflict do nothing",
    [s.feed_id, s.publish_time, s.price.toString(), s.expo],
  );
}

export async function getCursor(db: Db, key: string): Promise<string | null> {
  const r = await db.query<{ last_signature: string }>("select last_signature from indexer_cursors where key = $1", [key]);
  return r.rows[0]?.last_signature ?? null;
}

export async function setCursor(db: Db, key: string, sig: string): Promise<void> {
  await db.query(
    `insert into indexer_cursors (key, last_signature) values ($1,$2)
     on conflict (key) do update set last_signature = excluded.last_signature, updated_at = now()`,
    [key, sig],
  );
}

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Stores the thesis text only if it hashes to the onchain `text_hash`. */
export async function setThesisText(db: Db, pda: string, text: string): Promise<"ok" | "not_found" | "hash_mismatch"> {
  const r = await db.query<{ text_hash: string }>("select text_hash from theses where pda = $1", [pda]);
  if (!r.rows[0]) return "not_found";
  if (r.rows[0].text_hash !== sha256Hex(text)) return "hash_mismatch";
  await db.query("update theses set text = $2, updated_at = now() where pda = $1", [pda, text]);
  return "ok";
}

export async function upsertProfile(db: Db, p: { wallet: string; display_name?: string | null; x_handle?: string | null }) {
  await db.query(
    `insert into profiles (wallet, display_name, x_handle) values ($1,$2,$3)
     on conflict (wallet) do update set display_name = excluded.display_name, x_handle = excluded.x_handle, updated_at = now()`,
    [p.wallet, p.display_name ?? null, p.x_handle ?? null],
  );
}

/**
 * Stores a wallet-signed profile edit. `issuedAt` (unix seconds, from the
 * signed message) becomes `updated_at`, and an edit is applied only if it is
 * newer than the stored one, so replaying an old signature changes nothing.
 * Returns whether the row was written.
 */
export async function saveSignedProfile(
  db: Db,
  p: { wallet: string; display_name: string; x_handle: string | null; issued_at: number },
): Promise<boolean> {
  const r = await db.query(
    `insert into profiles (wallet, display_name, x_handle, updated_at) values ($1, $2, $3, to_timestamp($4))
     on conflict (wallet) do update set display_name = excluded.display_name, x_handle = excluded.x_handle, updated_at = excluded.updated_at
       where profiles.updated_at < excluded.updated_at
     returning wallet`,
    [p.wallet, p.display_name, p.x_handle, p.issued_at],
  );
  return r.rows.length > 0;
}
