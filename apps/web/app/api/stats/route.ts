import { stats } from "@thesis/db";
import { db, env, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/stats — public traction numbers, team wallets excluded. */
export async function GET() {
  return json({ cluster: env.cluster, ...(await stats(db(), env.teamWallets)) }, 200, 30);
}
