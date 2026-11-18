import { BorshCoder, EventParser, utils } from "@anchor-lang/core";
import { PublicKey, type ConfirmedSignatureInfo, type VersionedTransactionResponse } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  getCursor, insertCrossing, insertFeeClaim, insertSpotSample, insertTrade, setCursor, setMarketPrice, setMarketTx,
  setThesisCreatedTx, upsertMarket, upsertThesis, type Db, type TradeSide,
} from "@thesis/db";
import { log, PM_AMM, type Ctx } from "./client";
import { decodePmMarket, decodeSwapData, yesPriceBps } from "@thesis/chain";
import { decodePriceUpdateV2 } from "@thesis/chain";

export interface IndexerOptions {
  intervalMs: number;
  /** Minimum gap between two price points of one market. */
  priceSampleSecs: number;
  /** Pyth price account to sample for volatility (optional). */
  spotAccount?: PublicKey;
}

const hex = (b: number[] | Uint8Array) => Buffer.from(b).toString("hex");
const str = (v: { toString(): string }) => v.toString();
/** Anchor TS may hand back snake_case or camelCase field names. */
function field<T>(o: Record<string, unknown>, snake: string): T {
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return (o[snake] ?? o[camel]) as T;
}

/**
 * Keeps Postgres in step with the chain. Every write is idempotent, so the
 * whole database can be rebuilt by clearing the cursors and running again.
 */
export class Indexer {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPricePoint = new Map<string, number>();
  private parser: EventParser;
  private treasury?: PublicKey;
  private usdcMint?: PublicKey;

  constructor(
    private readonly ctx: Ctx,
    private readonly db: Db,
    private readonly opts: IndexerOptions,
  ) {
    this.parser = new EventParser(ctx.program.programId, new BorshCoder(ctx.program.idl));
  }

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  /** One full pass. Safe to call directly (tests, backfills). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncAccounts();
      await this.syncProgramTransactions();
      await this.syncDirectSwaps();
      if (this.opts.spotAccount) await this.sampleSpot(this.opts.spotAccount);
    } catch (e) {
      log("indexer", `pass failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ------------------------------------------------------------ accounts

  async syncAccounts(): Promise<void> {
    const { program, connection, authority } = this.ctx;
    const config = await program.account.config.fetch(this.ctx.config);
    this.usdcMint = config.usdcMint;
    this.treasury = getAssociatedTokenAddressSync(config.usdcMint, authority, true);

    const markets = await program.account.touchMarket.all();
    for (const { publicKey, account: m } of markets) {
      await upsertMarket(this.db, {
        touch_market: publicKey.toBase58(),
        pm_market: m.pmMarket.toBase58(),
        market_id: str(m.marketId),
        feed_id: hex(m.feedId),
        direction: "below" in (m.direction as object) ? "below" : "above",
        strike: BigInt(str(m.strike)),
        expo: m.expo,
        spot_at_open: BigInt(str(m.spotAtOpen)),
        start_ts: m.startTs.toNumber(),
        end_ts: m.endTs.toNumber(),
        initial_price_bps: m.initialPriceBps,
        seed_usdc: BigInt(str(m.seedAmount)),
        seeded_by: m.seededBy.toBase58(),
        sponsored: m.seededBy.equals(authority),
        creator: m.creator.toBase58(),
        origin_thesis: m.originThesis.equals(PublicKey.default) ? null : m.originThesis.toBase58(),
        touched: m.touched,
        touch_price: m.touched ? BigInt(str(m.touchPrice)) : null,
        touch_publish_time: m.touched ? m.touchPublishTime.toNumber() : null,
        prover: m.touched ? m.prover.toBase58() : null,
        settled: m.settled,
        winning_side: m.winningSide,
      });
    }

    for (const { publicKey, account: t } of await program.account.thesis.all()) {
      await upsertThesis(this.db, {
        pda: publicKey.toBase58(),
        creator: t.creator.toBase58(),
        thesis_id: t.id.toNumber(),
        text_hash: hex(t.textHash),
        conviction_market: t.convictionMarket.toBase58(),
        protection_market: t.protectionMarket.equals(PublicKey.default) ? null : t.protectionMarket.toBase58(),
        created_ts: t.createdTs.toNumber(),
        end_ts: t.endTs.toNumber(),
        volume_usdc: BigInt(str(t.volumeUsdc)),
        self_volume_usdc: BigInt(str(t.selfVolumeUsdc)),
        fees_attributed: BigInt(str(t.feesAttributed)),
        fees_claimed: BigInt(str(t.feesClaimed)),
        outcome: t.outcome,
      });
    }

    // Pool prices for open markets, at most one point per `priceSampleSecs`.
    const now = Math.floor(Date.now() / 1000);
    const open = markets.filter((m) => !m.account.settled && m.account.endTs.toNumber() > now);
    for (let i = 0; i < open.length; i += 100) {
      const chunk = open.slice(i, i + 100);
      const infos = await connection.getMultipleAccountsInfo(chunk.map((m) => m.account.pmMarket));
      for (let j = 0; j < chunk.length; j++) {
        const info = infos[j];
        const key = chunk[j].publicKey.toBase58();
        if (!info || now - (this.lastPricePoint.get(key) ?? 0) < this.opts.priceSampleSecs) continue;
        const bps = yesPriceBps(decodePmMarket(info.data), now);
        if (bps === null) continue;
        await setMarketPrice(this.db, key, now, bps);
        this.lastPricePoint.set(key, now);
      }
    }
  }

  // ------------------------------------------------------------ transactions

  /** New signatures for `address` since the stored cursor, oldest first. */
  private async newSignatures(address: PublicKey, cursorKey: string): Promise<ConfirmedSignatureInfo[]> {
    const until = (await getCursor(this.db, cursorKey)) ?? undefined;
    const out: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.ctx.connection.getSignaturesForAddress(address, { until, before, limit: 1000 }, "confirmed");
      out.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    return out.reverse();
  }

