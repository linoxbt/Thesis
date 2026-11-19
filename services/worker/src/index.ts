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
 *   KEEPER_MIN_SOL      ops alert below this keeper balance (default 0.1)
 *   AUTHORITY_MIN_SOL   ops alert below this Authority PDA float (default 0.1)
 *   DATABASE_URL        Postgres for the indexer; unset = no indexer. TLS for
 *                       remote hosts (DATABASE_SSL=off|verify to change)
 *   INDEXER_INTERVAL_MS default 15000
 *   VOL_KEEPER          "on" (default when DATABASE_URL is set) | "off"
 *   TELEGRAM_BOT_TOKEN  enables Telegram alerts (needs DATABASE_URL)
 *   TELEGRAM_ADMIN_CHAT_ID  optional operator chat for ops alerts
 *   SITE_URL            links in alerts; default https://thesis-calls.netlify.app
 *   ALERTS_INTERVAL_MS  default 20000
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { connect, migrate } from "@thesis/db";
import { log, makeCtx } from "./client";
import { Indexer } from "./indexer";
import { Keeper } from "./keeper";
import { OnchainFeedSource } from "./sources";
import { AlertNotifier, OpsAlerts, TelegramBot, telegramApi } from "./telegram";
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

  // Ops alerts first, so the other components can raise them.
  let ops: OpsAlerts | undefined;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  if (tgToken && process.env.TELEGRAM_ADMIN_CHAT_ID) {
    ops = new OpsAlerts(telegramApi(tgToken), process.env.TELEGRAM_ADMIN_CHAT_ID, {
      connection: ctx.connection,
      keeper: keeper.publicKey,
      minSol: Number(process.env.KEEPER_MIN_SOL ?? "0.1"),
      authority: ctx.authority,
      authorityMinSol: Number(process.env.AUTHORITY_MIN_SOL ?? "0.1"),
      cluster: /mainnet/.test(rpc) ? "mainnet" : "devnet",
    });
  }
  const alert = ops?.alert;

  const watcher = new Watcher(ctx, source, {
    treasuryBuyMicroUsdc: Math.round(Number(process.env.TREASURY_BUY_USDC ?? "0") * 1e6),
    refreshMs: 15_000,
    alert,
  });
  const keeperLoop = new Keeper(ctx, Number(process.env.KEEPER_INTERVAL_MS ?? "30000"), alert);

  log("worker", `program ${ctx.program.programId.toBase58()} keeper ${keeper.publicKey.toBase58()} rpc ${rpc}`);
  // Each component starts on its own: one failing must not take down the rest.
  await startSafely("ops", () => ops?.start());
  await startSafely("watcher", () => watcher.start());
  await startSafely("keeper", () => keeperLoop.start());

  let indexer: Indexer | undefined;
  let volKeeper: VolatilityKeeper | undefined;
  let bot: TelegramBot | undefined;
  let notifier: AlertNotifier | undefined;
  const siteUrl = (process.env.SITE_URL ?? "https://thesis-calls.netlify.app").replace(/\/$/, "");
  if (process.env.DATABASE_URL) {
    const db = connect();
    const applied = await retry("migrate", () => migrate(db));
    if (applied.length) log("worker", `migrations applied: ${applied.join(", ")}`);
    indexer = new Indexer(ctx, db, {
      intervalMs: Number(process.env.INDEXER_INTERVAL_MS ?? "15000"),
      priceSampleSecs: 30,
      spotAccount: account,
    });
    await startSafely("indexer", () => indexer!.start());
    if ((process.env.VOL_KEEPER ?? "on") !== "off") {
      volKeeper = new VolatilityKeeper(ctx, db);
      await startSafely("volatility keeper", () => volKeeper!.start());
    }
    if (tgToken) {
      const api = telegramApi(tgToken);
      bot = new TelegramBot(api, db, { siteUrl });
      notifier = new AlertNotifier(api, db, { siteUrl, intervalMs: Number(process.env.ALERTS_INTERVAL_MS ?? "20000") });
      await startSafely("telegram bot", () => bot!.start());
      await startSafely("telegram alerts", () => notifier!.start());
      log("worker", "telegram alerts on");
    } else {
      log("worker", "TELEGRAM_BOT_TOKEN not set: telegram alerts are off");
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
    await bot?.stop();
    await notifier?.stop();
    await ops?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Starts a component; a failure is logged, not fatal. */
async function startSafely(name: string, start: () => Promise<void> | undefined): Promise<void> {
  try {
    await start();
  } catch (e) {
    log("worker", `${name} failed to start: ${(e as Error).message.split("\n")[0]}`);
  }
}

/** Retries a startup step (e.g. the database still booting) with backoff. */
async function retry<T>(name: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = Math.min(30_000, 1_000 * 2 ** i);
      log("worker", `${name} failed (attempt ${i}/${attempts}): ${(e as Error).message.split("\n")[0]}; retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// A stray rejection is logged, never a silent crash loop.
process.on("unhandledRejection", (e) => log("worker", `unhandled rejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
