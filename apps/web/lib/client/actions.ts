"use client";

import "./polyfills";
import { BN, Program, type Idl } from "@anchor-lang/core";
import {
  ComputeBudgetProgram, Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, VersionedTransaction,
  TransactionMessage, type TransactionInstruction,
} from "@solana/web3.js";
import {
  AccountLayout, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  decodePmMarket, PM_AMM_IDL, PM_AMM_PROGRAM_ID, PROTOCOL_DAO, THESIS_IDL, yesPriceBps, type ThesisIdl,
} from "@thesis/chain";
import { PRICE_ACCOUNT } from "./config";

const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
/** pm-AMM accrues before every swap: ~200k CU fresh, ~600k after time passes. */
const SWAP_CU = 1_000_000;

export type Side = "buy_yes" | "buy_no" | "sell_yes" | "sell_no";

export function programs(connection: Connection) {
  const thesis = new Program<ThesisIdl>(THESIS_IDL as ThesisIdl, { connection });
  const pm = new Program(PM_AMM_IDL as Idl, { connection });
  return { thesis, pm };
}

const seed = (s: string) => Buffer.from(s);
const pmPda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PM_AMM_PROGRAM_ID)[0];

export function pdas(programId: PublicKey) {
  const p = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  return {
    config: p([seed("config")]),
    authority: p([seed("authority")]),
    touch: (pmMarket: PublicKey) => p([seed("touch"), pmMarket.toBuffer()]),
    creatorStats: (creator: PublicKey) => p([seed("creator"), creator.toBuffer()]),
    thesis: (creator: PublicKey, id: BN) => p([seed("thesis"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)]),
  };
}

export function pmAccounts(pmMarket: PublicKey) {
  return {
    yesMint: pmPda([seed("yes_mint"), pmMarket.toBuffer()]),
    noMint: pmPda([seed("no_mint"), pmMarket.toBuffer()]),
    vault: pmPda([seed("vault"), pmMarket.toBuffer()]),
  };
}

const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);
const ensureAta = (payer: PublicKey, mint: PublicKey, owner: PublicKey) =>
  createAssociatedTokenAccountIdempotentInstruction(payer, ata(mint, owner), owner, mint);

// ------------------------------------------------------------------ trade

export interface TradeArgs {
  trader: PublicKey;
  usdcMint: PublicKey;
  thesis: PublicKey | null; // null = direct pm-AMM swap (protect-only markets)
  touchMarket: PublicKey;
  pmMarket: PublicKey;
  thesisCreator?: PublicKey;
  side: Side;
  amountIn: bigint;
  minOutput: bigint;
}

export async function tradeInstructions(connection: Connection, a: TradeArgs): Promise<TransactionInstruction[]> {
  const { thesis, pm } = programs(connection);
  const ids = pdas(thesis.programId);
  const { yesMint, noMint, vault } = pmAccounts(a.pmMarket);
  const treasury = ata(a.usdcMint, ids.authority);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_CU }),
    ensureAta(a.trader, a.usdcMint, a.trader),
    ensureAta(a.trader, yesMint, a.trader),
    ensureAta(a.trader, noMint, a.trader),
  ];
  const common = {
    usdcMint: a.usdcMint,
    yesMint,
    noMint,
    vault,
    daoUsdc: ata(a.usdcMint, PROTOCOL_DAO),
    tokenProgram: TOKEN_PROGRAM_ID,
  };
  if (a.thesis && a.thesisCreator) {
    const side = { buy_yes: { buyYes: {} }, buy_no: { buyNo: {} }, sell_yes: { sellYes: {} }, sell_no: { sellNo: {} } }[a.side];
    ixs.push(
      await thesis.methods
        .trade(side as never, new BN(a.amountIn.toString()), new BN(a.minOutput.toString()))
        .accountsPartial({
          trader: a.trader,
          config: ids.config,
          authority: ids.authority,
          treasury,
          thesis: a.thesis,
          creatorStats: ids.creatorStats(a.thesisCreator),
          touchMarket: a.touchMarket,
          pmMarket: a.pmMarket,
          traderUsdc: ata(a.usdcMint, a.trader),
          traderYes: ata(yesMint, a.trader),
          traderNo: ata(noMint, a.trader),
          pmAmmProgram: PM_AMM_PROGRAM_ID,
          ...common,
        })
        .instruction(),
    );
  } else {
    const dir = { buy_yes: { usdcToYes: {} }, buy_no: { usdcToNo: {} }, sell_yes: { yesToUsdc: {} }, sell_no: { noToUsdc: {} } }[a.side];
    ixs.push(
      await pm.methods
        .swap(dir, new BN(a.amountIn.toString()), new BN(a.minOutput.toString()))
        .accountsPartial({
          signer: a.trader,
          market: a.pmMarket,
          collateralMint: a.usdcMint,
          userCollateral: ata(a.usdcMint, a.trader),
          userYes: ata(yesMint, a.trader),
          userNo: ata(noMint, a.trader),
          creatorUsdc: treasury,
          ...common,
        })
        .instruction(),
    );
  }
  return ixs;
}

