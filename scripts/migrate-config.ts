/**
 * One-off, after upgrading a program deployed with the v1 Config: resizes the
 * Config account and records the creator fees already owed (sum over theses
 * of earned - claimed, the same per-thesis rounding as the program).
 *
 *   RPC_URL=https://api.devnet.solana.com tsx scripts/migrate-config.ts          # dry run
 *   RPC_URL=https://api.devnet.solana.com tsx scripts/migrate-config.ts --send   # migrate
 *
 * Signs with ADMIN_KEYPAIR (default ~/.config/solana/id.json).
 */
import { BorshAccountsCoder } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";
import { THESIS_IDL } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEY = process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;

async function main() {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY, "utf8"))));
  const ctx = makeCtx(RPC, admin);
  const coder = new BorshAccountsCoder(THESIS_IDL as never);
  const v2Len = coder.size("Config");
  const info = await ctx.connection.getAccountInfo(ctx.config);
  if (!info) throw new Error("no config account");
  if (info.data.length === v2Len) {
    console.log(JSON.stringify({ status: "already migrated", len: info.data.length }));
    return;
  }
  // A v1 account is the v2 layout minus its tail; zero-pad it to decode.
  const padded = Buffer.concat([info.data, Buffer.alloc(v2Len - info.data.length)]);
  const cfg = coder.decode("Config", padded) as { admin: { toBase58(): string }; creator_share_bps: number };
  if (cfg.admin.toBase58() !== admin.publicKey.toBase58()) throw new Error("signer is not the config admin");

  const share = BigInt(cfg.creator_share_bps);
  let owed = 0n;
  const theses = await ctx.program.account.thesis.all();
  for (const { account: t } of theses) {
    const earned = (BigInt(t.feesAttributed.toString()) * share) / 10_000n;
    const claimed = BigInt(t.feesClaimed.toString());
    owed += earned > claimed ? earned - claimed : 0n;
  }
  console.log(JSON.stringify({ v1Len: info.data.length, v2Len, theses: theses.length, creatorShareBps: Number(share), owedMicroUsdc: owed.toString() }));
  if (!process.argv.includes("--send")) return;

  const sig = await ctx.program.methods
    .migrateConfig(new (await import("@anchor-lang/core")).BN(owed.toString()))
    .accountsPartial({ admin: admin.publicKey, config: ctx.config })
    .rpc();
  const after = await ctx.program.account.config.fetch(ctx.config);
  console.log(JSON.stringify({ migrated: sig, creatorFeesOwed: after.creatorFeesOwed.toString(), pendingAdmin: after.pendingAdmin.toBase58() }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
