/**
 * Phase 0 devnet spike: the full touch-market lifecycle on the real pm-AMM.
 *
 *   initialize_config (once) -> fund treasury -> create_touch_market (PDA
 *   authority, treasury seed) -> buy YES directly on pm-AMM -> watch Pyth ->
 *   prove_touch if the strike is crossed -> settle after end + grace.
 *
 * Proof source: Pyth's sponsored SOL/USD feed account on devnet is itself a
 * fully verified PriceUpdateV2, so prove_touch can read it directly. (The
 * production watcher posts the exact crossing update from Hermes instead.)
 *
 * Usage: pnpm devnet:spike [--distance-bps 15] [--window 330] [--seed 25]
 * Needs ~2.5 devnet SOL for the first run (program deploy is separate:
 * `anchor deploy --provider.cluster devnet`) and mUSDC from the pm-AMM faucet.
 */
import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Thesis } from "../target/types/thesis";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PM_AMM = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const PROTOCOL_DAO = new PublicKey("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");
const SOL_USD_PRICE_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const SOL_USD_FEED_ID = Buffer.from(
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "hex",
);
const USDC = 1_000_000;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];
const explorer = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads price, exponent and publish time from a PriceUpdateV2 account. */
function readPythPrice(data: Buffer) {
  let at = 40;
  const level = data[at];
  at += level === 0 ? 2 : 1;
  const feed = data.subarray(at, at + 32);
  at += 32;
  const price = data.readBigInt64LE(at);
  const conf = data.readBigUInt64LE(at + 8);
  const expo = data.readInt32LE(at + 16);
  const publishTime = Number(data.readBigInt64LE(at + 20));
  return { full: level === 1, feed, price, conf, expo, publishTime };
}

