// Thesis on QIE keeper. Outcomes don't depend on it (the contract scans oracle
// rounds itself before bets and NO settlements); it makes things prompt:
//   - proves a touch as soon as a crossing oracle round appears (YES settles, winners can claim)
//   - settles calls once their deadline + grace has passed
//   - posts each feed's 7-day realised volatility (posting needs it fresh)
//
//   KEEPER_KEY=0x… CALLS_ADDRESS=0x… RPC_URL=https://rpc1mainnet.qie.digital node scripts/keeper.js [--once]
// KEEPER_KEY falls back to QIE_DEPLOYER_KEY in .env (the deployer is the keeper at launch).
const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");

function envKey() {
  if (process.env.KEEPER_KEY) return process.env.KEEPER_KEY;
  const f = path.join(__dirname, "..", ".env");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").match(/QIE_DEPLOYER_KEY=(\S+)/)?.[1];
  return undefined;
}

const RPC = process.env.RPC_URL ?? "https://rpc1mainnet.qie.digital";
const ADDRESS = process.env.CALLS_ADDRESS;
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? "60000");
const VOL_EVERY_SECS = Number(process.env.VOL_EVERY_SECS ?? String(12 * 3600));
const MIN_GAS_QIE = Number(process.env.MIN_GAS_QIE ?? "0.05");
const YEAR = 31_536_000;

const CALLS_ABI = [
  "function callCount() view returns (uint256)",
  "function getCalls(uint256 from, uint256 count) view returns ((address creator,address feed,bool above,bool touched,bool settled,bool yesWon,uint16 openBps,uint64 start,uint64 end,int256 strike,int256 spotAtOpen,uint80 touchRound,int256 touchPrice,uint80 checkedRound,bool scanDone,uint256 yesPool,uint256 noPool,uint256 volume)[])",
  "function params() view returns (uint16 feeBps,uint64 minSeed,uint64 maxSeed,uint64 minStake,uint32 minWindow,uint32 maxWindow,uint32 grace,uint32 maxOracleAge,uint32 maxVolAge,uint16 minDistanceBps,uint16 maxDistanceBps,uint16 minOpenBps,uint16 maxOpenBps,uint16 betCutoffBps)",
  "function feedCount() view returns (uint256)",
  "function feedList(uint256) view returns (address)",
  "function feeds(address) view returns (bool enabled,uint32 volBps,uint64 volUpdatedAt)",
  "function keeper() view returns (address)",
  "function owner() view returns (address)",
  "function proveTouch(uint256 id, uint80 roundId)",
  "function settle(uint256 id)",
  "function sync(uint256 id, uint256 maxRounds) returns (bool)",
  "function setVolatility(address feed, uint32 volBps)",
  "error SyncRequired()",
  "error AlreadyFinal()",
];
const FEED_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function description() view returns (string)",
];

const log = (m) => console.log(`${new Date().toISOString()} [keeper] ${m}`);

/** Annualised realised volatility (bps) from oracle rounds over the last `days`. */
async function realisedVolBps(feed, days = 7) {
  const [latest] = await feed.latestRoundData();
  const since = Math.floor(Date.now() / 1000) - days * 86_400;
  const pts = [];
  // Walk back in parallel batches of 25 rounds until we pass `since`.
  let id = latest;
  let done = false;
  while (!done && id > 0n && pts.length < 3000) {
    const ids = [];
    for (let k = 0; k < 25 && id > 0n; k++, id -= 1n) ids.push(id);
    const rows = await Promise.all(ids.map((x) => feed.getRoundData(x).catch(() => null)));
    for (const r of rows) {
      if (!r || r[1] <= 0n) continue;
      const t = Number(r[3]);
      pts.push({ t, p: Number(r[1]) });
      if (t < since) done = true;
    }
  }
  pts.sort((a, b) => a.t - b.t);
  let sum = 0;
  let span = 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0) continue;
    const r = Math.log(pts[i].p / pts[i - 1].p);
    sum += r * r;
    span += dt;
  }
  if (span < 86_400 || pts.length < 20) return null; // not enough history
  return Math.round(Math.sqrt((sum / span) * YEAR) * 10_000);
}

