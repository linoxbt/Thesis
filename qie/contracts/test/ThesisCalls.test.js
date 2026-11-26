const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = 1_000_000n; // 6 decimals
const PX = (usd) => BigInt(Math.round(usd * 1e8)); // feed units (8 decimals)
const MIN = 60;
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
  staleZTenths: 30,
  closeBps: 1_000,
  voidAfter: 3 * DAY,
  minScoredVolume: 5n * USDC,
};

async function deploy() {
  const [owner, treasury, keeper, creator, alice, bob, carol] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockToken")).deploy();
  const feed = await (await ethers.getContractFactory("MockFeed")).deploy("SOL / USDT");
  const calls = await (await ethers.getContractFactory("ThesisCalls")).deploy(
    await token.getAddress(), treasury.address, keeper.address, 5_000, PARAMS,
  );
  await calls.setFeed(await feed.getAddress(), true, 6_000, 0);
  const now = await time.latest();
  await feed.push(PX(100), now); // SOL at $100
  for (const s of [creator, alice, bob, carol]) {
    await token.mint(s.address, 100_000n * USDC);
    await token.connect(s).approve(await calls.getAddress(), ethers.MaxUint256);
  }
  return { owner, treasury, keeper, creator, alice, bob, carol, token, feed, calls };
}

/**
 * A call "SOL touches $105 within 2 days", seeded with 100 QUSDC, and one
 * quiet oracle round after it (a touch in the very first round after posting
 * voids a call, so tests that want a YES need a round in between).
 */
async function withCall() {
  const f = await deploy();
  const end = (await time.latest()) + 2 * DAY;
  await f.calls.connect(f.creator).createCall(await f.feed.getAddress(), true, PX(105), end, 100n * USDC, "SOL breaks $105");
  await time.increase(5 * MIN);
  const t = (await time.latest()) + 1;
  await time.setNextBlockTimestamp(t);
  await f.feed.push(PX(100.2), t);
  const c = await f.calls.getCall(0);
  return { ...f, id: 0n, end, closeAt: Number(c.closeAt) };
}

/** Push an oracle round at the next block's time (what a real update looks like). */
async function print(f, usd) {
  const t = (await time.latest()) + 1;
  await time.setNextBlockTimestamp(t);
  const id = await f.feed.push.staticCall(PX(usd), t);
  await f.feed.push(PX(usd), t);
  return id;
}

/** Let `secs` pass, then print a fresh round (keeps betting open). */
async function later(f, secs, usd = 100) {
  await time.increase(secs);
  return print(f, usd);
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

  it("discrete monitoring lowers the odds by the Broadie-Glasserman-Kou shift", async () => {
    const h = await (await ethers.getContractFactory("TouchMathHarness")).deploy();
    // 3% up, 68% vol, 48h, rounds every ~6 minutes. Float reference:
    // shift = 0.5826 * 0.68 * sqrt(360 / 31536000) = 0.0013385
    // d = (ln 1.03 + shift) / (0.68 * sqrt(48h)) ; P = erfc(d / sqrt 2)
    const ln = Math.log(1.03), sig = 0.68, tau = (48 * HOUR) / 31_536_000;
    const shift = 0.5825971579 * sig * Math.sqrt(360 / 31_536_000);
    const erfc = (x) => { const t = 1 / (1 + 0.3275911 * x); return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x); };
    const want = erfc((ln + shift) / (sig * Math.sqrt(tau)) / Math.SQRT2);
    const cont = Number(await h.touchProbabilityBps(100_000_000n, 103_000_000n, 6_800, 48 * HOUR));
    const disc = Number(await h.touchProbabilityBpsDiscrete(100_000_000n, 103_000_000n, 6_800, 48 * HOUR, 360));
    expect(disc).to.be.lessThan(cont);
    expect(Math.abs(disc - Math.round(want * 10_000))).to.be.at.most(1);
  });

  it("sizes the stale-print margin as z * sigma * sqrt(age)", async () => {
    const h = await (await ethers.getContractFactory("TouchMathHarness")).deploy();
    for (const [vol, age] of [[6800, 600], [6800, 2 * HOUR], [8200, 30 * MIN]]) {
      const want = 3 * (vol / 10_000) * Math.sqrt(age / 31_536_000) * 10_000;
      expect(Number(await h.staleMoveBps(vol, age, 30))).to.be.closeTo(want, 1);
    }
    expect(await h.staleMoveBps(6800, 0, 30)).to.equal(0n);
  });
});

