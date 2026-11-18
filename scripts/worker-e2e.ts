/**
 * End-to-end check of the worker on a local validator that clones the real
 * pm-AMM from devnet: create a sponsored TouchBelow market + thesis, run the
 * watcher (on a crafted price account that crosses the strike) and the keeper,
 * and assert the market was proven, bought into by the treasury, settled YES,
 * and recorded as a hit.
 *
 *   PRICE_ACCOUNT=<crafted> RPC_URL=http://127.0.0.1:8899 tsx scripts/worker-e2e.ts
 */
import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { createTransferInstruction, getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { creatorStatsPda, log, makeCtx, PM_AMM, pmAccounts, pmPda } from "../services/worker/src/client";
import { Keeper } from "../services/worker/src/keeper";
import { decodePriceUpdateV2 } from "../services/worker/src/pyth";
import { OnchainFeedSource } from "../services/worker/src/sources";
import { Watcher } from "../services/worker/src/watcher";

const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SPOT_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const USDC = 1_000_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(cond: boolean, what: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const ctx = makeCtx(process.env.RPC_URL ?? "http://127.0.0.1:8899", wallet);
  const { program, connection, config, authority } = ctx;
  const treasury = getAssociatedTokenAddressSync(MUSDC, authority, true);
  const crafted = new PublicKey(process.env.PRICE_ACCOUNT!);

  if (!(await connection.getAccountInfo(config))) {
    await program.methods
      .initializeConfig({
        keeper: wallet.publicKey,
        solUsdFeedId: [...FEED],
        creatorShareBps: 5000,
        graceSecs: 120,
        maxConfBps: 50,
        minSeedPerMarket: new BN(USDC),
        maxSeedPerMarket: new BN(100 * USDC),
        maxCoverPerWallet: new BN(250 * USDC),
        sponsorBudget: new BN(150 * USDC),
        solVolBps: 6000,
        maxVolAgeSecs: 3 * 86_400,
        maxSpotAgeSecs: 3_600,
        minStrikeDistanceBps: 50,
        maxStrikeDistanceBps: 5_000,
        minOpenBps: 100,
        maxOpenBps: 9_900,
        authorityFunding: new BN(0.5e9),
      })
      .accountsPartial({ admin: wallet.publicKey, config, authority, usdcMint: MUSDC, treasury })
      .rpc();
    const walletUsdc = getAssociatedTokenAddressSync(MUSDC, wallet.publicKey);
    await program.provider.sendAndConfirm!(
      new Transaction().add(createTransferInstruction(walletUsdc, treasury, wallet.publicKey, 200 * USDC)),
    );
    log("e2e", "config initialised, treasury funded");
  }

  // Market: TouchBelow 0.5% under the cloned spot, 10 minutes, sponsored.
  const spot = decodePriceUpdateV2((await connection.getAccountInfo(SPOT_ACCOUNT))!.data);
  const cross = decodePriceUpdateV2((await connection.getAccountInfo(crafted))!.data);
  const strike = (spot.price * 9_950n) / 10_000n;
  const marketId = new BN(randomBytes(8), "le");
  const pmMarket = pmPda([Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)]);
  const { yesMint, noMint, vault } = pmAccounts(pmMarket);
  const meta = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL.toBuffer(), mint.toBuffer()], MPL)[0];
  const touchMarket = PublicKey.findProgramAddressSync([Buffer.from("touch"), pmMarket.toBuffer()], program.programId)[0];
  const window = Number(process.env.WINDOW ?? 600);
  await program.methods
    .createTouchMarket({
      marketId,
      direction: { below: {} },
      strike: new BN(strike.toString()),
      endTs: new BN(Math.floor(Date.now() / 1000) + window),
      seedAmount: new BN(25 * USDC),
      sponsored: true,
      name: "e2e touch",
    })
    .accountsPartial({
      creator: wallet.publicKey,
      config,
      authority,
      treasury,
      creatorUsdc: null,
      usdcMint: MUSDC,
      priceUpdate: SPOT_ACCOUNT,
      pmMarket,
      yesMint,
      noMint,
      vault,
      yesMetadata: meta(yesMint),
      noMetadata: meta(noMint),
      lpPosition: pmPda([Buffer.from("lp"), pmMarket.toBuffer(), authority.toBuffer()]),
      touchMarket,
      pmAmmProgram: PM_AMM,
      tokenMetadataProgram: MPL,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  const tm0 = await program.account.touchMarket.fetch(touchMarket);
  log("e2e", `market ${touchMarket.toBase58()} strike ${strike} opens ${tm0.initialPriceBps / 100}% start ${tm0.startTs} end ${tm0.endTs}`);
  log("e2e", `crafted print ${cross.price} at ${cross.publishTime} (${cross.publishTime - tm0.startTs.toNumber()} s after start)`);

  // Thesis on it.
  const stats = creatorStatsPda(ctx, wallet.publicKey);
  const nextId = (await program.account.creatorStats.fetchNullable(stats))?.nextThesisId ?? new BN(0);
  const thesis = PublicKey.findProgramAddressSync(
    [Buffer.from("thesis"), wallet.publicKey.toBuffer(), nextId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  )[0];
  await program.methods
    .createThesis([...Buffer.alloc(32, 7)])
    .accountsPartial({ creator: wallet.publicKey, config, creatorStats: stats, thesis, convictionMarket: touchMarket, protectionMarket: null })
    .rpc();
  const hitsBefore = (await program.account.creatorStats.fetch(stats)).hit;

  // Worker: watcher on the crafted feed + keeper.
  const watcher = new Watcher(ctx, new OnchainFeedSource(connection, crafted, 3_000), {
    treasuryBuyMicroUsdc: 2 * USDC,
    refreshMs: 5_000,
  });
  const keeper = new Keeper(ctx, 10_000);
  await watcher.start();
  await keeper.start();

  const deadline = tm0.endTs.toNumber() + 120 + 90;
  let tm = tm0;
  while (Math.floor(Date.now() / 1000) < deadline && !tm.settled) {
    await sleep(5_000);
    // The crafted print sits in the future at genesis; re-read it each loop.
    await watcher.onTick({ ...decodePriceUpdateV2((await connection.getAccountInfo(crafted))!.data), proofAccount: crafted });
    tm = await program.account.touchMarket.fetch(touchMarket);
  }
  await watcher.stop();
  await keeper.stop();

  const th = await program.account.thesis.fetch(thesis);
  const st = await program.account.creatorStats.fetch(stats);
  const treasuryYes = await getAccount(connection, getAssociatedTokenAddressSync(yesMint, authority, true)).catch(() => null);
  console.log("");
  check(tm.touched, `watcher proved the touch (price ${tm.touchPrice} at ${tm.touchPublishTime})`);
  check(treasuryYes !== null && treasuryYes.amount > 0n, `treasury bought YES after the touch (${treasuryYes?.amount ?? 0n} units)`);
  check(tm.settled && tm.winningSide === 1, "keeper settled YES");
  check(th.outcome === 1, "thesis outcome = hit");
  check(st.hit === hitsBefore + 1, "creator stats hit +1");
  console.log("watcher crossings:", JSON.stringify(watcher.crossings, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  console.log("keeper settles:", JSON.stringify(keeper.settled));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