async function tick(ctx) {
  const { calls, wallet, provider } = ctx;
  // The contract judges deadlines by block time, so the keeper does too.
  const now = (await provider.getBlock("latest")).timestamp;
  const p = await calls.params();
  const grace = Number(p.grace);
  const n = Number(await calls.callCount());
  const feedCache = new Map();
  const feedOf = (a) => {
    if (!feedCache.has(a)) feedCache.set(a, new ethers.Contract(a, FEED_ABI, provider));
    return feedCache.get(a);
  };

  for (let from = 0; from < n; from += 50) {
    const page = await calls.getCalls(from, 50);
    for (let i = 0; i < page.length; i++) {
      const c = page[i];
      const id = from + i;
      if (c.settled) continue;
      try {
        const feed = feedOf(c.feed);
        const end = Number(c.end);
        // 1. A crossing round inside the window: prove it (settles YES).
        if (!c.scanDone) {
          const [latest] = await feed.latestRoundData();
          for (let r = c.checkedRound + 1n; r <= latest && r <= c.checkedRound + 200n; r++) {
            const rd = await feed.getRoundData(r).catch(() => null);
            if (!rd) continue;
            const t = Number(rd[3]);
            if (t > end) break;
            if (t >= Number(c.start) && rd[1] > 0n && (c.above ? rd[1] >= c.strike : rd[1] <= c.strike)) {
              const tx = await calls.proveTouch(id, r);
              await tx.wait();
              log(`call ${id}: touch proven with round ${r} (${rd[1]}) ${tx.hash}`);
              c.settled = true;
              break;
            }
          }
        }
        // 2. Past deadline + grace: settle (catching up the scan first if needed).
        if (!c.settled && now > end + grace) {
          try {
            const tx = await calls.settle(id);
            await tx.wait();
            log(`call ${id}: settled ${tx.hash}`);
          } catch (e) {
            if (!/SyncRequired/.test(String(e?.shortMessage ?? e?.message)) && !/SyncRequired/.test(calls.interface.parseError(e?.data ?? "0x")?.name ?? "")) throw e;
            await (await calls.sync(id, 500)).wait();
            const tx = await calls.settle(id);
            await tx.wait();
            log(`call ${id}: synced and settled ${tx.hash}`);
          }
        }
      } catch (e) {
        log(`call ${id}: ${(e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0]}`);
      }
    }
  }

  // 3. Volatility, at most every VOL_EVERY_SECS per feed.
  const me = wallet.address.toLowerCase();
  const allowed = [(await calls.keeper()).toLowerCase(), (await calls.owner()).toLowerCase()].includes(me);
  if (allowed) {
    const nf = Number(await calls.feedCount());
    for (let i = 0; i < nf; i++) {
      const addr = await calls.feedList(i);
      const f = await calls.feeds(addr);
      if (!f.enabled || now - Number(f.volUpdatedAt) < VOL_EVERY_SECS) continue;
      try {
        const v = await realisedVolBps(feedOf(addr));
        if (v === null) continue;
        const bps = Math.max(1_000, Math.min(30_000, v));
        const tx = await calls.setVolatility(addr, bps);
        await tx.wait();
        log(`${await feedOf(addr).description()}: volatility ${(bps / 100).toFixed(1)}% ${tx.hash}`);
      } catch (e) {
        log(`volatility ${addr}: ${(e?.shortMessage ?? e?.message).split("\n")[0]}`);
      }
    }
  }

  const gas = Number(ethers.formatEther(await provider.getBalance(wallet.address)));
  if (gas < MIN_GAS_QIE) log(`WARNING: keeper has ${gas.toFixed(4)} QIE for gas; top it up`);
}

async function main() {
  const key = envKey();
  if (!key) throw new Error("set KEEPER_KEY (or QIE_DEPLOYER_KEY in .env)");
  if (!ADDRESS) throw new Error("set CALLS_ADDRESS");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(key, provider);
  const calls = new ethers.Contract(ADDRESS, CALLS_ABI, wallet);
  log(`keeper ${wallet.address} on chain ${(await provider.getNetwork()).chainId}, contract ${ADDRESS}`);
  const ctx = { calls, wallet, provider };
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(ctx);
    } catch (e) {
      log(`tick failed: ${(e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0]}`);
    } finally {
      running = false;
    }
  };
  await run();
  if (process.argv.includes("--once")) return;
  setInterval(run, INTERVAL_MS);
}

module.exports = { realisedVolBps };

if (require.main === module) {
  process.on("unhandledRejection", (e) => log(`unhandled: ${e?.message ?? e}`));
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
