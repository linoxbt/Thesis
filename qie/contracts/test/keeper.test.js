// The keeper against a local chain: it must prove, sync, settle and void
// correctly, and survive a stuck transaction.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deployThesisCalls } = require("../scripts/factory");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { tick, makeCtx, send } = require("../scripts/keeper");
const ABI = require("../scripts/keeper-abi.json");
const { LAUNCH_PARAMS, STAKE_LIMITS } = require("../scripts/params");

const USDC = 1_000_000n;
const PX = (usd) => BigInt(Math.round(usd * 1e8));
const HOUR = 3600;
const DAY = 86_400;

async function setup() {
  const [owner, keeper, creator, alice] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockToken")).deploy();
  const feed = await (await ethers.getContractFactory("MockFeed")).deploy("SOL / USDT");
  const { calls } = await deployThesisCalls(ethers, [owner.address, keeper.address, 5_000, LAUNCH_PARAMS]);
  await calls.setStakeToken(await token.getAddress(), STAKE_LIMITS.QUSDC);
  await calls.setFeed(await feed.getAddress(), true, 6_800, 300);
  await print(feed, 100);
  for (const s of [creator, alice]) {
    await token.mint(s.address, 10_000n * USDC);
    await token.connect(s).approve(await calls.getAddress(), ethers.MaxUint256);
  }
  const end = (await time.latest()) + 2 * DAY;
  await calls.connect(creator).createCall(await token.getAddress(), await feed.getAddress(), true, PX(105), end, 100n * USDC, "");
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

  it("audit H3: leaves tiny calls nobody else bet on alone (spam can't drain it)", async () => {
    const f = await setup();
    const end = (await time.latest()) + 2 * DAY;
    // 20 spam calls at the minimum seed: unscored, no outside money.
    for (let i = 0; i < 20; i++) await f.calls.connect(f.creator).createCall(await f.token.getAddress(), await f.feed.getAddress(), true, PX(104 + i / 10), end, 2n * USDC, "");
    await time.increase(HOUR);
    await print(f.feed, 106); // touches every one of them
    const nonce0 = await ethers.provider.getTransactionCount(f.keeper.address);
    await quiet(() => tick(f.ctx));
    // Only the real call (scored, with outside money) got a transaction.
    expect((await ethers.provider.getTransactionCount(f.keeper.address)) - nonce0).to.equal(1);
    expect((await f.calls.getCall(0)).settled).to.equal(true);
    expect((await f.calls.getCall(1)).settled).to.equal(false);
  });

  it("takes on a small call once others have put the scoring seed's worth into it", async () => {
    const f = await setup();
    const end = (await time.latest()) + 2 * DAY;
    await f.calls.connect(f.creator).createCall(await f.token.getAddress(), await f.feed.getAddress(), true, PX(104), end, 2n * USDC, "");
    await time.increase(300);
    await print(f.feed, 100.2);
    await f.calls.connect(f.alice).bet(1, false, 6n * USDC); // >= 5 QUSDC from someone else
    await time.increase(300);
    await print(f.feed, 100.3);
    await time.increase(HOUR);
    await print(f.feed, 104.5);
    await quiet(() => tick(f.ctx));
    expect((await f.calls.getCall(1)).settled).to.equal(true);
  });

  it("stops at its per-tick transaction budget and carries on next tick", async () => {
    const f = await setup();
    const end = (await time.latest()) + 2 * DAY;
    // 14 scored calls (seed >= 5 QUSDC), all touched at once: more than one tick's budget (12).
    for (let i = 0; i < 14; i++) await f.calls.connect(f.creator).createCall(await f.token.getAddress(), await f.feed.getAddress(), true, PX(104 + i / 10), end, 10n * USDC, "");
    await time.increase(300);
    await print(f.feed, 100.2);
    await time.increase(HOUR);
    await print(f.feed, 106);
    await quiet(() => tick(f.ctx));
    const settledAfter = async () => (await Promise.all(Array.from({ length: 15 }, (_, i) => f.calls.getCall(i)))).filter((c) => c.settled).length;
    expect(await settledAfter()).to.equal(11); // 12 transactions, 2 always held back for a sync + an action
    await quiet(() => tick(f.ctx));
    expect(await settledAfter()).to.equal(15);
  });

  it("final review M2: drops calls it won't keep once betting closes, instead of re-reading them forever", async () => {
    const f = await setup();
    const end = (await time.latest()) + 8 * HOUR;
    for (let i = 0; i < 5; i++) await f.calls.connect(f.creator).createCall(await f.token.getAddress(), await f.feed.getAddress(), true, PX(102 + i / 10), end, 2n * USDC, "");
    await quiet(() => tick(f.ctx));
    expect(f.ctx.open.size).to.equal(6); // betting still open: they could still attract outside money
    await time.increaseTo(end - 600); // betting has closed (last 10% of the window), not yet the deadline
    await print(f.feed, 100.1);
    await quiet(() => tick(f.ctx));
    expect([...f.ctx.open]).to.deep.equal([0]); // only the real call is still followed
  });

  it("final review L1: running out of the tick's budget isn't counted as a failure", async () => {
    const f = await setup();
    const end = (await time.latest()) + 2 * DAY;
    for (let i = 0; i < 14; i++) await f.calls.connect(f.creator).createCall(await f.token.getAddress(), await f.feed.getAddress(), true, PX(104 + i / 10), end, 10n * USDC, "");
    await time.increase(300);
    await print(f.feed, 100.2);
    await time.increase(HOUR);
    await print(f.feed, 106);
    const r = await quiet(() => tick(f.ctx));
    expect(r.failures).to.equal(0);
  });
});
