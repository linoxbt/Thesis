import "server-only";
import { PublicKey } from "@solana/web3.js";
import { connect } from "@thesis/db";
import type { Pool } from "pg";

/** False until a Postgres (Supabase, Netlify DB…) is attached via DATABASE_URL. */
export const hasDb = () => !!process.env.DATABASE_URL;

const g = globalThis as unknown as { __thesisDb?: Pool };
/** One pool per server process (survives dev hot reloads). */
export function db(): Pool {
  g.__thesisDb ??= connect();
  return g.__thesisDb;
}

export const env = {
  cluster: (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta",
  rpcUrl: process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com",
  teamWallets: (process.env.TEAM_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  creatorShareBps: Number(process.env.CREATOR_SHARE_BPS ?? "5000"),
  // One variable for browser and server (the browser signs creates against it); PYTH_PRICE_ACCOUNT is the old name.
  pythPriceAccount: process.env.NEXT_PUBLIC_PYTH_PRICE_ACCOUNT ?? process.env.PYTH_PRICE_ACCOUNT,
  faucetUrl: process.env.FAUCET_URL ?? "https://pm-amm-devnet.vercel.app/api/faucet",
};

/** A base58 public key or null. */
export function pubkey(s: string | null | undefined): PublicKey | null {
  if (!s) return null;
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

export const json = (data: unknown, status = 200, cacheSecs = 0) =>
  Response.json(data, {
    status,
    headers: cacheSecs ? { "cache-control": `public, s-maxage=${cacheSecs}, stale-while-revalidate=${cacheSecs * 4}` } : {},
  });

export const bad = (message: string, status = 400) => json({ error: message }, status);

/** The caller's IP as the edge saw it (Netlify sets x-nf-client-connection-ip). */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  return h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

/** 429 unless `req`'s IP is under `max` calls of `name` per `windowSecs` (no DB, no limit). */
export async function limited(req: Request, name: string, max: number, windowSecs: number): Promise<Response | null> {
  if (!hasDb()) return null;
  const ip = clientIp(req);
  if (!ip) return null;
  const { hashIp, rateLimit } = await import("@thesis/db");
  const ok = await rateLimit(db(), `${name}:${hashIp(ip)}`, max, windowSecs).catch(() => true);
  return ok ? null : bad("too many requests; wait a minute", 429);
}
