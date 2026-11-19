import { marketDetail } from "@thesis/db";
import { bad, db, hasDb, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/markets/:touchMarket — one market, its prices and recent trades. */
export async function GET(_req: Request, { params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  if (!pubkey(market)) return bad("not a valid address");
  if (!hasDb()) return bad("the indexer is not running yet", 503);
  const detail = await marketDetail(db(), market);
  return detail ? json(detail, 200, 5) : bad("market not found (it may still be indexing)", 404);
}
