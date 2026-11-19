import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Db } from "./client";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Hashes a client IP for storage (salted so the table can't be reversed with a lookup of all IPv4). */
export const hashIp = (ip: string, salt = process.env.IP_HASH_SALT ?? "thesis") => sha(`${salt}:${ip}`);

export interface FaucetLimits {
  perWalletHours: number;
  /** At most `perIpMax` drips per IP per `perIpHours` (skipped without an IP). */
  perIpHours: number;
  perIpMax: number;
  dailyLamports: bigint;
}

/**
 * Checks every faucet limit and records the claim in one transaction, under
 * a transaction-scoped advisory lock: concurrent requests can't both pass.
 * Returns the claim id (to release it if the transfer then fails).
 */
export async function claimFaucet(
  pool: Pool,
  wallet: string,
  ipHash: string | null,
  lamports: bigint,
  limits: FaucetLimits,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(7446312)");
    const w = await c.query<{ n: string }>(
      "select count(*)::text as n from faucet_claims where wallet = $1 and claimed_at > now() - make_interval(hours => $2)",
      [wallet, limits.perWalletHours],
    );
    if (Number(w.rows[0].n) > 0) {
      await c.query("rollback");
      return { ok: false, reason: `this wallet was topped up in the last ${limits.perWalletHours}h` };
    }
    if (ipHash) {
      const ip = await c.query<{ n: string }>(
        "select count(*)::text as n from faucet_claims where ip_hash = $1 and claimed_at > now() - make_interval(hours => $2)",
        [ipHash, limits.perIpHours],
      );
      if (Number(ip.rows[0].n) >= limits.perIpMax) {
        await c.query("rollback");
        return { ok: false, reason: `this network already received ${limits.perIpMax} top-ups in the last ${limits.perIpHours}h` };
      }
    }
    const day = await c.query<{ total: string }>(
      "select coalesce(sum(lamports), 0)::text as total from faucet_claims where claimed_at > now() - interval '24 hours'",
    );
    if (BigInt(day.rows[0].total) + lamports > limits.dailyLamports) {
      await c.query("rollback");
      return { ok: false, reason: "the faucet's daily SOL budget is used up; try again tomorrow" };
    }
    const r = await c.query<{ id: string }>(
      "insert into faucet_claims (wallet, lamports, ip_hash) values ($1, $2, $3) returning id::text",
      [wallet, lamports.toString(), ipHash],
    );
    await c.query("commit");
    return { ok: true, id: r.rows[0].id };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Gives a claim back when its transfer failed, so the wallet can retry. */
export async function releaseFaucetClaim(db: Db, id: string): Promise<void> {
  await db.query("delete from faucet_claims where id = $1", [id]);
}

/** Records a wallet signature as used; false if it was used before (a replay). */
export async function useSignatureOnce(db: Db, signature: string, purpose: string): Promise<boolean> {
  const r = await db.query("insert into used_signatures (sig_hash, purpose) values ($1, $2) on conflict do nothing returning sig_hash", [
    sha(signature),
    purpose,
  ]);
  return r.rows.length > 0;
}

/**
 * Fixed-window rate limit: true if `key` is still under `max` hits in the
 * current `windowSecs` window. Old windows are swept now and then.
 */
export async function rateLimit(db: Db, key: string, max: number, windowSecs: number, now = Date.now()): Promise<boolean> {
  const windowTs = Math.floor(now / 1000 / windowSecs) * windowSecs;
  const r = await db.query<{ hits: number }>(
    `insert into rate_hits (key, window_ts) values ($1, $2)
     on conflict (key, window_ts) do update set hits = rate_hits.hits + 1
     returning hits`,
    [key, windowTs],
  );
  if (Math.random() < 0.01) await db.query("delete from rate_hits where window_ts < $1", [windowTs - 86_400]);
  return r.rows[0].hits <= max;
}