export interface Quote {
  /** Tokens received (buys) or USDC received (sells), micro-units. */
  output: bigint;
  /** YES price before and after, bps. */
  priceBefore: number | null;
  priceAfter: number | null;
  /** Average price paid per token for buys, bps of $1. */
  avgPriceBps: number | null;
  error?: string;
}

/**
 * Exact quote: simulates the real transaction and reads back the trader's
 * receiving token account and the pool. No pm-AMM math is re-implemented,
 * so the quote can't drift from what the program will do.
 */
export async function quoteTrade(connection: Connection, a: TradeArgs): Promise<Quote> {
  const ixs = await tradeInstructions(connection, { ...a, minOutput: 0n });
  const { yesMint, noMint } = pmAccounts(a.pmMarket);
  const receive =
    a.side === "buy_yes" ? ata(yesMint, a.trader) : a.side === "buy_no" ? ata(noMint, a.trader) : ata(a.usdcMint, a.trader);
  const msg = new TransactionMessage({
    payerKey: a.trader,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const [before, pmInfo] = await Promise.all([
    connection.getTokenAccountBalance(receive).then((b) => BigInt(b.value.amount)).catch(() => 0n),
    connection.getAccountInfo(a.pmMarket),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const priceBefore = pmInfo ? yesPriceBps(decodePmMarket(pmInfo.data), now) : null;
  const sim = await connection.simulateTransaction(new VersionedTransaction(msg), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: [receive.toBase58(), a.pmMarket.toBase58()] },
  });
  if (sim.value.err) {
    const line = (sim.value.logs ?? []).find((l) => l.includes("Error Message:"));
    return {
      output: 0n,
      priceBefore,
      priceAfter: null,
      avgPriceBps: null,
      error: line?.split("Error Message: ")[1] ?? (sim.value.logs?.some((l) => /insufficient/i.test(l)) ? "Not enough funds" : JSON.stringify(sim.value.err)),
    };
  }
  const [recv, pool] = sim.value.accounts ?? [];
  const after = recv ? AccountLayout.decode(Buffer.from(recv.data[0], "base64")).amount : 0n;
  const priceAfter = pool ? yesPriceBps(decodePmMarket(Buffer.from(pool.data[0], "base64")), now) : null;
  const output = after - before;
  const buying = a.side.startsWith("buy");
  return {
    output,
    priceBefore,
    priceAfter,
    avgPriceBps: buying && output > 0n ? Number((a.amountIn * 10_000n) / output) : null,
  };
}

// ------------------------------------------------------------------ create

export function randomMarketId(): BN {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return new BN(Buffer.from(b), "le");
}

export async function createMarketInstructions(
  connection: Connection,
  a: {
    creator: PublicKey;
    usdcMint: PublicKey;
    direction: "above" | "below";
    strike: bigint;
    endTs: number;
    seed: bigint;
    name: string;
    /** Seed from the treasury (admin or keeper only, within the sponsor budget). */
    sponsored?: boolean;
  },
): Promise<{ ixs: TransactionInstruction[]; touchMarket: PublicKey; pmMarket: PublicKey }> {
  const { thesis } = programs(connection);
  const ids = pdas(thesis.programId);
  const marketId = randomMarketId();
  const pmMarket = pmPda([seed("market"), marketId.toArrayLike(Buffer, "le", 8)]);
  const { yesMint, noMint, vault } = pmAccounts(pmMarket);
  const meta = (mint: PublicKey) => PublicKey.findProgramAddressSync([seed("metadata"), MPL.toBuffer(), mint.toBuffer()], MPL)[0];
  const touchMarket = ids.touch(pmMarket);
  const ix = await thesis.methods
    .createTouchMarket({
      marketId,
      direction: a.direction === "above" ? { above: {} } : { below: {} },
      strike: new BN(a.strike.toString()),
      endTs: new BN(a.endTs),
      seedAmount: new BN(a.seed.toString()),
      sponsored: !!a.sponsored,
      name: a.name.slice(0, 60),
    } as never)
    .accountsPartial({
      creator: a.creator,
      config: ids.config,
      authority: ids.authority,
      treasury: ata(a.usdcMint, ids.authority),
      creatorUsdc: a.sponsored ? null : ata(a.usdcMint, a.creator),
      usdcMint: a.usdcMint,
      priceUpdate: PRICE_ACCOUNT,
      pmMarket,
      yesMint,
      noMint,
      vault,
      yesMetadata: meta(yesMint),
      noMetadata: meta(noMint),
      // The seeder's LP position: the treasury authority when sponsored.
      lpPosition: pmPda([seed("lp"), pmMarket.toBuffer(), (a.sponsored ? ids.authority : a.creator).toBuffer()]),
      touchMarket,
      pmAmmProgram: PM_AMM_PROGRAM_ID,
      tokenMetadataProgram: MPL,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
  return { ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix], touchMarket, pmMarket };
}

export async function createThesisInstruction(
  connection: Connection,
  a: { creator: PublicKey; conviction: PublicKey; protection: PublicKey | null; textHash: Uint8Array },
): Promise<{ ix: TransactionInstruction; thesis: PublicKey }> {
  const { thesis } = programs(connection);
  const ids = pdas(thesis.programId);
  const stats = await thesis.account.creatorStats.fetchNullable(ids.creatorStats(a.creator));
  const id = stats ? new BN(stats.nextThesisId.toString()) : new BN(0);
  const pda = ids.thesis(a.creator, id);
  const ix = await thesis.methods
    .createThesis(Array.from(a.textHash))
    .accountsPartial({
      creator: a.creator,
      config: ids.config,
      creatorStats: ids.creatorStats(a.creator),
      thesis: pda,
      convictionMarket: a.conviction,
      protectionMarket: a.protection,
    })
    .instruction();
  return { ix, thesis: pda };
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// ------------------------------------------------------------------ claims

export async function claimWinningsInstructions(
  connection: Connection,
  a: { owner: PublicKey; usdcMint: PublicKey; pmMarket: PublicKey },
): Promise<TransactionInstruction[]> {
  const { pm } = programs(connection);
  const { yesMint, noMint, vault } = pmAccounts(a.pmMarket);
  return [
    ensureAta(a.owner, a.usdcMint, a.owner),
    await pm.methods
      .claimWinnings(new BN(0))
      .accountsPartial({
        signer: a.owner,
        market: a.pmMarket,
        collateralMint: a.usdcMint,
        yesMint,
        noMint,
        vault,
        userYes: ata(yesMint, a.owner),
        userNo: ata(noMint, a.owner),
        userCollateral: ata(a.usdcMint, a.owner),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  ];
}

export async function claimCreatorFeesInstructions(
  connection: Connection,
  a: { creator: PublicKey; usdcMint: PublicKey; thesis: PublicKey },
): Promise<TransactionInstruction[]> {
  const { thesis } = programs(connection);
  const ids = pdas(thesis.programId);
  return [
    ensureAta(a.creator, a.usdcMint, a.creator),
    await thesis.methods
      .claimCreatorFees()
      .accountsPartial({
        creator: a.creator,
        config: ids.config,
        authority: ids.authority,
        treasury: ata(a.usdcMint, ids.authority),
        thesis: a.thesis,
        creatorStats: ids.creatorStats(a.creator),
        creatorUsdc: ata(a.usdcMint, a.creator),
        usdcMint: a.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  ];
}

/** Token balances a wallet holds in one market (micro-units). */
export async function positions(connection: Connection, owner: PublicKey, pmMarket: PublicKey, usdcMint: PublicKey) {
  const { yesMint, noMint } = pmAccounts(pmMarket);
  const bal = (mint: PublicKey) =>
    connection.getTokenAccountBalance(ata(mint, owner)).then((b) => BigInt(b.value.amount)).catch(() => 0n);
  const [yes, no, usdc, sol] = await Promise.all([bal(yesMint), bal(noMint), bal(usdcMint), connection.getBalance(owner)]);
  return { yes, no, usdc, sol };
}

/** "Prove it": asks the API for an unsigned prove_touch transaction. */
export async function proveTransaction(market: PublicKey, prover: PublicKey): Promise<{ tx?: Transaction; reason?: string; price?: string; publishTime?: number }> {
  const r = await fetch(`/api/prove/${market.toBase58()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prover: prover.toBase58() }),
  });
  const body = await r.json();
  if (r.status === 409) return { reason: body.reason, price: body.price, publishTime: body.publishTime };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return { tx: Transaction.from(Buffer.from(body.transaction, "base64")), price: body.price, publishTime: body.publishTime };
}

export const toTx = (ixs: TransactionInstruction[]) => new Transaction().add(...ixs);
