import { PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { settleable } from "@thesis/chain";
import { creatorStatsPda, log, lpPositionPda, openMarkets, PM_AMM, pmAccounts, settledSponsoredMarkets, toView, type Ctx } from "./client";

/** pm-AMM NoResidualsToClaim (6011) or Thesis NothingToClaim. */
const NOTHING_PENDING = /NoResidualsToClaim|0x177b|NothingToClaim/;

/**
 * Settles every market whose `end_ts + grace` has passed, then brings the
 * treasury's money home from settled sponsored markets (`treasury_redeem`:
 * the seed's LP residuals plus any YES the treasury bought). Anyone may do
 * either; the keeper just makes sure someone does.
 */
export class Keeper {
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Markets with nothing left to redeem (rebuilt after a restart). */
  private readonly redeemed = new Set<string>();
  readonly settled: { market: string; signature?: string; error?: string }[] = [];
  readonly redemptions: { market: string; signature?: string; error?: string }[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly intervalMs: number,
    private readonly alert?: (key: string, text: string) => void,
  ) {}

  async start(): Promise<void> {
    await this.tick().catch((e) => log("keeper", `not ready yet: ${(e as Error).message.split("\n")[0]}`));
    this.timer = setInterval(() => this.tick().catch((e) => log("keeper", `tick failed: ${e}`)), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return; // a slow tick must not overlap the next one
    this.running = true;
    try {
      await this.settleDue();
      await this.redeemSettled();
    } finally {
      this.running = false;
    }
  }

  private async settleDue(): Promise<void> {
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
        this.alert?.(`settle:${id}`, `⚠️ Settle failed for <code>${id}</code>: ${msg}`);
      }
    }
  }

  private async redeemSettled(): Promise<void> {
    const { connection, authority } = this.ctx;
    for (const m of await settledSponsoredMarkets(this.ctx)) {
      const id = m.key.toBase58();
      if (this.redeemed.has(id)) continue;
      const { yesMint, noMint } = pmAccounts(m.account.pmMarket);
      const yes = getAssociatedTokenAddressSync(yesMint, authority, true);
      const no = getAssociatedTokenAddressSync(noMint, authority, true);
      const [lp, yesAcc, noAcc] = await connection.getMultipleAccountsInfo([lpPositionPda(m.account.pmMarket, authority), yes, no]);
      const hasLp = !!lp && lp.owner.equals(PM_AMM);
      const held = (a: typeof yesAcc) => (a && a.data.length >= 72 ? a.data.readBigUInt64LE(64) : 0n);
      const tokens = held(yesAcc) + held(noAcc);
      if (!hasLp && tokens === 0n) {
        this.redeemed.add(id);
        continue;
      }
      try {
        const sig = await this.redeem(m.key, m.account.pmMarket, hasLp).catch((e) => {
          // Residuals already claimed: redeem the held tokens alone.
          if (hasLp && NOTHING_PENDING.test(String((e as Error).message) + String((e as { logs?: string[] }).logs ?? ""))) {
            if (tokens === 0n) return null;
            return this.redeem(m.key, m.account.pmMarket, false);
          }
          throw e;
        });
        this.redeemed.add(id);
        if (sig) {
          this.redemptions.push({ market: id, signature: sig });
          log("keeper", `redeemed treasury position in ${id}: ${sig}`);
        }
      } catch (e) {
        const msg = (e as Error).message.split("\n")[0];
        if (NOTHING_PENDING.test(msg)) {
          this.redeemed.add(id);
          continue;
        }
        this.redemptions.push({ market: id, error: msg });
        log("keeper", `redeem ${id} failed: ${msg}`);
        this.alert?.(`redeem:${id}`, `⚠️ Treasury redeem failed for <code>${id}</code>: ${msg}`);
      }
    }
  }

  private async redeem(touchMarket: PublicKey, pmMarket: PublicKey, claimResiduals: boolean): Promise<string> {
    const { program, keeper, config, authority } = this.ctx;
    const { yesMint, noMint, vault } = pmAccounts(pmMarket);
    const treasuryYes = getAssociatedTokenAddressSync(yesMint, authority, true);
    const treasuryNo = getAssociatedTokenAddressSync(noMint, authority, true);
    const cfg = await program.account.config.fetch(config);
    const ix = await program.methods
      .treasuryRedeem(claimResiduals)
      .accountsPartial({
        cranker: keeper.publicKey,
        config,
        authority,
        touchMarket,
        pmMarket,
        usdcMint: cfg.usdcMint,
        yesMint,
        noMint,
        vault,
        treasuryYes,
        treasuryNo,
        lpPosition: lpPositionPda(pmMarket, authority),
        pmAmmProgram: PM_AMM,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, treasuryYes, authority, yesMint),
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, treasuryNo, authority, noMint),
      ix,
    );
    return program.provider.sendAndConfirm!(tx);
  }
}
