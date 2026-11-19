import type { Db } from "./client";

/**
 * Skill score: hits beyond what the market expected. Each settled call scores
 * (1 if hit, else 0) − its opening probability, which the program computed
 * onchain when the call was posted. A 20% call that hits earns +0.80; a 90%
 * call that misses costs −0.90; posting fair-odds calls at random scores 0 on
 * average, so only real edge climbs the board.
 *
 * Calls posted when the latest Pyth print (as sampled by the indexer) was
 * already at or past the target are excluded: the program accepts a spot print
 * up to `max_spot_age_secs` old, so such a call could be opened knowing it had
 * already won. They still count in the raw hit/miss record.
 */
const CALLS = `
  with calls as (
    select t.pda, t.creator, t.end_ts, t.outcome, c.initial_price_bps, c.direction, c.strike,
           (select s.price from spot_samples s
             where s.feed_id = c.feed_id and s.expo = c.expo and s.publish_time <= c.start_ts
             order by s.publish_time desc limit 1) as latest_price
      from theses t join markets c on c.touch_market = t.conviction_market
     where t.outcome in (1, 2)
  ), scored as (
    select *, coalesce((direction = 'above' and latest_price >= strike) or (direction = 'below' and latest_price <= strike), false) as stale
      from calls
  )`;

export interface SkillRow {
  creator: string;
  display_name: string | null;
  x_handle: string | null;
  calls: number;
  hits: number;
  /** Sum of (hit − opening probability), in bps of one call (10000 = +1.00). */
  score_bps: number;
  avg_open_bps: number | null;
  excluded: number;
}

const toRow = (r: Record<string, unknown>): SkillRow => ({
  creator: String(r.creator),
  display_name: (r.display_name as string | null) ?? null,
  x_handle: (r.x_handle as string | null) ?? null,
  calls: Number(r.calls),
  hits: Number(r.hits),
  score_bps: Number(r.score_bps),
  avg_open_bps: r.avg_open_bps === null ? null : Math.round(Number(r.avg_open_bps)),
  excluded: Number(r.excluded),
});

const AGG = `
  count(*) filter (where not stale)::int as calls,
  count(*) filter (where not stale and outcome = 1)::int as hits,
  coalesce(sum(case when stale then 0 else (case when outcome = 1 then 10000 else 0 end) - initial_price_bps end), 0)::int as score_bps,
  avg(initial_price_bps) filter (where not stale) as avg_open_bps,
  count(*) filter (where stale)::int as excluded`;

/**
 * Creators ranked by skill score. `sinceTs` limits it to calls that ended
 * since then (a weekly board); team wallets are left out, as on /stats.
 */
export async function skillLeaderboard(db: Db, opts: { sinceTs?: number; teamWallets?: string[]; limit?: number } = {}): Promise<SkillRow[]> {
  const r = await db.query(
    `${CALLS}
     select s.creator, p.display_name, p.x_handle, ${AGG}
       from scored s left join profiles p on p.wallet = s.creator
      where s.end_ts >= $1 and not (s.creator = any($2))
      group by s.creator, p.display_name, p.x_handle
     having count(*) filter (where not stale) > 0
      order by score_bps desc, calls desc, s.creator
      limit $3`,
    [opts.sinceTs ?? 0, opts.teamWallets ?? [], Math.min(opts.limit ?? 50, 200)],
  );
  return r.rows.map(toRow);
}

/** One creator's skill (all time), plus their rank among non-team creators. */
export async function creatorSkill(db: Db, wallet: string, teamWallets: string[] = []): Promise<SkillRow & { rank: number | null }> {
  const r = (
    await db.query(
      `${CALLS}
       select $1::text as creator, null::text as display_name, null::text as x_handle, ${AGG}
         from scored where creator = $1`,
      [wallet],
    )
  ).rows[0];
  const row = toRow(r);
  let rank: number | null = null;
  if (row.calls > 0 && !teamWallets.includes(wallet)) {
    const board = await skillLeaderboard(db, { teamWallets, limit: 200 });
    const i = board.findIndex((b) => b.creator === wallet);
    rank = i >= 0 ? i + 1 : null;
  }
  return { ...row, rank };
}

/** Per-call skill for one creator's history (null while open). */
export async function callSkill(db: Db, wallet: string): Promise<Record<string, { skill_bps: number; excluded: boolean }>> {
  const r = await db.query<{ pda: string; outcome: number; initial_price_bps: number; stale: boolean }>(
    `${CALLS} select pda, outcome, initial_price_bps, stale from scored where creator = $1`,
    [wallet],
  );
  const out: Record<string, { skill_bps: number; excluded: boolean }> = {};
  for (const x of r.rows) {
    out[x.pda] = { skill_bps: x.stale ? 0 : (Number(x.outcome) === 1 ? 10_000 : 0) - Number(x.initial_price_bps), excluded: x.stale };
  }
  return out;
}
