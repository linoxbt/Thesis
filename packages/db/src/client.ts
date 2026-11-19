import { Pool, type PoolConfig } from "pg";

/** The subset of node-postgres every query here needs. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Hosts reached over a private network, where Postgres usually has no TLS. */
const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|::1|\[::1\]|[^.]+\.railway\.internal|\/.*)$/;

/**
 * TLS for every remote host. Managed Postgres (Railway's proxy, Supabase)
 * uses certificates Node can't verify, so the connection is encrypted but the
 * certificate is only checked with DATABASE_SSL=verify. `sslmode=disable` in
 * the URL or DATABASE_SSL=off turns it off.
 */
export function sslFor(url: string, mode = process.env.DATABASE_SSL): PoolConfig["ssl"] {
  if (mode === "off" || /sslmode=disable/.test(url)) return undefined;
  if (mode === "verify") return { rejectUnauthorized: true };
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (!host || PRIVATE_HOST.test(host)) return undefined;
  return { rejectUnauthorized: false };
}

export function connect(url = process.env.DATABASE_URL): Pool {
  if (!url) throw new Error("DATABASE_URL is not set");
  // pg reads sslmode from the URL too and it overrides `ssl`; strip it.
  const clean = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const pool = new Pool({ connectionString: clean, ssl: sslFor(url), max: 5 });
  // An idle client dropped by the server must not crash the process.
  pool.on("error", (e) => console.error(`[db] idle client error: ${e.message}`));
  return pool;
}

/** True for URLs pointing at this machine (destructive tests only run there). */
export function isLocalUrl(url: string): boolean {
  try {
    return /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
