/**
 * One-time (idempotent) setup of the Thesis program on devnet:
 * initialize_config, then fund the treasury with mUSDC.
 *
 *   RPC_URL=https://api.devnet.solana.com tsx scripts/init-devnet.ts
 */
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createTransferInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SOL_USD_FEED_ID } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"); // pm-AMM devnet mock USDC
const USDC = 1_000_000;
const TREASURY_TARGET = 500 * USDC;

async function main() {
  if (!/devnet|127\.0\.0\.1|localhost/.test(RPC)) throw new Error("init-devnet only targets devnet or a local validator");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
  const ctx = makeCtx(RPC, admin);
  const { connection, program, config, authority } = ctx;
  const treasury = getAssociatedTokenAddressSync(MUSDC, authority, true);
  console.log("program", program.programId.toBase58(), "admin", admin.publicKey.toBase58());

  if (await connection.getAccountInfo(config)) {
    console.log("config already initialised");
  } else {
    const sig = await program.methods
      .initializeConfig({
        keeper: admin.publicKey,
        solUsdFeedId: [...Buffer.from(SOL_USD_FEED_ID, "hex")],
        creatorShareBps: 5000,
        graceSecs: 120,
        maxConfBps: 50,
        minSeedPerMarket: new BN(USDC),
        maxSeedPerMarket: new BN(100 * USDC),
        maxCoverPerWallet: new BN(250 * USDC),
        sponsorBudget: new BN(300 * USDC),
        solVolBps: 6000,
        maxVolAgeSecs: 3 * 86_400,
        // Devnet's sponsored SOL/USD account updates about every 30 min.
        maxSpotAgeSecs: 3_600,
        minStrikeDistanceBps: 50,
        maxStrikeDistanceBps: 5_000,
        minOpenBps: 100,
        maxOpenBps: 9_900,
        authorityFunding: new BN(0.5e9),
      })
      .accountsPartial({ admin: admin.publicKey, config, authority, usdcMint: MUSDC, treasury })
      .rpc({ commitment: "confirmed" });
    console.log("initialize_config", sig);
  }

  const have = await getAccount(connection, treasury).then((a) => a.amount).catch(() => 0n);
  if (have < BigInt(TREASURY_TARGET)) {
    const top = BigInt(TREASURY_TARGET) - have;
    const tx = new Transaction().add(
      createTransferInstruction(getAssociatedTokenAddressSync(MUSDC, admin.publicKey), treasury, admin.publicKey, top),
    );
    const sig = await program.provider.sendAndConfirm!(tx, [], { commitment: "confirmed" });
    console.log(`treasury topped up by ${Number(top) / USDC} mUSDC`, sig);
  }
  const cfg = await program.account.config.fetch(config);
  console.log(
    JSON.stringify({
      treasury: treasury.toBase58(),
      treasuryUsdc: Number((await getAccount(connection, treasury)).amount) / USDC,
      authoritySol: (await connection.getBalance(authority)) / 1e9,
      sponsorBudgetUsdc: Number(cfg.sponsorBudget.toString()) / USDC,
      volBps: cfg.solVolBps,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
