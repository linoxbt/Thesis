// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TouchMathLib as TouchMath} from "./TouchMathLib.sol";

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
/// distance, time and volatility) and opens two pools seeded at those odds,
/// in the stake its creator chose: native QIE or a whitelisted token (QUSDC).
/// The crowd backs it (YES) or challenges it (NO). Anyone can prove a
/// touch with a QIE Oracle round inside the window, which settles YES at once;
/// otherwise it settles NO after the deadline plus a grace period. Winners
/// split the whole pot. Each settled call updates the creator's onchain skill
/// score: (1 if hit, else 0) minus the opening odds. Whether a call counts
/// toward skill is fixed when it's posted (its seed is at least the token's
/// minScoredSeed), so nobody can pick afterwards which calls count.
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
/// - posting needs the strike at least z*sigma*sqrt(age) away from the latest
///   print (age = how old it is), so the market can't already be through it,
///   and opening odds are priced over the unseen time since that print;
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
        OracleTimeout, // no oracle round after the deadline within voidAfter, or the feed broke
        Emergency // owner, long after voidAfter, when the oracle can never settle it (e.g. its round ids jumped)
    }

    /// @notice How long after a call's void period the owner may void it outright.
    uint256 public constant EMERGENCY_AFTER = 30 days;
    /// @notice The keeper may move a feed's volatility by at most 2x, at most once an hour.
    uint256 public constant VOL_UPDATE_GAP = 1 hours;

    // ------------------------------------------------------------ config

    /// @notice The stake "token" for native QIE (sent as value, paid back as value).
    address public constant NATIVE = address(0);
    /// @notice Creators' share of each trade fee, in bps of the fee. Fixed at deploy.
    uint16 public immutable creatorShareBps;

    address public owner;
    address public pendingOwner;
    address public keeper;
    address public treasury;
    bool public paused;

    struct Params {
        uint16 feeBps; // per bet, of the amount (200 = 2%); <= 500
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
    }

    Params public params;

    /// @notice What a call can be staked in, with its amounts in that token's units.
    struct StakeToken {
        bool enabled; // new calls can use it (open calls keep working either way)
        uint128 minSeed;
        uint128 maxSeed;
        uint128 minStake; // smallest bet
        uint128 minScoredSeed; // a call counts toward skill if its seed is at least this (decided at posting)
    }

    mapping(address => StakeToken) public stakeTokens;
    address[] public stakeTokenList;

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
        address token; // stake: NATIVE (QIE) or a whitelisted ERC20
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
        bool scored; // counts toward the creator's skill: decided at posting (seed >= minScoredSeed)
        bool hasRefund; // bets of round `refundRound` are refunded in full (fee included)
        uint80 refundRound;
        uint16 betCutoffBps; // fixed at posting
        uint32 maxOracleAge; // fixed at posting
        uint128 minStake; // smallest bet, fixed at posting
        uint256 yesPool; // net of fees
        uint256 noPool;
        uint256 volume; // gross bets
        uint256 outsideVolume; // gross bets by others than the creator (refunded ones excluded); informational
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
        uint128 outsideYes; // the YES part of each total (only YES bets are refunded at a touch)
        uint128 creatorFeeYes;
        uint128 treasuryFeeYes;
    }

    /// @notice A wallet's bets in its latest round (see Pending).
    struct UserPending {
        uint80 round;
        uint128 yesNet;
        uint128 noNet;
        uint128 gross;
        uint128 yesGross; // the YES part of gross
    }

    Call[] internal calls;
    mapping(uint256 => string) public callText;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => Pending) public pending;
    mapping(uint256 => mapping(address => UserPending)) internal userPending;

    struct Stats {
        uint32 posted;
        uint32 hits;
        uint32 misses;
        int64 skillBps; // sum over scored calls of (hit ? 10000 : 0) - openBps
        uint32 scored; // settled calls that count toward skill (seeded at least minScoredSeed)
    }

    mapping(address => Stats) public stats;
    /// @dev Who called voidCall, while its self-call scan runs (for the Touched event).
    address private _prover;
    address[] public creators;
    /// @notice Creator => stake token => fees owed.
    mapping(address => mapping(address => uint256)) public creatorFeesOwed;
    /// @notice Stake token => treasury fees owed.
    mapping(address => uint256) public treasuryFees;

    // ------------------------------------------------------------ events

    event CallCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed feed,
        address token,
        bool above,
        int256 strike,
        int256 spot,
        uint64 start,
        uint64 end,
        uint16 openBps,
        uint256 seed,
        string text
    );
    /// @param round the oracle round that was latest when the bet was placed (its refund tag)
    event Bet(uint256 indexed id, address indexed user, bool yes, uint256 amount, uint256 fee, uint256 yesPool, uint256 noPool, uint80 round);
    event Touched(uint256 indexed id, uint80 roundId, int256 price, uint256 updatedAt, address prover);
    event Settled(uint256 indexed id, bool yesWon, int64 skillDeltaBps, address indexed creator, bool scored);
    event Voided(uint256 indexed id, VoidReason reason);
    event Synced(uint256 indexed id, uint80 checkedRound, bool caughtUp);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount, address to);
    event CreatorFeesClaimed(address indexed creator, address indexed token, uint256 amount, address to);
    event TreasuryWithdrawn(address indexed to, address indexed token, uint256 amount);
    event StakeTokenSet(address indexed token, StakeToken config);
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
    error TokenNotEnabled();
    error BadValue();
    error PayoutFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(address treasury_, address keeper_, uint16 creatorShareBps_, Params memory params_) {
        if (treasury_ == address(0) || creatorShareBps_ > BPS) revert BadParams();
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
            p.feeBps > 500 || p.minWindow < 300
                || p.minWindow > p.maxWindow || p.maxWindow > 30 days || p.grace < 60 || p.grace > 1 days
                || p.maxOracleAge == 0 || p.maxOracleAge > 1 days || p.maxVolAge == 0 || p.minDistanceBps == 0
                || p.minDistanceBps > p.maxDistanceBps || p.maxDistanceBps > 9_000 || p.minOpenBps < 100
                || p.minOpenBps > p.maxOpenBps || p.maxOpenBps > 9_900 || p.betCutoffBps > 500
                || p.betCutoffBps >= p.minDistanceBps || p.staleZTenths < 10 || p.staleZTenths > 60
                || p.closeBps > 5_000 || p.voidAfter < 1 days || p.voidAfter > 30 days
        ) revert BadParams();
        // A pool must start with stake on both sides: seed * minOpenBps / BPS > 0.
        for (uint256 i; i < stakeTokenList.length; i++) {
            if ((uint256(stakeTokens[stakeTokenList[i]].minSeed) * p.minOpenBps) / BPS == 0) revert BadParams();
        }
        params = p;
        emit ParamsSet(p);
    }

    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    /// @notice Add a stake token (NATIVE for QIE), or change its amounts or
    /// enable it. Calls already open keep their token, minimum bet and scoring
    /// threshold. Only plain tokens: what arrives must equal what was sent (no
    /// fee-on-transfer or rebasing tokens).
    function setStakeToken(address token, StakeToken calldata t) external onlyOwner {
        if (
            t.minSeed == 0 || t.minSeed > t.maxSeed || t.minStake == 0 || t.minScoredSeed == 0 || t.minScoredSeed > t.maxSeed
                || (uint256(t.minSeed) * params.minOpenBps) / BPS == 0
        ) revert BadParams();
        if (token != NATIVE && token.code.length == 0) revert BadParams();
        bool known;
        for (uint256 i; i < stakeTokenList.length; i++) {
            if (stakeTokenList[i] == token) known = true;
        }
        if (!known) stakeTokenList.push(token);
        stakeTokens[token] = t;
        emit StakeTokenSet(token, t);
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
        // The keeper's key is a hot key: it may move volatility (which sets new
        // calls' odds) by at most 2x, at most once an hour. The owner isn't bound.
        if (msg.sender != owner) {
            uint256 old = feeds[feed].volBps;
            if (block.timestamp < uint256(feeds[feed].volUpdatedAt) + VOL_UPDATE_GAP || volBps > old * 2 || uint256(volBps) * 2 < old) revert BadParams();
        }
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

    /// @notice Pays the treasury's fees in `token` to the treasury.
    function withdrawTreasury(address token) external nonReentrant {
        if (msg.sender != owner && msg.sender != treasury) revert Unauthorized();
        uint256 amount = treasuryFees[token];
        if (amount == 0) revert NothingToClaim();
        treasuryFees[token] = 0;
        _pay(token, treasury, amount);
        emit TreasuryWithdrawn(treasury, token, amount);
    }

    /// @dev Takes `amount` of `token` from the sender: native QIE must come as
    /// exactly that much value; a token must come with no value.
    function _pull(address token, uint256 amount) internal {
        if (token == NATIVE) {
            if (msg.value != amount) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /// @dev Pays `amount` of `token` to `to`. Every payout goes where its owner
    /// asked (the caller, an address the caller named, or the treasury), so a
    /// recipient that refuses QIE only blocks its own payout.
    function _pay(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            bool ok;
            assembly ("memory-safe") {
                ok := call(gas(), to, amount, 0, 0, 0, 0) // no return data copied
            }
            if (!ok) revert PayoutFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ------------------------------------------------------------ calls

    /// @notice Post a call: `feed` touches `strike` (feed units) before `end`.
    /// The creator's `seed`, in `token` (NATIVE: send it as value), opens both
    /// pools at the onchain odds; every bet on the call uses the same token.
    function createCall(
        address token,
        address feed,
        bool above,
        int256 strike,
        uint64 end,
        uint256 seed,
        string calldata text
    )
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        Params memory p = params;
        StakeToken memory t = stakeTokens[token];
        if (!t.enabled) revert TokenNotEnabled();
        if (bytes(text).length > MAX_TEXT_BYTES) revert TextTooLong();
        if (seed < t.minSeed || seed > t.maxSeed) revert BadSeed();
        if (end <= block.timestamp) revert BadWindow();
        uint256 window = end - block.timestamp;
        if (window < p.minWindow || window > p.maxWindow) revert BadWindow();
        (uint256 open, int256 spot, uint80 roundId, uint256 updatedAt) = _price(feed, above, strike, end, p);

        _pull(token, seed);
        uint256 yes = (seed * open) / BPS;
        uint256 no = seed - yes;

        id = calls.length;
        Call storage c = calls.push();
        c.creator = msg.sender;
        c.feed = feed;
        c.token = token;
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
        c.scored = seed >= t.minScoredSeed;
        c.betCutoffBps = p.betCutoffBps;
        c.maxOracleAge = p.maxOracleAge;
        c.minStake = t.minStake;
        c.yesPool = yes;
        c.noPool = no;
        if (bytes(text).length > 0) callText[id] = text;
        yesStake[id][msg.sender] = yes;
        noStake[id][msg.sender] = no;

        Stats storage s = stats[msg.sender];
        if (s.posted == 0 && s.hits == 0 && s.misses == 0) creators.push(msg.sender);
        s.posted += 1;
        emit CallCreated(id, msg.sender, feed, token, above, strike, spot, uint64(block.timestamp), end, uint16(open), seed, text);
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
    /// Betting closes at `closeAt`, while the latest print is too old
    /// (maxOracleAge), and while the strike is within betCutoffBps of it.
    function bet(uint256 id, bool yes, uint256 amount) external payable nonReentrant whenNotPaused {
        Call storage c = _call(id);
        if (c.settled || block.timestamp >= c.closeAt) revert CallClosed();
        if (amount < c.minStake) revert StakeTooSmall();
        if (amount > type(uint128).max) revert BadValue();
        bool caughtUp = _scan(id, c, SCAN_PER_TX);
        if (c.settled) {
            // Touched (or voided) just now: the bet is not taken. Value sent
            // for it goes back (a token bet was never pulled).
            if (msg.value != 0) _pay(NATIVE, msg.sender, msg.value);
            return;
        }
        if (!caughtUp) revert SyncRequired();
        (uint256 needBps, uint256 distBps, uint80 tag) = _betGap(c);
        if (distBps < needBps) revert NearStrike();
        _pull(c.token, amount);

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
        if (up.round != tag) userPending[id][msg.sender] = UserPending({round: tag, yesNet: 0, noNet: 0, gross: 0, yesGross: 0});
        up.gross += uint128(amount);
        if (yes) {
            c.yesPool += net;
            yesStake[id][msg.sender] += net;
            pd.yesNet += uint128(net);
            up.yesNet += uint128(net);
            up.yesGross += uint128(amount);
            pd.creatorFeeYes += uint128(toCreator);
            pd.treasuryFeeYes += uint128(fee - toCreator);
            if (msg.sender != c.creator) pd.outsideYes += uint128(amount);
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
        emit Bet(id, msg.sender, yes, amount, fee, c.yesPool, c.noPool, tag);
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
        if (age > c.maxOracleAge) revert StaleOracle();
        // No age-scaled margin for bets: a bet on a move the oracle hasn't
        // printed yet is refunded when the next round shows it (see Pending),
        // so a stale print can't be traded. Posting keeps the margin (it sets
        // the opening odds and the creator's skill).
        needBps = c.betCutoffBps;
        // A latest print already at or past the strike leaves no gap at all.
        bool crossed = c.above ? last >= c.strike : last <= c.strike;
        distBps = crossed ? 0 : TouchMath.distanceBps(uint256(last), uint256(c.strike));
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
    /// Oracle trust: the feeds are QIE Oracle aggregators whose round ids go up
    /// by one. A round the feed can't return is skipped; a feed that stops
    /// answering at all lets the call be voided (everyone refunded).
    function voidCall(uint256 id) external nonReentrant {
        Call storage c = _call(id);
        if (c.settled) revert AlreadyFinal();
        if (block.timestamp <= uint256(c.end) + c.voidAfter) revert TooEarly();
        bool scanned;
        bool caughtUp;
        uint256 g = gasleft();
        _prover = msg.sender; // a touch found by this scan is credited to the caller
        try this.scanFor(id, PROVE_SCAN_MAX) returns (bool cu) {
            scanned = true;
            caughtUp = cu;
        } catch {
            // A broken feed reverts quickly; running out of gas doesn't count.
            if (gasleft() <= g / 63) revert OutOfGas();
        }
        _prover = address(0);
        if (c.settled) return; // a touch was found
        if (scanned) {
            if (c.scanDone) return _settle(id, c, false); // the oracle did print past the deadline: NO
            // A backlog the scan hasn't reached yet may still hold a touch:
            // never void over it. `sync` catches up any backlog in steps.
            if (!caughtUp) revert SyncRequired();
        }
        _void(id, c, VoidReason.OracleTimeout);
    }

    /// @notice Owner, EMERGENCY_AFTER past a call's void period: voids a call the
    /// oracle can never settle (e.g. its feed's round ids jumped, so the scan
    /// can't catch up), refunding every stake. Funds are never stuck for good.
    function emergencyVoid(uint256 id) external onlyOwner nonReentrant {
        Call storage c = _call(id);
        if (c.settled) revert AlreadyFinal();
        if (block.timestamp <= uint256(c.end) + c.voidAfter + EMERGENCY_AFTER) revert TooEarly();
        _void(id, c, VoidReason.Emergency);
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
        creatorFeesOwed[c.creator][c.token] += pd.creatorFee;
        treasuryFees[c.token] += pd.treasuryFee;
        _clearPending(pd);
    }

    function _clearPending(Pending storage pd) internal {
        pd.creatorFee = 0;
        pd.treasuryFee = 0;
        pd.yesNet = 0;
        pd.noNet = 0;
        pd.outside = 0;
        pd.outsideYes = 0;
        pd.creatorFeeYes = 0;
        pd.treasuryFeeYes = 0;
    }

    function _touch(uint256 id, Call storage c, uint80 roundId, int256 price, uint256 updatedAt) internal {
        c.touched = true;
        c.touchRound = roundId;
        c.touchPrice = price;
        c.touchAt = uint64(updatedAt);
        emit Touched(id, roundId, price, updatedAt, msg.sender == address(this) ? _prover : msg.sender);
        // Touched in the very first round after posting (or within VOID_WINDOW):
        // the call was posted into a move the oracle hadn't printed yet. Void it.
        if (roundId == c.openRound + 1 || updatedAt < uint256(c.start) + VOID_WINDOW) {
            _void(id, c, VoidReason.EarlyTouch);
            return;
        }
        // YES bets placed while the round just before this one was the latest
        // were betting on a move not yet printed: refund them in full (their
        // fees are still in escrow). NO bets of that round are final: refunding
        // them would hand NO bettors a free option on the next print.
        Pending storage pd = pending[id];
        if (uint256(pd.round) + 1 == roundId && pd.yesNet > 0) {
            c.voidYes = pd.yesNet;
            c.hasRefund = true;
            c.refundRound = pd.round;
            c.outsideVolume -= pd.outsideYes;
            creatorFeesOwed[c.creator][c.token] += pd.creatorFee - pd.creatorFeeYes; // the NO side's fees are earned
            treasuryFees[c.token] += pd.treasuryFee - pd.treasuryFeeYes;
            _clearPending(pd);
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
        if (!yesWon) _release(c, pending[id]);
        // Whether a call counts toward skill was fixed when it was posted (by
        // the size of the creator's own seed), so nobody can choose afterwards
        // which calls count.
        bool scored = c.scored;
        if (scored) {
            // Hits and misses count scored calls only, like skill: practice
            // calls can't pad the record.
            if (yesWon) s.hits += 1;
            else s.misses += 1;
            s.skillBps += delta;
            s.scored += 1;
        } else {
            delta = 0;
        }
        emit Settled(id, yesWon, delta, c.creator, scored);
    }

    /// @dev Bets of the pending round get their full stake back, fee included
    /// (their fees were still in escrow, so they fund it).
    function _refundPending(Call storage c, Pending storage pd) internal {
        c.hasRefund = true;
        c.refundRound = pd.round;
        c.outsideVolume -= pd.outside;
        pd.creatorFee = 0;
        pd.treasuryFee = 0;
        pd.creatorFeeYes = 0;
        pd.treasuryFeeYes = 0;
    }

    function _hasPending(Pending storage pd) internal view returns (bool) {
        return pd.creatorFee | pd.treasuryFee | pd.yesNet | pd.noNet | pd.outside != 0;
    }

    function _void(uint256 id, Call storage c, VoidReason reason) internal {
        // A void refunds every net stake. Bets still pending (their round not
        // yet passed) also get their fee back; fees already credited are kept.
        Pending storage pd = pending[id];
        if (_hasPending(pd)) _refundPending(c, pd);
        c.settled = true;
        c.voided = true;
        emit Voided(id, reason);
    }

    /// @notice Winners take the whole pot pro rata to their winning stake;
    /// refunded stakes (void call, or placed right before the touch) come back.
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        return _claim(id, msg.sender);
    }

    /// @notice Like `claim`, paid to `to` (for a wallet that can't receive QIE itself).
    function claimTo(uint256 id, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert BadParams();
        return _claim(id, to);
    }

    function _claim(uint256 id, address to) internal returns (uint256 amount) {
        Call storage c = _call(id);
        if (!c.settled) revert NotSettled();
        if (claimed[id][msg.sender]) revert NothingToClaim();
        amount = _claimable(id, c, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[id][msg.sender] = true;
        _pay(c.token, to, amount);
        emit Claimed(id, msg.sender, amount, to);
    }

    /// @notice Withdraw your creator fees in `token` (NATIVE for QIE).
    function claimCreatorFees(address token) external nonReentrant returns (uint256 amount) {
        return _claimCreatorFees(token, msg.sender);
    }

    /// @notice Like `claimCreatorFees`, paid to `to`.
    function claimCreatorFeesTo(address token, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert BadParams();
        return _claimCreatorFees(token, to);
    }

    function _claimCreatorFees(address token, address to) internal returns (uint256 amount) {
        amount = creatorFeesOwed[msg.sender][token];
        if (amount == 0) revert NothingToClaim();
        creatorFeesOwed[msg.sender][token] = 0;
        _pay(token, to, amount);
        emit CreatorFeesClaimed(msg.sender, token, amount, to);
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
        UserPending storage up = userPending[id][user];
        bool refunded = c.hasRefund && up.round == c.refundRound && up.gross > 0;
        // Void: every net stake back, plus the fees of refunded (pending) bets.
        if (c.voided) return y + n + (refunded ? up.gross - up.yesNet - up.noNet : 0);
        if (!c.yesWon) return _payout(c, n, false);
        // YES: bets placed in the round just before the touch are refunded in
        // full (fee included); the rest share the pot left once they're out.
        uint256 refund;
        uint256 stake = y;
        if (refunded) {
            refund = up.yesGross; // the YES bets of that round, fee included (NO bets lost)
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
        if (c.settled) {
            // Settled: what the outcome actually pays (refunds included); void pays neither side.
            uint256 got = c.voided ? 0 : _claimable(id, c, user);
            payoutIfYes = c.yesWon ? got : 0;
            payoutIfNo = c.yesWon ? 0 : got;
        } else {
            payoutIfYes = _payout(c, yes, true);
            payoutIfNo = _payout(c, no, false);
        }
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
        needBps = c.betCutoffBps;
        int256 last;
        uint256 updatedAt;
        try IPriceFeed(c.feed).latestRoundData() returns (uint80, int256 l, uint256, uint256 u, uint80) {
            (last, updatedAt) = (l, u);
        } catch {
            return (false, needBps, 0, type(uint256).max); // the feed isn't answering
        }
        oracleAge = updatedAt > block.timestamp ? 0 : block.timestamp - updatedAt;
        // (Indicative: bet() also checks unscanned rounds first.)
        if (last > 0 && !(c.above ? last >= c.strike : last <= c.strike)) {
            distBps = TouchMath.distanceBps(uint256(last), uint256(c.strike));
        }
        open = !paused && !c.settled && block.timestamp < c.closeAt && oracleAge <= c.maxOracleAge && last > 0
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

    function stakeTokenCount() external view returns (uint256) {
        return stakeTokenList.length;
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
