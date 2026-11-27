// Thesis on QIE keeper. Outcomes don't depend on it (the contract scans oracle
// rounds itself before bets and NO settlements, and anyone can prove, settle
// or void from the app); it makes things prompt for the calls that matter:
// calls that count toward skill, and calls holding real money from others
// (at least the token's scoring seed). Tiny calls nobody else bet on are left
// to their creator, so spam can't drain the keeper. For those calls it:
//   - proves a touch as soon as a crossing oracle round appears (YES settles, winners can claim)
//   - keeps open calls' round checks caught up, so bets never hit SyncRequired
//   - settles calls once their deadline + grace has passed and the oracle has
//     printed past the deadline; voids them if the oracle never does (voidAfter)
//   - posts each feed's 7-day realised volatility and typical round gap
//
//   KEEPER_KEY=0x… CALLS_ADDRESS=0x… RPC_URL=https://rpc1mainnet.qie.digital node scripts/keeper.js [--once]
//
// Hardening: every transaction has a confirmation timeout and is re-sent with
// a higher gas price if it gets stuck; at most MAX_TX_PER_TICK transactions a
// tick; a tick that runs too long exits the process so the host (Railway)
// restarts it; it refuses to run on any chain but CHAIN_ID. PORT (if set)
// serves /health: 503 when gas is low, a call failed, or ticks have stopped.
const { ethers } = require("ethers");
const http = require("node:http");
const CALLS_ABI = require("./keeper-abi.json");

const RPC = process.env.RPC_URL ?? "https://rpc1mainnet.qie.digital";
const ADDRESS = process.env.CALLS_ADDRESS;
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? "60000");
const VOL_EVERY_SECS = Number(process.env.VOL_EVERY_SECS ?? String(12 * 3600));
// Below this (about 20 actions at ~0.0005 QIE each) /health reports low gas.
const MIN_GAS_QIE = Number(process.env.MIN_GAS_QIE ?? "0.01");
const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS ?? "90000");
const TICK_LIMIT_MS = Number(process.env.TICK_LIMIT_MS ?? String(30 * 60_000));
const MAX_TX_PER_TICK = Number(process.env.MAX_TX_PER_TICK ?? "12");
const CHAIN_ID = BigInt(process.env.CHAIN_ID ?? "1990");
const SCAN_BATCH = 25;
const SCAN_PER_TICK = 600; // rounds read off-chain per call per tick
const SYNC_BACKLOG = 40; // on-chain sync once this many rounds are unchecked (contract scans 48 per bet)
const PROVE_SCAN_MAX = 300n; // proveTouch scans at most this many rounds
const YEAR = 31_536_000;

const FEED_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function description() view returns (string)",
];

const log = (m) => console.log(`${new Date().toISOString()} [keeper] ${m}`);
const short = (e) => String(e?.shortMessage ?? e?.message ?? e).split("\n")[0];

/** Custom error name from a failed call/tx, or null. */
function errorName(calls, e) {
  for (const data of [e?.data, e?.error?.data, e?.info?.error?.data]) {
    if (typeof data !== "string" || data.length < 10) continue;
    try {
      return calls.interface.parseError(data)?.name ?? null;
    } catch {}
  }
  const m = /reverted with custom error '(\w+)\(/.exec(String(e?.message ?? ""));
  return m?.[1] ?? e?.revert?.name ?? null;
}

/**
 * Send a contract transaction and wait for it, re-sending with the same nonce
 * and a 30% higher gas price if it isn't mined within `timeoutMs` (up to
 * `bumps` times). The nonce is the next *confirmed* one, so a transaction
 * left stuck by an earlier run is replaced rather than queued behind.
 * Returns the receipt of whichever attempt was mined; throws if it reverted
 * or nothing was mined.
 */
/** This tick's transaction budget is spent: not a failure, the work resumes next tick. */
class BudgetSpent extends Error {}

