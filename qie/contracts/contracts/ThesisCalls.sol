// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TouchMath} from "./TouchMath.sol";

/// @notice The QIE Oracle feeds are Chainlink-style aggregators.
interface IPriceFeed {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title ThesisCalls (QIE edition of Thesis)
/// @notice Trade calls as markets. A creator posts "BTC/ETH/SOL touches K
/// before T"; the contract prices it onchain (touch probability from spot,
/// distance, time and volatility) and opens two QUSDC pools seeded at those
/// odds. The crowd backs it (YES) or challenges it (NO). Anyone can prove a
/// touch with a QIE Oracle round inside the window, which settles YES at once;
/// otherwise it settles NO after the deadline plus a grace period. Winners
/// split the whole pot. Each settled call updates the creator's onchain skill
/// score: (1 if hit, else 0) minus the opening odds.
///
/// Resolution never depends on someone racing to submit a proof: before any
/// bet and before settling NO, the contract itself scans every oracle round
/// published since the call opened. A bet placed after a crossing round
/// settles the call YES instead of being taken, and NO wins only once every
/// round up to the deadline has been checked and the oracle has published a
/// round after it.
///
/// Oracle rounds arrive irregularly (minutes to hours apart), so the latest
/// print can lag the market. Three rules keep that lag from being traded:
/// - posting and betting need the strike at least z*sigma*sqrt(age) away from
///   the latest print (age = how old it is), so the market can't already be
///   through it; opening odds are priced over the unseen time since that print;
/// - every bet is tagged with the oracle round that was latest when it was
///   placed; if the very next round is the one that touches, those bets were
///   placed on a move the oracle hadn't printed yet, so they are refunded in
///   full (fee included) instead of paid. Their fees stay in escrow until the
///   next round passes without a touch. A call whose first round after posting
///   touches (or that touches within VOID_WINDOW of posting) is void;
/// - only the first touching round counts, whoever proves it;
/// - betting closes `closeBps` of the window before the deadline.
/// If the oracle stops publishing past the deadline (or the feed breaks), the
/// call can be voided after `voidAfter` and every stake is refunded (fees
/// already credited are kept). A call the oracle can settle is never voided.
contract ThesisCalls is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_TEXT_BYTES = 280;
    /// @notice Oracle rounds checked per bet / settle; `sync` catches up longer gaps.
    uint256 public constant SCAN_PER_TX = 48;
    /// @notice A touch this soon after posting (or in the first round after it) voids the call.
    uint256 public constant VOID_WINDOW = 60;
    /// @notice Rounds `proveTouch` and `voidCall` may scan in one transaction.
    uint256 public constant PROVE_SCAN_MAX = 300;

    enum VoidReason {
        None,
        EarlyTouch, // touched in the first round after posting, or within VOID_WINDOW
        OracleTimeout // no oracle round after the deadline within voidAfter, or the feed broke
    }

    // ------------------------------------------------------------ config

    IERC20 public immutable stakeToken;
    /// @notice Creators' share of each trade fee, in bps of the fee. Fixed at deploy.
    uint16 public immutable creatorShareBps;

    address public owner;
    address public pendingOwner;
    address public keeper;
    address public treasury;
    bool public paused;

    struct Params {
        uint16 feeBps; // per bet, of the amount (200 = 2%); <= 500
        uint64 minSeed; // token units
        uint64 maxSeed;
        uint64 minStake;
        uint32 minWindow; // seconds
        uint32 maxWindow;
        uint32 grace; // after end_ts, to submit a late proof
        uint32 maxOracleAge; // latest print freshness, for posting and betting
        uint32 maxVolAge; // volatility freshness at posting
        uint16 minDistanceBps; // strike distance from spot
        uint16 maxDistanceBps;
        uint16 minOpenBps; // opening odds bounds
        uint16 maxOpenBps;
        uint16 betCutoffBps; // no new bets while the latest price is this close to the strike
        uint16 staleZTenths; // z for the z*sigma*sqrt(age) margin, in tenths (30 = 3.0)
        uint16 closeBps; // betting closes this share of the window before the deadline
        uint32 voidAfter; // after end: no oracle round past the deadline by then => void
        uint64 minScoredVolume; // outside volume a call needs to count toward skill
    }

