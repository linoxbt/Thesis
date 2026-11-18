import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { faucetAllowance, recordFaucetClaim } from "@thesis/db";
import { readFileSync } from "node:fs";
import { connection, fetchConfig } from "@/lib/chain";
import { bad, db, env, hasDb, json, pubkey } from "@/lib/server";

/** What an instant wallet needs: trades plus posting a protected trade (~0.08 SOL of market rent). */
const SOL_TARGET = 0.15 * LAMPORTS_PER_SOL;
const SOL_LOW = 0.05 * LAMPORTS_PER_SOL;

export const dynamic = "force-dynamic";

/**
 * POST /api/faucet {wallet} — devnet only.
 *
 * Hosted: test USDC from the pm-AMM faucet (1,000 mUSDC per wallet per hour;
 * its SOL drip is often empty), then SOL from this site's own faucet key
 * (FAUCET_SECRET_KEY, a devnet-only hot key): wallets under 0.05 SOL are
 * topped up to 0.15 SOL, at most once per wallet per 12h and
 * FAUCET_DAILY_SOL (default 3) per day overall.
 * Local: set DEV_FAUCET_KEYPAIR to a funded keypair file; the route then
 * sends 0.15 SOL and 100 mUSDC itself.
 */
export async function POST(req: Request) {
  if (env.cluster !== "devnet") return bad("faucet is devnet only", 404);
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = pubkey(body?.wallet);
  if (!wallet) return bad("wallet must be a valid address");

  const devKey = process.env.DEV_FAUCET_KEYPAIR;
  if (devKey) {
    try {
      return await localFaucet(wallet, devKey);
    } catch (e) {
      const msg = (e as Error).message;
      return bad(/insufficient/i.test(msg) ? "Local faucet is out of test USDC" : `Local faucet failed: ${msg.split("\n")[0]}`, 503);
    }
  }

  const r = await fetch(env.faucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58() }),
  });
  const data = (await r.json().catch(() => ({ error: `faucet returned ${r.status}` }))) as Record<string, unknown>;
  const sol = await solDrip(wallet).catch((e) => ({ sol: 0, solError: (e as Error).message.split("\n")[0] }));
  // Succeed if either half delivered: USDC from pm-AMM or SOL from us.
  const ok = r.ok || sol.sol > 0;
  // pm-AMM's own SOL fields describe its drip, not ours.
  delete data.sol;
  delete data.solSkipped;
  return json({ ...data, ...sol, ok }, ok ? 200 : r.status);
}

/** Tops a low wallet up to SOL_TARGET from FAUCET_SECRET_KEY, within the limits. */
async function solDrip(wallet: PublicKey): Promise<{ sol: number; solSkipped?: string; solSignature?: string }> {
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret || !hasDb()) return { sol: 0, solSkipped: "not configured" };
  const have = await connection.getBalance(wallet);
  if (have >= SOL_LOW) return { sol: 0, solSkipped: "enough SOL" };
  const want = BigInt(SOL_TARGET - have);
  const allowed = await faucetAllowance(db(), wallet.toBase58(), want, {
    perWalletHours: 12,
    dailyLamports: BigInt(Math.round(Number(process.env.FAUCET_DAILY_SOL ?? "3") * LAMPORTS_PER_SOL)),
  });
  if (!allowed.ok) return { sol: 0, solSkipped: allowed.reason };
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  // Record first so concurrent requests can't both pass the limit check twice.
  await recordFaucetClaim(db(), wallet.toBase58(), want);
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wallet, lamports: Number(want) }));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const solSignature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(solSignature, "confirmed");
  return { sol: Number(want) / LAMPORTS_PER_SOL, solSignature };
}

async function localFaucet(wallet: PublicKey, keyPath: string) {
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
  const config = await fetchConfig();
  if (!config) return bad("program not initialised", 503);
  const mint: PublicKey = config.usdc_mint;
  const from = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const to = getAssociatedTokenAddressSync(mint, wallet);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wallet, lamports: SOL_TARGET }),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, to, wallet, mint),
    createTransferInstruction(from, to, payer.publicKey, 100_000_000),
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  return json({ ok: true, signature, amount: 100, sol: SOL_TARGET / LAMPORTS_PER_SOL, local: true });
}
