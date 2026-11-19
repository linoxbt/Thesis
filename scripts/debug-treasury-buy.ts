import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { daoUsdc, makeCtx, pmAccounts } from "../services/worker/src/client";

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
  const ctx = makeCtx(process.env.RPC_URL ?? "http://127.0.0.1:8899", kp);
  const key = new PublicKey(process.argv[2]);
  const m = await ctx.program.account.touchMarket.fetch(key);
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const { yesMint, noMint, vault } = pmAccounts(m.pmMarket);
  const ty = getAssociatedTokenAddressSync(yesMint, ctx.authority, true);
  const tn = getAssociatedTokenAddressSync(noMint, ctx.authority, true);
  console.log("touched", m.touched, "settled", m.settled, "authority SOL", (await ctx.connection.getBalance(ctx.authority)) / 1e9);
  console.log("dao usdc exists", !!(await ctx.connection.getAccountInfo(daoUsdc(cfg.usdcMint))));
  const buy = await ctx.program.methods.treasuryBuyYes(new BN(2_000_000), new BN(0)).accountsPartial({
    keeper: kp.publicKey, config: ctx.config, authority: ctx.authority, touchMarket: key, pmMarket: m.pmMarket,
    usdcMint: cfg.usdcMint, yesMint, noMint, vault, treasuryYes: ty, treasuryNo: tn, daoUsdc: daoUsdc(cfg.usdcMint), tokenProgram: TOKEN_PROGRAM_ID,
  }).instruction();
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ty, ctx.authority, yesMint),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, tn, ctx.authority, noMint),
    buy,
  );
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await ctx.connection.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sim = await ctx.connection.simulateTransaction(tx);
  console.log("err", JSON.stringify(sim.value.err));
  console.log((sim.value.logs ?? []).filter((l) => !/Tokenkeg.*(invoke|success)|GetAccountDataSize|InitializeImmutableOwner|Please upgrade|Initialize the associated|InitializeAccount3|11111111111111111111111111111111/.test(l)).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
