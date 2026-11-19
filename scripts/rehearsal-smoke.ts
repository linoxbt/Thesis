/**
 * Mainnet-rehearsal smoke test (local validator cloned from mainnet): the admin
 * sponsors a market against the real SOL/USD print, posts a thesis on it, and
 * trades 1 USDC through Thesis (fee to the real pm-AMM DAO account).
 */
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { decodePriceUpdateV2, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { createMarketInstructions, createThesisInstruction, sha256, tradeInstructions } from "../apps/web/lib/client/actions";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("rehearsal only");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR!, "utf8"))));
  const { connection: c } = makeCtx(RPC, admin);
  const send = async (ixs: TransactionInstruction[]) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const sig = await c.sendRawTransaction(tx.serialize());
    await c.confirmTransaction(sig, "confirmed");
    return sig;
  };
  const spot = decodePriceUpdateV2((await c.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
  const endTs = Math.floor(Date.now() / 1000) + 172_800;
  const m = await createMarketInstructions(c, {
    creator: admin.publicKey, usdcMint: USDC, direction: "above", strike: (spot.price * 10_300n) / 10_000n, endTs,
    seed: 20_000_000n, name: "rehearsal", sponsored: true,
  });
  console.log("sponsored market", m.touchMarket.toBase58(), await send(m.ixs));
  const th = await createThesisInstruction(c, { creator: admin.publicKey, conviction: m.touchMarket, protection: null, textHash: await sha256("rehearsal") });
  console.log("thesis", th.thesis.toBase58(), await send([th.ix]));
  const ixs = await tradeInstructions(c, {
    trader: admin.publicKey, usdcMint: USDC, thesis: th.thesis, thesisCreator: admin.publicKey, touchMarket: m.touchMarket,
    pmMarket: m.pmMarket, side: "buy_yes", amountIn: 1_000_000n, minOutput: 0n,
  });
  console.log("trade 1 USDC via Thesis", await send(ixs));
  console.log("REHEARSAL OK");
}

main().catch((e) => {
  console.error((e as Error).message, (e as { logs?: string[] }).logs?.slice(-6).join("\n") ?? "");
  process.exit(1);
});
