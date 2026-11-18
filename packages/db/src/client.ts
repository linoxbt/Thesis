import { Pool } from "pg";

/** The subset of node-postgres every query here needs. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function connect(url = process.env.DATABASE_URL): Pool {
  if (!url) throw new Error("DATABASE_URL is not set");
  const ssl = /sslmode=require|supabase\.co/.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl, max: 5 });
}
