import { setThesisText } from "@thesis/db";
import { bad, db, json, pubkey } from "@/lib/server";

/**
 * POST /api/theses/:pda/text {text} — store the thesis text. Accepted only if
 * sha256(text) equals the text_hash written onchain by create_thesis, so no
 * signature is needed: only the original text can be stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  if (!pubkey(pda)) return bad("not a valid address");
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string" || body.text.length === 0 || body.text.length > 500) {
    return bad("text must be a string of 1-500 characters");
  }
  const r = await setThesisText(db(), pda, body.text);
  if (r === "not_found") return bad("thesis not indexed yet; retry in a few seconds", 404);
  if (r === "hash_mismatch") return bad("text does not match the onchain hash", 409);
  return json({ ok: true });
}
