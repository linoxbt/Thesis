const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = 1_000_000n; // 6 decimals
const PX = (usd) => BigInt(Math.round(usd * 1e8)); // feed units (8 decimals)
const HOUR = 3600;
const DAY = 86_400;

const PARAMS = {
  feeBps: 200,
  minSeed: 5n * USDC,
  maxSeed: 1_000n * USDC,
  minStake: 1n * USDC,
  minWindow: 600,
  maxWindow: 8 * DAY,
  grace: HOUR,
  maxOracleAge: 2 * HOUR,
  maxVolAge: 14 * DAY,
  minDistanceBps: 100,
  maxDistanceBps: 5_000,
  minOpenBps: 100,
  maxOpenBps: 9_900,
  betCutoffBps: 25,
};

async function deploy() {
  const [owner, treasury, keeper, creator, alice, bob, carol] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockToken")).deploy();
  const feed = await (await ethers.getContractFactory("MockFeed")).deploy();
  const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(
    await token.getAddress(), treasury.address, keeper.address, 5_000, PARAMS,
  );
  await calls.setFeed(await feed.getAddress(), true, 6_000);
  const now = await time.latest();
  await feed.push(PX(100), now); // SOL at $100
  for (const s of [creator, alice, bob, carol]) {
    await token.mint(s.address, 10_000n * USDC);
    await token.connect(s).approve(await calls.getAddress(), ethers.MaxUint256);
  }
  return { owner, treasury, keeper, creator, alice, bob, carol, token, feed, calls };
}

/** A call "SOL touches $105 within 2 days", seeded with 100 QUSDC. */
async function withCall() {
  const f = await deploy();
  const end = (await time.latest()) + 2 * DAY;
  await f.calls.connect(f.creator).createCall(await f.feed.getAddress(), true, PX(105), end, 100n * USDC, "SOL breaks $105");
  return { ...f, id: 0n, end };
}

describe("TouchMath", () => {
  it("matches the float reference (same cases as the Solana program) to 1 bp", async () => {
    const h = await (await ethers.getContractFactory("TouchMathHarness")).deploy();
    const s = 7_477_778_734n;
    const cases = [
      // [strike/spot, sigma bps, tau secs, reference P]
      [0.95, 6000, 48 * HOUR, 0.2481353044],
      [1.1, 6000, 7 * DAY, 0.2513575718],
      [0.995, 6000, 600, 0.0554555865],
      [0.5, 6000, DAY, 0.0],
      [1.5, 8000, DAY, 0.0],
      [0.999, 6000, 7 * DAY, 0.9903928852],
    ];
    for (const [ratio, sigma, tau, want] of cases) {
      const k = BigInt(Math.round(Number(s) * ratio));
      const got = Number(await h.touchProbabilityBps(s, k, sigma, tau));
      expect(Math.abs(got - Math.round(want * 10_000)), `ratio ${ratio} tau ${tau}`).to.be.at.most(1);
    }
    expect(await h.touchProbabilityBps(100, 100, 6000, 600)).to.equal(10_000n); // at spot: certain
  });
});