describe("ThesisCalls: posting", () => {
  it("prices the call onchain, seeds both pools at those odds and fixes its terms", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const end = (await time.latest()) + 2 * DAY;
    const [open] = await f.calls.previewOpenBps(feed, true, PX(105), end);
    await expect(f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 100n * USDC, "SOL breaks $105"))
      .to.emit(f.calls, "CallCreated");
    const c = await f.calls.getCall(0);
    expect(c.creator).to.equal(f.creator.address);
    expect(c.yesPool + c.noPool).to.equal(100n * USDC);
    expect(c.yesPool).to.equal((100n * USDC * c.openBps) / 10_000n);
    expect(Number(c.openBps)).to.be.closeTo(Number(open), 1);
    expect(c.feeBps).to.equal(200);
    expect(c.grace).to.equal(HOUR);
    expect(Number(c.closeAt)).to.equal(end - Math.floor(((end - Number(c.start)) * 1000) / 10_000));
    expect(await f.calls.callText(0)).to.equal("SOL breaks $105");
    expect((await f.calls.stats(f.creator.address)).posted).to.equal(1);
  });

  it("prices the unseen time since the last print into the opening odds", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    await time.increase(90 * MIN); // the latest print is now 1.5h old
    const end = (await time.latest()) + 6 * HOUR;
    await f.calls.connect(f.creator).createCall(feed, true, PX(104), end, 100n * USDC, "");
    const c = await f.calls.getCall(0);
    const h = await (await ethers.getContractFactory("TouchMathHarness")).deploy();
    const fromNow = await h.touchProbabilityBps(PX(100), PX(104), 6000, end - Number(c.start));
    const fromPrint = await h.touchProbabilityBps(PX(100), PX(104), 6000, end - Number(c.oracleAt));
    expect(c.openBps).to.equal(fromPrint);
    expect(c.openBps).to.be.greaterThan(fromNow);
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
    await expect(c.createCall(feed, true, PX(105), end, 100n * USDC, "é".repeat(141))).to.be.revertedWithCustomError(f.calls, "TextTooLong"); // 282 bytes
    await expect(c.createCall(f.alice.address, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "FeedNotEnabled");
    await f.calls.setPaused(true);
    await expect(c.createCall(feed, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "Paused");
  });

  it("needs more distance the older the print is (no posting into an unprinted move)", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    await time.increase(100 * MIN); // print is 100 min old: 3 * 60% * sqrt(100min) = 2.3%
    const end = (await time.latest()) + DAY;
    expect(await f.calls.minDistanceNow(feed)).to.be.greaterThan(220n);
    await expect(f.calls.connect(f.creator).createCall(feed, true, PX(102), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StrikeDistance");
    await expect(f.calls.previewOpenBps(feed, true, PX(102), end)).to.be.revertedWithCustomError(f.calls, "StrikeDistance");
    await f.calls.connect(f.creator).createCall(feed, true, PX(103), end, 100n * USDC, "");
  });

  it("refuses a stale oracle price or stale volatility", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    await time.increase(3 * HOUR); // last round is now 3h old (max 2h)
    let end = (await time.latest()) + 2 * DAY;
    await expect(f.calls.connect(f.creator).createCall(feed, true, PX(110), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StaleOracle");
    await print(f, 100);
    await time.increase(15 * DAY);
    await print(f, 100);
    end = (await time.latest()) + 2 * DAY;
    await expect(f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 100n * USDC, "")).to.be.revertedWithCustomError(f.calls, "StaleVolatility");
    await f.calls.connect(f.keeper).setVolatility(feed, 7_000, 300);
    expect((await f.calls.feeds(feed)).monitorSecs).to.equal(300);
    await f.calls.connect(f.creator).createCall(feed, true, PX(105), end, 100n * USDC, "");
  });
});

