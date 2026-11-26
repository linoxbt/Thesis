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
/// round up to the deadline has been checked.
contract ThesisCalls is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_TEXT_BYTES = 280;
    /// @notice Oracle rounds checked per bet / settle; `sync` catches up longer gaps.
    uint256 public constant SCAN_PER_TX = 48;

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
        uint32 maxOracleAge; // spot freshness at posting
        uint32 maxVolAge; // volatility freshness at posting
        uint16 minDistanceBps; // strike distance from spot
        uint16 maxDistanceBps;
        uint16 minOpenBps; // opening odds bounds
        uint16 maxOpenBps;
        uint16 betCutoffBps; // no new bets while the latest price is this close to the strike
    }

    Params public params;

    struct Feed {
        bool enabled;
        uint32 volBps; // annualised volatility (6000 = 60%)
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
        uint256 yesPool; // net of fees
        uint256 noPool;
        uint256 volume; // gross bets
    }

    Call[] internal calls;
    mapping(uint256 => string) public callText;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool)) public claimed;

    struct Stats {
        uint32 posted;
        uint32 hits;
        uint32 misses;
        int64 skillBps; // sum over settled calls of (hit ? 10000 : 0) - openBps
        uint128 volume; // gross bets on their calls
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
    event Settled(uint256 indexed id, bool yesWon, int64 skillDeltaBps, address indexed creator);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event FeedSet(address indexed feed, bool enabled, uint32 volBps);
    event VolatilitySet(address indexed feed, uint32 volBps);
    event ParamsSet();
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
                || p.betCutoffBps >= p.minDistanceBps
        ) revert BadParams();
        // A pool must start with stake on both sides: seed * minOpenBps / BPS > 0.
        if ((uint256(p.minSeed) * p.minOpenBps) / BPS == 0) revert BadParams();
        params = p;
        emit ParamsSet();
    }

    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    /// @notice Enable or disable an oracle feed (calls already open keep working).
    function setFeed(address feed, bool enabled, uint32 volBps) external onlyOwner {
        if (feed == address(0) || volBps < 1_000 || volBps > 30_000) revert BadParams();
        if (!feeds[feed].enabled && feeds[feed].volUpdatedAt == 0) feedList.push(feed);
        feeds[feed] = Feed({enabled: enabled, volBps: volBps, volUpdatedAt: uint64(block.timestamp)});
        emit FeedSet(feed, enabled, volBps);
    }

    /// @notice Keeper (or owner) posts a feed's annualised volatility, e.g. 7-day realised.
    function setVolatility(address feed, uint32 volBps) external {
        if (msg.sender != keeper && msg.sender != owner) revert Unauthorized();
        if (feeds[feed].volUpdatedAt == 0 || volBps < 1_000 || volBps > 30_000) revert BadParams();
        feeds[feed].volBps = volBps;
        feeds[feed].volUpdatedAt = uint64(block.timestamp);
        emit VolatilitySet(feed, volBps);
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
        Feed memory f = feeds[feed];
        if (!f.enabled) revert FeedNotEnabled();
        if (block.timestamp - f.volUpdatedAt > p.maxVolAge) revert StaleVolatility();
        if (bytes(text).length > MAX_TEXT_BYTES) revert TextTooLong();
        if (seed < p.minSeed || seed > p.maxSeed) revert BadSeed();

        (uint80 roundId, int256 spot,, uint256 updatedAt,) = IPriceFeed(feed).latestRoundData();
        if (spot <= 0 || strike <= 0) revert BadPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > p.maxOracleAge) revert StaleOracle();
        // The strike must be ahead of the latest price, by at least minDistanceBps:
        // nobody can post a call the market has already reached.
        if (above ? strike <= spot : strike >= spot) revert StrikeWrongSide();
        uint256 dist = TouchMath.distanceBps(uint256(spot), uint256(strike));
        if (dist < p.minDistanceBps || dist > p.maxDistanceBps) revert StrikeDistance();

        if (end <= block.timestamp) revert BadWindow();
        uint256 tau = end - block.timestamp;
        if (tau < p.minWindow || tau > p.maxWindow) revert BadWindow();
        uint256 open = TouchMath.touchProbabilityBps(uint256(spot), uint256(strike), f.volBps, tau);
        if (open < p.minOpenBps || open > p.maxOpenBps) revert OddsOutOfRange();

        stakeToken.safeTransferFrom(msg.sender, address(this), seed);
        uint256 yes = (seed * open) / BPS;
        uint256 no = seed - yes;

        id = calls.length;
        calls.push(
            Call({
                creator: msg.sender,
                feed: feed,
                above: above,
                touched: false,
                settled: false,
                yesWon: false,
                openBps: uint16(open),
                start: uint64(block.timestamp),
                end: end,
                strike: strike,
                spotAtOpen: spot,
                touchRound: 0,
                touchPrice: 0,
                checkedRound: roundId,
                scanDone: false,
                yesPool: yes,
                noPool: no,
                volume: 0
            })
        );
        if (bytes(text).length > 0) callText[id] = text;
        yesStake[id][msg.sender] = yes;
        noStake[id][msg.sender] = no;

        Stats storage s = stats[msg.sender];
        if (s.posted == 0 && s.hits == 0 && s.misses == 0) creators.push(msg.sender);
        s.posted += 1;
        emit CallCreated(id, msg.sender, feed, above, strike, spot, uint64(block.timestamp), end, uint16(open), seed, text);
    }

    /// @notice Back (yes) or challenge (no) a call. A 2% fee (params.feeBps) is
    /// split between the call's creator and the treasury; the rest joins the pool.
    /// Before taking it, every oracle round since the last check is scanned: if
    /// one already touched the strike, the call settles YES and nothing is taken.
    function bet(uint256 id, bool yes, uint256 amount) external nonReentrant whenNotPaused {
        Call storage c = _call(id);
        if (c.settled || block.timestamp >= c.end) revert CallClosed();
        if (amount < params.minStake) revert StakeTooSmall();
        bool caughtUp = _scan(id, c, SCAN_PER_TX);
        if (c.touched) return; // settled YES just now; the bet is not taken
        if (!caughtUp) revert SyncRequired();
        (, int256 last,,,) = IPriceFeed(c.feed).latestRoundData();
        if (last > 0 && TouchMath.distanceBps(uint256(last), uint256(c.strike)) < params.betCutoffBps) revert NearStrike();
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * params.feeBps) / BPS;
        uint256 toCreator = (fee * creatorShareBps) / BPS;
        creatorFeesOwed[c.creator] += toCreator;
        treasuryFees += fee - toCreator;
        uint256 net = amount - fee;
        if (yes) {
            c.yesPool += net;
            yesStake[id][msg.sender] += net;
        } else {
            c.noPool += net;
            noStake[id][msg.sender] += net;
        }
        c.volume += amount;
        stats[c.creator].volume += uint128(amount);
        emit Bet(id, msg.sender, yes, amount, fee, c.yesPool, c.noPool);
    }

    /// @notice Anyone: prove the call touched with an oracle round published
    /// inside the window. Settles YES at once.
    function proveTouch(uint256 id, uint80 roundId) external nonReentrant {
        Call storage c = _call(id);
        if (c.touched || c.settled) revert AlreadyFinal();
        if (block.timestamp > uint256(c.end) + params.grace) revert ProofTooLate();
        (, int256 price,, uint256 updatedAt,) = IPriceFeed(c.feed).getRoundData(roundId);
        if (price <= 0 || updatedAt == 0) revert BadPrice();
        if (updatedAt < c.start || updatedAt > c.end) revert RoundOutsideWindow();
        if (c.above ? price < c.strike : price > c.strike) revert NoTouch();
        _touch(id, c, roundId, price, updatedAt);
    }

    /// @notice Anyone: check oracle rounds not yet checked (up to `maxRounds`);
    /// a crossing round inside the window settles the call YES.
    /// @return caughtUp every round that matters has now been checked
    function sync(uint256 id, uint256 maxRounds) external nonReentrant returns (bool caughtUp) {
        Call storage c = _call(id);
        if (c.settled) return true;
        caughtUp = _scan(id, c, maxRounds == 0 ? SCAN_PER_TX : maxRounds);
    }

    /// @notice Anyone, after the deadline and grace period: settles NO, but
    /// only once every oracle round up to the deadline has been checked (a
    /// crossing round found on the way settles it YES instead).
    function settle(uint256 id) external nonReentrant {
        Call storage c = _call(id);
        if (c.settled) revert AlreadyFinal();
        if (block.timestamp <= uint256(c.end) + params.grace) revert TooEarly();
        bool caughtUp = _scan(id, c, SCAN_PER_TX);
        if (c.settled) return; // a touch was found
        if (!caughtUp) revert SyncRequired();
        _settle(id, c, false);
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
        return r >= latest;
    }

    function _touch(uint256 id, Call storage c, uint80 roundId, int256 price, uint256 updatedAt) internal {
        c.touched = true;
        c.touchRound = roundId;
        c.touchPrice = price;
        emit Touched(id, roundId, price, updatedAt, msg.sender);
        _settle(id, c, true);
    }

    function _settle(uint256 id, Call storage c, bool yesWon) internal {
        c.settled = true;
        c.yesWon = yesWon;
        int64 delta = int64(int256(yesWon ? BPS : 0) - int256(uint256(c.openBps)));
        Stats storage s = stats[c.creator];
        if (yesWon) s.hits += 1;
        else s.misses += 1;
        s.skillBps += delta;
        emit Settled(id, yesWon, delta, c.creator);
    }

    /// @notice Winners take the whole pot pro rata to their winning stake.
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        Call storage c = _call(id);
        if (!c.settled) revert NotSettled();
        if (claimed[id][msg.sender]) revert NothingToClaim();
        amount = _payout(c, c.yesWon ? yesStake[id][msg.sender] : noStake[id][msg.sender], c.yesWon);
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
        net = amount - (amount * params.feeBps) / BPS;
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
    function previewOpenBps(address feed, int256 strike, uint64 end) external view returns (uint256 openBps, int256 spot) {
        Feed memory f = feeds[feed];
        if (!f.enabled) revert FeedNotEnabled();
        (, spot,,,) = IPriceFeed(feed).latestRoundData();
        if (spot <= 0 || strike <= 0 || end <= block.timestamp) revert BadPrice();
        openBps = TouchMath.touchProbabilityBps(uint256(spot), uint256(strike), f.volBps, end - block.timestamp);
    }
}
