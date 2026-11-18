import { stats } from "@thesis/db";
import { db, env, hasDb, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/stats — public traction numbers, team wallets excluded. */
const EMPTY = {
  wallets: "0", trades: "0", volume_usdc: "0", volume_via_thesis_usdc: "0", fees_to_treasury_usdc: "0",
  theses: "0", creators: "0", cover_bought_usdc: "0", payouts_usdc: "0", touches_proven: 0, touches: [],
};

export async function GET() {
  if (!hasDb()) return json({ cluster: env.cluster, ...EMPTY, indexer: false });
  return json({ cluster: env.cluster, ...(await stats(db(), env.teamWallets)) }, 200, 30);
}