describe("ThesisCalls: trading", () => {
  it("takes the call's fee, half to the creator, half to the treasury", async () => {
    const f = await loadFixture(withCall);
    const before = await f.calls.getCall(0);
    await expect(f.calls.connect(f.alice).bet(0, true, 50n * USDC)).to.emit(f.calls, "Bet");
    const c = await f.calls.getCall(0);
    expect(c.yesPool - before.yesPool).to.equal(49n * USDC);
    expect(c.outsideVolume).to.equal(50n * USDC);
    expect(await f.calls.yesStake(0, f.alice.address)).to.equal(49n * USDC);
    // The fee waits in escrow until the next oracle round passes without a touch...
    const pd = await f.calls.pending(0);
    expect([pd.creatorFee, pd.treasuryFee]).to.deep.equal([500_000n, 500_000n]);
    expect(await f.calls.creatorFeesOwed(f.creator.address)).to.equal(0n);
    // ... then it's credited.
    await later(f, 10 * MIN, 100);
    await f.calls.sync(0, 0);
    expect(await f.calls.creatorFeesOwed(f.creator.address)).to.equal(500_000n);
    expect(await f.calls.treasuryFees()).to.equal(500_000n);
    const [net, pays] = await f.calls.quote(0, false, 10n * USDC);
    expect(net).to.equal(9_800_000n);
    expect(pays).to.be.greaterThan(net);
  });

  it("keeps an open call's fee when the owner changes params later", async () => {
    const f = await loadFixture(withCall);
    await f.calls.setParams({ ...PARAMS, feeBps: 500, grace: 2 * HOUR });
    await f.calls.connect(f.alice).bet(0, true, 50n * USDC);
    expect((await f.calls.pending(0)).treasuryFee).to.equal(500_000n); // still 2%, not 5%
  });

  it("closes betting before the deadline and enforces the minimum stake", async () => {
    const f = await loadFixture(withCall);
    await expect(f.calls.connect(f.alice).bet(0, true, 500_000n)).to.be.revertedWithCustomError(f.calls, "StakeTooSmall");
    await time.increaseTo(f.closeAt - 30 * MIN);
    await print(f, 100);
    await f.calls.connect(f.alice).bet(0, false, 5n * USDC);
    await time.increaseTo(f.closeAt);
    await print(f, 100);
    await expect(f.calls.connect(f.bob).bet(0, false, 500n * USDC)).to.be.revertedWithCustomError(f.calls, "CallClosed"); // no last-minute sniping
    expect((await f.calls.betStatus(0)).open).to.equal(false);
    await expect(f.calls.connect(f.alice).bet(9, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "UnknownCall");
  });

  it("takes bets on an old print (no pause), but not on a stale one or right at the strike", async () => {
    const f = await loadFixture(withCall);
    await print(f, 103.5); // 1.43% under $105
    await time.increase(90 * MIN); // a quiet market: the print is 1.5 h old
    expect((await f.calls.betStatus(0)).open).to.equal(true);
    await f.calls.connect(f.alice).bet(0, true, 5n * USDC);
    await time.increase(2 * HOUR); // past maxOracleAge: the oracle may be down
    await expect(f.calls.connect(f.alice).bet(0, false, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "StaleOracle");
    await print(f, 104.9); // within the 0.25% cutoff
    await expect(f.calls.connect(f.alice).bet(0, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "NearStrike");
    await print(f, 103.5);
    await f.calls.connect(f.alice).bet(0, true, 5n * USDC);
  });
});

describe("ThesisCalls: resolution", () => {
  it("anyone proves a touch with an oracle round inside the window; YES wins at once", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 50n * USDC);
    await f.calls.connect(f.bob).bet(0, false, 30n * USDC);
    const c0 = await f.calls.getCall(0);

    const below = await later(f, HOUR, 104);
    await expect(f.calls.connect(f.carol).proveTouch(0, below)).to.be.revertedWithCustomError(f.calls, "NoTouch");
    await expect(f.calls.connect(f.carol).proveTouch(0, 1)).to.be.revertedWithCustomError(f.calls, "RoundOutsideWindow"); // before the call opened

    const hit = await later(f, HOUR, 105.2);
    await expect(f.calls.connect(f.carol).proveTouch(0, hit)).to.emit(f.calls, "Settled").withArgs(0, true, 10_000n - c0.openBps, f.creator.address, true);
    const c = await f.calls.getCall(0);
    expect([c.touched, c.settled, c.yesWon, c.voided, c.touchPrice]).to.deep.equal([true, true, true, false, PX(105.2)]);
    expect([c.voidYes, c.voidNo]).to.deep.equal([0n, 0n]);
    const s = await f.calls.stats(f.creator.address);
    expect([s.hits, s.misses, s.skillBps, s.scored]).to.deep.equal([1, 0, 10_000n - c0.openBps, 1]);
    await expect(f.calls.connect(f.carol).proveTouch(0, hit)).to.be.revertedWithCustomError(f.calls, "AlreadyFinal");
    await expect(f.calls.connect(f.alice).bet(0, true, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "CallClosed");

    // Winners split the whole pot; the loser gets nothing; nothing is paid twice.
    const pot = c.yesPool + c.noPool;
    const tok = (s) => f.token.balanceOf(s.address);
    const a0 = await tok(f.alice);
    const k0 = await tok(f.creator);
    expect(await f.calls.claimable(0, f.alice.address)).to.equal((49n * USDC * pot) / c.yesPool);
    await f.calls.connect(f.alice).claim(0);
    await f.calls.connect(f.creator).claim(0);
    const paid = (await tok(f.alice)) - a0 + ((await tok(f.creator)) - k0);
    expect(paid).to.be.at.most(pot);
    expect(pot - paid).to.be.lessThan(3n); // rounding dust only
    await expect(f.calls.connect(f.bob).claim(0)).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    await expect(f.calls.connect(f.alice).claim(0)).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    expect(await f.calls.claimable(0, f.alice.address)).to.equal(0n);
  });

  it("settles a short (below) call too, and the creator collects on NO", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const end = (await time.latest()) + DAY;
    await f.calls.connect(f.creator).createCall(feed, false, PX(95), end, 100n * USDC, "SOL loses $95");
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await later(f, HOUR, 96);
    await time.increaseTo(end + HOUR + 1);
    await print(f, 97); // the oracle prints after the deadline
    await f.calls.settle(0);
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon]).to.deep.equal([true, false]);
    const k0 = await f.token.balanceOf(f.creator.address);
    await f.calls.connect(f.creator).claim(0);
    expect((await f.token.balanceOf(f.creator.address)) - k0).to.equal(c.yesPool + c.noPool); // only NO holder takes all
  });

  it("a round published after the deadline doesn't count, and proofs stop after the grace period", async () => {
    const f = await loadFixture(withCall);
    await time.increaseTo(f.end + 10);
    const late = await print(f, 110);
    await expect(f.calls.proveTouch(0, late)).to.be.revertedWithCustomError(f.calls, "NoTouch");
    await time.increaseTo(f.end + HOUR + 1);
    await expect(f.calls.proveTouch(0, late)).to.be.revertedWithCustomError(f.calls, "ProofTooLate");
  });

  it("settles NO only after the oracle prints past the deadline; skill counts only with outside volume", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await f.calls.connect(f.bob).bet(0, false, 20n * USDC);
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "TooEarly");
    await time.increaseTo(f.end + HOUR + 1);
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "AwaitingOracle"); // nothing printed after the end yet
    await print(f, 101);
    const c0 = await f.calls.getCall(0);
    await expect(f.calls.connect(f.carol).settle(0)).to.emit(f.calls, "Settled").withArgs(0, false, -c0.openBps, f.creator.address, true);
    expect((await f.calls.stats(f.creator.address)).skillBps).to.equal(-c0.openBps);
    const b0 = await f.token.balanceOf(f.bob.address);
    await f.calls.connect(f.bob).claim(0);
    expect(await f.token.balanceOf(f.bob.address)).to.be.greaterThan(b0 + 19_600_000n);
    await expect(f.calls.connect(f.alice).claim(0)).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "AlreadyFinal");
  });

  it("a call nobody else traded doesn't move skill (no free farming), even with self-bets", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.creator).bet(0, true, 500n * USDC); // the creator's own volume doesn't count
    await f.calls.connect(f.alice).bet(0, false, 4n * USDC); // under minScoredVolume
    const hit = await later(f, HOUR, 106);
    await expect(f.calls.proveTouch(0, hit)).to.emit(f.calls, "Settled").withArgs(0, true, 0, f.creator.address, false);
    const s = await f.calls.stats(f.creator.address);
    expect([s.hits, s.skillBps, s.scored]).to.deep.equal([1, 0n, 0]);
  });

  it("pays creator fees and treasury fees to the right accounts only", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 100n * USDC);
    await later(f, 10 * MIN, 100);
    await f.calls.sync(0, 0); // the next round passed: fees are final
    const k0 = await f.token.balanceOf(f.creator.address);
    await f.calls.connect(f.creator).claimCreatorFees();
    expect((await f.token.balanceOf(f.creator.address)) - k0).to.equal(1n * USDC);
    await expect(f.calls.connect(f.creator).claimCreatorFees()).to.be.revertedWithCustomError(f.calls, "NothingToClaim");
    await expect(f.calls.connect(f.alice).withdrawTreasury()).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    const t0 = await f.token.balanceOf(f.treasury.address);
    await f.calls.connect(f.treasury).withdrawTreasury();
    expect((await f.token.balanceOf(f.treasury.address)) - t0).to.equal(1n * USDC);
  });

  it("pausing stops posting and betting but never claims or settlement", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await f.calls.setPaused(true);
    await expect(f.calls.connect(f.bob).bet(0, false, 5n * USDC)).to.be.revertedWithCustomError(f.calls, "Paused");
    await later(f, 10 * MIN, 101);
    const hit = await later(f, HOUR, 106);
    await f.calls.proveTouch(0, hit);
    await f.calls.connect(f.alice).claim(0);
    await f.calls.connect(f.creator).claimCreatorFees();
  });
});

