// Launch parameters for ThesisCalls (v2), shared by deploy, verification and the dev chain.
const USDC = 1_000_000n;

const LAUNCH_PARAMS = {
  feeBps: 200, // 2% per bet: half to the call's creator, half to the treasury
  minSeed: 2n * USDC,
  maxSeed: 250n * USDC,
  minStake: 500_000n, // 0.5 QUSDC
  minWindow: 30 * 60,
  maxWindow: 8 * 86_400,
  grace: 300,
  // QIE Oracle rounds: median 3-6 min apart, p90 13-30 min, longest seen 4.2 h
  // (measured over 600 rounds per feed, 26 Nov 2026). Older prints are still
  // usable, but need a strike z*sigma*sqrt(age) away (staleZTenths).
  maxOracleAge: 3 * 3600,
  maxVolAge: 14 * 86_400,
  minDistanceBps: 100, // 1% from the latest price
  maxDistanceBps: 5_000,
  minOpenBps: 100,
  maxOpenBps: 9_900,
  betCutoffBps: 25,
  staleZTenths: 30, // z = 3
  closeBps: 1_000, // betting closes in the last 10% of the window
  voidAfter: 3 * 86_400, // no oracle print 3 days past the deadline: void, refund all
  minScoredVolume: 5n * USDC, // calls need 5 QUSDC of outside bets to count toward skill
};

// 7-day realised volatility and median gap between rounds (seconds, for the
// discrete-monitoring correction), measured from QIE Oracle history on
// 26 Nov 2026 (BTC 1730 rounds, ETH 1991, SOL 972). The keeper keeps them current.
const FEEDS = {
  BTC: { address: "0x9E596d809a20A272c788726f592c0d1629755440", volBps: 7_100, monitorSecs: 177 },
  ETH: { address: "0x4bb7012Fbc79fE4Ae9B664228977b442b385500d", volBps: 8_140, monitorSecs: 122 },
  SOL: { address: "0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21", volBps: 6_800, monitorSecs: 239 },
};

const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

module.exports = { USDC, LAUNCH_PARAMS, FEEDS, QUSDC };
