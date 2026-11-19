import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { THESIS_IDL, type MarketView, type ThesisIdl as Thesis } from "@thesis/chain";

import { PM_AMM_PROGRAM_ID, PROTOCOL_DAO } from "@thesis/chain";
export const PM_AMM = PM_AMM_PROGRAM_ID;
export { PROTOCOL_DAO };

export interface Ctx {
  connection: Connection;
  keeper: Keypair;
  program: Program<Thesis>;
  config: PublicKey;
  authority: PublicKey;
}

export function makeCtx(rpcUrl: string, keeper: Keypair, idlPath?: string): Ctx {
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keeper), { commitment: "confirmed" });
  const idl = idlPath ? JSON.parse(readFileSync(idlPath, "utf8")) : THESIS_IDL;
  const program = new Program<Thesis>(idl, provider);
  const pda = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], program.programId)[0];
  return { connection, keeper, program, config: pda("config"), authority: pda("authority") };
}

export const pmPda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PM_AMM)[0];

export function pmAccounts(pmMarket: PublicKey) {
  return {
    yesMint: pmPda([Buffer.from("yes_mint"), pmMarket.toBuffer()]),
    noMint: pmPda([Buffer.from("no_mint"), pmMarket.toBuffer()]),
    vault: pmPda([Buffer.from("vault"), pmMarket.toBuffer()]),
  };
}

export function creatorStatsPda(ctx: Ctx, creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("creator"), creator.toBuffer()], ctx.program.programId)[0];
}

export function daoUsdc(usdcMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint, PROTOCOL_DAO, true);
}

export type TouchMarketAccount = Awaited<ReturnType<Ctx["program"]["account"]["touchMarket"]["fetch"]>>;

export function toView(m: TouchMarketAccount): MarketView {
  return {
    feedId: Buffer.from(m.feedId),
    direction: "below" in (m.direction as object) ? "below" : "above",
    strike: BigInt(m.strike.toString()),
    expo: m.expo,
    startTs: m.startTs.toNumber(),
    endTs: m.endTs.toNumber(),
    touched: m.touched,
    settled: m.settled,
  };
}

/** Byte offsets in a TouchMarket account (8-byte discriminator included). */
export const TOUCH_SETTLED_OFFSET = 160;
export const TOUCH_SEEDED_BY_OFFSET = 226;
const SETTLED = (v: boolean) => ({ memcmp: { offset: TOUCH_SETTLED_OFFSET, bytes: v ? "2" : "1" } }); // base58 of [1] / [0]

type MarketRow = { key: PublicKey; account: TouchMarketAccount };
const rows = (all: { publicKey: PublicKey; account: TouchMarketAccount }[]): MarketRow[] =>
  all.map((m) => ({ key: m.publicKey, account: m.account }));

/** Unsettled markets, filtered by the RPC node rather than downloaded and dropped. */
export async function openMarkets(ctx: Ctx): Promise<MarketRow[]> {
  return rows((await ctx.program.account.touchMarket.all([SETTLED(false)])).filter((m) => !m.account.settled));
}

/** Settled markets the treasury seeded (where it may have money to redeem). */
export async function settledSponsoredMarkets(ctx: Ctx): Promise<MarketRow[]> {
  const sponsored = { memcmp: { offset: TOUCH_SEEDED_BY_OFFSET, bytes: ctx.authority.toBase58() } };
  return rows((await ctx.program.account.touchMarket.all([SETTLED(true), sponsored])).filter((m) => m.account.settled));
}

export const lpPositionPda = (pmMarket: PublicKey, owner: PublicKey) =>
  pmPda([Buffer.from("lp"), pmMarket.toBuffer(), owner.toBuffer()]);

export const log = (scope: string, msg: string) => console.log(`${new Date().toISOString()} [${scope}] ${msg}`);
