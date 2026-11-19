import type { Db } from "./client";

export type FeedSort = "hot" | "new" | "ending";

/** Feed cards: one per thesis, with its conviction market's live state. */
export async function feed(db: Db, opts: { sort: FeedSort; limit?: number; now?: number }) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const order = {
    hot: "volume_24h desc, t.created_ts desc",
    new: "t.created_ts desc",
    ending: "t.end_ts asc",
  }[opts.sort];
  const r = await db.query(
    `with vol as (
       select touch_market, sum(usdc_amount) as v from trades
        where ts >= $1 - 86400 and not is_treasury group by touch_market
     )
     select t.pda, t.creator, p.display_name, p.x_handle, t.text, t.created_ts, t.end_ts, t.outcome,
            t.volume_usdc, (t.protection_market is not null) as has_protection,
            c.touch_market as conviction_market, c.pm_market, c.direction, c.strike, c.expo,
            c.initial_price_bps, coalesce(c.yes_price_bps, c.initial_price_bps) as yes_price_bps,
            c.touched, c.settled, c.spot_at_open,
            pr.strike as liq_strike, coalesce(pr.yes_price_bps, pr.initial_price_bps) as liq_yes_bps,
            (coalesce(vc.v, 0) + coalesce(vp.v, 0))::bigint as volume_24h,
            (select coalesce(array_agg(s.yes_price_bps order by s.ts), '{}') from (
               select yes_price_bps, ts from price_points pp
                where pp.touch_market = c.touch_market order by ts desc limit 40) s) as spark
       from theses t
       join markets c on c.touch_market = t.conviction_market
       left join markets pr on pr.touch_market = t.protection_market
       left join profiles p on p.wallet = t.creator
       left join vol vc on vc.touch_market = t.conviction_market
       left join vol vp on vp.touch_market = t.protection_market
      where ($2 <> 'ending' or (t.outcome = 0 and t.end_ts > $1))
      order by ${order}
      limit $3`,
    [now, opts.sort, Math.min(opts.limit ?? 50, 200)],
  );
  return r.rows;
}

/** Everything the thesis page needs. */
export async function thesisDetail(db: Db, pda: string) {
  const t = (await db.query("select * from theses where pda = $1", [pda])).rows[0] as Record<string, unknown> | undefined;
  if (!t) return null;
  const markets = (
    await db.query("select * from markets where touch_market = any($1)", [
      [t.conviction_market, t.protection_market].filter(Boolean),
    ])
  ).rows as Record<string, unknown>[];
  const byKey = new Map(markets.map((m) => [m.touch_market, m]));
  const trades = (
    await db.query(
      `select signature, touch_market, wallet, side, usdc_amount, token_amount, price_after_bps, ts, via_thesis, is_creator
         from trades where touch_market = any($1) order by ts desc, signature limit 50`,
      [markets.map((m) => m.touch_market)],
    )
  ).rows;
  const prices = (
    // The latest 500 points per market (one per 30 s is ~4 h at full rate).
    await db.query(
      `select touch_market, ts, yes_price_bps from (
         select touch_market, ts, yes_price_bps, row_number() over (partition by touch_market order by ts desc) as n
           from price_points where touch_market = any($1)) p
        where n <= 500 order by ts`,
      [markets.map((m) => m.touch_market)],
    )
  ).rows;
  const creator = await creatorSummary(db, t.creator as string);
  const conv = byKey.get(t.conviction_market);
  const spot = conv
    ? (
        await db.query(
          `select publish_time, price, expo from spot_samples
            where feed_id = $1 and publish_time between $2 and $3 order by publish_time`,
          [conv.feed_id, Number(t.created_ts) - 3600, Number(t.end_ts) + 3600],
        )
      ).rows
    : [];
  return {
    spot,
    thesis: t,
    conviction: byKey.get(t.conviction_market) ?? null,
    protection: t.protection_market ? byKey.get(t.protection_market) ?? null : null,
    trades,
    prices,
    creator,
  };
}

