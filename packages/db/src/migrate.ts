import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { connect } from "./client";

const DIR = resolve(__dirname, "../migrations");

/** Arbitrary constant for pg_advisory_lock: one migrator at a time. */
const LOCK_ID = 7_446_311;

/**
 * Applies every migrations/*.sql not yet recorded, in name order. Runs on one
 * connection (so each file really is one transaction) under an advisory lock
 * (so two workers starting together don't both apply a file).
 */
export async function migrate(pool: Pool): Promise<string[]> {
  const db = await pool.connect();
  try {
    await db.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await db.query(
      "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await db.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version));
    const applied: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await db.query("begin");
      try {
        await db.query(readFileSync(resolve(DIR, file), "utf8"));
        await db.query("insert into schema_migrations (version) values ($1)", [file]);
        await db.query("commit");
        applied.push(file);
      } catch (e) {
        await db.query("rollback");
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    return applied;
  } finally {
    await db.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    db.release();
  }
}

if (require.main === module) {
  const pool = connect();
  migrate(pool)
    .then((a) => console.log(a.length ? `applied ${a.join(", ")}` : "up to date"))
    .finally(() => pool.end());
}
