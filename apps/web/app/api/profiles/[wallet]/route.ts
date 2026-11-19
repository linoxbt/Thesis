import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import { profile, saveSignedProfile } from "@thesis/db";
import { cleanProfile, PROFILE_MAX_AGE_SECS, profileMessage } from "@/lib/profileMessage";
import { fetchConfig } from "@/lib/chain";
import { bad, db, env, hasDb, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/profiles/:wallet — raw numbers and thesis history. */
export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!pubkey(wallet)) return bad("not a valid address");
  if (!hasDb()) {
    return json({ wallet, profile: null, stats: null, fees_earned: "0", protection_bought_usdc: "0", protection_paid_out_usdc: "0", history: [], indexer: false });
  }
  // The onchain share (fixed once set); the env value only if the RPC is down.
  const share = (await fetchConfig().catch(() => null))?.creator_share_bps ?? env.creatorShareBps;
  return json(await profile(db(), wallet, share), 200, 10);
}

/**
 * POST /api/profiles/:wallet {display_name, x_handle, issued_at, signature}
 * — set the display name and X handle. Authorised by an ed25519 signature
 * from the wallet over `profileMessage(...)` (base64 signature). The message
 * must be recent and newer than the stored profile, so it can't be replayed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!pubkey(wallet)) return bad("not a valid address");
  if (!hasDb()) return bad("the indexer is not running yet", 503);
  const body = (await req.json().catch(() => null)) as
    | { display_name?: unknown; x_handle?: unknown; issued_at?: unknown; signature?: unknown }
    | null;
  if (typeof body?.display_name !== "string" || typeof body.issued_at !== "number" || typeof body.signature !== "string") {
    return bad("display_name, issued_at and signature are required");
  }
  const fields = cleanProfile(body.display_name, typeof body.x_handle === "string" ? body.x_handle : "");
  if ("error" in fields) return bad(fields.error);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(body.issued_at) || Math.abs(now - body.issued_at) > PROFILE_MAX_AGE_SECS) {
    return bad("signature expired; sign again", 401);
  }
  let sig: Buffer;
  try {
    sig = Buffer.from(body.signature, "base64");
  } catch {
    return bad("bad signature encoding");
  }
  // Verify against exactly what the client was asked to sign (the raw fields).
  const signed = profileMessage(wallet, { displayName: body.display_name, xHandle: typeof body.x_handle === "string" ? body.x_handle : "" }, body.issued_at);
  let valid = false;
  try {
    valid = sig.length === 64 && ed25519.verify(sig, new TextEncoder().encode(signed), new PublicKey(wallet).toBytes());
  } catch {
    valid = false;
  }
  if (!valid) return bad("signature does not match this wallet", 401);
  const saved = await saveSignedProfile(db(), {
    wallet,
    display_name: fields.displayName,
    x_handle: fields.xHandle || null,
    issued_at: body.issued_at,
  });
  if (!saved) return bad("a newer profile edit is already stored", 409);
  return json({ ok: true, display_name: fields.displayName, x_handle: fields.xHandle || null });
}