  private async fetchTx(sig: string): Promise<VersionedTransactionResponse | null> {
    return this.ctx.connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  }

  async syncProgramTransactions(): Promise<void> {
    const sigs = await this.newSignatures(this.ctx.program.programId, "program");
    for (const s of sigs) {
      if (!s.err) {
        const tx = await this.fetchTx(s.signature);
        if (tx) await this.indexProgramTx(s.signature, tx);
      }
      await setCursor(this.db, "program", s.signature);
    }
  }

  async indexProgramTx(sig: string, tx: VersionedTransactionResponse): Promise<void> {
    const ts = tx.blockTime ?? Math.floor(Date.now() / 1000);
    const logs = tx.meta?.logMessages ?? [];
    let n = 0;
    for (const ev of this.parser.parseLogs(logs)) {
      const d = ev.data as Record<string, unknown>;
      const pk = (k: string) => (field<PublicKey>(d, k)).toBase58();
      const big = (k: string) => BigInt(str(field<{ toString(): string }>(d, k)));
      const name = ev.name.toLowerCase();
      const ix = n++;
      if (name === "touchmarketcreated") {
        await setMarketTx(this.db, pk("touch_market"), "created_tx", sig);
      } else if (name === "thesiscreated") {
        await setThesisCreatedTx(this.db, pk("thesis"), sig);
      } else if (name === "traded") {
        const side = Object.keys(field<object>(d, "side"))[0];
        await insertTrade(this.db, {
          signature: sig,
          ix_index: ix,
          touch_market: pk("touch_market"),
          thesis: pk("thesis"),
          wallet: pk("trader"),
          side: ({ buyYes: "buy_yes", buyNo: "buy_no", sellYes: "sell_yes", sellNo: "sell_no" } as Record<string, TradeSide>)[side] ?? "other",
          usdc_amount: big("usdc_amount"),
          token_amount: big("token_amount"),
          fee_to_treasury: big("fee_to_treasury"),
          price_after_bps: null,
          ts,
          via_thesis: true,
          is_creator: field<boolean>(d, "is_creator"),
          is_treasury: false,
        });
      } else if (name === "treasurybought") {
        await insertTrade(this.db, {
          signature: sig,
          ix_index: ix,
          touch_market: pk("touch_market"),
          thesis: null,
          wallet: this.ctx.authority.toBase58(),
          side: "buy_yes",
          usdc_amount: big("usdc_in"),
          token_amount: big("yes_out"),
          fee_to_treasury: 0n,
          price_after_bps: null,
          ts,
          via_thesis: true,
          is_creator: false,
          is_treasury: true,
        });
      } else if (name === "touched") {
        const market = pk("touch_market");
        await setMarketTx(this.db, market, "proof_tx", sig);
        const row = (await this.db.query<{ feed_id: string }>("select feed_id from markets where touch_market = $1", [market])).rows[0];
        await insertCrossing(this.db, {
          touch_market: market,
          feed_id: row?.feed_id ?? "",
          publish_time: Number(big("publish_time")),
          price: big("price"),
          proof_tx: sig,
          prover: pk("prover"),
        });
      } else if (name === "settled") {
        await setMarketTx(this.db, pk("touch_market"), "settle_tx", sig);
      } else if (name === "creatorfeesclaimed") {
        await insertFeeClaim(this.db, { signature: sig, thesis: pk("thesis"), creator: pk("creator"), amount: big("amount"), ts });
      }
    }
  }

