// Runs only against a fork of QIE mainnet: FORK=1 npx hardhat test test/fork.test.js
// Real QIE Oracle feeds and real round history; a mock token stands in for QUSDC.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const FEEDS = {
  BTC: "0x9E596d809a20A272c788726f592c0d1629755440",
  ETH: "0x4bb7012Fbc79fE4Ae9B664228977b442b385500d",
  SOL: "0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21",
};
const USDC = 1_000_000n;

(process.env.FORK ? describe : describe.skip)("on a QIE mainnet fork (real oracle)", function () {
  this.timeout(300_000);

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: process.env.QIE_MAINNET_RPC ?? "https://rpc1mainnet.qie.digital" } }],
    });
  });

  it("prices, scans real oracle rounds and settles", async () => {
    const [owner, creator, alice] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockToken")).deploy();
    const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(await token.getAddress(), owner.address, owner.address, 5_000, {
      feeBps: 200, minSeed: 5n * USDC, maxSeed: 1_000n * USDC, minStake: USDC, minWindow: 600, maxWindow: 8 * 86_400, grace: 300,
      maxOracleAge: 3 * 3600, maxVolAge: 14 * 86_400, minDistanceBps: 100, maxDistanceBps: 5_000, minOpenBps: 100, maxOpenBps: 9_900, betCutoffBps: 25,
    });
    for (const [name, addr] of Object.entries(FEEDS)) {
      const feed = await ethers.getContractAt("IPriceFeed", addr);
      const [roundId, price, , updatedAt] = await feed.latestRoundData();
      console.log(`      ${name}: ${(await feed.description())} round ${roundId} $${(Number(price) / 1e8).toFixed(2)} (${(await time.latest()) - Number(updatedAt)} s old)`);
      await calls.setFeed(addr, true, name === "BTC" ? 5_000 : 7_000);
    }
    await token.mint(creator.address, 1_000n * USDC);
    await token.mint(alice.address, 1_000n * USDC);
    await token.connect(creator).approve(await calls.getAddress(), ethers.MaxUint256);
    await token.connect(alice).approve(await calls.getAddress(), ethers.MaxUint256);

    // "SOL touches spot + 3% within 48h", priced from the live feed.
    const sol = await ethers.getContractAt("IPriceFeed", FEEDS.SOL);
    const [, spot] = await sol.latestRoundData();
    const strike = (spot * 10_300n) / 10_000n;
    const end = (await time.latest()) + 48 * 3600;
    const [open] = await calls.previewOpenBps(FEEDS.SOL, strike, end);
    console.log(`      opening odds for +3% in 48h: ${(Number(open) / 100).toFixed(2)}%`);
    await calls.connect(creator).createCall(FEEDS.SOL, true, strike, end, 25n * USDC, "fork test");
    const tx = await calls.connect(alice).bet(0, false, 10n * USDC);
    console.log(`      bet gas (with a round scan): ${(await tx.wait()).gasUsed}`);

    // Past the deadline with no new rounds on the fork: the scan is caught up, NO settles.
    await time.increaseTo(end + 301);
    await calls.settle(0);
    const c = await calls.getCall(0);
    expect([c.settled, c.yesWon]).to.deep.equal([true, false]);

    // Proving with a real historical round outside the window is refused.
    const [latest] = await sol.latestRoundData();
    await expect(calls.proveTouch(0, latest - 5n)).to.be.revertedWithCustomError(calls, "AlreadyFinal");
  });
});
