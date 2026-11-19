import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { decodePriceUpdateV2, provable } from "@thesis/chain";
import { daoUsdc, log, openMarkets, pmAccounts, toView, type Ctx, type TouchMarketAccount } from "./client";
import type { PriceSource } from "./sources";
import type { PriceTick } from "@thesis/chain";

export interface WatcherOptions {
  /** Operator alert hook (lost crossings). */
  alert?: (key: string, text: string) => void;
  /** USDC (6 dp) the treasury spends on YES right after proving a touch on a
   * treasury-seeded market. 0 disables the buy. */
  treasuryBuyMicroUsdc: number;
  refreshMs: number;
}

/**
 * Proves touches. On every price tick it checks each open market with the same
 * rules as `prove_touch` and, on a crossing, sends one transaction:
 * prove_touch (+ treasury_buy_yes for sponsored markets).
 */
export class Watcher {
  private markets = new Map<string, { key: PublicKey; account: TouchMarketAccount }>();
  private inflight = new Set<string>();
  /** Crossings whose transaction failed; retried on every refresh. */
  private pending = new Map<string, { tick: PriceTick; attempts: number }>();
  /** The latest tick, so markets found by `refresh` get checked at once. */
  private lastTick?: PriceTick;
  private graceSecs = 0;
  static readonly MAX_ATTEMPTS = 10;
  private maxConfBps = 50;
  private usdcMint?: PublicKey;
  private timer?: NodeJS.Timeout;
  readonly crossings: { market: string; price: bigint; publishTime: number; signature?: string; error?: string }[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly source: PriceSource,
    private readonly opts: WatcherOptions,
  ) {}

