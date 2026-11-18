import type { Db } from "@thesis/db";
import { log, type Ctx } from "./client";
import { realizedVolBps, shouldPost } from "./volatility";

const MIN_VOL_BPS = 500;
const MAX_VOL_BPS = 50_000;
const WEEK = 7 * 86_400;

/**
 * Keeps `Config.sol_vol_bps` current from the spot samples the indexer stores
 * (7-day realised volatility). If there is not enough data yet it re-posts the
 * current value once a day, so market creation does not stall on staleness,
 * and says so in the log.
 */
export class VolatilityKeeper {
  private timer?: NodeJS.Timeout;
  readonly posts: { volBps: number; source: "realised" | "refresh"; signature: string }[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly db: Db,
    private readonly intervalMs = 15 * 60_000,
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => this.tick().catch((e) => log("vol", `tick failed: ${e}`)), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = Math.floor(Date.now() / 1000)): Promise<void> {
    const { program, config } = this.ctx;
    const cfg = await program.account.config.fetch(config);
    const feed = Buffer.from(cfg.solUsdFeedId).toString("hex");
    const rows = (
      await this.db.query<{ publish_time: string; price: string }>(
        "select publish_time, price from spot_samples where feed_id = $1 and publish_time >= $2 order by publish_time",
        [feed, now - WEEK],
      )
    ).rows;
    const measured = realizedVolBps(rows.map((r) => ({ publishTime: Number(r.publish_time), price: Number(r.price) })));
    const current = cfg.solVolBps;
    const age = now - cfg.volUpdatedTs.toNumber();
    let next: number;
    let source: "realised" | "refresh";
    if (measured === null) {
      if (age <= 86_400) return;
      next = current;
      source = "refresh";
      log("vol", `only ${rows.length} samples in 7 days; re-posting ${current} bps to keep it fresh`);
    } else {
      next = Math.min(MAX_VOL_BPS, Math.max(MIN_VOL_BPS, measured));
      if (!shouldPost(current, next, age)) return;
      source = "realised";
    }
    const signature = await program.methods
      .setVolatility(next)
      .accountsPartial({ signer: this.ctx.keeper.publicKey, config })
      .rpc();
    this.posts.push({ volBps: next, source, signature });
    log("vol", `posted ${next} bps (${source}, was ${current}): ${signature}`);
  }
}
