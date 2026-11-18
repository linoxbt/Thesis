import { PublicKey } from "@solana/web3.js";
import { settleable } from "@thesis/chain";
import { creatorStatsPda, log, openMarkets, PM_AMM, toView, type Ctx } from "./client";

/**
 * Settles every market whose `end_ts + grace` has passed. Anyone may settle;
 * the keeper just makes sure someone does.
 */
export class Keeper {
  private timer?: NodeJS.Timeout;
  readonly settled: { market: string; signature?: string; error?: string }[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly intervalMs: number,
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => this.tick().catch((e) => log("keeper", `tick failed: ${e}`)), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const { program, config, authority } = this.ctx;
    const cfg = await program.account.config.fetch(config);
    const now = Math.floor(Date.now() / 1000);
    for (const m of await openMarkets(this.ctx)) {
      if (!settleable(toView(m.account), cfg.graceSecs, now)) continue;
      const id = m.key.toBase58();
      try {
        let thesis: PublicKey | null = null;
        let creatorStats: PublicKey | null = null;
        if (!m.account.originThesis.equals(PublicKey.default)) {
          thesis = m.account.originThesis;
          const t = await program.account.thesis.fetch(thesis);
          creatorStats = creatorStatsPda(this.ctx, t.creator);
        }
        const sig = await program.methods
          .settle()
          .accountsPartial({
            cranker: this.ctx.keeper.publicKey,
            config,
            authority,
            touchMarket: m.key,
            pmMarket: m.account.pmMarket,
            pmAmmProgram: PM_AMM,
            thesis,
            creatorStats,
          })
          .rpc();
        this.settled.push({ market: id, signature: sig });
        log("keeper", `settled ${id} (${m.account.touched ? "YES" : "NO"}): ${sig}`);
      } catch (e) {
        const msg = (e as Error).message.split("\n")[0];
        this.settled.push({ market: id, error: msg });
        log("keeper", `settle ${id} failed: ${msg}`);
      }
    }
  }
}