    Params public params;

    struct Feed {
        bool enabled;
        uint32 volBps; // annualised volatility (6000 = 60%)
        uint32 monitorSecs; // typical gap between oracle rounds (discrete-monitoring correction)
        uint64 volUpdatedAt;
    }

    mapping(address => Feed) public feeds;
    address[] public feedList;

    // ------------------------------------------------------------ calls

    struct Call {
        address creator;
        address feed;
        bool above; // true: touches at or above strike; false: at or below
        bool touched;
        bool settled;
        bool yesWon;
        uint16 openBps; // opening odds of YES
        uint64 start;
        uint64 end;
        int256 strike; // feed units
        int256 spotAtOpen;
        uint80 touchRound;
        int256 touchPrice;
        uint80 checkedRound; // every round up to this one has been checked for a touch
        bool scanDone; // a round after `end` was reached: nothing left to check
        bool voided; // settled as void: every stake refunded
        uint16 feeBps; // fee for this call, fixed at posting
        uint32 grace; // proof grace for this call, fixed at posting
        uint64 closeAt; // betting closes at this time
        uint64 oracleAt; // time of the print the opening odds used
        uint64 touchAt; // time of the touching round
        uint80 openRound; // latest round when the call was posted
        uint32 voidAfter; // fixed at posting
        uint64 minScored; // outside volume needed to score, fixed at posting
        uint256 yesPool; // net of fees
        uint256 noPool;
        uint256 volume; // gross bets
        uint256 outsideVolume; // gross bets by others than the creator (refunded ones excluded)
        uint256 voidYes; // net stakes refunded because they were placed in the round before the touch
        uint256 voidNo;
    }

    /// @notice Bets placed while `round` was the latest print, not final yet:
    /// if round + 1 touches they are refunded; once it passes, they're final
    /// and their fees are credited.
    struct Pending {
        uint80 round;
        uint128 yesNet;
        uint128 noNet;
        uint128 outside; // gross, by others than the creator
        uint128 creatorFee;
        uint128 treasuryFee;
    }

    /// @notice A wallet's bets in its latest round (see Pending).
    struct UserPending {
        uint80 round;
        uint128 yesNet;
        uint128 noNet;
        uint128 gross;
    }

