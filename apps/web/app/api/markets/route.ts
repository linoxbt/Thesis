import { nearbyCoverMarkets } from "@thesis/db";
import { bad, db, hasDb, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets?direction=below&strike=<pyth units>&end_after=<unix>[&bps=50]
 * — open cover markets near a level, so Protect can reuse a pool.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const direction = q.get("direction");
  if (direction !== "above" && direction !== "below") return bad("direction must be above or below");
  const strikeRaw = q.get("strike") ?? "";
  if (!/^\d{1,19}$/.test(strikeRaw)) return bad("strike must be a positive integer in Pyth units");
  const endAfter = Number(q.get("end_after") ?? "0");
  const bps = Math.min(Math.max(Number(q.get("bps") ?? "50"), 1), 500);
  if (!Number.isFinite(endAfter) || !Number.isFinite(bps)) return bad("bad end_after or bps");
  if (!hasDb()) return json({ markets: [] });
  const markets = await nearbyCoverMarkets(db(), {
    direction,
    strike: BigInt(strikeRaw),
    bps,
    minEndTs: Math.floor(endAfter),
    now: Math.floor(Date.now() / 1000),
  });
  return json({ markets }, 200, 10);
}
