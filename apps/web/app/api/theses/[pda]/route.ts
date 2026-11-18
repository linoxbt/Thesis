import { thesisDetail } from "@thesis/db";
import { bad, db, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/theses/:pda — thesis, both markets, recent trades, prices, creator. */
export async function GET(_req: Request, { params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  if (!pubkey(pda)) return bad("not a valid address");
  const detail = await thesisDetail(db(), pda);
  return detail ? json(detail, 200, 5) : bad("thesis not found", 404);
}
