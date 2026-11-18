import { feed, type FeedSort } from "@thesis/db";
import { bad, db, hasDb, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/theses?sort=hot|new|ending&limit=50 — the feed. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sort = (url.searchParams.get("sort") ?? "hot") as FeedSort;
  if (!["hot", "new", "ending"].includes(sort)) return bad("sort must be hot, new or ending");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1) return bad("limit must be a positive integer");
  if (!hasDb()) return json({ sort, theses: [], indexer: false });
  return json({ sort, theses: await feed(db(), { sort, limit }) }, 200, 5);
}
