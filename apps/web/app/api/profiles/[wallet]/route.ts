import { profile } from "@thesis/db";
import { bad, db, env, hasDb, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/profiles/:wallet — raw numbers and thesis history. */
export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!pubkey(wallet)) return bad("not a valid address");
  if (!hasDb()) {
    return json({ wallet, profile: null, stats: null, fees_earned: "0", protection_bought_usdc: "0", protection_paid_out_usdc: "0", history: [], indexer: false });
  }
  return json(await profile(db(), wallet, env.creatorShareBps), 200, 10);
}