describe("ThesisCalls: no racing the oracle", () => {
  it("a bet placed after an unproven crossing round settles the call YES and takes nothing", async () => {
    const f = await loadFixture(withCall);
    await later(f, HOUR, 105.5); // crosses; nobody has proven it
    await print(f, 103); // and the price falls back
    const a0 = await f.token.balanceOf(f.alice.address);
    await expect(f.calls.connect(f.alice).bet(0, true, 50n * USDC)).to.emit(f.calls, "Touched");
    expect(await f.token.balanceOf(f.alice.address)).to.equal(a0); // not taken
    const c = await f.calls.getCall(0);
    expect([c.touched, c.settled, c.yesWon, c.touchPrice]).to.deep.equal([true, true, true, PX(105.5)]);
  });

  it("audit C1: a YES bet on a stale print can't profit: the catch-up round refunds it", async () => {
    // The audit's attack: the last print is hours old, the market is already
    // through the strike, the attacker bets YES at the stale odds.
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const end = (await time.latest()) + 6 * HOUR;
    await f.calls.connect(f.creator).createCall(feed, true, PX(102.5), end, 250n * USDC, "");
    await later(f, 5 * MIN, 100.4); // a quiet round
    await time.increase(2 * HOUR - 10 * MIN); // the print goes stale; off-chain, SOL runs past $102.50
    const a0 = await f.token.balanceOf(f.alice.address);
    await f.calls.connect(f.alice).bet(0, true, 10n * USDC);
    const hit = await print(f, 102.7); // the oracle catches up
    await f.calls.proveTouch(0, hit);
    await f.calls.connect(f.alice).claim(0);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(a0); // got exactly her 10 back: no profit
  });

  it("audit C1: bets placed in the round before the touch (front-running the oracle) are refunded in full", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, false, 50n * USDC); // honest, rounds before the touch
    await later(f, HOUR, 103);
    const fees0 = await f.calls.treasuryFees();
    await f.calls.connect(f.bob).bet(0, true, 200n * USDC); // bets on the move the next print shows
    await time.increase(4 * MIN); // minutes later, not seconds: a whole round gap is covered
    const hit = await print(f, 105.5); // the touching round
    await f.calls.proveTouch(0, hit);
    const c = await f.calls.getCall(0);
    expect(c.voidYes).to.equal(196n * USDC);
    expect(await f.calls.treasuryFees()).to.equal(fees0 + 500_000n); // alice's fee was credited when her round passed; bob's never was
    const b0 = await f.token.balanceOf(f.bob.address);
    await f.calls.connect(f.bob).claim(0);
    expect((await f.token.balanceOf(f.bob.address)) - b0).to.equal(200n * USDC); // the full 200 back, fee included
    // The creator's seed YES takes the whole remaining pot (alice's NO stake).
    const k0 = await f.token.balanceOf(f.creator.address);
    await f.calls.connect(f.creator).claim(0);
    const pot = c.yesPool + c.noPool - c.voidYes - c.voidNo;
    expect((await f.token.balanceOf(f.creator.address)) - k0).to.be.closeTo(pot, 2n);
    // Everything owed is covered.
    await f.calls.connect(f.creator).claimCreatorFees();
    await f.calls.connect(f.treasury).withdrawTreasury();
    expect(await f.token.balanceOf(await f.calls.getAddress())).to.be.lessThan(3n);
  });

  it("re-audit N1: proving a later touching round still settles on the first one (no dodging the refund)", async () => {
    const f = await loadFixture(withCall);
    await later(f, HOUR, 103);
    await f.calls.connect(f.bob).bet(0, true, 200n * USDC);
    await time.increase(3 * MIN);
    const r1 = await print(f, 105.3); // first touch: bob's bet is in the round before it
    await time.increase(5 * MIN);
    const r2 = await print(f, 105.6); // a later touch
    await f.calls.proveTouch(0, r2);
    const c = await f.calls.getCall(0);
    expect(c.touchRound).to.equal(r1);
    expect(c.voidYes).to.equal(196n * USDC);
    expect(await f.calls.claimable(0, f.bob.address)).to.equal(200n * USDC);
  });

  it("re-audit N2: a call touched in its first round can't be rescued by proving a later round", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const end = (await time.latest()) + DAY;
    await f.calls.connect(f.creator).createCall(feed, true, PX(101.5), end, 100n * USDC, "");
    await time.increase(4 * MIN);
    await print(f, 101.7); // the first round after posting touches
    await time.increase(4 * MIN);
    const r2 = await print(f, 101.9);
    await expect(f.calls.proveTouch(0, r2)).to.emit(f.calls, "Voided").withArgs(0, 1);
    expect((await f.calls.stats(f.creator.address)).skillBps).to.equal(0n);
  });

  it("audit H1: a touch right after posting voids the call (posted into an unprinted move)", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const end = (await time.latest()) + DAY;
    await f.calls.connect(f.creator).createCall(feed, true, PX(101.5), end, 100n * USDC, "");
    await f.calls.connect(f.alice).bet(0, false, 10n * USDC);
    const hit = await print(f, 101.6);
    await expect(f.calls.proveTouch(0, hit)).to.emit(f.calls, "Voided").withArgs(0, 1);
    const c = await f.calls.getCall(0);
    expect([c.settled, c.voided]).to.deep.equal([true, true]);
    expect((await f.calls.stats(f.creator.address)).skillBps).to.equal(0n);
    const k0 = await f.token.balanceOf(f.creator.address);
    await f.calls.connect(f.creator).claim(0);
    expect((await f.token.balanceOf(f.creator.address)) - k0).to.equal(100n * USDC);
    const a0 = await f.token.balanceOf(f.alice.address);
    await f.calls.connect(f.alice).claim(0);
    expect((await f.token.balanceOf(f.alice.address)) - a0).to.equal(9_800_000n);
  });

  it("NO only wins after every round up to the deadline is checked; a missed touch is found", async () => {
    const f = await loadFixture(withCall);
    await later(f, HOUR, 106); // a touch nobody proved
    for (let i = 0; i < 60; i++) await print(f, 101); // a long gap after it
    await time.increaseTo(f.end + HOUR + 1);
    await f.calls.settle(0); // the scan finds it before anything else
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon]).to.deep.equal([true, true]);
  });

  it("a long backlog of quiet rounds needs sync() before NO can settle", async () => {
    const f = await loadFixture(withCall);
    for (let i = 0; i < 70; i++) await print(f, 101);
    await time.increaseTo(f.end + HOUR + 1);
    await print(f, 101); // a round after the deadline
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "SyncRequired");
    await expect(f.calls.sync(0, 100)).to.emit(f.calls, "Synced");
    await f.calls.settle(0);
    const c = await f.calls.getCall(0);
    expect([c.settled, c.yesWon, c.scanDone]).to.deep.equal([true, false, true]);
  });

  it("re-audit N3: voidCall settles NO when the oracle did print past the deadline", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await time.increaseTo(f.end + HOUR);
    await print(f, 101); // past the deadline, nobody settled
    await time.increaseTo(f.end + 3 * DAY + 1);
    await expect(f.calls.connect(f.alice).voidCall(0)).to.emit(f.calls, "Settled");
    const c = await f.calls.getCall(0);
    expect([c.settled, c.voided, c.yesWon]).to.deep.equal([true, false, false]);
    expect(await f.calls.claimable(0, f.alice.address)).to.equal(0n); // the YES loser gets no refund
  });

  it("re-audit N3: voidCall finds an unproven touch and settles YES", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.bob).bet(0, false, 20n * USDC);
    await later(f, 10 * MIN, 101);
    await later(f, HOUR, 106); // touched; nobody proved it, and the oracle then went silent
    await time.increaseTo(f.end + 3 * DAY + 1);
    await f.calls.connect(f.bob).voidCall(0);
    const c = await f.calls.getCall(0);
    expect([c.settled, c.voided, c.yesWon]).to.deep.equal([true, false, true]);
    expect(await f.calls.claimable(0, f.bob.address)).to.equal(0n);
  });

  it("re-audit N6: refunded outside bets don't make a call count toward skill", async () => {
    const f = await loadFixture(withCall);
    await later(f, HOUR, 103);
    await f.calls.connect(f.alice).bet(0, false, 6n * USDC); // a 'sybil' bet in the round before the touch
    await time.increase(3 * MIN);
    const hit = await print(f, 105.4);
    await expect(f.calls.proveTouch(0, hit)).to.emit(f.calls, "Settled").withArgs(0, true, 0, f.creator.address, false);
  });

  it("audit M2: if the oracle stops, the call voids after voidAfter and everyone is refunded", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await time.increaseTo(f.end + HOUR + 1);
    await expect(f.calls.settle(0)).to.be.revertedWithCustomError(f.calls, "AwaitingOracle"); // no NO by default
    await expect(f.calls.voidCall(0)).to.be.revertedWithCustomError(f.calls, "TooEarly");
    await time.increaseTo(f.end + 3 * DAY + 1);
    await expect(f.calls.voidCall(0)).to.emit(f.calls, "Voided").withArgs(0, 2);
    expect(await f.calls.claimable(0, f.alice.address)).to.equal(19_600_000n);
    expect(await f.calls.claimable(0, f.creator.address)).to.equal(100n * USDC);
    await f.calls.connect(f.alice).claim(0);
    await f.calls.connect(f.creator).claim(0);
    expect(await f.token.balanceOf(await f.calls.getAddress())).to.equal(400_000n); // only the fees remain
  });

  it("audit M2: a feed that starts reverting can't lock funds (and running out of gas can't fake that)", async () => {
    const f = await loadFixture(withCall);
    await f.calls.connect(f.alice).bet(0, true, 20n * USDC);
    await f.feed.setBroken(true); // the feed is retired mid-call
    await expect(f.calls.connect(f.bob).bet(0, false, 5n * USDC)).to.be.reverted;
    await time.increaseTo(f.end + HOUR + 1);
    await expect(f.calls.settle(0)).to.be.reverted;
    await time.increaseTo(f.end + 3 * DAY + 1);
    await f.calls.voidCall(0); // needs nothing from the feed
    const a0 = await f.token.balanceOf(f.alice.address);
    await f.calls.connect(f.alice).claim(0);
    expect((await f.token.balanceOf(f.alice.address)) - a0).to.equal(19_600_000n);
  });
});

