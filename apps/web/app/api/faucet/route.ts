import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { connection, fetchConfig } from "@/lib/chain";
import { bad, env, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/faucet {wallet} — devnet only.
 *
 * Normally forwards to the pm-AMM faucet (1,000 mUSDC per wallet per hour,
 * plus a little devnet SOL). For a local validator, set DEV_FAUCET_KEYPAIR to
 * a funded keypair file: the route then sends 0.1 SOL and 200 mUSDC itself.
 */
export async function POST(req: Request) {
  if (env.cluster !== "devnet") return bad("faucet is devnet only", 404);
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = pubkey(body?.wallet);
  if (!wallet) return bad("wallet must be a valid address");

  const devKey = process.env.DEV_FAUCET_KEYPAIR;
  if (devKey) return localFaucet(wallet, devKey);

  const r = await fetch(env.faucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58() }),
  });
  const data = await r.json().catch(() => ({ error: `faucet returned ${r.status}` }));
  return json(data, r.status);
}

async function localFaucet(wallet: PublicKey, keyPath: string) {
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
  const config = await fetchConfig();
  if (!config) return bad("program not initialised", 503);
  const mint: PublicKey = config.usdc_mint;
  const from = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const to = getAssociatedTokenAddressSync(mint, wallet);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wallet, lamports: 0.1 * LAMPORTS_PER_SOL }),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, to, wallet, mint),
    createTransferInstruction(from, to, payer.publicKey, 200_000_000),
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  return json({ ok: true, signature, amount: 200, sol: 0.1, local: true });
}
