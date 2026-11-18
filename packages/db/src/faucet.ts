import type { Db } from "./client";

/**
 * Whether the faucet may drip SOL to `wallet` now: no drip to it in the last
 * `perWalletHours`, and the last 24h total stays within `dailyLamports`.
 */
export async function faucetAllowance(
  db: Db,
  wallet: string,
  want: bigint,
  opts: { perWalletHours: number; dailyLamports: bigint },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const recent = await db.query<{ n: string }>(
    "select count(*)::text as n from faucet_claims where wallet = $1 and claimed_at > now() - make_interval(hours => $2)",
    [wallet, opts.perWalletHours],
  );
  if (Number(recent.rows[0].n) > 0) return { ok: false, reason: `this wallet was topped up in the last ${opts.perWalletHours}h` };
  const day = await db.query<{ total: string }>("select coalesce(sum(lamports), 0)::text as total from faucet_claims where claimed_at > now() - interval '24 hours'");
  if (BigInt(day.rows[0].total) + want > opts.dailyLamports) return { ok: false, reason: "the faucet's daily SOL budget is used up; try again tomorrow" };
  return { ok: true };
}

export async function recordFaucetClaim(db: Db, wallet: string, lamports: bigint): Promise<void> {
  await db.query("insert into faucet_claims (wallet, lamports) values ($1, $2)", [wallet, lamports.toString()]);
}