async function creatorSummary(db: Db, wallet: string) {
  const stats = (await db.query("select * from creator_stats where creator = $1", [wallet])).rows[0] ?? null;
  const profile = (await db.query("select display_name, x_handle from profiles where wallet = $1", [wallet])).rows[0] ?? null;
  return { wallet, profile, stats };
}

/** Profile page: raw numbers and thesis history (spec: no accuracy score in v1). */
export async function profile(db: Db, wallet: string, creatorShareBps = 5000) {
  const summary = await creatorSummary(db, wallet);
  const cover = (
    await db.query<{ cover_cost: string; cover_paid: string }>(
      `select coalesce(sum(case when tr.side = 'buy_yes' then tr.usdc_amount else 0 end), 0)::bigint as cover_cost,
              coalesce(sum(case when m.winning_side = 1 then
                (case tr.side when 'buy_yes' then tr.token_amount when 'sell_yes' then -tr.token_amount else 0 end)
              else 0 end), 0)::bigint as cover_paid
         from trades tr
         join markets m on m.touch_market = tr.touch_market
        where tr.wallet = $1
          -- Cover: any market that isn't a call's take profit (thesis protection or standalone Protect).
          and not exists (select 1 from theses t where t.conviction_market = tr.touch_market)`,
      [wallet],
    )
  ).rows[0];
  const history = (
    await db.query(
      `select t.pda, t.text, t.created_ts, t.end_ts, t.outcome, t.volume_usdc, t.self_volume_usdc,
              c.direction, c.strike, c.expo, c.initial_price_bps,
              (t.fees_attributed * $2 / 10000)::bigint as fees_earned
         from theses t join markets c on c.touch_market = t.conviction_market
        where t.creator = $1 order by t.created_ts desc`,
      [wallet, creatorShareBps],
    )
  ).rows;
  const s = summary.stats as Record<string, string> | null;
  return {
    ...summary,
    fees_earned: s ? ((BigInt(s.fees_attributed) * BigInt(creatorShareBps)) / 10_000n).toString() : "0",
    protection_bought_usdc: cover.cover_cost,
    protection_paid_out_usdc: cover.cover_paid,
    history,
    markets: await walletMarkets(db, wallet),
  };
}

/** Public traction numbers (spec section 11): team wallets excluded. */
type Row = Record<string, string>;

export interface TractionStats {
  wallets: string;
  trades: string;
  volume_usdc: string;
  volume_via_thesis_usdc: string;
  fees_to_treasury_usdc: string;
  theses: string;
  creators: string;
  cover_bought_usdc: string;
  payouts_usdc: string;
  touches_proven: number;
  touches: Record<string, unknown>[];
}

export async function stats(db: Db, teamWallets: string[] = []): Promise<TractionStats> {
  const team = teamWallets;
  const totals = (
    await db.query<Row>(
      `select count(distinct wallet) as wallets,
              count(*) as trades,
              coalesce(sum(usdc_amount), 0)::bigint as volume_usdc,
              coalesce(sum(usdc_amount) filter (where via_thesis), 0)::bigint as volume_via_thesis_usdc,
              coalesce(sum(fee_to_treasury), 0)::bigint as fees_to_treasury_usdc
         from trades where not is_treasury and not is_creator and not (wallet = any($1))`,
      [team],
    )
  ).rows[0];
  const theses = (
    await db.query<Row>(
      "select count(*) as theses, count(distinct creator) as creators from theses where not (creator = any($1))",
      [team],
    )
  ).rows[0];
  const cover = (
    await db.query<Row>(
      `select coalesce(sum(tr.usdc_amount) filter (where tr.side = 'buy_yes'), 0)::bigint as cover_bought_usdc,
              coalesce(sum(case when m.winning_side = 1 then
                (case tr.side when 'buy_yes' then tr.token_amount when 'sell_yes' then -tr.token_amount else 0 end)
              else 0 end), 0)::bigint as payouts_usdc
         from trades tr
         join markets m on m.touch_market = tr.touch_market
        where not tr.is_treasury and not (tr.wallet = any($1))
          and not exists (select 1 from theses t where t.conviction_market = tr.touch_market)`,
      [team],
    )
  ).rows[0];
  const touches = (
    await db.query(
      `select m.touch_market, m.direction, m.strike, m.expo, m.touch_price, m.touch_publish_time, m.proof_tx
         from markets m where m.touched order by m.touch_publish_time desc limit 100`,
    )
  ).rows;
  // The list is capped at 100; the count is not.
  const proven = (await db.query<Row>("select count(*)::int as n from markets where touched")).rows[0];
  return { ...totals, ...theses, ...cover, touches_proven: Number(proven.n), touches } as TractionStats;
}

