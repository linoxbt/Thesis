// The keeper against a local chain: it must prove, sync, settle and void
// correctly, and survive a stuck transaction.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { tick, makeCtx, send } = require("../scripts/keeper");
const ABI = require("../scripts/keeper-abi.json");
const { LAUNCH_PARAMS } = require("../scripts/params");

const USDC = 1_000_000n;
const PX = (usd) => BigInt(Math.round(usd * 1e8));
const HOUR = 3600;
const DAY = 86_400;

async function setup() {
  const [owner, keeper, creator, alice] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockToken")).deploy();
  const feed = await (await ethers.getContractFactory("MockFeed")).deploy("SOL / USDT");
  const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(await token.getAddress(), owner.address, keeper.address, 5_000, LAUNCH_PARAMS);
  await calls.setFeed(await feed.getAddress(), true, 6_800, 300);
  await print(feed, 100);
  for (const s of [creator, alice]) {
    await token.mint(s.address, 10_000n * USDC);
    await token.connect(s).approve(await calls.getAddress(), ethers.MaxUint256);
  }
  const end = (await time.latest()) + 2 * DAY;
  await calls.connect(creator).createCall(await feed.getAddress(), true, PX(105), end, 100n * USDC, "");
  await calls.connect(alice).bet(0, false, 10n * USDC);
  // A quiet round (a touch in the very first round after posting would void the call).
  await time.increase(300);
  await print(feed, 100.3);
  const ctx = makeCtx(keeper, await calls.getAddress());
  return { owner, keeper, creator, alice, token, feed, calls, ctx, end };
}

async function print(feed, usd, at) {
  const t = at ?? (await time.latest()) + 1;
  await time.setNextBlockTimestamp(t);
  await feed.push(PX(usd), t);
}

const quiet = async (fn) => {
  const orig = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = orig;
  }
};

describe("keeper", function () {
  this.timeout(120_000);

  it("ships the contract's current ABI", async () => {
    const art = require("../artifacts/contracts/ThesisCalls.sol/ThesisCalls.json");
    expect(ABI).to.deep.equal(art.abi);
  });

  it("proves a touch as soon as a crossing round appears", async () => {
    const f = await setup();
    await time.increase(HOUR);
    await print(f.feed, 105.4);
    await quiet(() => tick(f.ctx));
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon, c.touched, c.voided]).to.deep.equal([true, true, true, false]);
  });

  it("audit H3: a touch first seen after the grace period still settles YES", async () => {
    const f = await setup();
    await time.increase(HOUR);
    await print(f.feed, 105.4); // the keeper was down and missed it
    await time.increaseTo(f.end + 2 * HOUR);
    await print(f.feed, 101); // a round after the deadline
    await quiet(() => tick(f.ctx));
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon]).to.deep.equal([true, true]);
  });

  it("keeps open calls caught up, then settles NO through a long backlog", async () => {
    const f = await setup();
    for (let i = 0; i < 45; i++) await print(f.feed, 101);
    await quiet(() => tick(f.ctx)); // backlog >= 40: on-chain sync
    const c1 = await f.calls.getCall(0);
    expect(c1.checkedRound).to.be.greaterThan(40n);
    for (let i = 0; i < 120; i++) await print(f.feed, 101);
    await time.increaseTo(f.end + HOUR);
    await print(f.feed, 101);
    await quiet(() => tick(f.ctx));
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon, c.voided]).to.deep.equal([true, false, false]);
  });

  it("voidCall after voidAfter still settles NO when the oracle printed past the deadline", async () => {
    const f = await setup();
    await time.increaseTo(f.end + 600);
    await print(f.feed, 101);
    await time.increaseTo(f.end + Number(LAUNCH_PARAMS.voidAfter) + 10);
    await quiet(() => tick(f.ctx));
    const c = await f.calls.getCall(0);
    expect([c.settled, c.voided, c.yesWon]).to.deep.equal([true, false, false]);
  });

  it("voids a call whose feed broke", async () => {
    const f = await setup();
    await f.feed.setBroken(true);
    await time.increaseTo(f.end + Number(LAUNCH_PARAMS.voidAfter) + 10);
    await quiet(() => tick(f.ctx));
    expect((await f.calls.getCall(0)).voided).to.equal(true);
  });

  it("waits for an oracle print past the deadline, and voids if it never comes", async () => {
    const f = await setup();
    await time.increaseTo(f.end + HOUR);
    await quiet(() => tick(f.ctx));
    expect((await f.calls.getCall(0)).settled).to.equal(false);
    await time.increaseTo(f.end + Number(LAUNCH_PARAMS.voidAfter) + 10);
    await quiet(() => tick(f.ctx));
    const c = await f.calls.getCall(0);
    expect([c.settled, c.voided]).to.deep.equal([true, true]);
  });

  it("posts volatility and the typical round gap from oracle history", async () => {
    const f = await setup();
    let t = await time.latest();
    for (let i = 0; i < 60; i++) {
      t += 1800; // 30h of rounds, 30 min apart
      await print(f.feed, 100 + (i % 2 ? 0.6 : -0.6), t);
    }
    await time.increase(13 * HOUR);
    await quiet(() => tick(f.ctx));
    const fd = await f.calls.feeds(await f.feed.getAddress());
    expect(fd.monitorSecs).to.equal(1800);
    expect(fd.volBps).to.be.within(5_000, 30_000);
  });

  it("audit H3: re-sends a stuck transaction with a higher gas price", async () => {
    const f = await setup();
    await network.provider.send("evm_setAutomine", [false]);
    try {
      const p = quiet(() => send(f.ctx, f.calls.connect(f.keeper), "sync", [0, 10], { timeoutMs: 400, bumps: 2 }));
      // Let the first attempt time out, then mine whatever is in the pool (the replacement).
      await new Promise((r) => setTimeout(r, 700));
      await network.provider.send("evm_mine", []);
      const rc = await p;
      const sent = rc ? await ethers.provider.getTransaction(rc.hash) : null;
      expect(rc === null || sent.gasPrice > 1_125_000_000n).to.equal(true);
      expect(await ethers.provider.getTransactionCount(f.keeper.address, "latest")).to.equal(await ethers.provider.getTransactionCount(f.keeper.address, "pending"));
    } finally {
      await network.provider.send("evm_setAutomine", [true]);
    }
  });
});
