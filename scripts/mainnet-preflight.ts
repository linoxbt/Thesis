/**
 * Read-only mainnet readiness check. Sends no transactions.
 *
 *   RPC_URL=https://api.mainnet-beta.solana.com tsx scripts/mainnet-preflight.ts [deployer]
 *
 * Checks the programs and accounts Thesis depends on, the freshness and
 * confidence of the sponsored Pyth SOL/USD account, the pm-AMM DAO's USDC
 * account (fee recipient), and what deploying would cost in SOL.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { decodePriceUpdateV2, PM_AMM_PROGRAM_ID, PROTOCOL_DAO, PYTH_RECEIVER, SOL_USD_FEED_ID, SOL_USD_PRICE_ACCOUNT, THESIS_PROGRAM_ID } from "@thesis/chain";
import { statSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SO = "target/deploy/thesis.so";

type Row = [string, boolean, string];
const rows: Row[] = [];
const ok = (k: string, pass: boolean, note = "") => rows.push([k, pass, note]);

async function main() {
  const c = new Connection(RPC, "confirmed");
  const genesis = await c.getGenesisHash();
  const mainnet = genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  ok("RPC is mainnet-beta", mainnet, genesis.slice(0, 8));

  for (const [name, id, exec] of [
    ["pm-AMM program", PM_AMM_PROGRAM_ID, true],
    ["Pyth receiver", PYTH_RECEIVER, true],
    ["Metaplex token metadata", METAPLEX, true],
    ["USDC mint", USDC, false],
  ] as const) {
    const a = await c.getAccountInfo(id);
    ok(name, !!a && a.executable === exec, a ? `owner ${a.owner.toBase58().slice(0, 6)}…` : "missing");
  }

  const thesis = await c.getAccountInfo(THESIS_PROGRAM_ID);
  ok("Thesis program id free or ours", true, thesis ? `already deployed (owner ${thesis.owner.toBase58().slice(0, 6)}…)` : "not deployed yet");

  const pa = await c.getAccountInfo(SOL_USD_PRICE_ACCOUNT);
  if (!pa) ok("Pyth SOL/USD sponsored account", false, "missing");
  else {
    const t = decodePriceUpdateV2(pa.data);
    const age = Math.round(Date.now() / 1000 - t.publishTime);
    const confBps = Number((t.conf * 10_000n) / t.price);
    ok("SOL/USD account owned by receiver", pa.owner.equals(PYTH_RECEIVER));
    ok("SOL/USD feed id", t.feedId.toString("hex") === SOL_USD_FEED_ID, t.feedId.toString("hex").slice(0, 8));
    ok("SOL/USD fully verified", t.fullyVerified);
    ok("SOL/USD fresh (< 120 s)", age < 120, `${age}s old, $${(Number(t.price) * 10 ** t.expo).toFixed(2)}`);
    ok("SOL/USD confidence <= 50 bps", confBps <= 50, `${confBps} bps`);
  }

  const daoUsdc = getAssociatedTokenAddressSync(USDC, PROTOCOL_DAO, true);
  const dao = await c.getAccountInfo(daoUsdc);
  ok("pm-AMM DAO USDC account (fee recipient)", !!dao, dao ? daoUsdc.toBase58().slice(0, 8) + "…" : "missing: creating it costs ~0.002 SOL");

  const soLen = statSync(SO).size;
  const maxLen = 440_000;
  const rent = await c.getMinimumBalanceForRentExemption(maxLen + 45);
  const configRent = await c.getMinimumBalanceForRentExemption(400);
  const deployer = process.argv[2] ? new PublicKey(process.argv[2]) : null;
  const need = rent * 2 + configRent + 0.5 * LAMPORTS_PER_SOL + 0.05 * LAMPORTS_PER_SOL;
  ok("Program binary", soLen < maxLen, `${(soLen / 1000).toFixed(0)} KB (max-len ${maxLen / 1000} KB)`);
  if (deployer) {
    const bal = await c.getBalance(deployer);
    ok("Deployer balance covers deploy", bal >= need, `${(bal / 1e9).toFixed(3)} / ${(need / 1e9).toFixed(3)} SOL`);
  }

  for (const [k, p, n] of rows) console.log(`${p ? "PASS" : "FAIL"}  ${k.padEnd(40)} ${n}`);
  console.log(
    `\nCost: program data ${(rent / 1e9).toFixed(3)} SOL (kept), deploy buffer ${(rent / 1e9).toFixed(3)} SOL (refunded), ` +
      `config ${(configRent / 1e9).toFixed(4)} SOL, authority PDA funding 0.5 SOL, fees ~0.05 SOL. ` +
      `Peak need ≈ ${(need / 1e9).toFixed(2)} SOL; ≈ ${((rent + configRent + 0.55e9) / 1e9).toFixed(2)} SOL stays locked.`,
  );
  process.exit(rows.every((r) => r[1]) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
