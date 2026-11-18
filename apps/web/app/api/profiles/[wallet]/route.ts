import { profile } from "@thesis/db";
import { bad, db, env, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/profiles/:wallet — raw numbers and thesis history. */
export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!pubkey(wallet)) return bad("not a valid address");
  return json(await profile(db(), wallet, env.creatorShareBps), 200, 10);
}
