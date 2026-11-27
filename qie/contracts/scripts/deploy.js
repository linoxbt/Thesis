// Deploys ThesisCalls, enables its stake tokens (QUSDC and native QIE) and the QIE Oracle feeds.
//
//   QIE_DEPLOYER_KEY=0x… npx hardhat run scripts/deploy.js --network qieMainnet
//
// Optional: TREASURY (default: deployer), KEEPER (default: deployer),
// STAKE_TOKEN (default: QUSDC on mainnet; a fresh test token elsewhere).
// Writes deployments/<network>.json (addresses only).
const { ethers, network } = require("hardhat");
const fs = require("node:fs");

const { LAUNCH_PARAMS: PARAMS, STAKE_LIMITS, NATIVE, FEEDS, QUSDC } = require("./params");

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
  const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(treasury, keeper, 5_000, PARAMS);
  await calls.waitForDeployment();
  const address = await calls.getAddress();
  console.log("ThesisCalls", address);

  // The QUSDC limits are in 6-decimal units: refuse any other token.
  const dec = await (await ethers.getContractAt(["function decimals() view returns (uint8)"], stake)).decimals();
  if (Number(dec) !== 6) throw new Error(`stake token ${stake} has ${dec} decimals; the QUSDC limits need 6`);
  await (await calls.setStakeToken(stake, STAKE_LIMITS.QUSDC)).wait();
  console.log("stake token QUSDC", stake);
  await (await calls.setStakeToken(NATIVE, STAKE_LIMITS.QIE)).wait();
  console.log("stake token QIE (native)");

  for (const [name, f] of Object.entries(FEEDS)) {
    const code = await ethers.provider.getCode(f.address);
    if (code === "0x") {
      console.log(`skip ${name}: no oracle at ${f.address} on this network`);
      continue;
    }
    await (await calls.setFeed(f.address, true, f.volBps, f.monitorSecs)).wait();
    console.log(`feed ${name} enabled (${f.volBps / 100}% vol, rounds ~${f.monitorSecs}s apart)`);
  }
  const block = (await calls.deploymentTransaction()?.wait())?.blockNumber ?? null;
  const out = { network: network.name, deployBlock: block, owner: deployer.address, chainId: network.config.chainId, ThesisCalls: address, stakeTokens: { QUSDC: stake, QIE: NATIVE }, treasury, keeper, params: Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, String(v)])), stakeLimits: JSON.parse(JSON.stringify(STAKE_LIMITS, (k, v) => (typeof v === "bigint" ? String(v) : v))), feeds: FEEDS, deployedAt: new Date().toISOString() };
  fs.writeFileSync(`deployments/${network.name}.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
