/**
 * Mainnet setup, right after `solana program deploy`: initialize_config with
 * the mainnet caps, then check nobody front-ran it (whoever initialises first
 * becomes admin). Optionally funds the treasury.
 *
 *   RPC_URL=<mainnet rpc> ADMIN_KEYPAIR=<path> KEEPER_PUBKEY=<keeper> \
 *     tsx scripts/init-mainnet.ts [--send] [--treasury-usdc 100]
 *
 * Without --send it only prints the plan. REHEARSAL=1 allows a local
 * validator cloned from mainnet (scripts/mainnet-rehearsal.sh).
 */
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SOL_USD_FEED_ID } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC = 1_000_000;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Launch caps (docs/PLAN.md, Phase 5): small, raised later with update_config. */
export const MAINNET_ARGS = (keeper: PublicKey, spotAgeSecs: number) => ({
  keeper,
  solUsdFeedId: [...Buffer.from(SOL_USD_FEED_ID, "hex")],
  creatorShareBps: 5000, // fixed forever once set
  graceSecs: 120,
  maxConfBps: 50,
  minSeedPerMarket: new BN(5 * USDC),
  maxSeedPerMarket: new BN(25 * USDC),
  maxCoverPerWallet: new BN(100 * USDC),
  sponsorBudget: new BN(100 * USDC),
  solVolBps: 6000,
  maxVolAgeSecs: 3 * 86_400,
  maxSpotAgeSecs: spotAgeSecs, // the sponsored mainnet account updates every few seconds
  minStrikeDistanceBps: 50,
  maxStrikeDistanceBps: 5_000,
  minOpenBps: 100,
  maxOpenBps: 9_900,
  authorityFunding: new BN(0.5e9), // fronts market rent; creators repay it in the same instruction
});

async function main() {
  const rehearsal = process.env.REHEARSAL === "1";
  const send = process.argv.includes("--send");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR ?? "", "utf8"))));
  const keeper = new PublicKey(process.env.KEEPER_PUBKEY ?? "");
  const ctx = makeCtx(RPC, admin);
  const { connection, program, config, authority } = ctx;

  const genesis = await connection.getGenesisHash();
  if (genesis !== MAINNET_GENESIS && !(rehearsal && /127\.0\.0\.1|localhost/.test(RPC))) {
    throw new Error("not mainnet-beta (set REHEARSAL=1 with a local validator to rehearse)");
  }
  if (keeper.equals(admin.publicKey) && !rehearsal) throw new Error("use a separate keeper key: the admin key should stay offline");
  const spotAge = rehearsal ? Number(process.env.SPOT_AGE_SECS ?? "600") : 60;
  const treasury = getAssociatedTokenAddressSync(USDC_MINT, authority, true);
  const plan = {
    cluster: rehearsal ? "local rehearsal (mainnet clone)" : "mainnet-beta",
    program: program.programId.toBase58(),
    admin: admin.publicKey.toBase58(),
    keeper: keeper.toBase58(),
    adminSol: (await connection.getBalance(admin.publicKey)) / 1e9,
    maxSpotAgeSecs: spotAge,
    caps: "seed 5–25 USDC, cover 100 USDC/wallet, sponsor budget 100 USDC",
  };
  console.log(JSON.stringify(plan, null, 1));

  const programInfo = await connection.getAccountInfo(program.programId);
  if (!programInfo?.executable) throw new Error("program not deployed at this id");
  const existing = await connection.getAccountInfo(config);
  if (!existing) {
    if (!send) return console.log("dry run: pass --send to initialise");
    const sig = await program.methods
      .initializeConfig(MAINNET_ARGS(keeper, spotAge))
      .accountsPartial({ admin: admin.publicKey, config, authority, usdcMint: USDC_MINT, treasury })
      .rpc({ commitment: "confirmed" });
    console.log("initialize_config", sig);
  }
  // Front-running check: the config must be ours.
  const cfg = await program.account.config.fetch(config);
  if (!cfg.admin.equals(admin.publicKey)) {
    throw new Error(`Config admin is ${cfg.admin.toBase58()}, not you: someone initialised first. Redeploy under a new program id.`);
  }
  if (!cfg.usdcMint.equals(USDC_MINT)) throw new Error("Config USDC mint is not mainnet USDC");
  console.log("config ok: admin is you, USDC mint is mainnet USDC");

  const fund = Number(arg("--treasury-usdc") ?? "0");
  if (send && fund > 0) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasury, authority, USDC_MINT),
      createTransferInstruction(getAssociatedTokenAddressSync(USDC_MINT, admin.publicKey), treasury, admin.publicKey, BigInt(Math.round(fund * USDC))),
    );
    console.log("treasury funded", await program.provider.sendAndConfirm!(tx, [], { commitment: "confirmed" }));
  }
  const bal = await getAccount(connection, treasury).then((a) => Number(a.amount) / USDC).catch(() => 0);
  console.log(JSON.stringify({ treasury: treasury.toBase58(), treasuryUsdc: bal, authoritySol: (await connection.getBalance(authority)) / 1e9 }));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
