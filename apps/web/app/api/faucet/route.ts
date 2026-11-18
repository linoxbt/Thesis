import { bad, env, json, pubkey } from "@/lib/server";

/**
 * POST /api/faucet {wallet} — devnet only. Forwards to the pm-AMM faucet:
 * 1,000 mUSDC per wallet per hour (plus a little devnet SOL when enabled).
 */
export async function POST(req: Request) {
  if (env.cluster !== "devnet") return bad("faucet is devnet only", 404);
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = pubkey(body?.wallet);
  if (!wallet) return bad("wallet must be a valid address");
  const r = await fetch(env.faucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58() }),
  });
  const data = await r.json().catch(() => ({ error: `faucet returned ${r.status}` }));
  return json(data, r.status);
}
