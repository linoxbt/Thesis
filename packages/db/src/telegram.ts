import { randomBytes } from "node:crypto";
import type { Db } from "./client";

export const LINK_CODE_TTL_SECS = 15 * 60;

/** A one-time code the wallet's owner sends to the bot (`/start <code>`). */
export async function createLinkCode(db: Db, wallet: string): Promise<string> {
  const code = randomBytes(12).toString("base64url");
  await db.query("delete from telegram_link_codes where wallet = $1 or expires_at < now()", [wallet]);
  await db.query("insert into telegram_link_codes (code, wallet, expires_at) values ($1, $2, now() + make_interval(secs => $3))", [
    code,
    wallet,
    LINK_CODE_TTL_SECS,
  ]);
  return code;
}

/** Spends a code: links its wallet to the chat. Returns the wallet, or null if the code is unknown or expired. */
export async function consumeLinkCode(db: Db, code: string, chatId: number, username: string | null): Promise<string | null> {
  const r = await db.query<{ wallet: string }>("delete from telegram_link_codes where code = $1 and expires_at > now() returning wallet", [code]);
  const wallet = r.rows[0]?.wallet;
  if (!wallet) return null;
  await db.query(
    `insert into telegram_links (wallet, chat_id, username, linked_at) values ($1, $2, $3, now())
     on conflict (wallet) do update set chat_id = excluded.chat_id, username = excluded.username, linked_at = now()`,
    [wallet, chatId, username],
  );
  return wallet;
}

export async function unlinkChat(db: Db, chatId: number): Promise<string[]> {
  return (await db.query<{ wallet: string }>("delete from telegram_links where chat_id = $1 returning wallet", [chatId])).rows.map((r) => r.wallet);
}

export async function unlinkWallet(db: Db, wallet: string): Promise<boolean> {
  return (await db.query("delete from telegram_links where wallet = $1 returning wallet", [wallet])).rows.length > 0;
}

export async function telegramLink(db: Db, wallet: string): Promise<{ username: string | null; linked_at: string } | null> {
  return ((await db.query("select username, linked_at from telegram_links where wallet = $1", [wallet])).rows[0] as never) ?? null;
}

/** Records an alert key; true if it was new (send it), false if already sent. */
/**
 * Alerts older than this are never sent (a worker down for a week doesn't
 * wake up and flood chats), and keeps each pass's scan bounded. Keys already
 * in alerts_sent are filtered in SQL, so a pass only returns unsent alerts;
 * the key formats here must match AlertNotifier's.
 */
export const ALERT_WINDOW_SECS = 3 * 86_400;

export async function claimAlert(db: Db, key: string): Promise<boolean> {
  return (await db.query("insert into alerts_sent (key) values ($1) on conflict do nothing returning key", [key])).rows.length > 0;
}

export async function releaseAlert(db: Db, key: string): Promise<void> {
  await db.query("delete from alerts_sent where key = $1", [key]);
}

/** Fields every alert needs to describe the trade behind it. */
export interface AlertThesis {
  pda: string;
  creator: string;
  direction: "above" | "below";
  strike: string;
  expo: number;
  spot_at_open: string;
  liq_strike: string | null;
  end_ts: string;
}

export interface AlertRow extends AlertThesis {
  chat_id: string;
  wallet: string;
  is_creator: boolean;
}

const THESIS_COLS = `t.pda, t.creator, c.direction, c.strike, c.expo, c.spot_at_open, pr.strike as liq_strike, t.end_ts`;
const THESIS_JOIN = `join markets c on c.touch_market = t.conviction_market left join markets pr on pr.touch_market = t.protection_market`;

/**
 * Touches since each recipient linked: the take profit (conviction) or the
 * liquidation (protection) was proven. Recipients: the thesis creator and
 * every linked wallet that bought YES on that market.
 */
export async function touchAlerts(db: Db) {
  return (
    await db.query(
      `select ${THESIS_COLS}, m.touch_market, (m.touch_market = t.conviction_market) as is_conviction,
              m.touch_price, m.touch_publish_time, l.chat_id, l.wallet, (l.wallet = t.creator) as is_creator
         from markets m
         join theses t on m.touch_market in (t.conviction_market, t.protection_market)
         ${THESIS_JOIN}
         join telegram_links l on l.wallet = t.creator
           or l.wallet in (select wallet from trades tr where tr.touch_market = m.touch_market and tr.side = 'buy_yes')
        where m.touched and m.touch_publish_time >= extract(epoch from l.linked_at)::bigint - 60
          and m.touch_publish_time >= extract(epoch from now())::bigint - $1
          and not exists (select 1 from alerts_sent a where a.key = 'touch:' || m.touch_market || ':' || l.wallet)`,
      [ALERT_WINDOW_SECS],
    )
  ).rows as unknown as (AlertRow & { touch_market: string; is_conviction: boolean; touch_price: string; touch_publish_time: string })[];
}

/**
 * Settlements of markets that ended after the recipient linked: the creator
 * (called it / missed it) and every linked wallet that traded the market
 * (which side won).
 */
export async function settleAlerts(db: Db) {
  return (
    await db.query(
      `select ${THESIS_COLS}, m.touch_market, (m.touch_market = t.conviction_market) as is_conviction,
              m.winning_side, l.chat_id, l.wallet, (l.wallet = t.creator) as is_creator,
              (select string_agg(distinct tr.side, ',') from trades tr where tr.touch_market = m.touch_market and tr.wallet = l.wallet) as sides
         from markets m
         join theses t on m.touch_market in (t.conviction_market, t.protection_market)
         ${THESIS_JOIN}
         join telegram_links l on l.wallet = t.creator
           or l.wallet in (select wallet from trades tr where tr.touch_market = m.touch_market)
        where m.settled and m.end_ts >= extract(epoch from l.linked_at)::bigint
          and m.end_ts >= extract(epoch from now())::bigint - $1
          and not exists (select 1 from alerts_sent a where a.key = 'settle:' || m.touch_market || ':' || l.wallet)`,
      [ALERT_WINDOW_SECS],
    )
  ).rows as unknown as (AlertRow & { touch_market: string; is_conviction: boolean; winning_side: number; sides: string | null })[];
}

/** Others' trades on a linked creator's thesis, since the creator linked. */
export async function tradeAlerts(db: Db) {
  return (
    await db.query(
      `select ${THESIS_COLS}, tr.signature, tr.ix_index, tr.side, tr.usdc_amount, tr.touch_market,
              (tr.touch_market = t.conviction_market) as is_conviction, tr.price_after_bps,
              l.chat_id, l.wallet, true as is_creator
         from trades tr
         join theses t on t.pda = tr.thesis
         ${THESIS_JOIN}
         join telegram_links l on l.wallet = t.creator
        where tr.via_thesis and not tr.is_creator and not tr.is_treasury and tr.wallet <> t.creator
          and tr.side in ('buy_yes', 'buy_no') and tr.ts >= extract(epoch from l.linked_at)::bigint
          and tr.ts >= extract(epoch from now())::bigint - $1
          and not exists (select 1 from alerts_sent a where a.key = 'trade:' || tr.signature || ':' || tr.ix_index || ':' || l.wallet)`,
      [ALERT_WINDOW_SECS],
    )
  ).rows as unknown as (AlertRow & { signature: string; ix_index: number; side: string; usdc_amount: string; touch_market: string; is_conviction: boolean; price_after_bps: number | null })[];
}