    Call[] internal calls;
    mapping(uint256 => string) public callText;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => Pending) public pending;
    mapping(uint256 => mapping(address => UserPending)) public userPending;

    struct Stats {
        uint32 posted;
        uint32 hits;
        uint32 misses;
        int64 skillBps; // sum over scored calls of (hit ? 10000 : 0) - openBps
        uint128 volume; // gross bets on their calls
        uint32 scored; // settled calls with enough outside volume to count toward skill
    }

    mapping(address => Stats) public stats;
    address[] public creators;
    mapping(address => uint256) public creatorFeesOwed;
    uint256 public treasuryFees;

    // ------------------------------------------------------------ events

    event CallCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed feed,
        bool above,
        int256 strike,
        int256 spot,
        uint64 start,
        uint64 end,
        uint16 openBps,
        uint256 seed,
        string text
    );
    event Bet(uint256 indexed id, address indexed user, bool yes, uint256 amount, uint256 fee, uint256 yesPool, uint256 noPool);
    event Touched(uint256 indexed id, uint80 roundId, int256 price, uint256 updatedAt, address prover);
    event Settled(uint256 indexed id, bool yesWon, int64 skillDeltaBps, address indexed creator, bool scored);
    event Voided(uint256 indexed id, VoidReason reason);
    event Synced(uint256 indexed id, uint80 checkedRound, bool caughtUp);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event FeedSet(address indexed feed, bool enabled, uint32 volBps, uint32 monitorSecs);
    event VolatilitySet(address indexed feed, uint32 volBps, uint32 monitorSecs);
    event ParamsSet(Params params);
    event PausedSet(bool paused);
    event KeeperSet(address keeper);
    event TreasurySet(address treasury);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ------------------------------------------------------------ errors

    error Unauthorized();
    error Paused();
    error BadParams();
    error FeedNotEnabled();
    error StaleOracle();
    error StaleVolatility();
    error BadPrice();
    error StrikeWrongSide();
    error StrikeDistance();
    error BadWindow();
    error OddsOutOfRange();
    error BadSeed();
    error TextTooLong();
    error UnknownCall();
    error CallClosed();
    error StakeTooSmall();
    error AlreadyFinal();
    error ProofTooLate();
    error RoundOutsideWindow();
    error NoTouch();
    error TooEarly();
    error NotSettled();
    error NothingToClaim();
    error SyncRequired();
    error NearStrike();
    error AwaitingOracle();
    error OutOfGas();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(IERC20 stakeToken_, address treasury_, address keeper_, uint16 creatorShareBps_, Params memory params_) {
        if (address(stakeToken_) == address(0) || treasury_ == address(0) || creatorShareBps_ > BPS) revert BadParams();
        stakeToken = stakeToken_;
        creatorShareBps = creatorShareBps_;
        owner = msg.sender;
        treasury = treasury_;
        keeper = keeper_;
        _setParams(params_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------ admin

    function _setParams(Params memory p) internal {
        if (
            p.feeBps > 500 || p.minSeed == 0 || p.minSeed > p.maxSeed || p.minStake == 0 || p.minWindow < 300
                || p.minWindow > p.maxWindow || p.maxWindow > 30 days || p.grace < 60 || p.grace > 1 days
                || p.maxOracleAge == 0 || p.maxOracleAge > 1 days || p.maxVolAge == 0 || p.minDistanceBps == 0
                || p.minDistanceBps > p.maxDistanceBps || p.maxDistanceBps > 9_000 || p.minOpenBps < 100
                || p.minOpenBps > p.maxOpenBps || p.maxOpenBps > 9_900 || p.betCutoffBps > 500
                || p.betCutoffBps >= p.minDistanceBps || p.staleZTenths < 10 || p.staleZTenths > 60
                || p.closeBps > 5_000 || p.voidAfter < 1 days || p.voidAfter > 30 days || p.minScoredVolume == 0
        ) revert BadParams();
        // A pool must start with stake on both sides: seed * minOpenBps / BPS > 0.
        if ((uint256(p.minSeed) * p.minOpenBps) / BPS == 0) revert BadParams();
        params = p;
        emit ParamsSet(p);
    }

    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    /// @notice Enable or disable an oracle feed (calls already open keep working).
    function setFeed(address feed, bool enabled, uint32 volBps, uint32 monitorSecs) external onlyOwner {
        if (feed == address(0) || volBps < 1_000 || volBps > 30_000 || monitorSecs > 1 days) revert BadParams();
        if (!feeds[feed].enabled && feeds[feed].volUpdatedAt == 0) feedList.push(feed);
        feeds[feed] = Feed({enabled: enabled, volBps: volBps, monitorSecs: monitorSecs, volUpdatedAt: uint64(block.timestamp)});
        emit FeedSet(feed, enabled, volBps, monitorSecs);
    }

    /// @notice Keeper (or owner) posts a feed's annualised volatility (7-day
    /// realised) and its typical gap between oracle rounds.
    function setVolatility(address feed, uint32 volBps, uint32 monitorSecs) external {
        if (msg.sender != keeper && msg.sender != owner) revert Unauthorized();
        if (feeds[feed].volUpdatedAt == 0 || volBps < 1_000 || volBps > 30_000 || monitorSecs > 1 days) revert BadParams();
        feeds[feed].volBps = volBps;
        feeds[feed].monitorSecs = monitorSecs;
        feeds[feed].volUpdatedAt = uint64(block.timestamp);
        emit VolatilitySet(feed, volBps, monitorSecs);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert BadParams();
        treasury = t;
        emit TreasurySet(t);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner || msg.sender == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function withdrawTreasury() external nonReentrant {
        if (msg.sender != owner && msg.sender != treasury) revert Unauthorized();
        uint256 amount = treasuryFees;
        if (amount == 0) revert NothingToClaim();
        treasuryFees = 0;
        stakeToken.safeTransfer(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
    }

    // ------------------------------------------------------------ calls

    /// @notice Post a call: `feed` touches `strike` (feed units) before `end`.
    /// The creator's `seed` opens both pools at the onchain odds.
    function createCall(address feed, bool above, int256 strike, uint64 end, uint256 seed, string calldata text)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        Params memory p = params;
        if (bytes(text).length > MAX_TEXT_BYTES) revert TextTooLong();
        if (seed < p.minSeed || seed > p.maxSeed) revert BadSeed();
        if (end <= block.timestamp) revert BadWindow();
        uint256 window = end - block.timestamp;
        if (window < p.minWindow || window > p.maxWindow) revert BadWindow();
        (uint256 open, int256 spot, uint80 roundId, uint256 updatedAt) = _price(feed, above, strike, end, p);

        stakeToken.safeTransferFrom(msg.sender, address(this), seed);
        uint256 yes = (seed * open) / BPS;
        uint256 no = seed - yes;

        id = calls.length;
        Call storage c = calls.push();
        c.creator = msg.sender;
        c.feed = feed;
        c.above = above;
        c.openBps = uint16(open);
        c.start = uint64(block.timestamp);
        c.end = end;
        c.strike = strike;
        c.spotAtOpen = spot;
        c.checkedRound = roundId;
        c.feeBps = p.feeBps;
        c.grace = p.grace;
        c.closeAt = uint64(end - (window * p.closeBps) / BPS);
        c.oracleAt = uint64(updatedAt);
        c.openRound = roundId;
        c.voidAfter = p.voidAfter;
        c.minScored = p.minScoredVolume;
        c.yesPool = yes;
        c.noPool = no;
        if (bytes(text).length > 0) callText[id] = text;
        yesStake[id][msg.sender] = yes;
        noStake[id][msg.sender] = no;

        Stats storage s = stats[msg.sender];
        if (s.posted == 0 && s.hits == 0 && s.misses == 0) creators.push(msg.sender);
        s.posted += 1;
        emit CallCreated(id, msg.sender, feed, above, strike, spot, uint64(block.timestamp), end, uint16(open), seed, text);
    }

    /// @dev Every check a new call must pass, and its opening odds. The odds
    /// run from the latest print (not from now): the market has moved unseen
    /// since then, so that time counts as part of the window.
    function _price(address feed, bool above, int256 strike, uint64 end, Params memory p)
        internal
        view
        returns (uint256 open, int256 spot, uint80 roundId, uint256 updatedAt)
    {
        Feed memory f = feeds[feed];
        if (!f.enabled) revert FeedNotEnabled();
        if (block.timestamp - f.volUpdatedAt > p.maxVolAge) revert StaleVolatility();
        (roundId, spot,, updatedAt,) = IPriceFeed(feed).latestRoundData();
        if (spot <= 0 || strike <= 0) revert BadPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > p.maxOracleAge) revert StaleOracle();
        // The strike must be ahead of the latest price, by at least minDistanceBps
        // and by more than the market can plausibly have moved since that print:
        // nobody can post a call the market has already reached.
        if (above ? strike <= spot : strike >= spot) revert StrikeWrongSide();
        uint256 dist = TouchMath.distanceBps(uint256(spot), uint256(strike));
        uint256 stale = TouchMath.staleMoveBps(f.volBps, block.timestamp - updatedAt, p.staleZTenths);
        if (dist < p.minDistanceBps || dist < stale || dist > p.maxDistanceBps) revert StrikeDistance();
        open = TouchMath.touchProbabilityBps(uint256(spot), uint256(strike), f.volBps, end - updatedAt, f.monitorSecs);
        if (open < p.minOpenBps || open > p.maxOpenBps) revert OddsOutOfRange();
    }

    /// @notice Back (yes) or challenge (no) a call. A fee (the call's feeBps) is
    /// split between the call's creator and the treasury; the rest joins the pool.
    /// Before taking it, every oracle round since the last check is scanned: if
    /// one already touched the strike, the call settles YES and nothing is taken.
    /// Betting closes at `closeAt`, while the latest print is too old, and while
    /// the strike is within z*sigma*sqrt(age) (at least betCutoffBps) of it.
    function bet(uint256 id, bool yes, uint256 amount) external nonReentrant whenNotPaused {
        Call storage c = _call(id);
        if (c.settled || block.timestamp >= c.closeAt) revert CallClosed();
        if (amount < params.minStake) revert StakeTooSmall();
        bool caughtUp = _scan(id, c, SCAN_PER_TX);
        if (c.settled) return; // touched (or voided) just now; the bet is not taken
        if (!caughtUp) revert SyncRequired();
        (uint256 needBps, uint256 distBps, uint80 tag) = _betGap(c);
        if (distBps < needBps) revert NearStrike();
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * c.feeBps) / BPS;
        uint256 toCreator = (fee * creatorShareBps) / BPS;
        uint256 net = amount - fee;
        // This bet joins the pending bets of round `tag`: final (and its fee
        // credited) once the next round passes without a touch.
        Pending storage pd = pending[id];
        if (pd.round != tag) {
            _release(c, pd);
            pd.round = tag;
        }
        pd.creatorFee += uint128(toCreator);
        pd.treasuryFee += uint128(fee - toCreator);
        UserPending storage up = userPending[id][msg.sender];
        if (up.round != tag) userPending[id][msg.sender] = UserPending({round: tag, yesNet: 0, noNet: 0, gross: 0});
        up.gross += uint128(amount);
        if (yes) {
            c.yesPool += net;
            yesStake[id][msg.sender] += net;
            pd.yesNet += uint128(net);
            up.yesNet += uint128(net);
        } else {
            c.noPool += net;
            noStake[id][msg.sender] += net;
            pd.noNet += uint128(net);
            up.noNet += uint128(net);
        }
        c.volume += amount;
        if (msg.sender != c.creator) {
            c.outsideVolume += amount;
            pd.outside += uint128(amount);
        }
        stats[c.creator].volume += uint128(amount);
        emit Bet(id, msg.sender, yes, amount, fee, c.yesPool, c.noPool);
    }

    /// @dev Distance the strike needs from the latest print to take a bet, the
    /// distance it has, and that print's round. Reverts if the print is too old
    /// to bet on at all.
    function _betGap(Call storage c) internal view returns (uint256 needBps, uint256 distBps, uint80 round) {
        int256 last;
        uint256 updatedAt;
        (round, last,, updatedAt,) = IPriceFeed(c.feed).latestRoundData();
        if (last <= 0 || updatedAt > block.timestamp) revert BadPrice();
        uint256 age = block.timestamp - updatedAt;
        if (age > params.maxOracleAge) revert StaleOracle();
        needBps = TouchMath.staleMoveBps(feeds[c.feed].volBps, age, params.staleZTenths);
        if (needBps < params.betCutoffBps) needBps = params.betCutoffBps;
        distBps = TouchMath.distanceBps(uint256(last), uint256(c.strike));
    }

    /// @notice Anyone: prove the call touched with an oracle round published
    /// inside the window. Every unchecked round up to `roundId` is checked in
    /// order, so the call settles on the FIRST touching round (whichever one
    /// was named). Settles YES at once (or void, if it touched right after posting).
    function proveTouch(uint256 id, uint80 roundId) external nonReentrant {
        Call storage c = _call(id);
        if (c.touched || c.settled) revert AlreadyFinal();
        if (block.timestamp > uint256(c.end) + c.grace) revert ProofTooLate();
        if (roundId <= c.checkedRound) revert RoundOutsideWindow(); // before the call, or already checked
        if (roundId - c.checkedRound > PROVE_SCAN_MAX) revert SyncRequired();
        _scan(id, c, roundId - c.checkedRound);
        if (!c.settled) revert NoTouch();
    }

    /// @notice Anyone: check oracle rounds not yet checked (up to `maxRounds`);
    /// a crossing round inside the window settles the call YES.
    /// @return caughtUp every round that matters has now been checked
    function sync(uint256 id, uint256 maxRounds) external nonReentrant returns (bool caughtUp) {
        Call storage c = _call(id);
        if (c.settled) return true;
        caughtUp = _scan(id, c, maxRounds == 0 ? SCAN_PER_TX : maxRounds);
        emit Synced(id, c.checkedRound, caughtUp);
    }

    /// @notice Anyone, after the deadline and grace period: settles NO, but
    /// only once every oracle round up to the deadline has been checked and
    /// the oracle has published a round after it (a crossing round found on
    /// the way settles it YES instead).
    function settle(uint256 id) external nonReentrant {
        Call storage c = _call(id);
        if (c.settled) revert AlreadyFinal();
        if (block.timestamp <= uint256(c.end) + c.grace) revert TooEarly();
        bool caughtUp = _scan(id, c, SCAN_PER_TX);
        if (c.settled) return; // a touch was found
        if (!caughtUp) revert SyncRequired();
        if (!c.scanDone) revert AwaitingOracle(); // no round after the deadline yet
        _settle(id, c, false);
    }

    /// @notice Anyone, `voidAfter` past the deadline: settles the call if the
    /// oracle can (a touch found settles YES, a round past the deadline settles
    /// NO); voids it only if the feed is broken or still hasn't printed past the
    /// deadline, and every stake is refunded.
    function voidCall(uint256 id) external nonReentrant {
        Call storage c = _call(id);
        if (c.settled) revert AlreadyFinal();
        if (block.timestamp <= uint256(c.end) + c.voidAfter) revert TooEarly();
        bool scanned;
        bool caughtUp;
        uint256 g = gasleft();
        try this.scanFor(id, PROVE_SCAN_MAX) returns (bool cu) {
            scanned = true;
            caughtUp = cu;
        } catch {
            // A broken feed reverts quickly; running out of gas doesn't count.
            if (gasleft() <= g / 63) revert OutOfGas();
        }
        if (c.settled) return; // a touch was found
        if (scanned) {
            if (c.scanDone) return _settle(id, c, false); // the oracle did print past the deadline: NO
            // A long backlog: catch up first. Unless it can never be caught up
            // (e.g. round ids jumped), in which case void after twice the wait.
            if (!caughtUp && block.timestamp <= uint256(c.end) + 2 * uint256(c.voidAfter)) revert SyncRequired();
        }
        _void(id, c, VoidReason.OracleTimeout);
    }

    /// @dev For voidCall only: the scan as an external call, so a feed that
    /// reverts can be caught.
    function scanFor(uint256 id, uint256 maxRounds) external returns (bool) {
        if (msg.sender != address(this)) revert Unauthorized();
        return _scan(id, calls[id], maxRounds);
    }

    /// @dev Walks rounds after `checkedRound`, at most `maxRounds`. Rounds the
    /// feed can't return are skipped. Stops at the first round published after
    /// `end` (nothing later can count). Returns whether it has caught up.
    function _scan(uint256 id, Call storage c, uint256 maxRounds) internal returns (bool) {
        if (c.scanDone || c.touched) return true;
        (uint80 latest,,,,) = IPriceFeed(c.feed).latestRoundData();
        uint80 r = c.checkedRound;
        uint256 steps;
        while (r < latest && steps < maxRounds) {
            r += 1;
            steps += 1;
            try IPriceFeed(c.feed).getRoundData(r) returns (uint80, int256 price, uint256, uint256 updatedAt, uint80) {
                if (updatedAt > c.end) {
                    c.checkedRound = r - 1;
                    c.scanDone = true;
                    return true;
                }
                if (updatedAt >= c.start && price > 0 && (c.above ? price >= c.strike : price <= c.strike)) {
                    c.checkedRound = r;
                    _touch(id, c, r, price, updatedAt);
                    return true;
                }
            } catch {}
        }
        c.checkedRound = r;
        // The round after the pending bets' round passed without a touch: they're final.
        if (r > pending[id].round) _release(c, pending[id]);
        return r >= latest;
    }

    /// @dev Pending bets become final: credit their fees, forget the escrow.
    function _release(Call storage c, Pending storage pd) internal {
        if (pd.creatorFee | pd.treasuryFee | pd.yesNet | pd.noNet | pd.outside == 0) return;
        creatorFeesOwed[c.creator] += pd.creatorFee;
        treasuryFees += pd.treasuryFee;
        pd.creatorFee = 0;
        pd.treasuryFee = 0;
        pd.yesNet = 0;
        pd.noNet = 0;
        pd.outside = 0;
    }

    function _touch(uint256 id, Call storage c, uint80 roundId, int256 price, uint256 updatedAt) internal {
        c.touched = true;
        c.touchRound = roundId;
        c.touchPrice = price;
        c.touchAt = uint64(updatedAt);
        emit Touched(id, roundId, price, updatedAt, msg.sender);
        // Touched in the very first round after posting (or within VOID_WINDOW):
        // the call was posted into a move the oracle hadn't printed yet. Void it.
        if (roundId == c.openRound + 1 || updatedAt < uint256(c.start) + VOID_WINDOW) {
            _void(id, c, VoidReason.EarlyTouch);
            return;
        }
        // Bets placed while the round just before this one was the latest were
        // betting on a move not yet printed: refund them in full (their fees are
        // still in escrow), and don't count them toward the creator's score.
        Pending storage pd = pending[id];
        if (uint256(pd.round) + 1 == roundId) {
            c.voidYes = pd.yesNet;
            c.voidNo = pd.noNet;
            c.outsideVolume -= pd.outside;
            pd.creatorFee = 0; // these fees fund the full refunds
            pd.treasuryFee = 0;
        } else {
            _release(c, pd);
        }
        _settle(id, c, true);
    }

    function _settle(uint256 id, Call storage c, bool yesWon) internal {
        c.settled = true;
        c.yesWon = yesWon;
        int64 delta = int64(int256(yesWon ? BPS : 0) - int256(uint256(c.openBps)));
        Stats storage s = stats[c.creator];
        if (yesWon) s.hits += 1;
        else s.misses += 1;
        // Only calls others actually traded count toward skill: a call nobody
        // bet on cost its creator nothing, so it proves nothing.
        if (!yesWon) _release(c, pending[id]);
        bool scored = c.outsideVolume >= c.minScored;
        if (scored) {
            s.skillBps += delta;
            s.scored += 1;
        } else {
            delta = 0;
        }
        emit Settled(id, yesWon, delta, c.creator, scored);
    }

    function _void(uint256 id, Call storage c, VoidReason reason) internal {
        _release(c, pending[id]); // a void refunds net stakes; fees already paid are kept
        c.settled = true;
        c.voided = true;
        emit Voided(id, reason);
    }

    /// @notice Winners take the whole pot pro rata to their winning stake;
    /// refunded stakes (void call, or placed right before the touch) come back.
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        Call storage c = _call(id);
        if (!c.settled) revert NotSettled();
        if (claimed[id][msg.sender]) revert NothingToClaim();
        amount = _claimable(id, c, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[id][msg.sender] = true;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        amount = creatorFeesOwed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        creatorFeesOwed[msg.sender] = 0;
        stakeToken.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------ views

    function _call(uint256 id) internal view returns (Call storage) {
        if (id >= calls.length) revert UnknownCall();
        return calls[id];
    }

    function _payout(Call storage c, uint256 stake, bool yesSide) internal view returns (uint256) {
        uint256 side = yesSide ? c.yesPool : c.noPool;
        if (stake == 0 || side == 0) return 0;
        return (stake * (c.yesPool + c.noPool)) / side;
    }

    /// @dev What `user` gets from a settled call (ignores `claimed`).
    function _claimable(uint256 id, Call storage c, address user) internal view returns (uint256) {
        uint256 y = yesStake[id][user];
        uint256 n = noStake[id][user];
        if (c.voided) return y + n;
        if (!c.yesWon) return _payout(c, n, false);
        // YES: bets placed in the round just before the touch are refunded in
        // full (fee included); the rest share the pot left once they're out.
        uint256 refund;
        uint256 stake = y;
        UserPending storage up = userPending[id][user];
        if (uint256(up.round) + 1 == c.touchRound && c.voidYes + c.voidNo > 0) {
            refund = up.gross;
            stake = y - up.yesNet;
        }
        uint256 side = c.yesPool - c.voidYes;
        uint256 pot = c.yesPool + c.noPool - c.voidYes - c.voidNo;
        return refund + (stake == 0 ? 0 : (stake * pot) / side);
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function getCall(uint256 id) external view returns (Call memory) {
        return _call(id);
    }

    /// @notice Calls `[from, from + count)`, clipped to what exists.
    function getCalls(uint256 from, uint256 count) external view returns (Call[] memory out) {
        uint256 n = calls.length;
        if (from >= n) return new Call[](0);
        uint256 to = from + count > n ? n : from + count;
        out = new Call[](to - from);
        for (uint256 i = from; i < to; i++) out[i - from] = calls[i];
    }

    /// @notice YES probability implied by the pools, in bps.
    function impliedYesBps(uint256 id) external view returns (uint256) {
        Call storage c = _call(id);
        return (c.yesPool * BPS) / (c.yesPool + c.noPool);
    }

    /// @notice What a bet would add to the pool and pay if its side wins (if no one else bets).
    function quote(uint256 id, bool yes, uint256 amount) external view returns (uint256 net, uint256 payoutIfWin) {
        Call storage c = _call(id);
        net = amount - (amount * c.feeBps) / BPS;
        uint256 side = (yes ? c.yesPool : c.noPool) + net;
        payoutIfWin = (net * (c.yesPool + c.noPool + net)) / side;
    }

    /// @notice A wallet's stakes in a call and what each side would pay it now.
    function position(uint256 id, address user)
        external
        view
        returns (uint256 yes, uint256 no, bool hasClaimed, uint256 payoutIfYes, uint256 payoutIfNo)
    {
        Call storage c = _call(id);
        yes = yesStake[id][user];
        no = noStake[id][user];
        hasClaimed = claimed[id][user];
        payoutIfYes = _payout(c, yes, true);
        payoutIfNo = _payout(c, no, false);
    }

    /// @notice What `user` can claim from call `id` now (0 if open, claimed or lost).
    function claimable(uint256 id, address user) external view returns (uint256) {
        Call storage c = _call(id);
        if (!c.settled || claimed[id][user]) return 0;
        return _claimable(id, c, user);
    }

    /// @notice Whether call `id` takes bets right now, and if not, why:
    /// the distance the strike needs from the latest print and the distance
    /// it has (bets need dist >= need), and the print's age.
    function betStatus(uint256 id) external view returns (bool open, uint256 needBps, uint256 distBps, uint256 oracleAge) {
        Call storage c = _call(id);
        (, int256 last,, uint256 updatedAt,) = IPriceFeed(c.feed).latestRoundData();
        oracleAge = updatedAt > block.timestamp ? 0 : block.timestamp - updatedAt;
        // (Indicative: bet() also checks unscanned rounds first.)
        if (last > 0) distBps = TouchMath.distanceBps(uint256(last), uint256(c.strike));
        needBps = TouchMath.staleMoveBps(feeds[c.feed].volBps, oracleAge, params.staleZTenths);
        if (needBps < params.betCutoffBps) needBps = params.betCutoffBps;
        open = !paused && !c.settled && block.timestamp < c.closeAt && oracleAge <= params.maxOracleAge && last > 0
            && distBps >= needBps;
    }

    function creatorCount() external view returns (uint256) {
        return creators.length;
    }

    /// @notice Creators `[from, from + count)` and their stats (for the leaderboard).
    function getCreators(uint256 from, uint256 count) external view returns (address[] memory who, Stats[] memory s) {
        uint256 n = creators.length;
        if (from >= n) return (new address[](0), new Stats[](0));
        uint256 to = from + count > n ? n : from + count;
        who = new address[](to - from);
        s = new Stats[](to - from);
        for (uint256 i = from; i < to; i++) {
            who[i - from] = creators[i];
            s[i - from] = stats[creators[i]];
        }
    }

    function feedCount() external view returns (uint256) {
        return feedList.length;
    }

    /// @notice Opening odds a call would get right now (for the Post form).
    /// Reverts with the same error createCall would.
    function previewOpenBps(address feed, bool above, int256 strike, uint64 end) external view returns (uint256 openBps, int256 spot) {
        Params memory p = params;
        if (end <= block.timestamp) revert BadWindow();
        uint256 window = end - block.timestamp;
        if (window < p.minWindow || window > p.maxWindow) revert BadWindow();
        (openBps, spot,,) = _price(feed, above, strike, end, p);
    }

    /// @notice The least strike distance a new call on `feed` needs right now, in bps.
    function minDistanceNow(address feed) external view returns (uint256) {
        (,,, uint256 updatedAt,) = IPriceFeed(feed).latestRoundData();
        uint256 age = updatedAt > block.timestamp ? 0 : block.timestamp - updatedAt;
        uint256 stale = TouchMath.staleMoveBps(feeds[feed].volBps, age, params.staleZTenths);
        return stale > params.minDistanceBps ? stale : params.minDistanceBps;
    }
}
