/** Admin: point Config.keeper at a new key. tsx scripts/set-keeper.ts <pubkey> */
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeCtx } from "../services/worker/src/client";

async function main() {
  const keeper = new PublicKey(process.argv[2]);
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
  const ctx = makeCtx(process.env.RPC_URL ?? "https://api.devnet.solana.com", admin);
  const sig = await ctx.program.methods
    .updateConfig({
      admin: null, keeper, creatorShareBps: null, lpRebateBps: null, graceSecs: null, maxConfBps: null,
      minSeedPerMarket: null, maxSeedPerMarket: null, maxCoverPerWallet: null, sponsorBudget: null,
      maxVolAgeSecs: null, maxSpotAgeSecs: null, minStrikeDistanceBps: null, maxStrikeDistanceBps: null,
      minOpenBps: null, maxOpenBps: null, paused: null,
    })
    .accountsPartial({ admin: admin.publicKey, config: ctx.config })
    .rpc({ commitment: "confirmed" });
  const c = await ctx.program.account.config.fetch(ctx.config);
  console.log("keeper set", c.keeper.toBase58(), sig);
}
main().catch((e) => { console.error(e); process.exit(1); });
