// Rewrites deployments/qieMainnet.json from what the chain says now (owner,
// pending owner, keeper, treasury, paused, params, stake tokens, feeds), so
// the record never drifts from the deployed contract. Read-only on chain.
//
//   node scripts/sync-deployment.js
const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");
const ABI = require("./keeper-abi.json");

const FILE = path.join(__dirname, "..", "deployments", "qieMainnet.json");
const RPC = process.env.QIE_MAINNET_RPC ?? "https://rpc1mainnet.qie.digital";
const str = (v) => (typeof v === "bigint" ? v.toString() : v);

async function main() {
  const dep = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC, 1990, { staticNetwork: true });
  const c = new ethers.Contract(dep.ThesisCalls, ABI, provider);
  const [owner, pendingOwner, keeper, treasury, paused, p, creatorShareBps] = await Promise.all([
    c.owner(), c.pendingOwner(), c.keeper(), c.treasury(), c.paused(), c.params(), c.creatorShareBps(),
  ]);
  const params = Object.fromEntries(p.toObject ? Object.entries(p.toObject()).map(([k, v]) => [k, str(v)]) : []);
  const stakeLimits = {};
  for (let i = 0; i < Number(await c.stakeTokenCount()); i++) {
    const t = await c.stakeTokenList(i);
    const s = (await c.stakeTokens(t)).toObject();
    stakeLimits[t === ethers.ZeroAddress ? "QIE" : t] = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, str(v)]));
  }
  const feeds = {};
  for (let i = 0; i < Number(await c.feedCount()); i++) {
    const a = await c.feedList(i);
    const f = (await c.feeds(a)).toObject();
    feeds[a] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, str(v)]));
  }
  const out = {
    ...dep,
    owner,
    pendingOwner: pendingOwner === ethers.ZeroAddress ? null : pendingOwner,
    keeper,
    treasury,
    paused,
    creatorShareBps: Number(creatorShareBps),
    params,
    stakeLimits,
    feedsOnChain: feeds,
    syncedAt: new Date().toISOString(),
  };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`synced ${path.relative(process.cwd(), FILE)}: owner ${owner}${out.pendingOwner ? ` (pending ${out.pendingOwner})` : ""}, keeper ${keeper}`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
