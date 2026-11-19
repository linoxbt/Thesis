import { skillLeaderboard } from "@thesis/db";
import { bad, db, env, hasDb, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard?period=week|all — creators ranked by skill score (team wallets excluded). */
export async function GET(req: Request) {
  const period = new URL(req.url).searchParams.get("period") ?? "all";
  if (period !== "week" && period !== "all") return bad("period must be week or all");
  if (!hasDb()) return json({ period, rows: [], indexer: false });
  const sinceTs = period === "week" ? Math.floor(Date.now() / 1000) - 7 * 86_400 : 0;
  const rows = await skillLeaderboard(db(), { sinceTs, teamWallets: env.teamWallets, limit: 100 });
  return json({ period, rows }, 200, 30);
}