  async start(): Promise<void> {
    // The program may not be initialised yet: log and keep retrying.
    await this.refresh().catch((e) => log("watcher", `not ready yet: ${(e as Error).message.split("\n")[0]}`));
    this.timer = setInterval(() => this.refresh().catch((e) => log("watcher", `refresh failed: ${e}`)), this.opts.refreshMs);
    await this.source.start((t) => void this.onTick(t));
    log("watcher", `watching ${this.markets.size} open markets via ${this.source.name}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.source.stop();
  }

  async refresh(): Promise<void> {
    const config = await this.ctx.program.account.config.fetch(this.ctx.config);
    this.maxConfBps = config.maxConfBps;
    this.usdcMint = config.usdcMint;
    this.graceSecs = config.graceSecs;
    const open = await openMarkets(this.ctx);
    const before = new Set(this.markets.keys());
    this.markets = new Map(open.filter((m) => !m.account.touched).map((m) => [m.key.toBase58(), m]));
    // Markets created since the last refresh haven't seen the latest tick.
    if (this.lastTick) for (const id of this.markets.keys()) if (!before.has(id)) await this.onTick(this.lastTick, id);
    await this.retryPending();
  }

  /**
   * Retries failed proofs. The onchain source is a rolling account: once Pyth
   * writes a newer print, the crossing print is gone, so each retry re-reads
   * the account and proves from what is there now, if that still crosses.
   */
  private async retryPending(): Promise<void> {
    if (!this.pending.size) return;
    const now = Math.floor(Date.now() / 1000);
    const live = new Map<string, PriceTick | null>();
    for (const [id, p] of [...this.pending]) {
      const m = this.markets.get(id);
      if (!m) {
        this.pending.delete(id); // proven, touched or settled meanwhile
        continue;
      }
      const deadline = m.account.endTs.toNumber() + this.graceSecs;
      if (p.attempts >= Watcher.MAX_ATTEMPTS || now > deadline) {
        this.pending.delete(id);
        this.lost(id, p.tick, p.attempts >= Watcher.MAX_ATTEMPTS ? `${p.attempts} attempts failed` : "proof deadline passed");
        continue;
      }
      const account = p.tick.proofAccount!;
      const k = account.toBase58();
      if (!live.has(k)) {
        const info = await this.ctx.connection.getAccountInfo(account, "confirmed").catch(() => null);
        live.set(k, info ? { ...decodePriceUpdateV2(info.data), proofAccount: account } : null);
      }
      const tick = live.get(k);
      if (!tick) continue; // RPC hiccup: try again next refresh
      if (tick.publishTime !== p.tick.publishTime && !provable(toView(m.account), tick, this.maxConfBps).ok) {
        this.pending.delete(id);
        this.lost(id, p.tick, "the crossing print was overwritten before a proof landed");
        continue;
      }
      this.pending.set(id, { tick, attempts: p.attempts });
      await this.onTick(tick, id);
    }
  }

  private lost(id: string, tick: PriceTick, why: string): void {
    log("watcher", `LOST crossing on ${id} at price ${tick.price} (t=${tick.publishTime}): ${why}`);
    this.opts.alert?.(`lost:${id}`, `🚨 Lost touch proof on market <code>${id}</code> (price ${tick.price}, t=${tick.publishTime}): ${why}. Anyone can still prove from another print inside the window.`);
  }

  /** Checks every open market (or just `only`) against a tick. */
  async onTick(tick: PriceTick, only?: string): Promise<void> {
    if (!only && (!this.lastTick || tick.publishTime >= this.lastTick.publishTime)) this.lastTick = tick;
    for (const [id, m] of this.markets) {
      if (only && id !== only) continue;
      if (this.inflight.has(id)) continue;
      const v = provable(toView(m.account), tick, this.maxConfBps);
      if (!v.ok) continue;
      if (!tick.proofAccount) {
        log("watcher", `${id} crossed at ${tick.publishTime} but this source has no onchain proof account`);
        continue;
      }
      this.inflight.add(id);
      try {
        const sig = await this.prove(m.key, m.account, tick.proofAccount);
        this.crossings.push({ market: id, price: tick.price, publishTime: tick.publishTime, signature: sig });
        this.markets.delete(id);
        this.pending.delete(id);
        log("watcher", `proved ${id} at price ${tick.price} (t=${tick.publishTime}): ${sig}`);
      } catch (e) {
        const msg = (e as Error).message.split("\n")[0];
        this.crossings.push({ market: id, price: tick.price, publishTime: tick.publishTime, error: msg });
        const attempts = (this.pending.get(id)?.attempts ?? 0) + 1;
        this.pending.set(id, { tick, attempts });
        log("watcher", `prove ${id} failed (attempt ${attempts}, will retry): ${msg}`);
      } finally {
        this.inflight.delete(id);
      }
    }
  }

  /** Sends prove_touch (+ the treasury buy). Overridden in tests. */
  protected async prove(key: PublicKey, m: TouchMarketAccount, proof: PublicKey): Promise<string> {
    const { program, keeper, config, authority } = this.ctx;
    const prove = await program.methods
      .proveTouch()
      .accountsPartial({ prover: keeper.publicKey, config, touchMarket: key, priceUpdate: proof })
      .instruction();
    const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), prove];
    const sponsored = m.seededBy.equals(authority);
    if (sponsored && this.opts.treasuryBuyMicroUsdc > 0 && this.usdcMint) {
      ixs.push(...(await this.treasuryBuy(key, m, this.usdcMint)));
    }
    try {
      return await program.provider.sendAndConfirm!(new Transaction().add(...ixs));
    } catch (e) {
      if (ixs.length <= 2) throw e;
      // The proof matters more than the buy: retry it alone.
      const logs = (e as { logs?: string[]; transactionLogs?: string[] }).logs ?? (e as { transactionLogs?: string[] }).transactionLogs;
      log("watcher", `bundle failed (${(e as Error).message.split("\n")[0]}); proving without the treasury buy`);
      if (logs?.length) log("watcher", `bundle logs:\n  ${logs.filter((l) => /Error|failed|consumed|log:/.test(l)).join("\n  ")}`);
      return await program.provider.sendAndConfirm!(new Transaction().add(ixs[0], ixs[1]));
    }
  }

  private async treasuryBuy(key: PublicKey, m: TouchMarketAccount, usdcMint: PublicKey): Promise<TransactionInstruction[]> {
    const { program, keeper, config, authority } = this.ctx;
    const { yesMint, noMint, vault } = pmAccounts(m.pmMarket);
    const treasuryYes = getAssociatedTokenAddressSync(yesMint, authority, true);
    const treasuryNo = getAssociatedTokenAddressSync(noMint, authority, true);
    const buy = await program.methods
      // The program also enforces this floor: each YES must cost under $0.99.
      .treasuryBuyYes(new BN(this.opts.treasuryBuyMicroUsdc), new BN((BigInt(this.opts.treasuryBuyMicroUsdc) * 101n) / 100n))
      .accountsPartial({
        keeper: keeper.publicKey,
        config,
        authority,
        touchMarket: key,
        pmMarket: m.pmMarket,
        usdcMint,
        yesMint,
        noMint,
        vault,
        treasuryYes,
        treasuryNo,
        daoUsdc: daoUsdc(usdcMint),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    return [
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, treasuryYes, authority, yesMint),
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, treasuryNo, authority, noMint),
      buy,
    ];
  }
}
