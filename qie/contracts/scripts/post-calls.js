// Posts a set of opening calls on QIE mainnet from the team wallet (QIE_DEPLOYER_KEY).
//
//   node --env-file=.env scripts/post-calls.js          dry run: prices each call onchain, checks balances
//   node --env-file=.env scripts/post-calls.js --send   posts them (approves QUSDC once if needed)
//   add --qie to stake them in native QIE instead of QUSDC
//
// Each target is the call's distance from the latest QIE Oracle price, widened
// if the contract currently needs more (minDistanceNow). Nothing is posted if
// the wallet can't cover every seed and the gas.
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { FEEDS, QUSDC, NATIVE } = require("./params");

const CALLS = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/qieMainnet.json"), "utf8")).ThesisCalls;
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "keeper-abi.json"), "utf8"));
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const FEED = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"];

const QIE_MODE = process.argv.includes("--qie");
// Seed per call: SEED (in the token's own units, e.g. SEED=0.005), else 25 QIE or 4 QUSDC.
const SEED = process.env.SEED ? ethers.parseUnits(process.env.SEED, QIE_MODE ? 18 : 6) : QIE_MODE ? 25n * 10n ** 18n : 4_000_000n;
const DEC = QIE_MODE ? 18 : 6;
const UNIT = QIE_MODE ? "QIE" : "QUSDC";
const H = 3600;
const PLAN = [
  { asset: "BTC", long: true, bps: 300, hours: 48, text: "BTC reclaims +3% inside two days. Funding has reset and spot bids are stacking under the range." },
  { asset: "ETH", long: false, bps: 400, hours: 72, text: "ETH loses another 4% this week. ETH/BTC keeps bleeding and every bounce gets sold." },
  { asset: "SOL", long: true, bps: 500, hours: 24, text: "SOL squeezes +5% in 24h. Shorts are crowded at the lows and the range is tight." },
  { asset: "BTC", long: false, bps: 300, hours: 120, text: "BTC sweeps the lows first: −3% before the week is out." },
  { asset: "ETH", long: true, bps: 600, hours: 168, text: "ETH +6% within a week once the range breaks. Volatility is compressed." },
];

async function main() {
  const send = process.argv.includes("--send");
  if (!process.env.QIE_DEPLOYER_KEY) throw new Error("QIE_DEPLOYER_KEY is not set");
  const provider = new ethers.JsonRpcProvider(process.env.QIE_MAINNET_RPC ?? "https://rpc1mainnet.qie.digital", 1990);
  const wallet = new ethers.Wallet(process.env.QIE_DEPLOYER_KEY, provider);
  const calls = new ethers.Contract(CALLS, ABI, wallet);
  const token = new ethers.Contract(QUSDC, ERC20, wallet);
  const feedOf = Object.fromEntries(Object.entries(FEEDS).map(([k, f]) => [k, f.address]));

  const [usdc, gas, fee] = await Promise.all([token.balanceOf(wallet.address), provider.getBalance(wallet.address), provider.getFeeData()]);
  const need = SEED * BigInt(PLAN.length);
  // In QIE mode the seeds and the gas both come out of the QIE balance: keep
  // KEEP_QIE (default 0.05) back for gas.
  const keep = ethers.parseEther(process.env.KEEP_QIE ?? "0.05");
  const bal = QIE_MODE ? (gas > keep ? gas - keep : 0n) : usdc;
  console.log(`wallet ${wallet.address}: ${ethers.formatUnits(usdc, 6)} QUSDC, ${ethers.formatEther(gas)} QIE (gas price ${ethers.formatUnits(fee.gasPrice ?? 0n, "gwei")} gwei)`);
  console.log(`contract ${CALLS}; ${PLAN.length} calls × ${ethers.formatUnits(SEED, DEC)} ${UNIT} = ${ethers.formatUnits(need, DEC)} ${UNIT}\n`);

  const now = (await provider.getBlock("latest")).timestamp;
  const ready = [];
  for (const c of PLAN) {
    const feed = feedOf[c.asset];
    const f = new ethers.Contract(feed, FEED, provider);
    const [[, price], dec, minBps] = await Promise.all([f.latestRoundData(), f.decimals(), calls.minDistanceNow(feed)]);
    const bps = BigInt(Math.max(c.bps, Number(minBps) + 50));
    const strike = c.long ? (price * (10_000n + bps)) / 10_000n : (price * (10_000n - bps)) / 10_000n;
    const end = BigInt(now + c.hours * H);
    const [openBps] = await calls.previewOpenBps(feed, c.long, strike, end);
    const fmt = (v) => Number(ethers.formatUnits(v, dec)).toLocaleString("en-US", { maximumFractionDigits: 2 });
    console.log(`${c.asset} ${c.long ? "long " : "short"} $${fmt(price)} → $${fmt(strike)} (${c.long ? "+" : "−"}${Number(bps) / 100}%), ${c.hours} h, opens at ${(Number(openBps) / 100).toFixed(1)}%`);
    ready.push({ ...c, feed, strike, end });
  }

  if (bal < need) {
    console.log(`\nNot enough ${UNIT}: has ${ethers.formatUnits(bal, DEC)} to stake, needs ${ethers.formatUnits(need, DEC)}. Nothing posted.`);
    return;
  }
  if (!send) return console.log("\nDry run. Run with --send to post.");

  if (!QIE_MODE && (await token.allowance(wallet.address, CALLS)) < need) {
    const tx = await token.approve(CALLS, need);
    await tx.wait();
    console.log(`approved ${ethers.formatUnits(need, 6)} QUSDC: ${tx.hash}`);
  }
  for (const c of ready) {
    const tx = await calls.createCall(QIE_MODE ? NATIVE : QUSDC, c.feed, c.long, c.strike, c.end, SEED, c.text, { value: QIE_MODE ? SEED : 0n });
    const r = await tx.wait();
    const ev = r.logs.map((l) => { try { return calls.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "CallCreated");
    console.log(`posted ${c.asset} ${c.long ? "long" : "short"}: call #${ev?.args.id ?? "?"}, gas ${r.gasUsed}, ${tx.hash}`);
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
