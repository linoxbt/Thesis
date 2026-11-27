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
const { USDC, LAUNCH_PARAMS, STAKE_LIMITS, FEEDS: FEED_CFG } = require("../scripts/params");

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
    const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(owner.address, owner.address, 5_000, LAUNCH_PARAMS);
    await calls.setStakeToken(await token.getAddress(), STAKE_LIMITS.QUSDC);
    for (const [name, addr] of Object.entries(FEEDS)) {
      const feed = await ethers.getContractAt("IPriceFeed", addr);
      const [roundId, price, , updatedAt] = await feed.latestRoundData();
      console.log(`      ${name}: ${(await feed.description())} round ${roundId} $${(Number(price) / 1e8).toFixed(2)} (${(await time.latest()) - Number(updatedAt)} s old)`);
      await calls.setFeed(addr, true, FEED_CFG[name].volBps, FEED_CFG[name].monitorSecs);
    }
    await token.mint(creator.address, 1_000n * USDC);
    await token.mint(alice.address, 1_000n * USDC);
    await token.connect(creator).approve(await calls.getAddress(), ethers.MaxUint256);
    await token.connect(alice).approve(await calls.getAddress(), ethers.MaxUint256);

    // "SOL touches spot + 5% within 48h", priced from the live feed.
    const sol = await ethers.getContractAt("IPriceFeed", FEEDS.SOL);
    const [, spot] = await sol.latestRoundData();
    const strike = (spot * 10_500n) / 10_000n;
    const end = (await time.latest()) + 48 * 3600;
    const [open] = await calls.previewOpenBps(FEEDS.SOL, true, strike, end);
    console.log(`      opening odds for +5% in 48h: ${(Number(open) / 100).toFixed(2)}%; strike needs ${await calls.minDistanceNow(FEEDS.SOL)} bps now`);
    await calls.connect(creator).createCall(await token.getAddress(), FEEDS.SOL, true, strike, end, 25n * USDC, "fork test");
    const st = await calls.betStatus(0);
    console.log(`      bet status: open ${st.open}, needs ${st.needBps} bps, has ${st.distBps}, print ${st.oracleAge}s old`);
    const tx = await calls.connect(alice).bet(0, false, 10n * USDC);
    console.log(`      bet gas (with a round scan): ${(await tx.wait()).gasUsed}`);

    // Past the deadline, the fork never prints again: NO can't settle by
    // default (the oracle may simply be down) ...
    await time.increaseTo(end + 301);
    await expect(calls.settle(0)).to.be.revertedWithCustomError(calls, "AwaitingOracle");
    // ... and after voidAfter the call voids and everyone is refunded.
    await time.increaseTo(end + Number(LAUNCH_PARAMS.voidAfter) + 1);
    await calls.voidCall(0);
    const c = await calls.getCall(0);
    expect([c.settled, c.voided]).to.deep.equal([true, true]);
    expect(await calls.claimable(0, alice.address)).to.equal(9_800_000n);

    // Proving with a real historical round outside the window is refused.
    const [latest] = await sol.latestRoundData();
    await expect(calls.proveTouch(0, latest - 5n)).to.be.revertedWithCustomError(calls, "AlreadyFinal");
  });
});
