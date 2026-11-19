import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { getCursor, isLocalUrl, migrate, openIndexFailures, Pool } from "@thesis/db";
import type { Ctx } from "../src/client";
import { Indexer } from "../src/indexer";
import { THESIS_IDL } from "@thesis/chain";

const BASE = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5433";
if (!isLocalUrl(BASE) && process.env.ALLOW_REMOTE_TEST_DB !== "1") throw new Error(`refusing to run destructive tests against ${BASE}`);
const DB_NAME = "thesis_test_indexer";
let db: Pool;

before(async () => {
  const admin = new Pool({ connectionString: `${BASE}/postgres` });
  await admin.query(`drop database if exists ${DB_NAME}`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  db = new Pool({ connectionString: `${BASE}/${DB_NAME}` });
  await migrate(db);
});
after(() => db.end());

/** Fake RPC: three new signatures; what getTransaction returns is scripted. */
function rig() {
  const served = new Map<string, boolean>([["s1", true], ["s2", true], ["s3", false]]);
  const broken = new Set(["s2"]);
  const handled: string[] = [];
  const ctx = {
    program: { programId: new PublicKey(THESIS_IDL.address), idl: THESIS_IDL },
    authority: Keypair.generate().publicKey,
    connection: {
      // Newest first, like the RPC.
      getSignaturesForAddress: async (_a: PublicKey, o: { until?: string }) => {
        const all = ["s3", "s2", "s1"];
        const cut = o.until ? all.indexOf(o.until) : all.length;
        return all.slice(0, cut).map((signature) => ({ signature, err: null }));
      },
      getTransaction: async (sig: string) => (served.get(sig) ? ({ meta: { logMessages: [] } } as unknown as VersionedTransactionResponse) : null),
    },
  } as unknown as Ctx;
  class TestIndexer extends Indexer {
    override async indexProgramTx(sig: string): Promise<void> {
      if (broken.has(sig)) throw new Error(`cannot decode ${sig}`);
      handled.push(sig);
    }
  }
  return { ix: new TestIndexer(ctx, db, { intervalMs: 60_000, priceSampleSecs: 30 }), served, broken, handled };
}

test("a bad transaction is set aside; an unserved one holds the cursor", async () => {
  const r = rig();
  await r.ix.syncProgramTransactions();
  assert.deepEqual(r.handled, ["s1"]);
  assert.equal(await getCursor(db, "program"), "s2", "past the bad one, stopped before the unserved one");
  assert.deepEqual((await openIndexFailures(db)).map((f) => f.signature), ["s2"]);

  // The RPC catches up and the decoder is fixed: everything lands.
  r.served.set("s3", true);
  r.broken.clear();
  await r.ix.syncProgramTransactions();
  await r.ix.retryFailures();
  assert.deepEqual(r.handled, ["s1", "s3", "s2"]);
  assert.equal(await getCursor(db, "program"), "s3");
  assert.deepEqual(await openIndexFailures(db), []);
});
