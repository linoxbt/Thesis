/**
 * Debug helper (local validator only): measures the SOL a full "Post a trade"
 * costs (conviction market + protection market + thesis), sending real
 * transactions from a fresh wallet funded with 1 SOL and 100 mUSDC by the admin.
 *
 *   RPC_URL=http://127.0.0.1:8899 tsx scripts/debug-create.ts
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { decodePriceUpdateV2, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createMarketInstructions, createThesisInstruction, sha256 } from "../apps/web/lib/client/actions";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("local only");
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");

async function main() {
  const c = new Connection(RPC, "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
  const kp = Keypair.generate();
  const send = async (ixs: TransactionInstruction[], signer: Keypair) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
    tx.sign(signer);
    const sig = await c.sendRawTransaction(tx.serialize());
    await c.confirmTransaction(sig, "confirmed");
  };
  const ata = getAssociatedTokenAddressSync(MUSDC, kp.publicKey);
  await send(
    [
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: LAMPORTS_PER_SOL }),
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, kp.publicKey, MUSDC),
      createTransferInstruction(getAssociatedTokenAddressSync(MUSDC, admin.publicKey), ata, admin.publicKey, 100_000_000),
    ],
    admin,
  );
  const bal = async () => (await c.getBalance(kp.publicKey)) / 1e9;
  const start = await bal();
  const spot = decodePriceUpdateV2((await c.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
  const endTs = Math.floor(Date.now() / 1000) + 172_800;
  const conv = await createMarketInstructions(c, { creator: kp.publicKey, usdcMint: MUSDC, direction: "above", strike: (spot.price * 10_300n) / 10_000n, endTs, seed: 25_000_000n, name: "debug" });
  await send(conv.ixs, kp);
  const afterConv = await bal();
  const prot = await createMarketInstructions(c, { creator: kp.publicKey, usdcMint: MUSDC, direction: "below", strike: (spot.price * 9_500n) / 10_000n, endTs, seed: 25_000_000n, name: "debug cover" });
  await send(prot.ixs, kp);
  const afterProt = await bal();
  const th = await createThesisInstruction(c, { creator: kp.publicKey, conviction: conv.touchMarket, protection: prot.touchMarket, textHash: await sha256("debug") });
  await send([th.ix], kp);
  const end = await bal();
  console.log(JSON.stringify({ conviction: +(start - afterConv).toFixed(4), protection: +(afterConv - afterProt).toFixed(4), thesis: +(afterProt - end).toFixed(4), total: +(start - end).toFixed(4) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
