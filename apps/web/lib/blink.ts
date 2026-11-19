import "server-only";
import { BN } from "@anchor-lang/core";
import {
  AccountLayout, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { PM_AMM_PROGRAM_ID, PROTOCOL_DAO } from "@thesis/chain";
import { configPda, connection, fetchConfig, program } from "./chain";
import { env } from "./server";

/**
 * Solana Actions (Blinks) for a thesis: Back (YES) or Challenge (NO) the take
 * profit from anywhere a blink renders. Headers per @solana/actions 1.6 /
 * actions-spec 2.4.
 */
export const ACTION_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "Content-Type": "application/json",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": env.cluster === "mainnet-beta" ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export const actionJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: ACTION_HEADERS });
/** Actions errors are `{ message }` with a 4xx/5xx status. */
export const actionError = (message: string, status = 400) => actionJson({ message }, status);

const USDC = 1_000_000n;
const SWAP_CU = 1_000_000;
const pmPda = (s: string, m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from(s), m.toBuffer()], PM_AMM_PROGRAM_ID)[0];
const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

/** Parses a USDC amount ("5", "2.5"): positive, at most 6 decimals. */
export function parseUsdc(s: string | null): bigint | null {
  if (!s || !/^\d{1,9}(\.\d{1,6})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const v = BigInt(w) * USDC + BigInt((f + "000000").slice(0, 6));
  return v > 0n ? v : null;
}

export interface ThesisMarket {
  thesis: PublicKey;
  creator: PublicKey;
  touchMarket: PublicKey;
  pmMarket: PublicKey;
  direction: "above" | "below";
  strike: bigint;
  spotAtOpen: bigint;
  expo: number;
  endTs: number;
  open: boolean;
  touched: boolean;
  settled: boolean;
  liqStrike: bigint | null;
}

/** The thesis and its conviction (take-profit) market, read from chain. */
export async function loadThesis(pda: PublicKey): Promise<ThesisMarket | null> {
  const t = await program.account.thesis.fetchNullable(pda);
  if (!t) return null;
  const m = await program.account.touchMarket.fetch(t.convictionMarket);
  const prot = t.protectionMarket.equals(PublicKey.default) ? null : await program.account.touchMarket.fetchNullable(t.protectionMarket);
  const endTs = m.endTs.toNumber();
  return {
    thesis: pda,
    creator: t.creator,
    touchMarket: t.convictionMarket,
    pmMarket: m.pmMarket,
    direction: "below" in (m.direction as object) ? "below" : "above",
    strike: BigInt(m.strike.toString()),
    spotAtOpen: BigInt(m.spotAtOpen.toString()),
    expo: m.expo,
    endTs,
    open: !m.touched && !m.settled && endTs > Math.floor(Date.now() / 1000),
    touched: m.touched,
    settled: m.settled,
    liqStrike: prot ? BigInt(prot.strike.toString()) : null,
  };
}

/**
 * An unsigned trade through Thesis (so the creator is credited), with the
 * minimum output set 1% under a quote simulated against the current pool.
 */
export async function buildTrade(t: ThesisMarket, trader: PublicKey, side: "yes" | "no", amountIn: bigint) {
  const cfg = await fetchConfig();
  if (!cfg) throw new Error("program not initialised");
  if (cfg.paused) throw new Error("trading is paused");
  const usdcMint: PublicKey = cfg.usdc_mint;
  const authority = PublicKey.findProgramAddressSync([Buffer.from("authority")], program.programId)[0];
  const creatorStats = PublicKey.findProgramAddressSync([Buffer.from("creator"), t.creator.toBuffer()], program.programId)[0];
  const yesMint = pmPda("yes_mint", t.pmMarket);
  const noMint = pmPda("no_mint", t.pmMarket);
  const receive = ata(side === "yes" ? yesMint : noMint, trader);
  const build = async (minOutput: bigint) => [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_CU }),
    createAssociatedTokenAccountIdempotentInstruction(trader, ata(usdcMint, trader), trader, usdcMint),
    createAssociatedTokenAccountIdempotentInstruction(trader, ata(yesMint, trader), trader, yesMint),
    createAssociatedTokenAccountIdempotentInstruction(trader, ata(noMint, trader), trader, noMint),
    await program.methods
      .trade((side === "yes" ? { buyYes: {} } : { buyNo: {} }) as never, new BN(amountIn.toString()), new BN(minOutput.toString()))
      .accountsPartial({
        trader,
        config: configPda,
        authority,
        treasury: ata(usdcMint, authority),
        thesis: t.thesis,
        creatorStats,
        touchMarket: t.touchMarket,
        pmMarket: t.pmMarket,
        usdcMint,
        yesMint,
        noMint,
        vault: pmPda("vault", t.pmMarket),
        traderUsdc: ata(usdcMint, trader),
        traderYes: ata(yesMint, trader),
        traderNo: ata(noMint, trader),
        daoUsdc: ata(usdcMint, PROTOCOL_DAO),
        pmAmmProgram: PM_AMM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  ];

  // Quote: simulate with no minimum and read the receiving account back.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const before = await connection.getTokenAccountBalance(receive).then((b) => BigInt(b.value.amount)).catch(() => 0n);
  const msg = new TransactionMessage({ payerKey: trader, recentBlockhash: blockhash, instructions: await build(0n) }).compileToV0Message();
  const sim = await connection.simulateTransaction(new VersionedTransaction(msg), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: [receive.toBase58()] },
  });
  if (sim.value.err) {
    const logs = sim.value.logs ?? [];
    const line = logs.find((l) => l.includes("Error Message:"))?.split("Error Message: ")[1];
    const broke = logs.some((l) => /insufficient/i.test(l)) || JSON.stringify(sim.value.err).includes("InsufficientFunds");
    throw new Error(broke ? "Not enough USDC or SOL in this wallet." : (line ?? "The trade would fail right now."));
  }
  const acc = sim.value.accounts?.[0];
  const after = acc ? AccountLayout.decode(Buffer.from(acc.data[0], "base64")).amount : 0n;
  const output = after - before;
  if (output <= 0n) throw new Error("The pool can't fill this trade right now.");

  const tx = new Transaction({ feePayer: trader, blockhash, lastValidBlockHeight }).add(...(await build((output * 99n) / 100n)));
  return { transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), output };
}
