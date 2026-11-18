import { fetchConfig } from "@/lib/chain";
import { bad, env, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/config — the public program settings the Create form needs. */
export async function GET() {
  const c = await fetchConfig();
  if (!c) return bad("program not initialised", 503);
  const n = (v: { toString(): string }) => Number(v.toString());
  return json(
    {
      cluster: env.cluster,
      usdcMint: c.usdc_mint.toBase58(),
      keeper: c.keeper.toBase58(),
      creatorShareBps: c.creator_share_bps,
      graceSecs: c.grace_secs,
      maxConfBps: c.max_conf_bps,
      minSeedUsdc: n(c.min_seed_per_market),
      maxSeedUsdc: n(c.max_seed_per_market),
      maxCoverUsdc: n(c.max_cover_per_wallet),
      solVolBps: c.sol_vol_bps,
      volUpdatedTs: n(c.vol_updated_ts),
      maxSpotAgeSecs: c.max_spot_age_secs,
      minStrikeDistanceBps: c.min_strike_distance_bps,
      maxStrikeDistanceBps: c.max_strike_distance_bps,
      minOpenBps: c.min_open_bps,
      maxOpenBps: c.max_open_bps,
      paused: c.paused,
    },
    200,
    30,
  );
}
