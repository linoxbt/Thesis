import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Thesis } from "../../../target/types/thesis";
import type { MarketView } from "./crossing";

export const PM_AMM = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
export const PROTOCOL_DAO = new PublicKey("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");

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
  const idl = JSON.parse(readFileSync(idlPath ?? resolve(__dirname, "../../../target/idl/thesis.json"), "utf8"));
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

/** Every TouchMarket not yet settled. */
export async function openMarkets(ctx: Ctx): Promise<{ key: PublicKey; account: TouchMarketAccount }[]> {
  const all = await ctx.program.account.touchMarket.all();
  return all.filter((m) => !m.account.settled).map((m) => ({ key: m.publicKey, account: m.account }));
}

export const log = (scope: string, msg: string) => console.log(`${new Date().toISOString()} [${scope}] ${msg}`);
