// Local stand-in for QIE mainnet, for UI work and the browser tests:
//   npx hardhat node &   then   npx hardhat run scripts/dev-chain.js --network localhost
// Mock BTC/ETH/SOL feeds start at the live QIE Oracle prices; a 6-decimal test
// token stands in for QUSDC; test accounts get 1,000 each; three demo calls
// (two in QUSDC, one in native QIE), plus one with a 280-byte reason.
// Writes deployments/localhost.json and ../app/.env.local.
const { ethers } = require("hardhat");
const { LAUNCH_PARAMS, STAKE_LIMITS, NATIVE, QIE } = require("./params");
const fs = require("node:fs");
const path = require("node:path");

const LIVE = {
  BTC: "0x9E596d809a20A272c788726f592c0d1629755440",
  ETH: "0x4bb7012Fbc79fE4Ae9B664228977b442b385500d",
  SOL: "0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21",
};
const VOL = { BTC: 5_000, ETH: 6_500, SOL: 7_000 };
const USDC = 1_000_000n;

async function livePrice(addr) {
  try {
    const r = await fetch("https://rpc1mainnet.qie.digital", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: addr, data: "0xfeaf968c" }, "latest"] }),
    });
    const hex = (await r.json()).result;
    return BigInt("0x" + hex.slice(66, 130));
  } catch {
    return null;
  }
}

async function main() {
  const [owner, keeper, ...users] = await ethers.getSigners();
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;
  const token = await (await ethers.getContractFactory("MockToken")).deploy();
  const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(owner.address, keeper.address, 5_000, LAUNCH_PARAMS);
  await calls.setStakeToken(await token.getAddress(), STAKE_LIMITS.QUSDC);
  await calls.setStakeToken(NATIVE, STAKE_LIMITS.QIE);
  const feeds = {};
  for (const [asset, live] of Object.entries(LIVE)) {
    const f = await (await ethers.getContractFactory("MockFeed")).deploy(`${asset} / USDT`);
    const p = (await livePrice(live)) ?? { BTC: 6_000_000_000_000n, ETH: 170_000_000_000n, SOL: 7_000_000_000n }[asset];
    await f.push(p, await now());
    await calls.setFeed(await f.getAddress(), true, VOL[asset], 0);
    feeds[asset] = { address: await f.getAddress(), price: p.toString() };
    console.log(`${asset} feed ${await f.getAddress()} at $${(Number(p) / 1e8).toFixed(2)}`);
  }
  for (const u of [owner, ...users.slice(0, 8)]) {
    await token.mint(u.address, 1_000n * USDC);
    await token.connect(u).approve(await calls.getAddress(), ethers.MaxUint256);
  }
  // Demo calls: SOL +3% in 48h (user 0) and BTC −5% in 7d (user 1) in QUSDC;
  // ETH +4% in 3d (user 2) in QIE.
  const sol = BigInt(feeds.SOL.price);
  const btc = BigInt(feeds.BTC.price);
  const eth = BigInt(feeds.ETH.price);
  const usdc = await token.getAddress();
  await calls.connect(users[0]).createCall(usdc, feeds.SOL.address, true, (sol * 10_300n) / 10_000n, (await now()) + 2 * 86_400, 20n * USDC, "SOL squeezes into the weekend");
  await calls.connect(users[1]).createCall(usdc, feeds.BTC.address, false, (btc * 9_500n) / 10_000n, (await now()) + 7 * 86_400, 25n * USDC, "BTC retests support before month end");
  await calls.connect(users[2]).bet(0, true, 8n * USDC);
  await calls.connect(users[3]).bet(0, false, 5n * USDC);
  await calls.connect(users[2]).createCall(NATIVE, feeds.ETH.address, true, (eth * 10_400n) / 10_000n, (await now()) + 3 * 86_400, 100n * QIE, "ETH breaks out in QIE terms", { value: 100n * QIE });
  await calls.connect(users[4]).bet(2, false, 40n * QIE, { value: 40n * QIE });
  // A call whose reason is as long as the contract allows (280 bytes): its page must still render.
  const long = "SOL holds the range lows and squeezes into resistance; funding is negative, open interest is climbing and every dip gets bought within the hour. I expect a sweep of the highs before the window closes, then a fast move through the take profit as shorts cover. Patience pays off!!!!";
  await calls.connect(users[5]).createCall(usdc, feeds.SOL.address, true, (sol * 10_400n) / 10_000n, (await now()) + 2 * 86_400, 10n * USDC, long);

  const out = { network: "localhost", chainId: 31337, ThesisCalls: await calls.getAddress(), stakeTokens: { QUSDC: usdc, QIE: NATIVE }, feeds, keeper: keeper.address };
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "localhost.json"), JSON.stringify(out, null, 2) + "\n");
  fs.writeFileSync(
    path.join(__dirname, "..", "..", "app", ".env.local"),
    `NEXT_PUBLIC_QIE_NETWORK=local\nNEXT_PUBLIC_CALLS_ADDRESS=${await calls.getAddress()}\nNEXT_PUBLIC_DEPLOY_BLOCK=0\n`,
  );
  console.log("ThesisCalls", await calls.getAddress(), "· wrote deployments/localhost.json and ../app/.env.local");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