async function send(ctx, contract, method, args, { timeoutMs = TX_TIMEOUT_MS, bumps = 3 } = {}) {
  const { wallet, provider } = ctx;
  if (ctx.budget !== undefined) {
    if (ctx.budget <= 0) throw new BudgetSpent(`${method}: this tick's transaction budget is spent; next tick`);
    ctx.budget -= 1;
  }
  const data = contract.interface.encodeFunctionData(method, args);
  const to = await contract.getAddress();
  const estimate = async () => ((await provider.estimateGas({ from: wallet.address, to, data })) * 13n) / 10n;
  let gasLimit = await estimate();
  const nonce = await provider.getTransactionCount(wallet.address, "latest");
  let gasPrice = (await provider.getFeeData()).gasPrice ?? 1_125_000_000n;
  // A transaction left pending on this nonce by an earlier send: outbid it, or
  // the node refuses the new one as an underpriced replacement.
  const prior = ctx.lastPrice?.get(nonce);
  if (prior && (prior * 13n) / 10n > gasPrice) gasPrice = (prior * 13n) / 10n;
  const remember = () => ctx.lastPrice?.set(nonce, gasPrice);
  const hashes = [];
  const minedAttempt = async () => {
    for (const h of hashes) {
      const rc = await provider.getTransactionReceipt(h).catch(() => null);
      if (rc) return rc;
    }
    return null;
  };
  const done = (rc) => {
    if (rc.status !== 1) throw new Error(`${method} reverted (${rc.hash})`);
    return rc;
  };
  for (let attempt = 0; attempt <= bumps; attempt++) {
    let tx;
    try {
      tx = await wallet.sendTransaction({ to, data, nonce, gasLimit, gasPrice, type: 0 });
      remember();
    } catch (e) {
      // "nonce too low" / "already known": an earlier attempt got in first.
      const rc = await minedAttempt();
      if (rc) return done(rc);
      throw e;
    }
    hashes.push(tx.hash);
    try {
      const rc = await tx.wait(1, timeoutMs);
      return done(rc);
    } catch (e) {
      if (e?.code === "TRANSACTION_REPLACED") {
        // One of our own earlier attempts (same nonce) was mined instead.
        if (e.receipt && hashes.includes(e.receipt.hash)) return done(e.receipt);
        throw e;
      }
      if (e?.code !== "TIMEOUT") throw e;
      const rc = await minedAttempt();
      if (rc) return done(rc);
      gasPrice = (gasPrice * 13n) / 10n;
      // More oracle rounds may have arrived since: re-estimate (keep the larger).
      const fresh = await estimate().catch(() => gasLimit);
      if (fresh > gasLimit) gasLimit = fresh;
      log(`${method}: not mined in ${timeoutMs / 1000}s, re-sending at ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
    }
  }
  const rc = await minedAttempt();
  if (rc) return done(rc);
  throw new Error(`${method}: still not mined after ${bumps} re-sends`);
}

/** Realised volatility (annualised bps) and median gap between rounds (s), over the last `days`. */
async function feedStats(feed, nowTs, days = 7) {
  const [latest] = await feed.latestRoundData();
  const since = nowTs - days * 86_400;
  const pts = [];
  let id = latest;
  let done = false;
  while (!done && id > 0n && pts.length < 5000) {
    const ids = [];
    for (let k = 0; k < SCAN_BATCH && id > 0n; k++, id -= 1n) ids.push(id);
    const rows = await Promise.all(ids.map((x) => feed.getRoundData(x).catch(() => null)));
    for (const r of rows) {
      if (!r || r[1] <= 0n) continue;
      const t = Number(r[3]);
      if (t < since) {
        done = true;
        continue;
      }
      pts.push({ t, p: Number(r[1]) });
    }
  }
  pts.sort((a, b) => a.t - b.t);
  let sum = 0;
  let span = 0;
  const gaps = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0) continue;
    const r = Math.log(pts[i].p / pts[i - 1].p);
    sum += r * r;
    span += dt;
    gaps.push(dt);
  }
  if (span < 86_400 || pts.length < 20) return { volBps: null, monitorSecs: null, rounds: pts.length, spanSecs: span };
  gaps.sort((a, b) => a - b);
  return {
    volBps: Math.round(Math.sqrt((sum / span) * YEAR) * 10_000),
    monitorSecs: gaps[Math.floor(gaps.length / 2)],
    rounds: pts.length,
    spanSecs: span,
  };
}

/**
 * The first round after `from` (up to `latest`, at most `limit` reads) that
 * touches the call's strike inside its window. Stops at the first round after
 * the deadline. Returns { touch, lastChecked, pastEnd }.
 */
async function findTouch(feed, c, from, latest, limit) {
  let r = from;
  const stop = latest < from + BigInt(limit) ? latest : from + BigInt(limit);
  while (r < stop) {
    const ids = [];
    for (let k = 0; k < SCAN_BATCH && r + BigInt(k) + 1n <= stop; k++) ids.push(r + BigInt(k) + 1n);
    // A round the feed refuses (a revert) is skipped, like the contract does;
    // a network error stops here, so that round is read again next tick.
    const rows = await Promise.all(ids.map((x) => feed.getRoundData(x).then((v) => ({ v }), (e) => ({ e }))));
    for (let k = 0; k < rows.length; k++) {
      if (rows[k].e) {
        if (rows[k].e?.code === "CALL_EXCEPTION") continue;
        return { touch: null, lastChecked: ids[k] - 1n, pastEnd: false };
      }
      const rd = rows[k].v;
      const t = Number(rd[3]);
      if (t > Number(c.end)) return { touch: null, lastChecked: ids[k] - 1n, pastEnd: true };
      if (t >= Number(c.start) && rd[1] > 0n && (c.above ? rd[1] >= c.strike : rd[1] <= c.strike))
        return { touch: { round: ids[k], price: rd[1], t }, lastChecked: ids[k], pastEnd: false };
    }
    r = ids[ids.length - 1];
  }
  return { touch: null, lastChecked: r, pastEnd: false };
}

/**
 * Whether the keeper spends gas on a call: it counts toward skill, or others
 * have put real money in (at least the token's scoring seed). Anything else
 * can be settled by its creator or bettors from the app.
 */
function worthKeeping(c, tok) {
  if (c.scored) return true;
  return tok ? c.outsideVolume >= tok.minScoredSeed : false;
}

async function handleCall(ctx, id, c, now) {
  const { calls, feedOf, scanned, notes } = ctx;
  const feed = feedOf(c.feed);
  const end = Number(c.end);
  const grace = Number(c.grace);
  const note = (key, msg, everySecs = 3600) => {
    const k = `${id}:${key}`;
    if ((notes.get(k) ?? 0) + everySecs > now) return;
    notes.set(k, now);
    log(`call ${id}: ${msg}`);
  };

  // 0. Long past the deadline: settle if the oracle can, else void (this also
  // covers a feed that has started reverting).
  if (now > end + Number(c.voidAfter)) {
    await settle(ctx, id, end, c);
    return;
  }
  // 1. Look for a touch off-chain (cheap) and prove it at once.
  if (!c.scanDone) {
    const [latest] = await feed.latestRoundData();
    const from = scanned.get(id) ?? c.checkedRound;
    const start = from > c.checkedRound ? from : c.checkedRound;
    const res = await findTouch(feed, c, start, latest, SCAN_PER_TICK);
    scanned.set(id, res.lastChecked);
    if (res.touch) {
      if (now <= end + grace) {
        // proveTouch checks every round up to it, in order (at most 300 at a time).
        if (res.touch.round - c.checkedRound > PROVE_SCAN_MAX) await send(ctx, calls, "sync", [id, 250]);
        await send(ctx, calls, "proveTouch", [id, res.touch.round]);
        const after = await calls.getCall(id);
        log(`call ${id}: touch proven with round ${after.touchRound} (${after.voided ? "void: touched right after posting" : "YES"})`);
      } else {
        // Too late to prove: settle() finds the same round in its own scan.
        await settle(ctx, id, end, c);
      }
      return;
    }
    // 2. Keep the contract's own check caught up while betting is open, so a
    // bet never needs a sync first (only on calls people are betting on).
    if (now < Number(c.closeAt) && c.volume > 0n && latest - c.checkedRound >= BigInt(SYNC_BACKLOG)) {
      await send(ctx, calls, "sync", [id, 200]);
      note("sync", `synced ${latest - c.checkedRound} unchecked rounds`, 0);
    }
  }

  // 3. Past deadline + grace: settle (voidCall takes over after voidAfter).
  if (now > end + grace) await settle(ctx, id, end, c, note);
}

/**
 * Settles a call past its deadline: syncs as far as needed, then settle().
 * Once voidAfter has passed, voidCall() instead: it settles whatever the
 * oracle can still decide and voids only a call the oracle never printed past
 * (or whose feed is broken).
 */
async function settle(ctx, id, end, c, note = (_k, m) => log(`call ${id}: ${m}`)) {
  const { calls } = ctx;
  const voidAt = end + Number(c.voidAfter);
  for (let i = 0; i < 20; i++) {
    const now = (await ctx.provider.getBlock("latest")).timestamp;
    const fn = now > voidAt ? "voidCall" : "settle";
    try {
      await calls[fn].staticCall(id);
    } catch (e) {
      const name = errorName(calls, e);
      if (name === "SyncRequired") {
        await send(ctx, calls, "sync", [id, 300]);
        continue;
      }
      if (name === "AwaitingOracle") return note("await", "deadline passed; waiting for the oracle to print past it before settling");
      if (name === "AlreadyFinal") return;
      throw e;
    }
    await send(ctx, calls, fn, [id]);
    const after = await calls.getCall(id);
    log(`call ${id}: ${fn === "voidCall" ? "voidCall: " : ""}settled ${after.voided ? "void (stakes refundable)" : after.yesWon ? "YES" : "NO"}`);
    return;
  }
  throw new Error("settle: still behind after 20 syncs");
}

async function tick(ctx) {
  const { calls, wallet, provider, feedOf } = ctx;
  ctx.budget = MAX_TX_PER_TICK;
  let failures = 0;
  // The contract judges deadlines by block time, so the keeper does too.
  const blockTime = async () => (await provider.getBlock("latest")).timestamp;
  let now = await blockTime();
  const p = await calls.params();
  // New calls since the last tick join the open set; settled ones leave it.
  const n = Number(await calls.callCount());
  for (let from = ctx.seen; from < n; from += 50) {
    const page = await calls.getCalls(from, 50);
    page.forEach((c, i) => !c.settled && ctx.open.add(from + i));
  }
  ctx.seen = Math.max(ctx.seen, n);
  const tokens = new Map();
  const tokenOf = async (a) => {
    if (!tokens.has(a)) tokens.set(a, await calls.stakeTokens(a).catch(() => null));
    return tokens.get(a);
  };
  // Open calls, read 50 at a time (one RPC per page, not one per call).
  const ids = [...ctx.open].sort((a, b) => a - b);
  const byId = new Map();
  for (let k = 0; k < ids.length; ) {
    const from = ids[k];
    const page = await calls.getCalls(from, 50);
    page.forEach((c, i) => byId.set(from + i, c));
    while (k < ids.length && ids[k] < from + 50) k++;
  }
  let open = 0;
  let kept = 0;
  for (const id of ids) {
    const c = byId.get(id);
    if (!c || c.settled) {
      ctx.open.delete(id);
      continue;
    }
    open += 1;
    if (!worthKeeping(c, await tokenOf(c.token))) {
      // Once betting has closed a call can't become worth keeping (its seed and
      // outside volume are final): stop reading it.
      if (now >= Number(c.closeAt)) ctx.open.delete(id);
      continue;
    }
    kept += 1;
    if (ctx.budget < 2) continue; // too little budget left for a sync + an action: next tick
    try {
      now = await blockTime();
      await handleCall(ctx, id, c, now);
    } catch (e) {
      if (e instanceof BudgetSpent) continue; // not a failure: resumes next tick
      failures += 1;
      log(`call ${id}: ${short(e)}`);
    }
  }

  // Volatility and round gap, at most every VOL_EVERY_SECS per feed.
  const me = wallet.address.toLowerCase();
  const allowed = [(await calls.keeper()).toLowerCase(), (await calls.owner()).toLowerCase()].includes(me);
  const nf = Number(await calls.feedCount());
  for (let i = 0; i < nf; i++) {
    const addr = await calls.feedList(i);
    const f = await calls.feeds(addr);
    if (!f.enabled) continue;
    const age = now - Number(f.volUpdatedAt);
    if (age > Number(p.maxVolAge) - 2 * 86_400) log(`WARNING: ${addr} volatility is ${(age / 86_400).toFixed(1)} days old; new calls stop at ${Number(p.maxVolAge) / 86_400} days`);
    if (!allowed || age < VOL_EVERY_SECS) continue;
    try {
      const s = await feedStats(feedOf(addr), now);
      if (s.volBps === null) {
        log(`volatility ${addr}: not enough oracle history (${s.rounds} rounds over ${(s.spanSecs / 3600).toFixed(1)}h); skipped`);
        continue;
      }
      const bps = Math.max(1_000, Math.min(30_000, s.volBps));
      const mon = Math.max(0, Math.min(86_400, s.monitorSecs));
      await send(ctx, calls, "setVolatility", [addr, bps, mon]);
      log(`${await feedOf(addr).description()}: volatility ${(bps / 100).toFixed(1)}%, rounds ~${mon}s apart`);
    } catch (e) {
      failures += 1;
      log(`volatility ${addr}: ${short(e)}`);
    }
  }
  if (!allowed) log(`note: ${wallet.address} is not the contract's keeper; volatility isn't posted (owner: setKeeper)`);

  const gas = Number(ethers.formatEther(await provider.getBalance(wallet.address)));
  if (gas < MIN_GAS_QIE) log(`WARNING: keeper has ${gas.toFixed(4)} QIE for gas; top it up`);
  return { open, kept, gas, failures, lowGas: gas < MIN_GAS_QIE };
}

function makeCtx(wallet, address) {
  const provider = wallet.provider;
  const calls = new ethers.Contract(address, CALLS_ABI, wallet);
  const cache = new Map();
  const feedOf = (a) => {
    if (!cache.has(a)) cache.set(a, new ethers.Contract(a, FEED_ABI, provider));
    return cache.get(a);
  };
  return { calls, wallet, provider, feedOf, scanned: new Map(), notes: new Map(), open: new Set(), seen: 0, lastPrice: new Map() };
}

async function main() {
  const key = process.env.KEEPER_KEY;
  // Healthy = the last tick finished without a failed call, gas is above the
  // floor, and ticks are still finishing (allowing for one long tick).
  const health = { ok: false, started: new Date().toISOString(), lastTick: null, failures: 0, lowGas: false, open: 0, kept: 0, gas: null };
  if (process.env.PORT) {
    http
      .createServer((req, res) => {
        const stale = !health.lastTick || Date.now() - Date.parse(health.lastTick) > TICK_LIMIT_MS + 2 * INTERVAL_MS;
        const healthy = health.ok && !stale && !health.lowGas && health.failures === 0;
        res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ healthy, stale, ...health }));
      })
      .listen(Number(process.env.PORT));
  }
  if (!key) {
    // Hosted without a key yet: wait instead of crash-looping (Railway redeploys when it's set).
    log("KEEPER_KEY is not set; idle until it is (any funded QIE wallet can prove and settle)");
    setInterval(() => {}, 1 << 30);
    return;
  }
  if (!ADDRESS) throw new Error("set CALLS_ADDRESS");
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected ${CHAIN_ID}; refusing to sign`);
  const ctx = makeCtx(wallet, ADDRESS);
  log(`keeper ${wallet.address} on chain ${chainId}, contract ${ADDRESS}`);
  let running = null;
  const run = async () => {
    if (running) {
      // Watchdog: a tick stuck past the limit means a hung RPC or tx; let the host restart us.
      if (Date.now() - running > TICK_LIMIT_MS) {
        log(`tick has run ${Math.round((Date.now() - running) / 1000)}s; exiting for a restart`);
        process.exit(1);
      }
      return;
    }
    running = Date.now();
    try {
      const r = await tick(ctx);
      Object.assign(health, { ok: true, lastTick: new Date().toISOString(), failures: r.failures, lowGas: r.lowGas, open: r.open, kept: r.kept, gas: r.gas });
    } catch (e) {
      health.ok = false;
      log(`tick failed: ${short(e)}`);
    } finally {
      running = null;
    }
  };
  await run();
  if (process.argv.includes("--once")) return;
  setInterval(run, INTERVAL_MS);
}

module.exports = { tick, makeCtx, send, feedStats, findTouch, errorName, worthKeeping };

if (require.main === module) {
  process.on("unhandledRejection", (e) => log(`unhandled: ${short(e)}`));
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
