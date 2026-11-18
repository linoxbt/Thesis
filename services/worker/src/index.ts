/**
 * Thesis worker: the watcher (proves touches) and the keeper (settles), in one
 * process. Phase 3 adds the indexer loop here.
 *
 * Env:
 *   RPC_URL             default https://api.devnet.solana.com
 *   KEEPER_KEYPAIR      default ~/.config/solana/id.json
 *   PRICE_SOURCE        "onchain" (default). Hermes is not wired yet.
 *   PYTH_PRICE_ACCOUNT  default 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE (sponsored SOL/USD)
 *   TREASURY_BUY_USDC   USDC the treasury buys right after a proven touch (default 0 = off)
 *   KEEPER_INTERVAL_MS  default 30000
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { log, makeCtx } from "./client";
import { Keeper } from "./keeper";
import { OnchainFeedSource } from "./sources";
import { Watcher } from "./watcher";

async function main() {
  const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const keypairPath = process.env.KEEPER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
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

  const shutdown = async () => {
    log("worker", "shutting down");
    await watcher.stop();
    await keeperLoop.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
