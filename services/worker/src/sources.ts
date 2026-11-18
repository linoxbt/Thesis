import { Connection, PublicKey } from "@solana/web3.js";
import { decodePriceUpdateV2, type PriceTick } from "@thesis/chain";

/** Where the watcher gets prices from. */
export interface PriceSource {
  readonly name: string;
  start(onTick: (tick: PriceTick) => void): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Reads a Pyth price feed account on Solana (e.g. the sponsored SOL/USD feed
 * 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE). Every tick it emits is a
 * fully verified PriceUpdateV2 already onchain, so the same account is the
 * proof: no Hermes call and no posting transaction.
 *
 * Trade-off: only prints that land in this account can prove a touch. On
 * devnet it updates about every 30 minutes; on mainnet it updates on Pyth's
 * sponsored schedule. A wick between prints can't be proven from here.
 */
export class OnchainFeedSource implements PriceSource {
  readonly name = "onchain";
  private subscription?: number;
  private timer?: NodeJS.Timeout;
  private lastPublish = 0;

  constructor(
    private readonly connection: Connection,
    private readonly account: PublicKey,
    private readonly pollMs = 5_000,
  ) {}

  async start(onTick: (tick: PriceTick) => void): Promise<void> {
    const emit = (data: Buffer) => {
      try {
        const t = decodePriceUpdateV2(data);
        if (t.publishTime === this.lastPublish) return;
        this.lastPublish = t.publishTime;
        onTick({ ...t, proofAccount: this.account });
      } catch (e) {
        console.error(`[onchain] decode failed: ${(e as Error).message}`);
      }
    };
    // Push via websocket, plus a slow poll in case the socket drops.
    this.subscription = this.connection.onAccountChange(this.account, (info) => emit(info.data), "confirmed");
    const poll = async () => {
      const info = await this.connection.getAccountInfo(this.account, "confirmed").catch(() => null);
      if (info) emit(info.data);
    };
    await poll();
    this.timer = setInterval(poll, this.pollMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.subscription !== undefined) await this.connection.removeAccountChangeListener(this.subscription);
  }
}