  /**
   * Swaps that went straight to pm-AMM on our markets (not through `trade`).
   * Thesis-routed swaps are skipped here: their `Traded` event is exact.
   */
  async syncDirectSwaps(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const markets = (
      await this.db.query<{ touch_market: string; pm_market: string; creator: string }>(
        "select touch_market, pm_market, creator from markets where not settled or end_ts > $1",
        [now - 2 * 86_400],
      )
    ).rows;
    for (const m of markets) {
      const key = `pm:${m.pm_market}`;
      for (const s of await this.newSignatures(new PublicKey(m.pm_market), key)) {
        if (!s.err) {
          const tx = await this.fetchTx(s.signature);
          if (tx) await this.indexDirectSwapTx(s.signature, tx, m.touch_market, m.pm_market);
        }
        await setCursor(this.db, key, s.signature);
      }
    }
  }

  async indexDirectSwapTx(sig: string, tx: VersionedTransactionResponse, touchMarket: string, pmMarket: string): Promise<void> {
    const thesisId = this.ctx.program.programId.toBase58();
    if ((tx.meta?.logMessages ?? []).some((l) => l.startsWith(`Program ${thesisId} invoke`))) return;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined });
    const at = (i: number) => keys.get(i)?.toBase58() ?? "";
    // Top-level and inner pm-AMM instructions, with their account lists.
    const ixs: { program: string; accounts: number[]; data: Buffer; index: number }[] = [];
    tx.transaction.message.compiledInstructions.forEach((ix, i) =>
      ixs.push({ program: at(ix.programIdIndex), accounts: ix.accountKeyIndexes, data: Buffer.from(ix.data), index: i * 100 }),
    );
    for (const inner of tx.meta?.innerInstructions ?? []) {
      inner.instructions.forEach((ix, j) => {
        const data = Buffer.from(utils.bytes.bs58.decode(ix.data));
        ixs.push({ program: at(ix.programIdIndex), accounts: ix.accounts, data, index: inner.index * 100 + j + 1 });
      });
    }
    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];
    const delta = (owner: string, mint: string) => {
      const sum = (bs: typeof pre) =>
        bs.filter((b) => b.owner === owner && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
      return sum(post) - sum(pre);
    };
    const treasuryDelta = () => {
      if (!this.treasury) return 0n;
      const idx = keys.staticAccountKeys.findIndex((k) => k.equals(this.treasury!));
      if (idx < 0) return 0n;
      const amt = (bs: typeof pre) => BigInt(bs.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? "0");
      return amt(post) - amt(pre);
    };
    for (const ix of ixs) {
      if (ix.program !== PM_AMM.toBase58()) continue;
      const swap = decodeSwapData(ix.data);
      if (!swap || at(ix.accounts[1]) !== pmMarket) continue;
      const wallet = at(ix.accounts[0]);
      const yesMint = at(ix.accounts[3]);
      const noMint = at(ix.accounts[4]);
      const usdc = this.usdcMint?.toBase58() ?? at(ix.accounts[2]);
      const side: TradeSide =
        ({ usdcToYes: "buy_yes", usdcToNo: "buy_no", yesToUsdc: "sell_yes", noToUsdc: "sell_no" } as Record<string, TradeSide>)[
          swap.direction
        ] ?? "other";
      const tokenMint = side.endsWith("yes") ? yesMint : noMint;
      const tokenDelta = delta(wallet, tokenMint);
      await insertTrade(this.db, {
        signature: sig,
        ix_index: ix.index,
        touch_market: touchMarket,
        thesis: null,
        wallet,
        side,
        usdc_amount: (() => {
          const d = delta(wallet, usdc);
          return d < 0n ? -d : d;
        })(),
        token_amount: tokenDelta < 0n ? -tokenDelta : tokenDelta,
        fee_to_treasury: treasuryDelta(),
        price_after_bps: null,
        ts: tx.blockTime ?? Math.floor(Date.now() / 1000),
        via_thesis: false,
        is_creator: false,
        is_treasury: wallet === this.ctx.authority.toBase58(),
      });
    }
  }

  // ------------------------------------------------------------ spot

  async sampleSpot(account: PublicKey): Promise<void> {
    const info = await this.ctx.connection.getAccountInfo(account, "confirmed");
    if (!info) return;
    const p = decodePriceUpdateV2(info.data);
    if (!p.fullyVerified) return;
    await insertSpotSample(this.db, { feed_id: p.feedId.toString("hex"), publish_time: p.publishTime, price: p.price, expo: p.expo });
  }
}