async function main() {
  const distanceBps = arg("distance-bps", 15); // strike 0.15% below spot by default
  const windowSecs = arg("window", 330);
  const seedUsdc = arg("seed", 25);

  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync("target/idl/thesis.json", "utf8"));
  const thesis = new Program<Thesis>(idl, provider);
  const pmIdl = JSON.parse(readFileSync("idls/pm_amm.json", "utf8"));
  const pm = new Program(pmIdl, provider);

  const config = pda([Buffer.from("config")], thesis.programId);
  const authority = pda([Buffer.from("authority")], thesis.programId);
  const treasury = getAssociatedTokenAddressSync(MUSDC, authority, true);
  const walletUsdc = getAssociatedTokenAddressSync(MUSDC, wallet.publicKey);
  console.log("program  ", thesis.programId.toBase58());
  console.log("wallet   ", wallet.publicKey.toBase58(), (await connection.getBalance(wallet.publicKey)) / 1e9, "SOL");
  console.log("authority", authority.toBase58());
  console.log("treasury ", treasury.toBase58());

  // 1. Config (once).
  if (!(await connection.getAccountInfo(config))) {
    const sig = await thesis.methods
      .initializeConfig({
        keeper: wallet.publicKey,
        solUsdFeedId: [...SOL_USD_FEED_ID],
        creatorShareBps: 5000,
        graceSecs: 120,
        maxConfBps: 50,
        maxSeedPerMarket: new BN(100 * USDC),
        maxCoverPerWallet: new BN(250 * USDC),
        authorityFunding: new BN(0.5e9),
      })
      .accountsPartial({ admin: wallet.publicKey, config, authority, usdcMint: MUSDC, treasury })
      .rpc();
    console.log("initialize_config", explorer(sig));
  }

  // 2. Make sure the treasury can pay the seed.
  const treasuryBal = Number((await getAccount(connection, treasury)).amount);
  if (treasuryBal < seedUsdc * USDC) {
    const tx = new Transaction().add(
      createTransferInstruction(walletUsdc, treasury, wallet.publicKey, 200 * USDC),
    );
    console.log("fund treasury 200 mUSDC", explorer(await provider.sendAndConfirm(tx)));
  }

  // 3. Create a near-spot TouchBelow market.
  const spotInfo = readPythPrice((await connection.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
  const strike = (spotInfo.price * BigInt(10_000 - distanceBps)) / 10_000n;
  const marketId = new BN(randomBytes(8), "le");
  const pmMarket = pda([Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)], PM_AMM);
  const yesMint = pda([Buffer.from("yes_mint"), pmMarket.toBuffer()], PM_AMM);
  const noMint = pda([Buffer.from("no_mint"), pmMarket.toBuffer()], PM_AMM);
  const vault = pda([Buffer.from("vault"), pmMarket.toBuffer()], PM_AMM);
  const meta = (mint: PublicKey) => pda([Buffer.from("metadata"), MPL.toBuffer(), mint.toBuffer()], MPL);
  const lpPosition = pda([Buffer.from("lp"), pmMarket.toBuffer(), authority.toBuffer()], PM_AMM);
  const touchMarket = pda([Buffer.from("touch"), pmMarket.toBuffer()], thesis.programId);
  const endTs = Math.floor(Date.now() / 1000) + windowSecs;
  const fmt = (p: bigint) => (Number(p) * 10 ** spotInfo.expo).toFixed(4);
  console.log(`spot $${fmt(spotInfo.price)}  strike $${fmt(strike)} (TouchBelow, ${distanceBps >= 0 ? "-" : "+"}${Math.abs(distanceBps)} bps from spot)  window ${windowSecs}s`);

  const createSig = await thesis.methods
    .createTouchMarket({
      marketId,
      direction: { below: {} },
      strike: new BN(strike.toString()),
      expo: spotInfo.expo,
      endTs: new BN(endTs),
      initialPriceBps: 5000,
      seedAmount: new BN(seedUsdc * USDC),
      name: `SOL <= ${fmt(strike)}`,
    })
    .accountsPartial({
      payer: wallet.publicKey,
      config,
      authority,
      treasury,
      usdcMint: MUSDC,
      pmMarket,
      yesMint,
      noMint,
      vault,
      yesMetadata: meta(yesMint),
      noMetadata: meta(noMint),
      lpPosition,
      touchMarket,
      pmAmmProgram: PM_AMM,
      tokenMetadataProgram: MPL,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  console.log("create_touch_market", explorer(createSig));
  console.log("pm-AMM market", pmMarket.toBase58());

  // 4. Buy 5 mUSDC of YES directly on the pm-AMM; creator fee goes to the treasury.
  const userYes = getAssociatedTokenAddressSync(yesMint, wallet.publicKey);
  const userNo = getAssociatedTokenAddressSync(noMint, wallet.publicKey);
  const before = Number((await getAccount(connection, treasury)).amount);
  const swapSig = await pm.methods
    .swap({ usdcToYes: {} }, new BN(5 * USDC), new BN(0))
    .accountsPartial({
      signer: wallet.publicKey,
      market: pmMarket,
      collateralMint: MUSDC,
      yesMint,
      noMint,
      vault,
      userCollateral: walletUsdc,
      userYes,
      userNo,
      daoUsdc: getAssociatedTokenAddressSync(MUSDC, PROTOCOL_DAO, true),
      creatorUsdc: treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, userYes, wallet.publicKey, yesMint),
      createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, userNo, wallet.publicKey, noMint),
    ])
    .rpc();
  const after = Number((await getAccount(connection, treasury)).amount);
  console.log(`swap 5 mUSDC -> YES ${explorer(swapSig)}  treasury +${(after - before) / USDC} mUSDC`);

  // 5. Watch the sponsored Pyth account until the window closes.
  const startTs = (await thesis.account.touchMarket.fetch(touchMarket)).startTs.toNumber();
  let proven = false;
  while (Math.floor(Date.now() / 1000) <= endTs && !proven) {
    const p = readPythPrice((await connection.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
    const inWindow = p.publishTime >= startTs && p.publishTime <= endTs;
    process.stdout.write(`\r  pyth $${fmt(p.price)} @ ${p.publishTime}  ${p.price <= strike ? "CROSSED" : "above strike"}   `);
    if (p.full && inWindow && p.price <= strike) {
      try {
        const sig = await thesis.methods
          .proveTouch()
          .accountsPartial({ prover: wallet.publicKey, config, touchMarket, priceUpdate: SOL_USD_PRICE_ACCOUNT })
          .rpc();
        console.log(`\nprove_touch ${explorer(sig)}`);
        proven = true;
      } catch (e) {
        console.log(`\nprove_touch rejected: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await sleep(4_000);
  }
  console.log(proven ? "" : "\nno touch in the window");

  // 6. Settle after end + grace.
  const settleAt = endTs + 120;
  while (Math.floor(Date.now() / 1000) < settleAt + 2) await sleep(5_000);
  const settleSig = await thesis.methods
    .settle()
    .accountsPartial({ cranker: wallet.publicKey, config, authority, touchMarket, pmMarket, pmAmmProgram: PM_AMM })
    .rpc();
  const tm = await thesis.account.touchMarket.fetch(touchMarket);
  console.log(`settle ${explorer(settleSig)}  winner: ${tm.winningSide === 1 ? "YES (touched)" : "NO"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