describe("ThesisCalls: invariants", () => {
  it("random trading never pays out more than it holds (fuzz, 40 rounds)", async () => {
    const f = await deploy();
    const feed = await f.feed.getAddress();
    const users = [f.creator, f.alice, f.bob, f.carol];
    let seed = 7;
    const rnd = (n) => ((seed = (seed * 48271) % 2147483647) % n);
    for (let round = 0; round < 40; round++) {
      const end = (await time.latest()) + 2 * HOUR + rnd(DAY);
      const above = rnd(2) === 0;
      const strike = above ? PX(100 + 1 + rnd(4)) : PX(100 - 1 - rnd(4));
      await f.calls.connect(users[rnd(4)]).createCall(feed, above, strike, end, BigInt(5 + rnd(100)) * USDC, "").catch(() => null);
      const id = (await f.calls.callCount()) - 1n;
      for (let k = 0; k < 6; k++) {
        await f.calls.connect(users[rnd(4)]).bet(id, rnd(2) === 0, BigInt(1 + rnd(50)) * USDC).catch(() => null);
        if (rnd(3) === 0) await later(f, rnd(20 * MIN), 100 + (rnd(1000) - 500) / 100);
      }
      await time.increaseTo(end + HOUR + 2);
      await print(f, 100);
      const c = await f.calls.getCall(id);
      if (!c.settled) await f.calls.settle(id).catch(async () => { await f.calls.sync(id, 500); await f.calls.settle(id); });
      await print(f, 100);
    }
    // Everyone claims everything; fees are withdrawn; the contract never runs dry.
    const n = await f.calls.callCount();
    for (let id = 0n; id < n; id++) for (const u of users) if ((await f.calls.claimable(id, u.address)) > 0n) await f.calls.connect(u).claim(id);
    for (const u of users) if ((await f.calls.creatorFeesOwed(u.address)) > 0n) await f.calls.connect(u).claimCreatorFees();
    if ((await f.calls.treasuryFees()) > 0n) await f.calls.connect(f.treasury).withdrawTreasury();
    const left = await f.token.balanceOf(await f.calls.getAddress());
    expect(left).to.be.at.least(0n);
    expect(left).to.be.lessThan(BigInt(n) * 4n); // rounding dust only, a few units per call
  });
});

describe("ThesisCalls: admin", () => {
  it("bounds every parameter and keeps roles separate", async () => {
    const f = await deploy();
    await expect(f.calls.connect(f.alice).setParams(PARAMS)).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    for (const bad of [{ feeBps: 600 }, { minOpenBps: 50 }, { grace: 10 }, { minSeed: 10n }, { betCutoffBps: 100 }, { staleZTenths: 5 }, { closeBps: 6000 }, { voidAfter: HOUR }, { minScoredVolume: 0n }])
      await expect(f.calls.setParams({ ...PARAMS, ...bad }), JSON.stringify(bad, (k, v) => (typeof v === "bigint" ? v.toString() : v))).to.be.revertedWithCustomError(f.calls, "BadParams");
    await expect(f.calls.setParams(PARAMS)).to.emit(f.calls, "ParamsSet");
    await expect(f.calls.connect(f.alice).setVolatility(await f.feed.getAddress(), 7_000, 0)).to.be.revertedWithCustomError(f.calls, "Unauthorized");
    await expect(f.calls.connect(f.keeper).setVolatility(await f.feed.getAddress(), 500, 0)).to.be.revertedWithCustomError(f.calls, "BadParams");
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
    await mine(1);
  });
});