// ------------------------------------------------------------------ markets

const MARKET_COLS = `m.touch_market, m.pm_market, m.direction, m.strike, m.expo, m.spot_at_open, m.start_ts, m.end_ts,
  m.initial_price_bps, m.yes_price_bps, m.touched, m.touch_price, m.touch_publish_time, m.proof_tx, m.settled,
  m.winning_side, m.creator, m.sponsored, m.seed_usdc,
  coalesce(m.origin_thesis, (select t.pda from theses t where m.touch_market in (t.conviction_market, t.protection_market) limit 1)) as thesis,
  (select t.creator from theses t where m.touch_market in (t.conviction_market, t.protection_market) limit 1) as thesis_creator,
  exists (select 1 from theses t where t.conviction_market = m.touch_market) as is_conviction`;

/** One market on its own (standalone Protect markets have no thesis page). */
export async function marketDetail(db: Db, touchMarket: string) {
  const m = (await db.query(`select ${MARKET_COLS} from markets m where m.touch_market = $1`, [touchMarket])).rows[0] as
    | Record<string, unknown>
    | undefined;
  if (!m) return null;
  const prices = (
    await db.query(
      `select ts, yes_price_bps from (select ts, yes_price_bps from price_points where touch_market = $1 order by ts desc limit 500) p order by ts`,
      [touchMarket],
    )
  ).rows;
  const trades = (
    await db.query(
      `select signature, wallet, side, usdc_amount, token_amount, price_after_bps, ts, via_thesis
         from trades where touch_market = $1 order by ts desc, signature limit 50`,
      [touchMarket],
    )
  ).rows;
  return { market: m, prices, trades };
}

/**
 * Open cover markets near a level: same direction, strike within `bps` of
 * `strike`, ending no earlier than `minEndTs`. Lets Protect buy into an
 * existing pool instead of paying rent for a new one.
 */
export async function nearbyCoverMarkets(
  db: Db,
  q: { direction: "above" | "below"; strike: bigint; bps: number; minEndTs: number; now: number; limit?: number },
) {
  return (
    await db.query(
      `select ${MARKET_COLS} from markets m
        where m.direction = $1 and not m.touched and not m.settled and m.end_ts > $5 and m.end_ts >= $4
          and abs(m.strike - $2::bigint) * 10000 <= $2::bigint * $3
          and not exists (select 1 from theses t where t.conviction_market = m.touch_market)
        order by abs(m.strike - $2::bigint), m.end_ts limit $6`,
      [q.direction, q.strike.toString(), q.bps, q.minEndTs, q.now, Math.min(q.limit ?? 5, 20)],
    )
  ).rows;
}

/** Markets a wallet has traded, newest activity first (balances are read onchain). */
export async function walletMarkets(db: Db, wallet: string, limit = 100) {
  return (
    await db.query(
      `select ${MARKET_COLS}, x.last_ts from markets m
         join (select touch_market, max(ts) as last_ts from trades where wallet = $1 group by touch_market) x
           on x.touch_market = m.touch_market
        order by x.last_ts desc limit $2`,
      [wallet, limit],
    )
  ).rows;
}
