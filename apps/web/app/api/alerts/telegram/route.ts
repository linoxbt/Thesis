import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import { createLinkCode, telegramLink, unlinkWallet, useSignatureOnce } from "@thesis/db";
import { ALERTS_MAX_AGE_SECS, alertsMessage, type AlertsAction } from "@/lib/alertsMessage";
import { bad, db, hasDb, json, limited, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

const BOT = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;

/**
 * GET /api/alerts/telegram?wallet=… — is alerts set up here, and is this
 * wallet linked? Unsigned, so it never says which Telegram account.
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
  if (!pubkey(wallet)) return bad("not a valid address");
  if (!BOT || !hasDb()) return json({ configured: false, linked: false });
  const link = await telegramLink(db(), wallet);
  return json({ configured: true, bot: BOT, linked: !!link });
}

function verify(wallet: string, action: AlertsAction, issuedAt: unknown, signature: unknown): string | null {
  if (typeof issuedAt !== "number" || !Number.isInteger(issuedAt) || typeof signature !== "string") return "issued_at and signature are required";
  if (Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > ALERTS_MAX_AGE_SECS) return "signature expired; sign again";
  try {
    const sig = Buffer.from(signature, "base64");
    const ok = sig.length === 64 && ed25519.verify(sig, new TextEncoder().encode(alertsMessage(wallet, action, issuedAt)), new PublicKey(wallet).toBytes());
    return ok ? null : "signature does not match this wallet";
  } catch {
    return "signature does not match this wallet";
  }
}

/**
 * POST /api/alerts/telegram {wallet, action: "connect"|"disconnect", issued_at, signature}
 * connect: returns a one-time t.me deep link (valid 15 min) that links the chat to the wallet.
 * disconnect: unlinks. Both need an ed25519 signature from the wallet over alertsMessage().
 */
export async function POST(req: Request) {
  if (!BOT || !hasDb()) return bad("Telegram alerts aren't set up on this deployment", 503);
  const slow = await limited(req, "telegram", 20, 600);
  if (slow) return slow;
  const b = (await req.json().catch(() => null)) as { wallet?: string; action?: string; issued_at?: unknown; signature?: unknown } | null;
  const wallet = b?.wallet ?? "";
  if (!pubkey(wallet)) return bad("not a valid address");
  const action = b?.action === "disconnect" ? "disconnect" : b?.action === "connect" ? "connect" : null;
  if (!action) return bad("action must be connect or disconnect");
  const err = verify(wallet, action, b?.issued_at, b?.signature);
  if (err) return bad(err, 401);
  // Each signed request works once: a captured one can't be replayed to relink.
  if (!(await useSignatureOnce(db(), String(b?.signature), `telegram:${action}`))) return bad("this signature was already used; sign again", 409);
  if (action === "disconnect") return json({ ok: true, unlinked: await unlinkWallet(db(), wallet) });
  const code = await createLinkCode(db(), wallet);
  return json({ ok: true, url: `https://t.me/${BOT}?start=${code}` });
}
