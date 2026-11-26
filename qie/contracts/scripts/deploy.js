// Deploys ThesisCalls and enables the QIE Oracle feeds.
//
//   QIE_DEPLOYER_KEY=0x… npx hardhat run scripts/deploy.js --network qieMainnet
//
// Optional: TREASURY (default: deployer), KEEPER (default: deployer),
// STAKE_TOKEN (default: QUSDC on mainnet; a fresh test token elsewhere).
// Writes deployments/<network>.json (addresses only).
const { ethers, network } = require("hardhat");
const fs = require("node:fs");

const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const FEEDS = {
  BTC: { address: "0x9E596d809a20A272c788726f592c0d1629755440", volBps: 5_000 },
  ETH: { address: "0x4bb7012Fbc79fE4Ae9B664228977b442b385500d", volBps: 6_500 },
  SOL: { address: "0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21", volBps: 7_000 },
};
const USDC = 1_000_000n;

// Launch limits: small, raised later with setParams.
const PARAMS = {
  feeBps: 200, // 2% per bet: half to the call's creator, half to the treasury
  minSeed: 2n * USDC,
  maxSeed: 250n * USDC,
  minStake: 500_000n, // 0.5 QUSDC
  minWindow: 30 * 60,
  maxWindow: 8 * 86_400,
  grace: 300,
  maxOracleAge: 3 * 3600, // QIE Oracle rounds arrive minutes to ~an hour apart
  maxVolAge: 14 * 86_400,
  minDistanceBps: 100, // 1% from the latest price
  maxDistanceBps: 5_000,
  minOpenBps: 100,
  maxOpenBps: 9_900,
  betCutoffBps: 25,
};

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("set QIE_DEPLOYER_KEY");
  const mainnet = network.config.chainId === 1990;
  console.log(`network ${network.name} (${network.config.chainId}), deployer ${deployer.address}, balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} QIE`);

  let stake = process.env.STAKE_TOKEN ?? (mainnet ? QUSDC : null);
  if (!stake) {
    const t = await (await ethers.getContractFactory("MockToken")).deploy();
    await t.waitForDeployment();
    stake = await t.getAddress();
    console.log("test token", stake);
  }
  const treasury = process.env.TREASURY ?? deployer.address;
  const keeper = process.env.KEEPER ?? deployer.address;
  const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(stake, treasury, keeper, 5_000, PARAMS);
  await calls.waitForDeployment();
  const address = await calls.getAddress();
  console.log("ThesisCalls", address);

  for (const [name, f] of Object.entries(FEEDS)) {
    const code = await ethers.provider.getCode(f.address);
    if (code === "0x") {
      console.log(`skip ${name}: no oracle at ${f.address} on this network`);
      continue;
    }
    await (await calls.setFeed(f.address, true, f.volBps)).wait();
    console.log(`feed ${name} enabled (${f.volBps / 100}% vol)`);
  }
  const out = { network: network.name, chainId: network.config.chainId, ThesisCalls: address, stakeToken: stake, treasury, keeper, feeds: FEEDS, deployedAt: new Date().toISOString() };
  fs.writeFileSync(`deployments/${network.name}.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
