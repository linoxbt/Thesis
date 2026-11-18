/**
 * Seeds a local validator (cloning devnet pm-AMM) with a few theses and
 * trades, through the same instruction builders the web app uses. For UI
 * development and the Playwright run; never points at devnet or mainnet.
 *
 *   RPC_URL=http://127.0.0.1:8899 DATABASE_URL=... tsx scripts/local-seed.ts
 */
import { BN } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connect, setThesisText } from "@thesis/db";
import { decodePriceUpdateV2, SOL_USD_FEED_ID, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  createMarketInstructions, createThesisInstruction, sha256, tradeInstructions,
} from "../apps/web/lib/client/actions";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("local-seed only runs against a local validator");
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const USDC = 1_000_000;

async function main() {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
  const ctx = makeCtx(RPC, admin);
  const { connection, program, config, authority } = ctx;
  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = [admin]) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(...signers);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  };
  const treasury = getAssociatedTokenAddressSync(MUSDC, authority, true);
  const adminUsdc = getAssociatedTokenAddressSync(MUSDC, admin.publicKey);

  if (!(await connection.getAccountInfo(config))) {
    await program.methods
      .initializeConfig({
        keeper: admin.publicKey,
        solUsdFeedId: [...Buffer.from(SOL_USD_FEED_ID, "hex")],
        creatorShareBps: 5000,
        graceSecs: 120,
        maxConfBps: 50,
        minSeedPerMarket: new BN(USDC),
        maxSeedPerMarket: new BN(100 * USDC),
        maxCoverPerWallet: new BN(250 * USDC),
        sponsorBudget: new BN(100 * USDC),
        solVolBps: 6000,
        maxVolAgeSecs: 3 * 86_400,
        maxSpotAgeSecs: 86_400, // local: the cloned Pyth account doesn't update
        minStrikeDistanceBps: 50,
        maxStrikeDistanceBps: 5_000,
        minOpenBps: 100,
        maxOpenBps: 9_900,
        authorityFunding: new BN(0.5e9),
      })
      .accountsPartial({ admin: admin.publicKey, config, authority, usdcMint: MUSDC, treasury })
      .rpc();
    await send([createTransferInstruction(adminUsdc, treasury, admin.publicKey, 100 * USDC)]);
    console.log("config initialised");
  }

  const spot = decodePriceUpdateV2((await connection.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
  const at = (pct: number) => (spot.price * BigInt(Math.round(10_000 + pct * 100))) / 10_000n;
  const now = Math.floor(Date.now() / 1000);

  const theses: { pda: PublicKey; conviction: { touch: PublicKey; pm: PublicKey }; protection?: { touch: PublicKey; pm: PublicKey }; text: string }[] = [];
  const plan = [
    { dir: "above" as const, pct: 3, window: 172_800, protect: -5, text: "ETF flows plus a short squeeze: SOL tags the range high this week." },
    { dir: "below" as const, pct: -4, window: 86_400, protect: undefined, text: "Unlock overhang; I'm short into Friday." },
    { dir: "above" as const, pct: 0.6, window: 600, protect: undefined, text: "Ten-minute demo market: a quick tap of the high." },
  ];
  for (const p of plan) {
    const endTs = now + p.window;
    const conv = await createMarketInstructions(connection, {
      creator: admin.publicKey, usdcMint: MUSDC, direction: p.dir, strike: at(p.pct), endTs, seed: 25n * BigInt(USDC), name: `seed ${p.pct}`,
    });
    await send(conv.ixs);
    let prot: { touch: PublicKey; pm: PublicKey } | undefined;
    if (p.protect !== undefined) {
      const m = await createMarketInstructions(connection, {
        creator: admin.publicKey, usdcMint: MUSDC, direction: p.dir === "above" ? "below" : "above", strike: at(p.protect), endTs, seed: 25n * BigInt(USDC), name: "seed cover",
      });
      await send(m.ixs);
      prot = { touch: m.touchMarket, pm: m.pmMarket };
    }
    const th = await createThesisInstruction(connection, {
      creator: admin.publicKey, conviction: conv.touchMarket, protection: prot?.touch ?? null, textHash: await sha256(p.text),
    });
    await send([th.ix]);
    theses.push({ pda: th.thesis, conviction: { touch: conv.touchMarket, pm: conv.pmMarket }, protection: prot, text: p.text });
    console.log(`thesis ${th.thesis.toBase58()} (${p.dir} ${p.pct}%, ${p.window}s${prot ? ", protected" : ""})`);
  }

  // A few followers trade through Thesis.
  for (let i = 0; i < 3; i++) {
    const kp = Keypair.generate();
    await send([
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: 0.2 * LAMPORTS_PER_SOL }),
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, getAssociatedTokenAddressSync(MUSDC, kp.publicKey), kp.publicKey, MUSDC),
      createTransferInstruction(adminUsdc, getAssociatedTokenAddressSync(MUSDC, kp.publicKey), admin.publicKey, 40 * USDC),
    ]);
    for (const [j, t] of theses.entries()) {
      const side = (i + j) % 3 === 0 ? "buy_no" : "buy_yes";
      const ixs = await tradeInstructions(connection, {
        trader: kp.publicKey, usdcMint: MUSDC, thesis: t.pda, thesisCreator: admin.publicKey,
        touchMarket: t.conviction.touch, pmMarket: t.conviction.pm, side, amountIn: BigInt((2 + i) * USDC), minOutput: 0n,
      });
      await send(ixs, [kp]);
    }
    if (theses[0].protection) {
      const ixs = await tradeInstructions(connection, {
        trader: kp.publicKey, usdcMint: MUSDC, thesis: theses[0].pda, thesisCreator: admin.publicKey,
        touchMarket: theses[0].protection.touch, pmMarket: theses[0].protection.pm, side: "buy_yes", amountIn: BigInt(USDC), minOutput: 0n,
      });
      await send(ixs, [kp]);
    }
  }
  console.log("trades done");

  // Store the texts once the indexer has the theses.
  if (process.env.DATABASE_URL) {
    const db = connect();
    for (const t of theses) {
      for (let i = 0; i < 40; i++) {
        const r = await setThesisText(db, t.pda.toBase58(), t.text);
        if (r === "ok") break;
        if (r === "hash_mismatch") throw new Error("hash mismatch");
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    await db.end();
    console.log("texts stored");
  }
  console.log(JSON.stringify({ theses: theses.map((t) => t.pda.toBase58()), spot: spot.price.toString() }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