describe("ThesisCalls: posting", () => {
  it("prices the call onchain and seeds both pools at those odds", async () => {
    const f = await deploy();
    const end = (await time.latest()) + 2 * DAY;
    const [open] = await f.calls.previewOpenBps(await f.feed.getAddress(), PX(105), end);
    await expect(f.calls.connect(f.creator).createCall(await f.feed.getAddress(), true, PX(105), end, 100n * USDC, "SOL breaks $105"))
      .to.emit(f.calls, "CallCreated");
    const c = await f.calls.getCall(0);
    expect(c.creator).to.equal(f.creator.address);
    expect(c.yesPool + c.noPool).to.equal(100n * USDC);
    expect(c.yesPool).to.equal((100n * USDC * c.openBps) / 10_000n);
    expect(Number(c.openBps)).to.be.closeTo(Number(open), 2); // a block later: same odds within a bp or two
    expect(await f.calls.impliedYesBps(0)).to.be.closeTo(c.openBps, 1n);
    expect(await f.calls.callText(0)).to.equal("SOL breaks $105");
    expect((await f.calls.stats(f.creator.address)).posted).to.equal(1);
    expect(await f.calls.creatorCount()).to.equal(1n);
  });

  it("refuses bad calls", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const now = await time.latest();
    const c = f.calls.connect(f.creator);
    const end = now + 2 * DAY;
    await expect(c.createCall(feed, true, PX(99), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StrikeWrongSide");
    await expect(c.createCall(feed, false, PX(101), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StrikeWrongSide");
    await expect(c.createCall(feed, true, PX(100.5), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StrikeDistance");
    await expect(c.createCall(feed, true, PX(160), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StrikeDistance");
    await expect(c.createCall(feed, true, PX(105), now + 60, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "BadWindow");
    await expect(c.createCall(feed, true, PX(105), now + 9 * DAY, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "BadWindow");
    await expect(c.createCall(feed, true, PX(140), now + 700, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "OddsOutOfRange");
    await expect(c.createCall(feed, true, PX(105), end, 1n * USDC, "")).to.be.revertedWithCustomError(f.calls, "BadSeed");
    await expect(c.createCall(feed, true, PX(105), end, 100n * USDC, "x".repeat(281))).to.be.revertedWithCustomError(f.calls, "TextTooLong");
    await expect(c.createCall(f.alice.address, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "FeedNotEnabled");
    await f.calls.setPaused(true);
    await expect(c.createCall(feed, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "Paused");
  });

  it("refuses a stale oracle price or stale volatility", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    await time.increase(3 * HOUR); // last round is now 3h old (max 2h)
    let end = (await time.latest()) + 2 * DAY;
    await expect(f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StaleOracle");
    await f.feed.push(PX(100), await time.latest());
    await time.increase(15 * DAY);
    await f.feed.push(PX(100), await time.latest());
    end = (await time.latest()) + 2 * DAY;
    await expect(f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StaleVolatility");
    await f.calls.connect(f.keeper).setVolatility(feed, 7_000);
    await f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 100n * USDC, "");
  });
});

describe("ThesisCalls: trading", () => {
  it("takes a 2% fee, half to the creator, half to the treasury", async () => {
    const f = await loadFixture(withCall);
    const before = await f.calls.getCall(0);
    await expect(f.calls.connect(f.alice).bet(0, true, 50n * USDC)).to.emit(f.calls, "Bet");
    const c = await f.calls.getCall(0);
    expect(c.yesPool - before.yesPool).to.equal(49n * USDC);
    expect(await f.calls.yesStake(0, f.alice.address)).to.equal(49n * USDC);
    expect(await f.calls.creatorFeesOwed(f.creator.address)).to.equal(500_000n);
    expect(await f.calls.treasuryFees()).to.equal(500_000n);
    expect((await f.calls.stats(f.creator.address)).volume).to.equal(50n * USDC);
    const [net, pays] = await f.calls.quote(0, false, 10n * USDC);
    expect(net).to.equal(9_800_000n);
    expect(pays).to.be.greaterThan(net);
  });

  it("closes betting at the deadline and enforces the minimum stake", async () => {
    const f = await loadFixture(withCall);
    await expect(f.calls.connect(f.alice).bet(0, true, 500_000n)).to.be.revertedWithCustomError(f.calls, "StakeTooSmall");
    await time.increaseTo(f.end);
    await expect(f.calls.connect(f.alice).bet(0, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "CallClosed");
    await expect(f.calls.connect(f.alice).bet(9, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "UnknownCall");
  });
});

describe("ThesisCalls: resolution", () => {
  it("anyone proves a touch with an oracle round inside the window; YES wins at once", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 50n * USDC);
    await f.calls.connect(f.bob).bet(0, false, 30n * USDC);
    const c0 = await f.calls.getCall(0);

    await time.increase(HOUR);
    const below = await f.feed.push.staticCall(PX(104), await time.latest());
    await f.feed.push(PX(104), await time.latest());
    await expect(f.calls.connect(f.carol).proveTouch(0, below)).to.be.revertedWithCustomError(f.calls, "NoTouch");
    await expect(f.calls.connect(f.carol).proveTouch(0, 1)).to.be.revertedWithCustomError(f.calls, "RoundOutsideWindow"); // before the call opened

    await time.increase(HOUR);
    const hit = await f.feed.push.staticCall(PX(105.2), await time.latest());
    await f.feed.push(PX(105.2), await time.latest());
    await expect(f.calls.connect(f.carol).proveTouch(0, hit)).to.emit(f.calls, "Settled").withArgs(0, true, 10_000n - c0.openBps, f.creator.address);
    const c = await f.calls.getCall(0);
    expect([c.touched, c.settled, c.yesWon, c.touchPrice]).to.deep.equal([true, true, true, PX(105.2)]);
    const s = await f.calls.stats(f.creator.address);
    expect([s.hits, s.misses, s.skillBps]).to.deep.equal([1, 0, 10_000n - c0.openBps]);
    await expect(f.calls.connect(f.carol).proveTouch(0, hit)).to.be.revertedWithCustomError(f.calls, "AlreadyFinal");
    await expect(f.calls.connect(f.alice).bet(0, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "CallClosed");

    // Winners split the whole pot; the loser gets nothing; nothing is paid twice.
    const pot = c.yesPool + c.noPool;
    const tok = (s) => f.token.balanceOf(s.address);
    const a0 = await tok(f.alice);
    const k0 = await tok(f.creator);
    await f.calls.connect(f.alice).claim(0);
    await f.calls.connect(f.creator).claim(0);
    const paid = (await tok(f.alice)) - a0 + ((await tok(f.creator)) - k0);
    expect(paid).to.be.at.most(pot);
    expect(pot - paid).to.be.lessThan(3n); // rounding dust only
    expect((await tok(f.alice)) - a0).to.equal((49n * USDC * pot) / c.yesPool);
    await expect(f.calls.connect(f.bob).claim(0)).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    await expect(f.calls.connect(f.alice).claim(0)).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
  });

  it("a round published after the deadline doesn't count, and proofs stop after the grace period", async () => {
    const f = await loadFixture(withCall);
    await time.increaseTo(f.end + 10);
    const late = await f.feed.push.staticCall(PX(110), await time.latest());
    await f.feed.push(PX(110), await time.latest());
    await expect(f.calls.proveTouch(0, late)).to.be.revertedWithCustomError(f.calls, "RoundOutsideWindow");
    await time.increaseTo(f.end + HOUR + 1);
    await expect(f.calls.proveTouch(0, late)).to.be.revertedWithCustomError(f.calls, "ProofTooLate");
  });

  it("unproven calls settle NO after deadline + grace; the creator's skill drops by the opening odds", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await f.calls.connect(f.bob).bet(0, false, 20n * USDC);
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "TooEarly");
    await time.increaseTo(f.end + HOUR + 1);
    const c0 = await f.calls.getCall(0);
    await expect(f.calls.connect(f.carol).settle(0)).to.emit(f.calls, "Settled").withArgs(0, false, -c0.openBps, f.creator.address);
    expect((await f.calls.stats(f.creator.address)).skillBps).to.equal(-c0.openBps);
    const b0 = await f.token.balanceOf(f.bob.address);
    await f.calls.connect(f.bob).claim(0);
    expect(await f.token.balanceOf(f.bob.address)).to.be.greaterThan(b0 + 19_600_000n); // more than the stake back
    await expect(f.calls.connect(f.alice).claim(0)).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "AlreadyFinal");
  });

  it("pays creator fees and treasury fees to the right accounts only", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 100n * USDC);
    const k0 = await f.token.balanceOf(f.creator.address);
    await f.calls.connect(f.creator).claimCreatorFees();
    expect((await f.token.balanceOf(f.creator.address)) - k0).to.equal(1n * USDC);
    await expect(f.calls.connect(f.creator).claimCreatorFees()).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    await expect(f.calls.connect(f.alice).withdrawTreasury()).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    const t0 = await f.token.balanceOf(f.treasury.address);
    await f.calls.connect(f.treasury).withdrawTreasury();
    expect((await f.token.balanceOf(f.treasury.address)) - t0).to.equal(1n * USDC);
  });
});

describe("ThesisCalls: no racing the oracle", () => {
  it("a bet placed after an unproven crossing round settles the call YES and takes nothing", async () => {
    const f = await loadFixture(withCall);
    await time.increase(HOUR);
    await f.feed.push(PX(105.5), await time.latest()); // crosses; nobody has proven it
    await f.feed.push(PX(103), await time.latest()); // and the price falls back
    const a0 = await f.token.balanceOf(f.alice.address);
    await expect(f.calls.connect(f.alice).bet(0, true, 50n * USDC)).to.emit(f.calls, "Touched");
    expect(await f.token.balanceOf(f.alice.address)).to.equal(a0); // not taken
    const c = await f.calls.getCall(0);
    expect([c.touched, c.settled, c.yesWon, c.touchPrice]).to.deep.equal([true, true, true, PX(105.5)]);
  });

  it("closes betting while the price sits within the cutoff of the strike", async () => {
    const f = await loadFixture(withCall);
    await f.feed.push(PX(104.9), await time.latest()); // 0.095% under $105 (cutoff 0.25%)
    await expect(f.calls.connect(f.alice).bet(0, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "NearStrike");
    await f.feed.push(PX(103), await time.latest());
    await f.calls.connect(f.alice).bet(0, true, 5n * USDC);
  });

  it("NO only wins after every round up to the deadline is checked; a missed touch is found", async () => {
    const f = await loadFixture(withCall);
    await time.increase(HOUR);
    await f.feed.push(PX(106), await time.latest()); // a touch nobody proved
    for (let i = 0; i < 60; i++) await f.feed.push(PX(101), await time.latest()); // a long gap after it
    await time.increaseTo(f.end + HOUR + 1);
    await f.calls.settle(0); // the scan finds round 2 before anything else
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon]).to.deep.equal([true, true]);
  });

  it("a long backlog of quiet rounds needs sync() before NO can settle", async () => {
    const f = await loadFixture(withCall);
    for (let i = 0; i < 70; i++) await f.feed.push(PX(101), await time.latest());
    await time.increaseTo(f.end + HOUR + 1);
    await f.feed.push(PX(101), await time.latest()); // a round after the deadline
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "SyncRequired");
    await f.calls.sync(0, 100);
    await f.calls.settle(0);
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon, c.scanDone]).to.deep.equal([true, false, true]);
  });
});

describe("ThesisCalls: admin", () => {
  it("bounds every parameter and keeps roles separate", async () => {
    const f = await deploy();
    await expect(f.calls.connect(f.alice).setParams(PARAMS)).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    await expect(f.calls.setParams({ ...PARAMS, feeBps: 600 })).to.be.revertedWithCustomError(f.calls, "BadParams");
    await expect(f.calls.setParams({ ...PARAMS, minOpenBps: 50 })).to.be.revertedWithCustomError(f.calls, "BadParams");
    await expect(f.calls.setParams({ ...PARAMS, grace: 10 })).to.be.revertedWithCustomError(f.calls, "BadParams");
    await expect(f.calls.setParams({ ...PARAMS, minSeed: 10n })).to.be.revertedWithCustomError(f.calls, "BadParams");
    await expect(f.calls.setParams({ ...PARAMS, betCutoffBps: 100 })).to.be.revertedWithCustomError(f.calls, "BadParams"); // must be < min distance
    await expect(f.calls.connect(f.alice).setVolatility(await f.feed.getAddress(), 7_000)).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    await expect(f.calls.connect(f.keeper).setVolatility(await f.feed.getAddress(), 500)).to.be.revertedWithCustomError(f.calls, "BadParams");
    expect(await f.calls.creatorShareBps()).to.equal(5_000); // fixed at deploy
  });

  it("hands ownership over in two steps", async () => {
    const f = await deploy();
    await f.calls.transferOwnership(f.alice.address);
    expect(await f.calls.owner()).to.equal(f.owner.address);
    await expect(f.calls.connect(f.bob).acceptOwnership()).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    await f.calls.connect(f.alice).acceptOwnership();
    expect(await f.calls.owner()).to.equal(f.alice.address);
    await expect(f.calls.setPaused(true)).to.be.revertedWithCustomError(f.calls, "Unauthorized");
  });

  it("pages calls and creators for the feed and the leaderboard", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const end = (await time.latest()) + 2 * DAY;
    await f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 10n * USDC, "a");
    await f.calls.connect(f.alice).createCall(feed, false, PX(95), end, 10n * USDC, "b");
    await f.calls.connect(f.creator).createCall(feed, true, PX(110), end, 10n * USDC, "c");
    expect((await f.calls.getCalls(1, 10)).length).to.equal(2);
    expect((await f.calls.getCalls(5, 10)).length).to.equal(0);
    const [who, s] = await f.calls.getCreators(0, 10);
    expect(who).to.deep.equal([f.creator.address, f.alice.address]);
    expect(s[0].posted).to.equal(2);
  });
});
