/**
 * Thesis worker, one process: the watcher (proves touches), the keeper
 * (settles), and, when DATABASE_URL is set, the indexer (chain -> Postgres)
 * and the volatility keeper (posts 7-day realised vol).
 *
 * Env:
 *   RPC_URL             default https://api.devnet.solana.com
 *   KEEPER_SECRET_KEY   keeper secret key as a JSON byte array (hosted deploys)
 *   KEEPER_KEYPAIR      or a keypair file; default ~/.config/solana/id.json
 *   PRICE_SOURCE        "onchain" (default). Hermes is not wired yet.
 *   PYTH_PRICE_ACCOUNT  default 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE (sponsored SOL/USD)
 *   TREASURY_BUY_USDC   USDC the treasury buys right after a proven touch (default 0 = off)
 *   KEEPER_INTERVAL_MS  default 30000
 *   DATABASE_URL        Postgres (Supabase) for the indexer; unset = no indexer
 *   INDEXER_INTERVAL_MS default 15000
 *   VOL_KEEPER          "on" (default when DATABASE_URL is set) | "off"
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, migrate } from "@thesis/db";
import { log, makeCtx } from "./client";
import { Indexer } from "./indexer";
import { Keeper } from "./keeper";
import { OnchainFeedSource } from "./sources";
import { VolatilityKeeper } from "./volkeeper";
import { Watcher } from "./watcher";

async function main() {
  const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  // KEEPER_SECRET_KEY (JSON byte array, for hosted deploys) or a keypair file.
  const secret = process.env.KEEPER_SECRET_KEY
    ?? readFileSync(process.env.KEEPER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8");
  const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const ctx = makeCtx(rpc, keeper);

  const sourceName = process.env.PRICE_SOURCE ?? "onchain";
  if (sourceName !== "onchain") throw new Error(`PRICE_SOURCE=${sourceName} is not supported yet; use "onchain"`);
  const account = new PublicKey(process.env.PYTH_PRICE_ACCOUNT ?? "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
  const source = new OnchainFeedSource(ctx.connection, account);

  const watcher = new Watcher(ctx, source, {
    treasuryBuyMicroUsdc: Math.round(Number(process.env.TREASURY_BUY_USDC ?? "0") * 1e6),
    refreshMs: 15_000,
  });
  const keeperLoop = new Keeper(ctx, Number(process.env.KEEPER_INTERVAL_MS ?? "30000"));

  log("worker", `program ${ctx.program.programId.toBase58()} keeper ${keeper.publicKey.toBase58()} rpc ${rpc}`);
  await watcher.start();
  await keeperLoop.start();

  let indexer: Indexer | undefined;
  let volKeeper: VolatilityKeeper | undefined;
  if (process.env.DATABASE_URL) {
    const db = connect();
    const applied = await migrate(db);
    if (applied.length) log("worker", `migrations applied: ${applied.join(", ")}`);
    indexer = new Indexer(ctx, db, {
      intervalMs: Number(process.env.INDEXER_INTERVAL_MS ?? "15000"),
      priceSampleSecs: 30,
      spotAccount: account,
    });
    await indexer.start();
    if ((process.env.VOL_KEEPER ?? "on") !== "off") {
      volKeeper = new VolatilityKeeper(ctx, db);
      await volKeeper.start();
    }
  } else {
    log("worker", "DATABASE_URL not set: indexer and volatility keeper are off");
  }

  const shutdown = async () => {
    log("worker", "shutting down");
    await watcher.stop();
    await keeperLoop.stop();
    await indexer?.stop();
    await volKeeper?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
