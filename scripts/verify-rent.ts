/**
 * Simulates (never sends) a creator-seeded create_touch_market on devnet and
 * reports the Authority PDA's and the creator's lamports before and after, to
 * check that creators repay the pm-AMM rent the Authority pays.
 *
 *   RPC_URL=https://api.devnet.solana.com tsx scripts/verify-rent.ts
 */
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { decodePriceUpdateV2, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createMarketInstructions } from "../apps/web/lib/client/actions";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");

async function main() {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
  const { connection: c, authority } = makeCtx(RPC, admin);
  const spot = decodePriceUpdateV2((await c.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
  const m = await createMarketInstructions(c, {
    creator: admin.publicKey, usdcMint: MUSDC, direction: "above", strike: (spot.price * 10_300n) / 10_000n,
    endTs: Math.floor(Date.now() / 1000) + 172_800, seed: 1_000_000n, name: "rent check",
  });
  const tx = new Transaction().add(...m.ixs);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  tx.sign(admin);
  const pre = await c.getMultipleAccountsInfo([authority, admin.publicKey]);
  const sim = await c.simulateTransaction(tx, undefined, [authority, admin.publicKey]);
  if (sim.value.err) {
    console.log("simulation failed", JSON.stringify(sim.value.err));
    console.log((sim.value.logs ?? []).slice(-8).join("\n"));
    process.exit(1);
  }
  const post = sim.value.accounts!;
  const d = (i: number) => (post[i]!.lamports - pre[i]!.lamports) / 1e9;
  console.log(JSON.stringify({ authorityDeltaSol: d(0), creatorDeltaSol: +d(1).toFixed(6) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
