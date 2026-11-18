/**
 * Posts a few house calls on devnet, seeded from the treasury (sponsored,
 * within Config.sponsor_budget) and labelled as the Thesis team's in their
 * text. No synthetic traders or trades: every trade on them is a real user's.
 *
 *   RPC_URL=https://api.devnet.solana.com SITE=https://thesis-calls.netlify.app tsx scripts/devnet-seed.ts
 *
 * The admin key (~/.config/solana/id.json or ADMIN_KEYPAIR) signs; it must be
 * the config admin or keeper.
 */
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { decodePriceUpdateV2, openingPriceBps, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createMarketInstructions, createThesisInstruction, sha256 } from "../apps/web/lib/client/actions";
import { makeCtx } from "../services/worker/src/client";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const SITE = process.env.SITE ?? "https://thesis-calls.netlify.app";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const USDC = 1_000_000n;
const SEED = 20n * USDC;
const DAY = 86_400;

const PLAN: { dir: "above" | "below"; pct: number; window: number; protect?: number; text: (strike: string) => string }[] = [
  {
    dir: "above",
    pct: 4,
    window: 7 * DAY,
    protect: -8,
    text: (k) => `House call (Thesis team): SOL tags $${k} within the week. Demo market seeded from the treasury; protection opened at the long's stop.`,
  },
  {
    dir: "below",
    pct: -5,
    window: 3 * DAY,
    text: (k) => `House call (Thesis team): SOL trades down to $${k} in the next three days. Demo market seeded from the treasury.`,
  },
  {
    dir: "above",
    pct: 2,
    window: 2 * DAY,
    text: (k) => `House call (Thesis team): a quick push to $${k} inside 48 hours. Demo market seeded from the treasury.`,
  },
];

async function main() {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
  const ctx = makeCtx(RPC, admin);
  const { connection, program, config } = ctx;
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new Error("devnet-seed only runs against devnet");

  const cfg = await program.account.config.fetch(config);
  const budget = BigInt(cfg.sponsorBudget.toString());
  const markets = PLAN.reduce((n, p) => n + (p.protect === undefined ? 1 : 2), 0);
  if (budget < SEED * BigInt(markets)) throw new Error(`sponsor budget ${budget / USDC} mUSDC < ${(SEED * BigInt(markets)) / USDC} needed`);

  const send = async (ixs: TransactionInstruction[]) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = admin.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(admin);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  };

  const spot = decodePriceUpdateV2((await connection.getAccountInfo(SOL_USD_PRICE_ACCOUNT))!.data);
  const age = Math.floor(Date.now() / 1000) - spot.publishTime;
  console.log(`spot $${(Number(spot.price) * 10 ** spot.expo).toFixed(2)}, ${age}s old (max ${cfg.maxSpotAgeSecs}s)`);
  if (age > Number(cfg.maxSpotAgeSecs)) throw new Error("spot too old; wait for the next sponsored Pyth update");
  const at = (pct: number) => (spot.price * BigInt(Math.round(10_000 + pct * 100))) / 10_000n;
  const fmt = (p: bigint) => (Number(p) * 10 ** spot.expo).toFixed(2);

  const posted: { pda: string; text: string }[] = [];
  for (const p of PLAN) {
    const endTs = Math.floor(Date.now() / 1000) + p.window;
    const strike = at(p.pct);
    const odds = openingPriceBps(Number(spot.price), Number(strike), cfg.solVolBps, p.window);
    if (odds === null || odds < cfg.minOpenBps || odds > cfg.maxOpenBps) throw new Error(`opening odds ${odds} bps outside the allowed range`);
    console.log(`\n${p.dir} ${fmt(strike)} (${p.pct}%), ${p.window / DAY}d, opening ${(odds / 100).toFixed(2)}%`);
    const conv = await createMarketInstructions(connection, {
      creator: admin.publicKey, usdcMint: MUSDC, direction: p.dir, strike, endTs, seed: SEED, name: `House ${p.dir} ${fmt(strike)}`, sponsored: true,
    });
    console.log("  conviction", conv.touchMarket.toBase58(), await send(conv.ixs));
    let prot: PublicKey | null = null;
    if (p.protect !== undefined) {
      const k = at(p.protect);
      const m = await createMarketInstructions(connection, {
        creator: admin.publicKey, usdcMint: MUSDC, direction: p.dir === "above" ? "below" : "above", strike: k, endTs, seed: SEED, name: `House cover ${fmt(k)}`, sponsored: true,
      });
      console.log("  protection", m.touchMarket.toBase58(), fmt(k), await send(m.ixs));
      prot = m.touchMarket;
    }
    const text = p.text(fmt(strike));
    const th = await createThesisInstruction(connection, { creator: admin.publicKey, conviction: conv.touchMarket, protection: prot, textHash: await sha256(text) });
    console.log("  thesis", th.thesis.toBase58(), await send([th.ix]));
    posted.push({ pda: th.thesis.toBase58(), text });
  }

  // Texts go through the public API, which accepts them only if they hash to
  // the onchain text_hash. Retry until the indexer has picked the theses up.
  for (const t of posted) {
    for (let i = 0; ; i++) {
      const r = await fetch(`${SITE}/api/theses/${t.pda}/text`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t.text }) });
      if (r.ok) {
        console.log("text stored", t.pda);
        break;
      }
      if (r.status !== 404 || i > 30) throw new Error(`text for ${t.pda}: HTTP ${r.status} ${await r.text()}`);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
  const after = await program.account.config.fetch(config);
  console.log(`\nsponsor budget left: ${BigInt(after.sponsorBudget.toString()) / USDC} mUSDC`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
